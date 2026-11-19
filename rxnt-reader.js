// Reads today's schedule from RxNT using the app's own signed-in browser session.
// RxNT's scheduler page already holds each appointment (name, phones, age, status)
// in memory, so we read it straight from the page — no clicking through charts.
const { BrowserWindow, session } = require('electron');
const store = require('./store');
const fs = require('fs');

const partitionFor = (pid) => `persist:rxnt-${pid}`;
const SCHEDULER = 'https://app2.rxnt.com/SchedulerV2/#/appointment';

// Runs inside the RxNT scheduler page. `target` is YYYY-MM-DD.
function readSchedule(target) {
  if (location.host.includes('auth.rxnt.com') || /\/login/i.test(location.pathname)) return { state: 'login' };
  if (!location.href.includes('SchedulerV2')) return { state: 'elsewhere', url: location.href };
  if (!/#\/appointment/.test(location.hash)) { location.hash = '#/appointment'; return { state: 'navigating' }; }
  const calEl = document.querySelector('.fc');
  if (!calEl || !window.angular) return { state: 'loading' };
  let cal = null;
  try { cal = angular.element(document.body).injector().get('uiCalendarConfig').calendars.myCalendar; } catch (e) {}
  if (!cal || !cal.fullCalendar) return { state: 'loading' };
  const shown = cal.fullCalendar('getDate').format('YYYY-MM-DD');
  if (target && shown !== target) {
    // RxNT can refuse some days (e.g. weekends hidden). After a few tries, report the day as closed.
    const nav = (window.__rmNav && window.__rmNav.target === target) ? window.__rmNav : (window.__rmNav = { target, n: 0, t: Date.now() });
    nav.n++;
    if (nav.n > 4 && Date.now() - nav.t > 1500) {
      let inView = false;
      try { const v = cal.fullCalendar('getView'); inView = v.start.format('YYYY-MM-DD') <= target && target < v.end.format('YYYY-MM-DD'); } catch (e) {}
      // Only weekends (which RxNT hides) count as closed. Any other day RxNT won't open is "couldn't read",
      // never an empty day, or every visit on it would look cancelled.
      const dow = new Date(target + 'T12:00:00').getDay();
      if (!inView) return dow === 0 || dow === 6 ? { state: 'ok', pending: 0, date: target, closed: true, dateLabel: '', items: [], blocks: [] } : { state: 'navfail' };
    }
    cal.fullCalendar('gotoDate', target); return { state: 'navigating' };
  }
  window.__rmNav = null;
  const scope = angular.element(calEl).isolateScope();
  if (!scope || !scope.eventSources) return { state: 'loading' };
  const local = (v) => String(v || '').replace(/Z$/, '');   // RxNT labels local clock time with "Z"
  const ageFrom = (dob) => {
    const d = new Date(local(dob)); if (isNaN(d) || d.getFullYear() < 1900) return null;
    const t = new Date(); let a = t.getFullYear() - d.getFullYear();
    if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--;
    return a;
  };
  const out = {}, blocks = {};
  for (const src of scope.eventSources) {
    for (const e of Object.values(src || {})) {
      if (!e || typeof e !== 'object') continue;
      if (!e.Appointment) {
        // Provider blocks such as "Maria Baig, PA-C - Not Available - Out of Office"
        const title = String(e.title || e.Title || '');
        const bs = local(e.StartDateTime || e.Start || (e.start && e.start.format && e.start.format()));
        if (!title || !bs || (target && bs.slice(0, 10) !== target)) continue;
        const parts = title.split(' - ').map((x) => x.trim()).filter(Boolean);
        const k = bs + '|' + title;
        if (!blocks[k]) blocks[k] = { who: parts[0] || '', label: parts.slice(1).join(' · ') || title, start: bs, end: local(e.EndDateTime || e.End || (e.end && e.end.format && e.end.format())) };
        continue;
      }
      const A = e.Appointment;
      const start = local(e.StartDateTime || e.Start);
      if (target && start.slice(0, 10) !== target) continue;
      const apptId = e.AppointmentId || A.AppointmentId;   // the inner Appointment.AppointmentId is often 0
      if (!apptId || out[apptId]) continue;
      const P = A.Patient || {}, per = P.Person || {}, pi = per.PersonInfo || {};
      const parts = String(e.PatientName || '').split(',');
      const st = A.AppointmentStatusType || {};
      out[apptId] = {
        appointmentId: apptId, patientId: e.PatientId || A.PatientId || P.PatientId, chart: P.ChartNumber || '',
        dob: String(per.DOB || pi.DOB || '').replace(/Z$/, '').slice(0, 10),
        last: (parts[0] || '').trim(), first: (parts.slice(1).join(',') || '').trim(),
        age: ageFrom(per.DOB || pi.DOB),
        cell: pi.CellPhone || '', home: pi.HomePhone || '', preferred: pi.PreferedNumber || '',
        statusCode: st.Code || '', statusText: st.Description || '',
        start, end: local(e.EndDateTime || e.End),
        visitType: (A.CompanyAppointmentTemplate || {}).Name || '',
      };
    }
  }
  const h = document.querySelector('.fc-toolbar h2, .fc-center h2');
  let pending = 0; try { pending = angular.element(document.body).injector().get('$http').pendingRequests.length; } catch (e) {}
  return { state: 'ok', pending, date: shown, dateLabel: h ? h.innerText.trim() : '', items: Object.values(out), blocks: Object.values(blocks) };
}
const scriptFor = (target) => `(${readSchedule.toString()})(${JSON.stringify(target || '')})`;
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWindow(pid, show, parent) {
  return new BrowserWindow({
    show, parent, modal: !!parent, width: 1200, height: 850,
    title: 'Sign in to RxNT', autoHideMenuBar: true,
    webPreferences: { partition: partitionFor(pid), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
}

async function evaluate(win, target) {
  try { return await win.webContents.executeJavaScript(scriptFor(target), true); }
  catch { return { state: 'loading' }; }
}

// Poll until RxNT has loaded the target day: no HTTP requests in flight for two
// checks in a row (usually under a second). Falls back to "unchanged for 3s".
async function waitForSchedule(win, target, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  let last = null, stableSince = 0, idle = 0, okSince = 0;
  while (Date.now() < end) {
    if (win.isDestroyed()) return { state: 'closed' };
    const r = await evaluate(win, target);
    if (r.state === 'login') return r;
    if (r.state === 'elsewhere' && /app2\.rxnt\.com/.test(r.url || '')) { win.loadURL(SCHEDULER).catch(() => {}); await sleep(2000); continue; }
    if (r.state === 'navigating') { last = null; idle = 0; okSince = 0; await sleep(250); continue; }
    if (r.state === 'ok' && r.closed) return r;
    if (r.state === 'navfail') return r;
    if (r.state === 'ok') {
      if (!okSince) okSince = Date.now();
      idle = r.pending === 0 ? idle + 1 : 0;
      if (idle >= 2 && Date.now() - okSince >= 400) return r;
      const sig = r.items.map((i) => i.appointmentId + i.statusCode + i.start).sort().join('|') + '#' + (r.blocks || []).length;
      if (sig !== last) { last = sig; stableSince = Date.now(); }
      else if (Date.now() - stableSince > 3000) return r;
    }
    await sleep(250);
  }
  return { state: 'timeout' };
}

function pickPhone(i) {
  for (const [src, v] of [['Cell', i.cell], ['Preferred', i.preferred], ['Home', i.home]]) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length >= 10 && !/^0+$/.test(d)) return { phone: d.slice(-10), phoneSource: src };
  }
  return { phone: '', phoneSource: '' };
}

// Reads one day. Pass `reuse` (a hidden window from openReader) to avoid reloading RxNT.
async function fetchDay(pid, date, reuse) {
  const target = date || localDate();
  const win = reuse || makeWindow(pid, false);
  try {
    if (!reuse || !win.webContents.getURL().includes('SchedulerV2')) await win.loadURL(SCHEDULER).catch(() => {});
    let r = await waitForSchedule(win, target, 30000);
    if (r.state === 'timeout') { await win.loadURL(SCHEDULER).catch(() => {}); r = await waitForSchedule(win, target, 45000); }
    if (r.state === 'login') return { needsLogin: true };
    if (r.state === 'navfail') return { error: `RxNT wouldn't open ${target}.` };
    if (r.state !== 'ok') return { error: "RxNT didn't finish loading. Check your internet and try again." };
    const items = r.items
      .map((i) => ({ ...i, ...pickPhone(i) }))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
    return { date: r.date, closed: !!r.closed, dateLabel: r.dateLabel, items, blocks: (r.blocks || []).sort((a, b) => a.start.localeCompare(b.start)) };
  } finally {
    if (!reuse && !win.isDestroyed()) win.destroy();
  }
}
// Hidden reader window. Links that would open a new window load in this one instead.
function openReader(pid) {
  const win = makeWindow(pid, false);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/[\w.-]*rxnt\.com\//.test(url)) win.loadURL(url).catch(() => {}); return { action: 'deny' }; });
  return win;
}

// ---------- Full patient directory (RxNT "Search Patients", A to Z) ----------
function searchStep(letter) {
  // Types a last-name prefix into RxNT's top search box and presses Enter.
  const ln = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'Last Name');
  const fn = [...document.querySelectorAll('input')].find((i) => i.placeholder === 'First Name');
  if (!ln) return { state: 'loading' };
  const setv = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  if (fn) setv(fn, '');
  setv(ln, letter);
  ['keydown', 'keypress', 'keyup'].forEach((t) => ln.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', keyCode: 13, which: 13, bubbles: true })));
  return { state: 'sent' };
}
function searchRead(letter) {
  const L = letter.toLowerCase();
  if (location.host.includes('auth.rxnt.com')) return { state: 'login' };
  const digitsOnly = (v) => String(v || '').replace(/\D/g, '');
  if (location.hash.includes('patientdashboard')) return { state: 'dashboard' };   // single match opened the chart
  if (!location.hash.includes('searchpatients')) return { state: 'loading' };
  const total = +((document.body.innerText.match(/Total items:?\s*([\d,]+)/i) || [])[1] || 'x').replace(/,/g, '');
  if (isNaN(total)) return { state: 'loading' };
  const hdr = [...document.querySelectorAll('.dx-header-row td')].map((td) => td.innerText.trim());
  const col = (n) => hdr.indexOf(n);
  const rows = [...document.querySelectorAll('.dx-data-row')].map((r) => {
    const c = (n) => (r.children[col(n)]?.innerText || '').trim();
    return { last: c('Last Name'), first: c('First Name'), dob: c('DOB'), chart: c('Chart #'), listedPhone: digitsOnly(c('Phone')) };
  });
  if (rows.length !== total) return { state: 'loading' };
  if (rows.some((r) => !r.last.toLowerCase().startsWith(L))) return { state: 'loading' };   // still showing the previous letter
  return { state: 'ok', rows, total };
}
function openRow(i) {
  const r = document.querySelectorAll('.dx-data-row')[i];
  if (!r) return { state: 'missing' };
  const b = r.children[0].querySelector('.dx-button') || r.children[0].querySelector('.dx-icon');
  if (!b) return { state: 'missing' };
  b.click(); return { state: 'sent' };
}
function readDash(expectChart) {
  if (!location.hash.includes('patientdashboard')) return { state: 'loading' };
  let sc = null;
  document.querySelectorAll('.ng-scope').forEach((el) => { const s = angular.element(el).scope(); if (s && s.pd && s.pd.patient && s.pd.patient.Person) sc = s; });
  if (!sc) return { state: 'loading' };
  const p = sc.pd.patient, per = p.Person || {}, pi = per.PersonInfo || {}, info = p.PatientInfo || {};
  const chart = String(info.ChartNumber || '');
  if (expectChart && chart && chart !== String(expectChart)) return { state: 'loading' };   // previous patient still on screen
  let first = '', last = '';
  const nm = document.body.innerText.match(/([A-Za-z'’.\- ]+),\s*([A-Za-z'’.\- ]+)\s*\n[^\n]*DOB/);
  if (nm) { last = nm[1].trim(); first = nm[2].trim(); }
  // Parent/guardian: best-effort search of the chart for a guarantor, responsible party, guardian or emergency contact.
  let guardian = null;
  try {
    const seen = new Set();
    const nameOf = (o) => { const pp = o.Person || o; const f = pp.FirstName || pp.FName || '', l = pp.LastName || pp.LName || ''; return f || l ? { first: String(f).trim(), last: String(l).trim() } : null; };
    const walk = (o, depth, hint) => {
      if (!o || typeof o !== 'object' || depth > 5 || seen.has(o) || guardian) return; seen.add(o);
      if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1, hint)); return; }
      const rel = String(o.RelationshipType?.Description || o.Relationship?.Description || o.RelationDescription || o.Relationship || '');
      if ((hint || /mother|father|parent|guardian/i.test(rel)) && o.PersonId !== p.PersonId) {
        const n = nameOf(o); if (n && (n.first || n.last) && !(n.first === pi.FirstName && n.last === pi.LastName)) { guardian = { ...n, rel: rel || hint }; return; }
      }
      for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, depth + 1, /guarant|responsib|guardian|parent|emergency|relation/i.test(k) ? k : hint);
    };
    walk(p, 0, '');
  } catch {}
  return { state: 'ok', patient: {
    guardianFirst: guardian ? guardian.first : '', guardianLast: guardian ? guardian.last : '', guardianRel: guardian ? String(guardian.rel).slice(0, 40) : '',
    patientId: p.PatientId, chart, first, last, age: typeof per.Age === 'number' && per.Age > 0 ? per.Age : null,
    dob: String(pi.DOB || per.DOB || '').replace(/Z$/, '').slice(0, 10),
    cell: pi.CellPhone || '', home: pi.HomePhone || '', preferred: pi.PreferedNumber || '',
  } };
}
// Runs a function inside the RxNT page. Arguments are written out as code, so an empty (undefined) one must be
// spelled out, or the call becomes invalid code and every read silently fails.
const argCode = (args) => args.map((a) => (a === undefined ? 'undefined' : JSON.stringify(a))).join(',');
const call = (win, fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(${argCode(args)})`, true).catch(() => ({ state: 'loading' }));

async function runSearch(win, L) {
  for (let t = 0; t < 40; t++) {
    const chk = await call(win, readSchedule, '');
    if (chk.state === 'login') return { needsLogin: true };
    const s = await call(win, searchStep, L);
    if (s.state === 'sent') break;
    await sleep(500);
  }
  const end = Date.now() + 20000, started = Date.now();
  while (Date.now() < end) {
    await sleep(600);
    const r = await call(win, searchRead, L);
    if (r.state === 'login') return { needsLogin: true };
    if (r.state === 'dashboard') return { dashboard: true };
    if (r.state === 'ok' && (r.rows.length || Date.now() - started > 3500)) return r;
  }
  return { rows: [] };
}
async function waitDash(win, expectChart) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    await sleep(500);
    const r = await call(win, readDash, expectChart || '');
    if (r.state === 'ok') return r.patient;
  }
  return null;
}

// Patient directory, in small steps so clicks in the app never wait long:
// listLetter() searches one letter; openPatient() opens one chart for its phone numbers.
async function listLetter(win, L) {
  if (!win.webContents.getURL().includes('SchedulerV2')) await win.loadURL(SCHEDULER).catch(() => {});
  const r = await runSearch(win, L);
  if (r.needsLogin) return { needsLogin: true };
  if (r.dashboard) { const p = await waitDash(win); return { rows: p ? [{ ...p, detailAt: Date.now(), done: true }] : [] }; }
  return { rows: r.rows || [] };
}
async function openPatient(win, L, i, row) {
  const r = await runSearch(win, L);
  if (r.needsLogin) return { needsLogin: true };
  if (r.dashboard) { const p = await waitDash(win); return { patient: p ? { ...row, ...p, detailAt: Date.now() } : row }; }
  const rows = r.rows || [];
  const at = rows.findIndex((x) => x.chart && x.chart === row.chart);
  const o = await call(win, openRow, at >= 0 ? at : i);
  const p = o.state === 'sent' ? await waitDash(win, row.chart) : null;
  return { patient: p ? { ...row, ...p, first: row.first || p.first, last: row.last || p.last, detailAt: Date.now() } : row };
}

// Visible window: user signs in to RxNT once; the session cookie is kept in the
// app's persistent partition so later reads happen silently.
/* Saved RxNT sign-in (asked for, so nobody has to type it again): when you sign in, the app remembers the
   username and password, encrypted on this computer with the OS keychain. If RxNT signs the app out, it signs
   back in by itself in a hidden window. A verification-code step still needs you, so it asks then. */
const credFile = (pid) => `rxnt-login-${pid}.bin`;
const savedLogin = (pid) => { const c = store.raw.readSecure(credFile(pid), null); return c && c.u && c.p ? c : null; };
const saveLogin = (pid, u, p) => { if (store.settings.get().rememberRxnt === false || !u || !p) return; try { store.raw.writeSecure(credFile(pid), { u, p, at: new Date().toISOString() }); } catch {} };
const markLoginBad = (pid) => { const c = savedLogin(pid); if (c) try { store.raw.writeSecure(credFile(pid), { ...c, bad: new Date().toISOString() }); } catch {} };
// Removes the saved sign-in for good and reports whether it's really gone.
function forgetLogin(pid) {
  const f = store.raw.file(credFile(pid));
  try { fs.rmSync(f, { force: true }); } catch {}
  return !fs.existsSync(f);
}
const AUTH_OK = /^https:\/\/([\w-]+\.)*rxnt\.com(\/|$)/i;   // only RxNT's own pages ever see the saved sign-in
// Runs in the RxNT login page: what's currently typed in the username/password boxes (read, never logged).
function readLoginBoxes() {
  const u = document.querySelector('input[autocomplete=username], input[type=email], #tenant-discovery-username, input[name*=user i], input[id*=user i]');
  const p = document.querySelector('input[type=password]');
  return { u: u && u.value ? u.value : '', p: p && p.value ? p.value : '' };
}
// Runs in the RxNT login page: which step is showing, and fills + submits it once.
function autofillStep(u, pw, submit) {
  if (/app2\.rxnt\.com/.test(location.host)) return { step: 'in' };
  const vis = (el) => el && el.offsetParent !== null;
  const text = (document.body.innerText || '').toLowerCase();
  if (/incorrect|invalid (user|pass|login|cred)|wrong password|not recognized|locked/.test(text)) return { step: 'bad' };
  const pass = [...document.querySelectorAll('input[type=password]')].find(vis);
  const user = [...document.querySelectorAll('input[autocomplete=username], input[type=email], #tenant-discovery-username, input[name*=user i], input[id*=user i], input[type=text]')].find(vis);
  if (!pass && /verification code|one-time|authenticator|enter the code|security code/.test(text)) return { step: 'code' };
  const step = pass ? 'password' : user ? 'username' : 'wait';
  if (!submit || step === 'wait') return { step };
  const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  if (user && user.value !== u) set(user, u);
  if (pass) set(pass, pw);
  const btn = [...document.querySelectorAll('button, input[type=submit]')].filter(vis).find((b) => /sign in|log ?in|continue|next|submit/i.test(b.innerText || b.value || '') || b.type === 'submit');
  if (btn) btn.click(); else { const f = (pass || user).form; if (f) f.requestSubmit ? f.requestSubmit() : f.submit(); }
  return { step, submitted: true };
}
// Sign back in without bothering anyone: each step (username, then password) is submitted at most once.
// A "wrong password" answer stops it at once and marks the saved sign-in as needing you, so it never retries
// and can't lock the account. Returns 'ok', 'code' (a verification code is needed), 'bad' or 'failed'.
async function autoSignIn(pid) {
  const c = savedLogin(pid); if (!c || c.bad) return 'failed';
  const win = makeWindow(pid, false);
  try {
    await win.loadURL('https://auth.rxnt.com/auth/login').catch(() => {});
    const end = Date.now() + 60000, done = new Set();
    while (Date.now() < end && !win.isDestroyed()) {
      await sleep(1500);
      const url = win.webContents.getURL();
      if (!AUTH_OK.test(url)) return 'failed';                       // somewhere unexpected: never fill anything
      if (/app2\.rxnt\.com/i.test(url)) { await keepSignedIn(pid); return 'ok'; }
      const look = await call(win, autofillStep, '', '', false);
      if (look.step === 'bad') { markLoginBad(pid); return 'bad'; }
      if (look.step === 'code') return 'code';
      if (look.step === 'in') { await keepSignedIn(pid); return 'ok'; }
      if ((look.step === 'username' || look.step === 'password') && !done.has(look.step)) {
        done.add(look.step); await call(win, autofillStep, c.u, c.p, true);
      } else if (look.step === 'password' && done.has('password')) { await sleep(3000); const again = await call(win, autofillStep, '', '', false); if (again.step === 'password' || again.step === 'bad') { markLoginBad(pid); return 'bad'; } }
    }
    return 'failed';
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

function signIn(pid, parent) {
  return new Promise((resolve) => {
    const win = makeWindow(pid, true, parent);
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (!win.isDestroyed()) win.destroy(); resolve(ok); };
    win.on('closed', () => finish(false));
    // Only jump to the scheduler once RxNT has landed on its dashboard after sign-in.
    win.webContents.on('did-navigate', (_e, url) => {
      if (/app2\.rxnt\.com\/Dashboard/i.test(url)) win.loadURL(SCHEDULER);
    });
    // F5 / Ctrl+R / Cmd+R reloads if a page gets stuck.
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) win.webContents.reload();
    });
    win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
    // Remember what's typed (in memory only) while on RxNT's own sign-in pages; it's saved, encrypted, only
    // after RxNT has actually let you in, so a typo never replaces a good saved sign-in.
    const typed = { u: '', p: '' };
    const peek = setInterval(async () => {
      if (done || win.isDestroyed() || !/^https:\/\/auth\.rxnt\.com\//i.test(win.webContents.getURL())) return;
      const v = await call(win, readLoginBoxes); if (v && v.u) typed.u = v.u; if (v && v.p) typed.p = v.p;
    }, 400);
    win.on('closed', () => clearInterval(peek));
    win.loadURL('https://auth.rxnt.com/auth/login').catch(() => {});
    (async () => {
      const end = Date.now() + 15 * 60 * 1000;
      let lastJump = 0;
      while (!done && Date.now() < end) {
        if (win.isDestroyed()) return;
        const r = await evaluate(win);
        if (r.state === 'ok') { clearInterval(peek); saveLogin(pid, typed.u, typed.p); await sleep(800); return finish(true); }
        // Signed in but landed on another RxNT page (EHR, billing…): go to the scheduler.
        if (r.state === 'elsewhere' && /app2\.rxnt\.com/i.test(r.url || '') && Date.now() - lastJump > 6000) {
          lastJump = Date.now(); win.loadURL(SCHEDULER).catch(() => {});
        }
        await sleep(1000);
      }
      finish(false);
    })();
  });
}

async function status(pid) {
  const win = makeWindow(pid, false);
  try {
    await win.loadURL(SCHEDULER).catch(() => {});
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const r = await evaluate(win);
      if (r.state === 'login') return { connected: false };
      if (r.state === 'ok') return { connected: true };
      await sleep(800);
    }
    return { connected: false, unknown: true };
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

async function logout(pid) {
  await session.fromPartition(partitionFor(pid)).clearStorageData();
}

/* ---------- Pending prescriptions (read-only) ----------
   RxNT's EHR dashboard has the counts; its prescriber dashboard lists Pending and Pharmacy Requests (refills).
   It's a grid inside an iframe on the same site, so we read the rows straight from the page. */
const RX_DASH = 'https://app2.rxnt.com/ehrv9/legacy/prescriberDashboard#/dashboard/rx/pending';
const RX_TABS = [['Pending', 'pending'], ['Pharmacy Requests', 'refill'], ['Recent', 'sent'], ['Voided', 'voided']];
const EHR_DASH = 'https://app2.rxnt.com/ehrv9/dashboard';
// Counts from the EHR dashboard tiles (number above its label).
const DASH_LABELS = { 'Sent': 'sent', 'Voided': 'voided', 'Failed': 'failed', 'Pending': 'pending', 'Pharmacy Request': 'refill', 'Labs': 'labs', 'Unsigned Encounters': 'unsigned', 'Patient Tasks': 'tasks', 'Documents': 'documents', 'Referrals': 'referrals', 'Awaiting Billing': 'awaiting' };
function readDashCounts(labels, anchor, required) {
  if (/auth\.rxnt\.com/.test(location.href)) return { state: 'login' };
  const lines = (document.body.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (!lines.includes(anchor || 'Pharmacy Request')) return { state: 'wait' };
  const out = {};
  lines.forEach((l, i) => { if (labels[l] && /^\d+$/.test(lines[i - 1] || '')) out[labels[l]] = Number(lines[i - 1]); });
  // Only accept the counts once every tile we rely on has loaded (a missing tile must not read as zero).
  if (required && required.some((k) => !(k in out))) return { state: 'wait' };
  return Object.keys(out).length >= Math.min(3, Object.keys(labels).length) ? { state: 'ready', counts: out } : { state: 'wait' };
}

// Runs in the EHR page. Clicks a tab in the dashboard iframe and reads its grid.
function rxReadTab(label) {
  const f = [...document.querySelectorAll('iframe')].find((x) => /PrescriberDashboardV2/.test(x.src));
  if (/auth\.rxnt\.com|\/logout/i.test(location.href)) return { state: 'login' };
  const d = f && f.contentDocument; if (!d || !d.body) return { state: 'loading' };
  const tab = [...d.querySelectorAll('a')].find((a) => a.innerText.trim().startsWith(label + ' ('));
  if (!tab) return { state: 'loading' };
  const count = Number((tab.innerText.match(/\((\d+)\)/) || [])[1] || 0);
  const clicked = (window.__rxClicked = window.__rxClicked || {});
  if (!clicked[label]) { clicked[label] = Date.now(); tab.click(); return { state: 'loading' }; }
  if (Date.now() - clicked[label] < 1500) return { state: 'loading' };   // let the grid switch tabs
  if (!count) return { state: 'ok', count, rows: [] };
  const heads = [...d.querySelectorAll('.ag-header-cell')].map((h) => ({ id: h.getAttribute('col-id'), name: (h.innerText || '').trim() }));
  const rows = [...d.querySelectorAll('.ag-center-cols-container [role=row]')].map((r) => {
    const o = {};
    r.querySelectorAll('[role=gridcell]').forEach((c) => { const h = heads.find((x) => x.id === c.getAttribute('col-id')); o[(h && h.name) || c.getAttribute('col-id')] = (c.innerText || '').trim(); });
    return o;
  });
  if (!rows.length) return { state: 'loading', count };
  return { state: 'ok', count, rows: rows.slice(0, count) };
}

function rxItem(kind, row) {
  const get = (re) => { const k = Object.keys(row).find((x) => re.test(x)); return k ? row[k] : ''; };
  const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const name = lines(get(/patient/i))[0] || '';
  const [last, first] = name.split(',').map((x) => (x || '').trim());
  const when = lines(get(/date|time|received|created/i))[0] || '';
  const at = when ? new Date(when.replace(/\s(CST|CDT|EST|EDT|MST|MDT|PST|PDT)$/, '')) : null;
  return {
    kind, patient: first ? `${first} ${last}` : name,
    med: lines(get(/drug|medication|med\b|rx\b|prescription/i))[0] || '',
    pharmacy: lines(get(/pharmacy/i))[0] || '', provider: lines(get(/provider|prescriber/i)).join(' '),
    detail: lines(get(/status|note|message|task|subject/i)).join(' · '), at: at && !isNaN(at) ? at.toISOString() : null,
  };
}

// The EHR side needs RxNT's own "Electronic Health Records" card clicked once per sign-in; it sets the
// EHR session and lands on the EHR. The card is a button inside the dashboard's iframe.
function clickCard(label) {
  const f = [...document.querySelectorAll('iframe')].find((x) => /CorporateDashboardSite/.test(x.src));
  const d = f && f.contentDocument;
  const b = d && [...d.querySelectorAll('button')].find((x) => (x.textContent || '').includes(label));
  if (b) { b.click(); return true; }
  return /auth\.rxnt\.com/.test(location.href) ? 'login' : false;
}
async function openEhr(win) {   // lands on the EHR dashboard
  await win.loadURL('https://app2.rxnt.com/dashboard/').catch(() => {});
  for (let i = 0; i < 25 && !win.isDestroyed(); i++) {
    await sleep(600);
    const r = await call(win, clickCard, 'Electronic Health Records');
    if (r === 'login') return 'login';
    if (r === true) break;
  }
  for (let i = 0; i < 25 && !win.isDestroyed(); i++) { await sleep(600); if (/\/ehrv9\/dashboard/.test(win.webContents.getURL())) break; }
  return !win.isDestroyed();
}

// Waits until the dashboard's Rx grid is there (or RxNT shows sign-in / something else).
async function waitRxGrid(win, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until && !win.isDestroyed()) {
    await sleep(600);
    const r = await call(win, () => {
      if (/auth\.rxnt\.com/.test(location.href)) return 'login';
      const f = [...document.querySelectorAll('iframe')].find((x) => /PrescriberDashboardV2/.test(x.src));
      const d = f && f.contentDocument;
      return d && [...d.querySelectorAll('a')].some((a) => /^Pending \(\d+\)/.test(a.innerText.trim())) ? 'ready' : 'wait';
    });
    if (r === 'login' || r === 'ready') return r;
  }
  return 'timeout';
}

async function dashCounts(win, ms, labels = DASH_LABELS, anchor, required) {
  const until = Date.now() + ms;
  while (Date.now() < until && !win.isDestroyed()) {
    await sleep(700);
    const r = await call(win, readDashCounts, labels, anchor, required);
    if (r.state === 'login' || r.state === 'ready') return r;
  }
  return { state: 'timeout' };
}

// 1) Counts from the EHR dashboard (opening the EHR from RxNT's home page if needed).
// 2) Names from the prescriber dashboard tabs that have anything: Pending, Pharmacy Requests, Recent (sent) and Voided.
async function readPending(win) {
  await win.loadURL(EHR_DASH).catch(() => {});
  const REQ = ['pending', 'refill', 'failed'];
  let d = await dashCounts(win, 15000, DASH_LABELS, undefined, REQ);
  if (d.state === 'timeout') { const o = await openEhr(win); if (o === 'login') return { needsLogin: true }; if (!o) return { error: 'unavailable' }; await win.loadURL(EHR_DASH).catch(() => {}); d = await dashCounts(win, 20000, DASH_LABELS, undefined, REQ); }
  if (d.state === 'login') return { needsLogin: true };
  if (d.state !== 'ready') return { error: 'unavailable' };
  const counts = d.counts, items = [];
  if (['pending', 'refill', 'sent', 'voided'].some((k) => counts[k] > 0)) {
    await win.loadURL(RX_DASH).catch(() => {});
    if ((await waitRxGrid(win, 20000)) === 'ready') {
      await call(win, () => { window.__rxClicked = {}; });
      for (const [label, kind] of RX_TABS) {
        if (!counts[kind]) continue;
        let r = { state: 'loading' };
        for (let i = 0; i < 20 && r.state === 'loading' && !win.isDestroyed(); i++) { await sleep(600); r = await call(win, rxReadTab, label); }
        if (r.state === 'ok') r.rows.forEach((row) => items.push(rxItem(kind, row)));
      }
    }
  }
  // Billing: the biller's unbilled queue (information) and patient payments not yet posted to a visit (Maria's part).
  let payments = null;
  try {
    const B = { 'Unbilled Encounters': 'unbilled', 'Unposted Patient Payments': 'unposted', 'Pending Statements': 'statements' };
    await win.loadURL('https://app2.rxnt.com/BillingV2/#/').catch(() => {});
    let b = await dashCounts(win, 15000, B, 'Unbilled Encounters');
    if (b.state === 'timeout' && !win.isDestroyed()) {
      await win.loadURL('https://app2.rxnt.com/dashboard/').catch(() => {});
      for (let i = 0; i < 20 && !win.isDestroyed(); i++) { await sleep(600); if ((await call(win, clickCard, 'Billing')) === true) break; }
      b = await dashCounts(win, 20000, B, 'Unbilled Encounters');
    }
    if (b.state === 'ready') {
      Object.assign(counts, b.counts);
      if (counts.unposted > 0) payments = await readPayments(win);
    }
  } catch {}
  return { items, counts, payments };
}

// Unposted patient payments (card charged, not yet applied to a visit). Read from RxNT Billing's grid.
// Deep links bounce to the dashboard, so we go there first and then switch the page in place.
function readPaymentRows() {
  const rows = [...document.querySelectorAll('tr.dx-data-row')];
  if (!rows.length) return null;
  const head = [...document.querySelectorAll('.dx-header-row td')].map((t) => t.innerText.trim());
  const col = (n) => head.indexOf(n);
  return rows.map((r) => { const c = [...r.cells].map((x) => x.innerText.trim()); return { id: c[col('Payment #')], patient: c[col('Patient')], date: c[col('Payment Date')], method: c[col('Method')], amount: Number(String(c[col('Payment Amount')] || '').replace(/[^0-9.]/g, '')) || 0 }; });
}
async function readPayments(win) {
  await call(win, () => { location.hash = '#/searchpatientpayments'; });
  for (let i = 0; i < 20 && !win.isDestroyed(); i++) {
    await sleep(700);
    const rows = await call(win, readPaymentRows);
    if (rows && rows.length) return rows.map((p) => { const t = p.date ? new Date(p.date) : null; return { ...p, at: t && !isNaN(t) ? t.toISOString() : null }; });
  }
  return null;
}

// One read in a throwaway hidden window, capped at 150 seconds.
let rxBusy = false;
async function readPendingOnce(pid) {
  if (rxBusy) return { error: 'busy' };
  rxBusy = true;
  const win = openReader(pid);
  let timer;
  try {
    return await Promise.race([readPending(win), new Promise((r) => { timer = setTimeout(() => r({ error: 'timeout' }), 150000); })]);
  } finally { clearTimeout(timer); rxBusy = false; if (!win.isDestroyed()) win.destroy(); }
}

/* ---------- Staying signed in ----------
   RxNT's sign-in lives in "session" cookies, which a browser throws away when it closes, so every
   restart or update signed you out. We keep them as saved cookies instead, and ping RxNT's own
   keep-alive page so the session doesn't time out between syncs. Signing out in Settings clears them. */
async function keepSignedIn(pid) {
  const ses = session.fromPartition(partitionFor(pid));
  try {
    const cookies = await ses.cookies.get({});
    const until = Math.floor(Date.now() / 1000) + 30 * 86400;
    for (const c of cookies.filter((x) => x.session && /rxnt\.com$/.test(x.domain.replace(/^\./, '')))) {
      await ses.cookies.set({
        url: `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, name: c.name, value: c.value, path: c.path,
        domain: c.hostOnly ? undefined : c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: until,
      }).catch(() => {});
    }
    await ses.cookies.flushStore();
  } catch {}
}
async function ping(pid) {
  try { await session.fromPartition(partitionFor(pid)).fetch('https://app2.rxnt.com/ehrv8/SessionAlive.aspx', { cache: 'no-store' }); } catch {}
}

/* ---------- RxNT patient portal messages (the Messaging sidebar) ----------
   RxNT's sidebar chat runs on messaging.rxnt.com. Opening any RxNT page signs that in with the same login,
   after which its conversation list can be read. Read-only: replies happen in RxNT. */
const MSG = 'https://messaging.rxnt.com/';
async function msgGet(pid, pathname) {
  const r = await session.fromPartition(partitionFor(pid)).fetch(MSG + pathname, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (r.status !== 200) return null;
  const t = await r.text();
  try { return JSON.parse(t); } catch { return null; }   // a sign-in page instead of data
}
const strip = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
async function readMessages(pid) {
  let me = await msgGet(pid, 'api/users/me');
  if (!me) {   // not signed in to messaging yet: open RxNT's dashboard once so it signs in
    const win = makeWindow(pid, false);
    try { await win.loadURL('https://app2.rxnt.com/dashboard/').catch(() => {}); for (let i = 0; i < 12 && !me; i++) { await sleep(1500); me = await msgGet(pid, 'api/users/me'); } }
    finally { if (!win.isDestroyed()) win.destroy(); }
  }
  if (!me) return { error: 'unavailable' };
  // A failed list read is "couldn't read", never an empty inbox.
  const raw = await msgGet(pid, 'api/conversations');
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : null;
  if (!list) return { error: 'unavailable' };
  const out = [], recent = Date.now() - 60 * 864e5;
  for (const c of list.filter((x) => !x.is_room).slice(0, 300)) {
    const fromPatient = !/^You:/i.test(c.excerpt || '');
    // Read, older conversations are listed without opening them (saves dozens of requests).
    if (c.is_read && new Date(c.last_message_at) < recent) { out.push({ id: c.id, title: c.title || 'Patient', unread: false, needsReply: false, at: c.last_message_at, excerpt: String(c.excerpt || '').replace(/^You:\s*/i, '') }); continue; }
    const item = { id: c.id, title: c.title || 'Patient', unread: !c.is_read, needsReply: fromPatient, at: c.last_message_at, excerpt: String(c.excerpt || '').replace(/^You:\s*/i, '') };
    if (fromPatient) {
      const m = await msgGet(pid, `api/conversations/${c.id}/messages`);
      const msgs = (m && m.data) || [];
      const last = msgs.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).pop();
      if (last) { item.excerpt = strip(last.html).slice(0, 300); item.at = last.created_at; item.needsReply = last.created_by_id !== me.id; }
    }
    out.push(item);
  }
  return { me: { id: me.id, name: (me.profile && me.profile.name) || '' }, conversations: out };
}

module.exports = { autoSignIn, savedLogin, forgetLogin, argCode, readMessages, keepSignedIn, ping, fetchDay, openReader, listLetter, openPatient, localDate, signIn, status, logout, readPendingOnce };
