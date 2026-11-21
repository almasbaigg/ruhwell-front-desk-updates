// Faxes (Doximity): reads Maria's Doximity fax inbox in a hidden, signed-in window (Doximity has no API for
// this), downloads each new fax as a PDF and keeps it encrypted on this computer. Nothing is changed in
// Doximity. Filing a fax into a patient's RxNT chart happens only after Maria picks the patient and confirms
// (see main.js and rxnt-reader.uploadToChart). Filed faxes are cleared from the app after 30 days.
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const PART = 'persist:doximity';
const INBOX = 'https://www.doximity.com/inbox/faxes';
const SIGNIN = 'https://www.doximity.com/signin';
const AUTH_OK = /^https:\/\/([\w-]+\.)*doximity\.com(\/|$)/i;   // only Doximity's own pages ever see the saved sign-in
const INDEX = 'faxes.bin', DIR = 'Faxes', CRED = 'doximity-login.bin';
const KEEP_FILED_DAYS = 30, FIRST_RUN_DAYS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argCode = (args) => args.map((a) => (a === undefined ? 'undefined' : JSON.stringify(a))).join(',');
const call = (win, fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(${argCode(args)})`, true).catch(() => ({ state: 'loading' }));

let last = { connected: false, error: null, at: null, account: '', lastNewAt: null };
const status = () => ({ ...last, count: list().filter((f) => f.status === 'new').length });

function makeWindow(show, parent) {
  const win = new BrowserWindow({
    show, parent, modal: !!parent, width: 1200, height: 860, title: 'Sign in to Doximity', autoHideMenuBar: true,
    webPreferences: { partition: PART, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (AUTH_OK.test(url)) win.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  return win;
}

/* ---------- Stored faxes (encrypted) ---------- */
const index = () => store.raw.readSecure(INDEX, { items: [], seeded: null });
const saveIndex = (v) => store.raw.writeSecure(INDEX, v);
const list = () => (index().items || []).slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
function pdf(id) { const r = store.raw.readSecure(path.join(DIR, `${safe(id)}.bin`), null); return r && r.data ? r : null; }
const safe = (id) => String(id).replace(/[^\w-]/g, '_').slice(0, 80);
function update(id, patch) { const ix = index(); const i = (ix.items || []).findIndex((f) => f.id === id); if (i < 0) return null; ix.items[i] = { ...ix.items[i], ...patch }; saveIndex(ix); return ix.items[i]; }
function prune() {
  const ix = index(), cutoff = Date.now() - KEEP_FILED_DAYS * 864e5;
  const keep = [], drop = [];
  for (const f of ix.items || []) (['filed', 'notpatient', 'spam'].includes(f.status) && new Date(f.doneAt || f.at || 0) < cutoff ? drop : keep).push(f);
  if (!drop.length) return;
  for (const f of drop) try { fs.rmSync(store.raw.file(path.join(DIR, `${safe(f.id)}.bin`)), { force: true }); } catch {}
  saveIndex({ ...ix, items: keep });
}

/* ---------- Saved sign-in (same rules as RxNT) ---------- */
const savedLogin = () => { const c = store.raw.readSecure(CRED, null); return c && c.u && c.p ? c : null; };
const saveLogin = (u, p) => { if (!u || !p) return; try { store.raw.writeSecure(CRED, { u, p, at: new Date().toISOString() }); } catch {} };
const markLoginBad = () => { const c = savedLogin(); if (c) try { store.raw.writeSecure(CRED, { ...c, bad: new Date().toISOString() }); } catch {} };
function forgetLogin() { const f = store.raw.file(CRED); try { fs.rmSync(f, { force: true }); } catch {} return !fs.existsSync(f); }
const loginState = () => { const c = store.raw.readSecure(CRED, null); return c && c.u ? (c.bad ? 'bad' : 'ok') : ''; };

function readLoginBoxes() {
  const u = document.querySelector('input[type=email], input[autocomplete=username], input[name*=email i], input[id*=email i], input[name*=login i]');
  const p = document.querySelector('input[type=password]');
  return { u: u && u.value ? u.value : '', p: p && p.value ? p.value : '' };
}
function autofillStep(u, pw, submit) {
  const vis = (el) => el && el.offsetParent !== null;
  const text = (document.body && document.body.innerText || '').toLowerCase();
  if (/inbox\/faxes/.test(location.pathname) && document.querySelector('a[href*="/inbox/faxes/"]')) return { step: 'in' };
  if (/incorrect|invalid (email|pass|login|cred)|wrong password|not recognized|locked/.test(text)) return { step: 'bad' };
  const pass = [...document.querySelectorAll('input[type=password]')].find(vis);
  const user = [...document.querySelectorAll('input[type=email], input[autocomplete=username], input[name*=email i], input[id*=email i], input[name*=login i]')].find(vis);
  if (!pass && /verification code|one-time|authenticator|enter the code|security code|we sent a code/.test(text)) return { step: 'code' };
  const step = pass ? 'password' : user ? 'username' : 'wait';
  if (!submit || step === 'wait') return { step };
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  if (user && user.value !== u) set(user, u);
  if (pass) set(pass, pw);
  const btn = [...document.querySelectorAll('button, input[type=submit]')].filter(vis).find((b) => /sign in|log ?in|continue|next|submit/i.test(b.innerText || b.value || '') || b.type === 'submit');
  if (btn) btn.click(); else { const f = (pass || user).form; if (f) f.requestSubmit ? f.requestSubmit() : f.submit(); }
  return { step, submitted: true };
}
// Session cookies are thrown away on restart; keep them like RxNT's so the app stays signed in.
async function keepSignedIn() {
  const ses = session.fromPartition(PART);
  try {
    const cookies = await ses.cookies.get({});
    const until = Math.floor(Date.now() / 1000) + 30 * 86400;
    for (const c of cookies.filter((x) => x.session && /doximity\.com$/.test(x.domain.replace(/^\./, '')))) {
      await ses.cookies.set({ url: `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, name: c.name, value: c.value, path: c.path, domain: c.hostOnly ? undefined : c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: until }).catch(() => {});
    }
    await ses.cookies.flushStore();
  } catch {}
}
// Quiet re-sign-in with the saved sign-in: each step submitted at most once; a wrong password stops it.
async function autoSignIn() {
  const c = savedLogin(); if (!c || c.bad) return 'failed';
  const win = makeWindow(false);
  try {
    await win.loadURL(SIGNIN).catch(() => {});
    const end = Date.now() + 60000, done = new Set();
    while (Date.now() < end && !win.isDestroyed()) {
      await sleep(1500);
      const url = win.webContents.getURL();
      if (!AUTH_OK.test(url)) return 'failed';
      if (!/signin|sign_in|login|session|auth/i.test(url) && /doximity\.com/.test(url)) { await win.loadURL(INBOX).catch(() => {}); await sleep(2500); const ok = await call(win, autofillStep, '', '', false); if (ok.step === 'in') { await keepSignedIn(); return 'ok'; } }
      const look = await call(win, autofillStep, '', '', false);
      if (look.step === 'in') { await keepSignedIn(); return 'ok'; }
      if (look.step === 'bad') { markLoginBad(); return 'bad'; }
      if (look.step === 'code') return 'code';
      if ((look.step === 'username' || look.step === 'password') && !done.has(look.step)) { done.add(look.step); await call(win, autofillStep, c.u, c.p, true); }
      else if (look.step === 'password' && done.has('password')) { await sleep(3000); const again = await call(win, autofillStep, '', '', false); if (again.step === 'password' || again.step === 'bad') { markLoginBad(); return 'bad'; } }
    }
    return 'failed';
  } finally { if (!win.isDestroyed()) win.destroy(); }
}
// Visible sign-in. What's typed is remembered in memory and saved (encrypted) only once Doximity lets you in.
function signIn(parent) {
  return new Promise((resolve) => {
    const win = makeWindow(true, parent);
    let done = false; const typed = { u: '', p: '' };
    const finish = async (ok) => { if (done) return; done = true; clearInterval(peek); if (ok) { if (typed.u && typed.p) saveLogin(typed.u, typed.p); await keepSignedIn(); last = { ...last, connected: true, error: null }; } if (!win.isDestroyed()) win.destroy(); resolve(ok); };
    win.on('closed', () => finish(false));
    const peek = setInterval(async () => {
      if (done || win.isDestroyed() || !AUTH_OK.test(win.webContents.getURL())) return;
      const v = await call(win, readLoginBoxes); if (v && v.u) typed.u = v.u; if (v && v.p) typed.p = v.p;
      const url = win.webContents.getURL();
      if (/doximity\.com/.test(url) && !/signin|sign_in|login|session|auth|verify/i.test(url)) {
        if (!/inbox\/faxes/.test(url)) win.loadURL(INBOX).catch(() => {});
        else { const s = await call(win, autofillStep, '', '', false); if (s.step === 'in') finish(true); }
      }
    }, 600);
    win.loadURL(SIGNIN).catch(() => {});
    setTimeout(() => finish(false), 15 * 60000);
  });
}
async function signOut() { await session.fromPartition(PART).clearStorageData(); last = { connected: false, error: null, at: null, account: '', lastNewAt: last.lastNewAt }; }

/* ---------- Reading the inbox ---------- */
// The sidebar list: day headings, then one link per fax (sender, fax number, pages, time).
function readInbox() {
  const text = (document.body && document.body.innerText || '').toLowerCase();
  if (/signin|sign_in|login/.test(location.pathname) || document.querySelector('input[type=password]')) return { state: 'login' };
  if (!/inbox\/faxes/.test(location.pathname)) return { state: 'elsewhere', url: location.href };
  const links = [...document.querySelectorAll('a[href*="/inbox/faxes/Fax::"]')];
  if (!links.length) return /no faxes|inbox is empty|you have no/.test(text) ? { state: 'ok', items: [] } : { state: 'wait' };
  const items = [];
  // Walk the page in order so each fax gets the nearest day heading above it.
  const all = [...document.querySelectorAll('.sidebar-list-section-title, a[href*="/inbox/faxes/Fax::"]')];
  let day = 'Today';
  for (const el of all) {
    if (el.matches('.sidebar-list-section-title')) { day = el.textContent.trim(); continue; }
    const href = el.getAttribute('href') || '';
    const id = decodeURIComponent(href.split('/inbox/faxes/')[1] || '').replace(/^Fax::InboundFax\//, '');
    if (!id || !/InboundFax/.test(decodeURIComponent(href))) continue;
    const li = el.closest('li') || el.parentElement;
    const q = (sel) => { const x = el.querySelector(sel) || (li && li.querySelector(sel)); return x ? x.textContent.trim() : ''; };
    const time = [...(li || el).querySelectorAll('span')].map((s) => s.textContent.trim()).find((t) => /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(t)) || '';
    items.push({ id, href, from: q('.dox-side-nav-item-title-text').replace(/\s+/g, ' '), number: q('.fax-sidebar-item-number'), pages: parseInt(q('.fax-sidebar-item-pages'), 10) || null, day, time });
  }
  return { state: 'ok', items };
}
// "Today"/"Yesterday"/"Nov 12" + "11:46 AM" → ISO time (Doximity shows no year; a future date means last year).
function whenOf(day, time) {
  const now = new Date(); let d;
  if (/^today$/i.test(day)) d = new Date(now); else if (/^yesterday$/i.test(day)) { d = new Date(now); d.setDate(d.getDate() - 1); }
  else { d = new Date(`${day} ${now.getFullYear()}`); if (isNaN(d)) d = new Date(now); else if (d - now > 2 * 864e5) d.setFullYear(d.getFullYear() - 1); }
  const m = /^(\d{1,2}):(\d{2})\s?(AM|PM)$/i.exec(time || '');
  if (m) { let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12; d.setHours(h, Number(m[2]), 0, 0); }
  return d.toISOString();
}
// Download one fax as PDF: open it and press Doximity's own "Download PDF"; the file is caught in memory.
async function downloadPdf(win, href) {
  const ses = win.webContents.session;
  let resolveFile; const got = new Promise((r) => { resolveFile = r; });
  const tmp = path.join(store.raw.file(''), `tmp-fax-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const onDl = (_e, item) => {
    item.setSavePath(tmp);
    item.once('done', (_e2, st) => {
      try { if (st === 'completed') { const buf = fs.readFileSync(tmp); resolveFile({ data: buf.toString('base64'), mime: item.getMimeType() || 'application/pdf' }); } else resolveFile(null); }
      catch { resolveFile(null); } finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
    });
  };
  ses.on('will-download', onDl);
  // If Doximity opens the PDF in a new window instead of downloading, fetch it with the same session.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) ses.fetch(url).then(async (r) => { const ct = r.headers.get('content-type') || ''; if (r.ok && /pdf|octet/.test(ct)) resolveFile({ data: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'application/pdf' }); }).catch(() => {});
    return { action: 'deny' };
  });
  try {
    await win.loadURL('https://www.doximity.com' + href).catch(() => {});
    let clicked = false;
    for (let i = 0; i < 25 && !clicked && !win.isDestroyed(); i++) {
      await sleep(700);
      clicked = await call(win, () => { const b = document.querySelector('button[aria-label="Download PDF"]'); if (b) { b.click(); return true; } return false; });
    }
    if (!clicked) return null;
    let file = await Promise.race([got, sleep(45000).then(() => null)]);
    if (!file) {   // fallback: the TIF link Doximity puts on the page
      const tif = await call(win, () => { const a = document.querySelector('a[aria-label="Download TIF"]'); return a ? a.href : ''; });
      if (tif && /^https:\/\//.test(tif)) { const r = await ses.fetch(tif).catch(() => null); if (r && r.ok) file = { data: Buffer.from(await r.arrayBuffer()).toString('base64'), mime: 'image/tiff' }; }
    }
    return file;
  } finally { ses.removeListener('will-download', onDl); }
}

let running = false;
async function sync() {
  if (running) return { busy: true };
  if ((store.settings.get().faxes || {}).enabled === false) return { off: true };
  running = true;
  const win = makeWindow(false);
  try {
    await win.loadURL(INBOX).catch(() => {});
    const readAll = async () => {
      let r = { state: 'wait' };
      for (let i = 0; i < 30 && !win.isDestroyed(); i++) {
        await sleep(800);
        r = await call(win, readInbox);
        if (r.state === 'ok') { await sleep(800); const r2 = await call(win, readInbox); if (r2.state === 'ok' && r2.items.length === r.items.length) break; r = r2; }
        if (r.state === 'login') break;
        if (r.state === 'elsewhere' && i % 5 === 4) win.loadURL(INBOX).catch(() => {});
      }
      return r;
    };
    const signedOut = (x) => x.state === 'login' || (x.state === 'elsewhere' && /signin|login|auth/i.test(x.url || ''));
    let r = await readAll();
    if (signedOut(r)) {
      const a = await autoSignIn();
      if (a !== 'ok') { last = { ...last, connected: false, error: a === 'code' ? 'code' : 'signin', at: new Date().toISOString() }; return { error: last.error, needsLogin: true }; }
      await win.loadURL(INBOX).catch(() => {});
      r = await readAll();
    }
    if (r.state !== 'ok') { last = { ...last, error: 'failed', at: new Date().toISOString() }; return { error: 'failed' }; }
    const ix = index(), known = new Set((ix.items || []).map((f) => f.id));
    const firstRun = !ix.seeded, cutoff = Date.now() - FIRST_RUN_DAYS * 864e5;
    const fresh = [];
    for (const it of r.items) {
      if (known.has(it.id)) continue;
      const at = whenOf(it.day, it.time);
      if (firstRun && new Date(at) < cutoff) { (ix.ignored = ix.ignored || []).push(it.id); continue; }
      if ((ix.ignored || []).includes(it.id)) continue;
      fresh.push({ ...it, at });
    }
    let added = 0;
    for (const f of fresh.slice(0, 15)) {
      const file = await downloadPdf(win, f.href);
      if (!file) continue;
      fs.mkdirSync(store.raw.file(DIR), { recursive: true });
      store.raw.writeSecure(path.join(DIR, `${safe(f.id)}.bin`), file);
      ix.items = [...(ix.items || []), { id: f.id, from: f.from, number: f.number, pages: f.pages, at: f.at, mime: file.mime, status: 'new', receivedAt: new Date().toISOString() }];
      added++;
    }
    ix.seeded = ix.seeded || new Date().toISOString();
    ix.ignored = (ix.ignored || []).slice(-2000);
    saveIndex(ix);
    await keepSignedIn();
    last = { ...last, connected: true, error: null, at: new Date().toISOString(), lastNewAt: added ? new Date().toISOString() : last.lastNewAt };
    prune();
    return { ok: true, added, fresh: added ? list().filter((f) => f.status === 'new').slice(0, added) : [] };
  } catch (e) {
    last = { ...last, error: 'failed', at: new Date().toISOString() };
    return { error: 'failed' };
  } finally { running = false; if (!win.isDestroyed()) win.destroy(); }
}

module.exports = { sync, status, list, pdf, update, signIn, signOut, autoSignIn, forgetLogin, loginState, savedLogin, prune, whenOf, readInbox, KEEP_FILED_DAYS };
