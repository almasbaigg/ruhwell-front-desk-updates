const { app, BrowserWindow, ipcMain, shell, nativeImage, Tray, Menu, dialog, Notification, powerMonitor, powerSaveBlocker, net, globalShortcut } = require('electron');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// App data lives in "Ruhwell Front Desk Data" next to the .exe on Windows (standard Application
// Support folder on Mac). Data from the old "Ruhwell Messenger" name is carried over once.
function migrateFrom(oldDirs, newDir) {
  if (fs.existsSync(path.join(newDir, 'settings.json'))) return;
  const old = oldDirs.find((d) => fs.existsSync(path.join(d, 'settings.json')));
  if (!old) return;
  try { fs.mkdirSync(newDir, { recursive: true }); fs.cpSync(old, newDir, { recursive: true }); } catch {}
}
if (process.platform === 'win32' && app.isPackaged) {
  // Data lives in the Windows profile (AppData), so installs and automatic updates never touch it.
  // Older versions kept it next to the .exe (zip builds) with a safety copy in AppData: bring that over once.
  const dataDir = path.join(app.getPath('appData'), 'Ruhwell Front Desk', 'Data');
  const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  migrateFrom([
    path.join(base, 'Ruhwell Front Desk Data'),
    path.join(app.getPath('appData'), 'Ruhwell Front Desk', 'Data copy'),
    path.join(base, 'Ruhwell Messenger Data'),
  ], dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath('userData', dataDir);
} else if (app.isPackaged) {
  const dataDir = path.join(app.getPath('appData'), 'Ruhwell Front Desk');
  migrateFrom([path.join(app.getPath('appData'), 'Ruhwell Messenger')], dataDir);
  app.setPath('userData', dataDir);
}

const store = require('./store');
const rxnt = require('./rxnt-reader');
const ringrx = require('./ringrx');
const watcher = require('./watcher');
const comms = require('./comms');
const activity = require('./activity');
// Safety net: a background failure (OCR, a site reader) should never put an error box in front of Maria.
process.on('uncaughtException', (e) => { try { diag('app', 'error', { msg: String(e && e.message || e).slice(0, 200) }); console.error(e); activity.add('app', 'error', { msg: String(e && e.message || e).slice(0, 200) }, false); } catch {} });
process.on('unhandledRejection', (e) => { try { console.error(e); } catch {} });
const faxes = require('./faxes');
const inapp = require('./inapp');
const ocr = require('./ocr');
const gmail = require('./gmail');
const gapi = require('./gmailapi');
const outbox = require('./outbox');
const { diag, prune: pruneDiag, bundle: diagBundle } = require('./diag');
// Email: Google's own sign-in once the key file is loaded (read, reply, send from hello@); before that, the old inbox count.
const mail = {
  check: () => (gapi.hasKey() ? gapi.check() : gmail.check()),
  status: () => (gapi.hasKey() ? gapi.status() : gmail.status()),
  signIn: async () => (gapi.hasKey() ? !!(await gapi.signIn()).ok : gmail.signIn(win)),
  signOut: async () => { if (gapi.hasKey()) return gapi.signOut(); return gmail.signOut(); },   // was calling itself forever
};
const checklist = require('./checklist');
const rxtasks = require('./rxtasks');
const backups = require('./backups');
const timer = require('./timer');
const migrations = require('./migrations');
const updater = require('./updater');

let win, tray, quitting = false;
const startHidden = process.argv.includes('--hidden');
const isMac = process.platform === 'darwin';
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-256.png'));

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function createWindow() {
  // Roomy by default (about 90% of the screen, centered); after that, the size and place you left it.
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workArea, saved = store.settings.get().windowBounds;
  const onScreen = saved && screen.getAllDisplays().some((d) => saved.x >= d.workArea.x - 40 && saved.y >= d.workArea.y - 40 && saved.x + 200 < d.workArea.x + d.workArea.width && saved.y + 100 < d.workArea.y + d.workArea.height);
  // Never bigger than the screen's usable area (high display scaling can make that smaller than our minimum).
  const minW = Math.min(1040, wa.width), minH = Math.min(660, wa.height);
  const w0 = Math.max(minW, Math.min(1680, Math.round(wa.width * 0.9), wa.width)), h0 = Math.max(minH, Math.min(1080, Math.round(wa.height * 0.9), wa.height));
  const fit = (b) => ({ ...b, width: Math.min(b.width, wa.width), height: Math.min(b.height, wa.height) });
  const bounds = onScreen ? fit(saved) : { width: w0, height: h0, x: wa.x + Math.round((wa.width - w0) / 2), y: wa.y + Math.round((wa.height - h0) / 2) };
  win = new BrowserWindow({
    ...bounds, minWidth: minW, minHeight: minH, show: !startHidden,
    backgroundColor: '#f6f1eb', title: 'Ruhwell Front Desk', icon: icon(),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#f6f1eb', symbolColor: '#005758', height: 40 },
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, plugins: true },   // plugins: the built-in PDF viewer for fax previews
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (startHidden) win.once('ready-to-show', () => win.hide());
  win.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openLink(url); } });
  // Tray options: close and/or minimize keep the app running in the tray (alerts keep working).
  win.on('close', (e) => { if (!quitting && store.settings.get().closeToTray) { e.preventDefault(); win.hide(); } });
  win.on('minimize', (e) => { if (store.settings.get().minimizeToTray) { e.preventDefault(); win.hide(); } });
  win.on('focus', () => syncSoon());   // coming back to the app catches up anything stale
  let saveT = null;
  const remember = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return; const b = win.isMaximized() ? win.getNormalBounds() : win.getBounds(); store.settings.set({ ...store.settings.get(), windowBounds: b, windowMax: win.isMaximized() }); }, 600); };
  win.on('resize', remember); win.on('move', remember); win.on('maximize', remember); win.on('unmaximize', remember);
  if (store.settings.get().windowMax) win.maximize();
}
function showWindow() { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); }

// Links leave the app only if they're https and go to a site we expect.
const LINK_OK = /^https:\/\/([\w-]+\.)*(rxnt\.com|ringrx\.com|google\.com|g\.page|goo\.gl|github\.com|ruhwellmed\.com)(\/|$)/i;
function openLink(url) {
  const review = store.settings.get().reviewLink;
  if (/^https:\/\/([\w-]+\.)*rxnt\.com(\/|$)/i.test(String(url))) return openRxntIn(String(url));   // RxNT opens inside the app, signed in
  if (LINK_OK.test(String(url)) || (review && url === review && /^https:/i.test(url))) shell.openExternal(url);
}
function createTray() {
  tray = new Tray(icon().resize({ width: 16, height: 16 }));
  tray.setToolTip('Ruhwell Front Desk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Ruhwell Front Desk', click: showWindow },
    { label: 'Quick task…', accelerator: 'CommandOrControl+Shift+Space', click: () => openCapture() },
    { label: 'Sync now', click: () => Object.values(RUN).forEach((f) => Promise.resolve().then(f).catch(() => {})) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const pid = () => store.settings.get().currentProfile;
// A single "sign in" page can be a blip (RxNT bouncing through its login server). Only treat RxNT as
// signed out after a fresh check agrees, so you aren't asked to sign in again for nothing.
let confirming = null;
// If RxNT really did sign us out, sign back in with the saved sign-in first; only ask when that can't work.
async function rxntSignedOut(id) {
  if (!confirming) confirming = (async () => {
    const r = await rxnt.status(id);
    if (r.connected || r.unknown) return false;
    const saved = rxnt.savedLogin(id);
    if (saved && !saved.bad && !userOut('rxnt')) {
      const a = await rxnt.autoSignIn(id);
      diag('rxnt', 'quiet sign-in', { result: a });
      if (a === 'ok') { setRxntFlag(id, true); send('sync', syncStatus()); return false; }
      rxntNeeds = a === 'code' ? 'code' : a === 'step' ? 'step' : a === 'bad' ? 'password' : '';
      if (a === 'code' || a === 'step') rxStepNotice(a);
      if (a === 'bad') notify("Saved RxNT sign-in didn't work", 'The password may have changed. Sign in again once from Settings.', () => { showWindow(); send('nav', 'settings'); });
    }
    setRxntFlag(id, false); send('sync', syncStatus());
    return true;
  })().finally(() => { setTimeout(() => (confirming = null), 60000); });
  return confirming;
}
// Signed out on purpose (Settings → Sign out): no quiet sign-in until the user signs in again.
const userOut = (k) => !!((store.settings.get().signedOut || {})[k]);
function setUserOut(k, v) { const s = store.settings.get(); store.settings.set({ ...s, signedOut: { ...(s.signedOut || {}), [k]: !!v } }); }
let rxStepNotified = 0;
function rxStepNotice(a) {   // tell the user once (per 30 min) when RxNT needs them, with the exact step
  if (Date.now() - rxStepNotified < 30 * 60000) return; rxStepNotified = Date.now();
  if (a === 'code') notify('RxNT needs a verification code', 'Click to finish signing in (one time).', () => { showWindow(); send('nav', 'settings'); });
  if (a === 'step') notify('RxNT needs you to finish signing in', 'RxNT is showing a page that needs a click. Click to open it.', () => { showWindow(); openRxntIn(RX_URLS.todo); });
}
function setRxntFlag(id, v) { const s = store.settings.get(); s.rxntConnected = { ...(s.rxntConnected || {}), [id]: v }; store.settings.set(s); }

// A number that replied STOP stays blocked until someone confirms the person asked for texts again (e.g. replied START).
ipcMain.handle('optout:status', (_e, phone) => { const d = String(phone || '').replace(/\D/g, '').slice(-10); return (store.inbound.get().optOut || {})[d] || null; });
ipcMain.handle('optout:clear', (_e, phone) => { comms.clearOptOut([String(phone || '').replace(/\D/g, '').slice(-10)]); return true; });
ipcMain.handle('rxnt:forgetLogin', () => rxnt.forgetLogin(pid()));
ipcMain.handle('rxnt:hasLogin', () => { const c = rxnt.savedLogin(pid()); return c ? (c.bad ? 'bad' : 'ok') : ''; });
ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), dataDir: store.dataDir() }));
ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:check', () => updater.checkNow());
// Before installing an update: a fresh backup of today's data, then quit cleanly (the installer also closes
// any copy still running and keeps its own safety copy).
ipcMain.handle('update:restart', () => {
  const st = updater.status();
  if (st.status === 'ready') {
    try { backups.autoDaily(true); } catch {}
    activity.add('App', 'update', { to: st.version || '' }, true);
    quitting = true;
  }
  return updater.restart();
});
ipcMain.handle('app:openData', () => shell.openPath(store.dataDir()));

// At start-up: really check every account, sign back in quietly where a saved sign-in exists, and only
// then tell the window what still needs the user. Never trusts an old "connected" flag.
let verifying = null, rxntNeeds = '';   // rxntNeeds: what RxNT is waiting on from the user (code / step / password)
ipcMain.handle('accounts:verify', () => {
  if (!verifying) verifying = (async () => {
    const id = pid(); if (!id) return { rxnt: false, ringrx: false };
    const rxCheck = (async () => {
      let r = await rxnt.status(id).catch(() => ({ connected: false, unknown: true }));
      if (r.connected) { setRxntFlag(id, true); return true; }
      if (r.unknown) return !!store.settings.get().rxntConnected?.[id];   // couldn't tell (offline): don't ask yet
      const c = rxnt.savedLogin(id);
      if (c && !c.bad && !userOut('rxnt')) {
        const a = await rxnt.autoSignIn(id).catch(() => '');
        diag('rxnt', 'quiet sign-in (start-up)', { result: a || 'error' });
        if (a === 'ok') { setRxntFlag(id, true); activity.add('RxNT', 'auto-sign-in', {}, true); return true; }
        rxntNeeds = a === 'code' ? 'code' : a === 'step' ? 'step' : a === 'bad' ? 'password' : '';
        if (a === 'code' || a === 'step') rxStepNotice(a);
      }
      setRxntFlag(id, false); return false;
    })();
    const rrCheck = (async () => {
      if (!ringrx.status(id).connected) return false;
      try { await ringrx.me(id); return true; } catch (e) { return e.code !== 'SIGNED_OUT'; }   // offline isn't signed out
    })();
    const [rxOk, rrOk] = await Promise.all([rxCheck, rrCheck]);
    send('sync', syncStatus());
    if (rxOk || rrOk) setTimeout(() => syncDue(0), 1500);
    return { rxnt: rxOk, ringrx: rrOk };
  })().finally(() => setTimeout(() => (verifying = null), 30000));
  return verifying;
});
ipcMain.handle('accounts:status', async () => {
  const id = pid();
  const g = mail.status().at ? mail.status() : await mail.check();
  return { profile: id, rxnt: { connected: !!store.settings.get().rxntConnected?.[id] }, ringrx: id ? ringrx.status(id) : { connected: false }, gmail: g };
});
// ---------- Gmail, checklist, prescriptions ----------
ipcMain.handle('gmail:signin', async () => { const ok = await mail.signIn(); send('sync', syncStatus()); return ok; });
ipcMain.handle('gmail:signout', async () => { await mail.signOut(); send('sync', syncStatus()); return true; });
ipcMain.handle('gmail:open', (_e, id) => shell.openExternal(gmail.url(id)));
ipcMain.handle('checklist:list', () => checklist.list(pid()));
ipcMain.handle('checklist:add', (_e, t, opts) => checklist.add(pid(), t, opts || {}));
ipcMain.handle('checklist:restore', (_e, item) => checklist.restore(pid(), item));
ipcMain.handle('checklist:star', (_e, id) => checklist.star(pid(), id));
ipcMain.handle('checklist:due', (_e, id, due) => checklist.setDue(pid(), id, due));
ipcMain.handle('checklist:reorder', (_e, ids) => checklist.reorder(pid(), ids));
ipcMain.handle('checklist:parse', (_e, t) => checklist.parse(t));
ipcMain.handle('gmail:check', async () => { const g = await mail.check(); send('sync', syncStatus()); return g; });
ipcMain.handle('notes:get', (_e, day) => checklist.notes.get(pid(), day || checklist.dayKey()));
ipcMain.handle('notes:set', (_e, day, text) => checklist.notes.set(pid(), day, text));
ipcMain.handle('notes:pin', (_e, day, on) => checklist.notes.pin(pid(), day, on));
ipcMain.handle('notes:search', (_e, q) => checklist.notes.search(pid(), q));
ipcMain.handle('checklist:toggle', (_e, id) => checklist.toggle(pid(), id));
ipcMain.handle('checklist:remove', (_e, id) => checklist.remove(pid(), id));
ipcMain.handle('rx:list', () => rxtasks.list());
ipcMain.handle('rx:refresh', async () => { await refreshRx(); return rxtasks.list(); });
// "Open in RxNT": inside the app, already signed in (the app's own RxNT session).
const RX_URLS = { todo: 'https://app2.rxnt.com/ehrv9/dashboard', billing: 'https://app2.rxnt.com/BillingV2/#/', messages: 'https://app2.rxnt.com/dashboard/', unsigned: 'https://app2.rxnt.com/ehrv9/legacy/prescriberDashboard#/dashboard/encounters/unsigned' };
const openRxntIn = (url) => inapp.open('rxnt', rxnt.partitionFor(pid()), url, win) || shell.openExternal(url);
ipcMain.handle('rx:open', (_e, where) => openRxntIn(RX_URLS[where] || RX_URLS.todo));
async function refreshRx() {
  if (!store.settings.get().rxntConnected?.[pid()]) return { skipped: 'RxNT not connected' };
  // Its own hidden window, so prescriptions never hold up or reset the schedule reader.
  const r = await rxtasks.refresh(() => rxnt.readPendingOnce(pid()));
  rxWaitingAlerts();
  send('sync', syncStatus());
  return r;
}
// Prescriptions are time-sensitive: once one has waited an hour during office hours, alert (once per item).
// Texts say only how many are waiting, never a name or a drug.
function rxWaitingAlerts() {
  if (!watcher.officeHours()) return;
  const st = store.syncState.get(), seen = st.rxAlerted || {};
  const due = rxtasks.list().items.filter((i) => ['pending', 'refill', 'failed'].includes(i.kind) && i.at && (i.kind === 'failed' || Date.now() - new Date(i.at) >= 36e5));
  const fresh = due.filter((i) => !seen[`${i.kind}|${i.patient}|${i.med || ''}|${i.at}`]);
  if (!fresh.length) return;
  fresh.forEach((i) => { seen[`${i.kind}|${i.patient}|${i.med || ''}|${i.at}`] = Date.now(); });
  for (const k of Object.keys(seen)) if (Date.now() - seen[k] > 14 * 864e5) delete seen[k];
  store.syncState.set({ rxAlerted: seen });
  const c2 = fresh.filter((i) => rxtasks.needsPhysician(i));
  const text = c2.length ? `${fresh.length} prescription${fresh.length > 1 ? 's' : ''} waiting (${c2.length} Schedule II, needs Dr. Baig)` : `${fresh.length} prescription${fresh.length > 1 ? 's' : ''} waiting over an hour`;
  watcher.deliver([{ kind: 'rx', text }]);
}
// Checklist reminders: desktop notification, and a text if chosen. Texts never include the task wording (it may name a patient).
setInterval(() => {
  if (!pid()) return;
  const hits = checklist.dueNow(pid()); if (!hits.length) return;
  const pref = { desk: true, text: false, ...((store.settings.get().alertPrefs || {}).task || {}) };
  for (const i of hits) {
    if (pref.desk) notify('Reminder', i.text, () => { showWindow(); send('nav', 'today'); });
    if (pref.text) {
      const at = new Date(i.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      ringrx.alertNumber(pid()).then((to) => to && ringrx.sendSms(pid(), to, `Ruhwell Front Desk: a checklist reminder is due (${at}).`)).catch(() => {});
    }
  }
  send('checklist-updated', true);
}, 30000);

ipcMain.handle('rxnt:signin', async () => {
  const ok = await rxnt.signIn(pid(), win);
  activity.add('RxNT', 'sign-in', {}, !!ok);
  diag('rxnt', ok ? 'signed in' : 'sign-in not finished');
  if (ok) {
    rxntNeeds = ''; rxStepNotified = 0; setUserOut('rxnt', false); rxnt.clearCodeWait(pid());
    setRxntFlag(pid(), true); rxnt.keepSignedIn(pid()); if (rx.win && !rx.win.isDestroyed()) rx.win.destroy(); rx.win = null; watcher.reschedule();
    // Fresh start for RxNT: old failures cleared, schedule + prescriptions + portal read once the session settles.
    for (const k of ['schedule', 'rx', 'portal']) { fails[k] = 0; lastErr[k] = ''; lastSync[k] = 0; }
    setTimeout(() => preload(), 1500); setTimeout(() => syncDue(0), 5000); setTimeout(syncPatientsNow, 8000);
  }
  return ok;
});
ipcMain.handle('rxnt:logout', async () => { await rxnt.logout(pid()); setRxntFlag(pid(), false); setUserOut('rxnt', true); return true; });
// ---------- One shared RxNT reader window, with a queue so jobs never collide ----------
const rx = { win: null, pid: null, high: [], low: [], busy: false };
function reader() {
  const id = pid();
  if (!rx.win || rx.win.isDestroyed() || rx.pid !== id) {
    if (rx.win && !rx.win.isDestroyed()) rx.win.destroy();
    rx.win = rxnt.openReader(id); rx.pid = id;
    // If the hidden page crashes or hangs, throw it away so the next job gets a fresh one (same saved session).
    const w = rx.win, drop = (why) => { diag('rxnt', 'reader rebuilt', { why }); if (rx.win === w) rx.win = null; if (!w.isDestroyed()) w.destroy(); };
    w.webContents.on('render-process-gone', (_e, d) => drop((d && d.reason) || 'crashed'));
    w.webContents.on('unresponsive', () => drop('unresponsive'));
  }
  return rx.win;
}
// Two lanes: things you click ("high") always run before background work ("low").
function rxQueue(job, priority = 'low') {
  const lane = priority === 'high' ? 'high' : 'low';
  return new Promise((resolve, reject) => { rx[lane].push({ job, resolve, reject, priority: lane }); pump(); });
}
async function pump() {
  if (rx.busy) return;
  const next = rx.high.shift() || rx.low.shift();
  if (!next) return;
  rx.busy = true; rx.current = next.priority;
  send('rx-busy', { high: rx.high.length + (next.priority === 'high' ? 1 : 0), low: rx.low.length + (next.priority === 'low' ? 1 : 0) });
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('RxNT took too long. Retrying shortly.')), 90000); });
  try { next.resolve(await Promise.race([next.job(reader()), limit])); }
  catch (e) {
    // A stuck page: throw away the hidden RxNT window so the next job starts fresh.
    if (rx.win && !rx.win.isDestroyed() && (/too long/.test(e.message) || rx.win.webContents.isCrashed())) { rx.win.destroy(); rx.win = null; }
    next.reject(e);
  }
  clearTimeout(timer);
  rx.busy = false;
  if (!rx.high.length && !rx.low.length) send('rx-busy', { high: 0, low: 0 });
  pump();
}
const inFlight = {};

// Day cache: visits + provider blocks per date, refreshed in the background.
// Days read from RxNT. The last good copy of the coming week is kept (encrypted) so the app opens with the
// schedule right away, marked with when it was read, while it refreshes.
const dayCache = {};
let dayCacheTimer = null;
function saveDayCache() { clearTimeout(dayCacheTimer); dayCacheTimer = setTimeout(() => { try { const from = ymd(new Date(Date.now() - 864e5)), out = {}; for (const [d, v] of Object.entries(dayCache)) if (d >= from && d <= addDays(ymd(new Date()), 8) && v.items) out[d] = { items: v.items, blocks: v.blocks, at: v.at }; store.raw.writeSecure('daycache.bin', out); } catch {} }, 2000); }
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return ymd(x); };
app.whenReady().then(() => { try { const saved = store.raw.readSecure('daycache.bin', {}); const keepFrom = ymd(new Date(Date.now() - 864e5)); for (const [d, v] of Object.entries(saved || {})) if (d >= keepFrom && v && v.items) dayCache[d] = { ...v, saved: true }; } catch {} });
async function loadDay(date, priority = 'low') {
  const key = date + priority;
  if (inFlight[key]) return inFlight[key];
  return (inFlight[key] = loadDayNow(date, priority).finally(() => delete inFlight[key]));
}
const dropSeen = {};   // date -> when a sudden drop was first seen (believed on the next read)
async function loadDayNow(date, priority) {
  const id = pid();
  let r = await rxQueue((w) => rxnt.fetchDay(id, date, w), priority);
  if (r.needsLogin) { rxntSignedOut(id); return r; }
  // Check the day before it replaces what's on screen.
  if (r.items && r.date && r.date !== date) return { error: `RxNT showed ${r.date} instead of ${date}` };
  if (r.items) {
    const prev = dayCache[date];
    // Availability view didn't load: keep the visits only it had shown, so portal-confirmed visits don't vanish.
    if ((r.incomplete || []).includes('availability') && prev && prev.items) {
      const have = new Set(r.items.map((i) => String(i.appointmentId)));
      const keep = prev.items.filter((i) => !have.has(String(i.appointmentId)) && (i.seenIn || []).length === 1 && i.seenIn[0] === 'availability');
      if (keep.length) r = { ...r, items: [...r.items, ...keep].sort((a, b) => String(a.start).localeCompare(String(b.start))) };
    }
    // A day that suddenly lost most of its visits is read again before it's believed (a half-loaded page looks the same).
    const before = prev && prev.items ? prev.items.length : 0;
    if (!r.closed && before >= 2 && r.items.length <= Math.floor(before / 2) && !(dropSeen[date] && Date.now() - dropSeen[date] < 20 * 60000)) {
      dropSeen[date] = Date.now(); diag('schedule', 'sudden drop held', { from: before, to: r.items.length });
      return { error: 'fewer visits than before; checking again before showing it' };
    }
    delete dropSeen[date];
  }
  if (r.items && date === ymd(new Date())) mergeEhrToday(r);
  if (r.items) {
    setRxntFlag(id, true);
    dayCache[date] = { ...r, at: Date.now() }; saveDayCache();
    store.patients.upsert(r.items.filter((i) => i.patientId).map((i) => ({
      patientId: i.patientId, chart: i.chart, first: i.first, last: i.last, dob: i.dob, age: i.age,
      cell: i.cell, home: i.home, preferred: i.preferred, email: i.email, visitAt: i.start, visitType: i.visitType,
    })));
    store.syncState.set({ schedule: { at: new Date().toISOString() } });
    send('day', { date, ...dayCache[date] }); send('sync', syncStatus());
  }
  return r;
}
// Third source for today: the EHR's "Today's Appointments" (read with prescriptions). A visit any source lists
// is real; one only the EHR has is added, so a portal-confirmed visit never looks cancelled.
function mergeEhrToday(r) {
  const t = rxtasks.extras().today;
  if (!t || t.date !== ymd(new Date()) || Date.now() - new Date(t.at) > 30 * 60000) return;
  const have = new Map(r.items.map((i) => [String(i.appointmentId), i]));
  for (const e of t.items) {
    const x = have.get(String(e.appointmentId));
    if (x) { x.seenIn = [...new Set([...(x.seenIn || []), 'ehr'])]; if (!x.statusText && e.statusText) x.statusText = e.statusText; if (e.encounter) x.encounter = e.encounter; continue; }
    const rec = Object.values(store.patients.all()).find((p) => String(p.patientId) === String(e.patientId));
    const phone = String(e.preferred || (rec && (rec.cell || rec.preferred || rec.home)) || '').replace(/\D/g, '').slice(-10);
    r.items.push({ ...e, chart: (rec && rec.chart) || '', cell: (rec && rec.cell) || '', home: (rec && rec.home) || '', phone, phoneSource: phone ? 'Preferred' : '' });
  }
  r.items.sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
async function preload(center) {
  const c = center || ymd(new Date());
  const order = [0, 1, -1, 2, -2, 3, -3, 4];   // nearest days first
  for (const n of order) { const d = addDays(c, n); if (!dayCache[d] || Date.now() - dayCache[d].at > 5 * 60000) await loadDay(d); }
}
ipcMain.handle('rxnt:day', async (_e, date, force) => {
  const c = dayCache[date];
  if (c && !force) {
    if (Date.now() - c.at > 3 * 60000) loadDay(date, 'high');   // stale: show cached, refresh quietly
    setTimeout(() => preload(date), 500);
    return { ...c, cached: true };
  }
  const r = await loadDay(date, 'high');
  setTimeout(() => preload(date), 500);
  return r.items ? { ...dayCache[date] } : r;
});
ipcMain.handle('rxnt:range', async (_e, from, days) => {
  const out = {};
  for (let i = 0; i < days; i++) { const d = addDays(from, i); if (dayCache[d]) out[d] = dayCache[d]; }
  // Fill gaps right away (ahead of background work); each finished day is pushed to the window.
  for (let i = 0; i < days; i++) { const d = addDays(from, i); if (!dayCache[d] || Date.now() - dayCache[d].at > 5 * 60000) loadDay(d, 'high'); }
  return out;
});

ipcMain.handle('ringrx:login', async (_e, { username, password, otp }) => {
  try { const r = { ok: true, ...(await ringrx.login(pid(), username, password, otp)) }; activity.add('RingRx', 'sign-in', {}, true); setTimeout(() => syncComms(true), 500); return r; }
  catch (e) { activity.add('RingRx', 'sign-in', { reason: e.code || 'failed' }, false); return { ok: false, error: e.message, code: e.code }; }
});
ipcMain.handle('ringrx:logout', () => { ringrx.logout(pid()); return true; });

ipcMain.handle('settings:get', () => store.settings.get());
ipcMain.handle('settings:set', (_e, s) => {
  const cur = store.settings.get();
  store.settings.set({ ...cur, ...s, watch: { ...cur.watch, ...(s.watch || {}) }, sync: { ...(cur.sync || {}), ...(s.sync || {}) } });
  if (s.watch) watcher.reschedule();
  if ('openAtLogin' in s) applyLoginItem();
  return true;
});
ipcMain.handle('patients:list', () => Object.values(store.patients.all()));
ipcMain.handle('patients:update', (_e, key, fields) => {
  return store.patients.update(key, fields);
});
ipcMain.handle('sync:status', () => syncStatus());
ipcMain.handle('sync:patients', () => { syncPatientsNow(); return true; });
ipcMain.handle('patients:add', (_e, p) => { const db = store.patients.upsert([p]); send('sync', syncStatus()); return Object.values(db).find((x) => x.phone === p.phone && (x.first || '') === (p.first || '') && (x.last || '') === (p.last || ''))?.key || null; });
ipcMain.handle('history:list', () => historyForChecks());
// ---------- Calls & texts (RingRx) ----------
async function syncComms(force) {
  const st = comms.status();
  if (!force && st.at && Date.now() - new Date(st.at) < 4 * 60000) return { skipped: 'checked recently' };
  send('sync', syncStatus());
  const r = await comms.sync(pid());
  if (r && r.ok) setTimeout(retryRingrxReads, 1000);
  if (r && r.fresh) {
    comms.handleReplies(r.fresh, (ev) => watcher.addEvents(ev));
    let n = 0; for (const m of r.fresh) n += checklist.resolveFollowUps(pid(), m.phone, m.at);
    if (n) send('checklist-updated', true);
  }
  send('sync', syncStatus()); send('comms-updated', true);
  if (!r) return { error: 'no answer' };
  if (r.skipped) return { skipped: 'not signed in or already running' };
  return r.ok ? { ok: true } : { error: r.error || "texts or calls didn't load" };
}
// Sent texts (Front Desk + RingRx app) used for "already messaged" and "review already asked" checks.
function historyForChecks() {
  const local = store.log.all();
  const rr = (store.ringrxHistory.get().items || []).filter((m) => !m.inbound && !local.some((h) => h.phone === m.phone && Math.abs(new Date(h.at) - new Date(m.at)) < 10 * 60000))
    .map((m) => ({ at: m.at, phone: m.phone, ok: true, message: m.body, source: 'ringrx', template: 'Sent from RingRx' }));
  return [...local, ...rr].sort((a, b) => new Date(b.at) - new Date(a.at));
}
ipcMain.handle('comms:sync', () => syncComms(true));
ipcMain.handle('comms:texts', (_e, days) => comms.textThreads(days || 30));
ipcMain.handle('comms:calls', (_e, days) => comms.callList(days || 30));
ipcMain.handle('comms:thread', (_e, phone) => comms.thread(phone));
ipcMain.handle('comms:seen', (_e, phone) => { const ph = String(phone || '').replace(/\D/g, '').slice(-10); comms.markSeen(ph); send('sync', syncStatus()); ringrxRead(comms.unreadRingrxTexts(ph)); return true; });
// Read in the app → read in RingRx (in the background; if RingRx refuses, the app still shows it read).
// Ones that don't go through (offline, RingRx busy) wait in a small list and are retried after each sync and restart.
function ringrxRead(ids) {
  const id = pid(); if (!id || !ids || !ids.length) return;
  const cb = store.callbacks.get(); cb.rrPending = [...new Set([...(cb.rrPending || []), ...ids.map(String)])].slice(-5000); store.callbacks.set(cb);
  ringrx.markRead(id, ids).then((done) => {
    // Confirmed ones leave the list; the rest move to the back so one stubborn id can't block the others.
    const c2 = store.callbacks.get(), left = (c2.rrPending || []).filter((x) => !done.includes(x)), failed = new Set(ids.map(String).filter((x) => !done.includes(x)));
    c2.rrPending = [...left.filter((x) => !failed.has(x)), ...left.filter((x) => failed.has(x))]; store.callbacks.set(c2);
    if (done.length) { comms.setRingrxRead(done); send('sync', syncStatus()); }
    if (done.length < ids.length) activity.add('RingRx', 'mark-read', { waiting: ids.length - done.length }, false);
  }).catch(() => {});
}
function retryRingrxReads() { const p = store.callbacks.get().rrPending || []; if (p.length) ringrxRead(p.slice(0, 50)); }
// RxNT portal messages (sidebar chat): read-only, alert on new patient messages.
let portal = { at: null, error: null, me: null, conversations: [] };
async function refreshPortal() {
  const id = pid(); if (!id || !store.settings.get().rxntConnected?.[id]) return { skipped: 'RxNT not connected' };
  try {
    const r = await rxnt.readMessages(id);
    // A failed read keeps what we knew (it's not an empty inbox) and says so.
    if (r.error) { portal = { ...portal, error: r.error, failedAt: new Date().toISOString() }; return portal; }
    const before = new Map(portal.conversations.map((c) => [c.id, c.at])), seeded = portal.seeded;
    portal = { at: new Date().toISOString(), error: null, me: r.me, conversations: r.conversations, seeded: true };
    if (seeded) {   // after the first successful read, anything new or updated that needs a reply alerts (even if the inbox was empty before)
      const fresh = r.conversations.filter((c) => c.needsReply && c.unread && before.get(c.id) !== c.at);
      if (fresh.length) watcher.addEvents(fresh.map((c) => ({ kind: 'portal', text: `RxNT portal message from ${c.title}` })));
    }
    send('comms-updated', true); send('sync', syncStatus());
  } catch (e) { portal = { ...portal, error: 'failed', failedAt: new Date().toISOString() }; }
  return portal;
}
ipcMain.handle('portal:list', () => ({ ...portal, conversations: portal.conversations.map((c) => ({ ...c, done: comms.doneSince('p:' + c.id, c.at) })) }));
ipcMain.handle('portal:done', (_e, id) => { comms.markDone('p', String(id)); return true; });
ipcMain.handle('portal:refresh', async () => { const o = await runPart('portal', 'manual'); return o.kind === 'verified'; });
ipcMain.handle('comms:snooze', (_e, key, until) => { comms.snooze(String(key), Number(until)); return true; });
ipcMain.handle('comms:snoozes', () => comms.snoozes());
ipcMain.handle('comms:ignore', (_e, phone, on) => { comms.ignore(String(phone || '').replace(/\D/g, '').slice(-10), on !== false); send('sync', syncStatus()); return true; });
ipcMain.handle('comms:done', (_e, kind, phone) => { comms.markDone(kind, phone); send('sync', syncStatus()); return true; });
const ph10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
ipcMain.handle('comms:spam', (_e, phone, on, force) => { const p = ph10(phone); comms.markSpam(p, on !== false, !!force); activity.add('RingRx', on !== false ? 'marked-spam' : 'not-spam', { number: p }); send('sync', syncStatus()); send('comms-updated', true); return true; });
ipcMain.handle('comms:spamList', () => comms.spamList());
/* ---------- Faxes (Doximity) ---------- */
let faxCodeAt = 0;
async function syncFaxes() {
  if (faxCodeAt && Date.now() - faxCodeAt < 30 * 60000 && faxes.status().error === 'code') return { skipped: 'waiting for the Doximity code' };
  const r = await faxes.sync();
  if (r && r.added) {
    for (const f of r.fresh || []) activity.add('Doximity', 'fax-received', { fax: f.id.slice(0, 12), from_number: f.number, pages: f.pages });
    if (!r.firstRun) watcher.addEvents([{ kind: 'fax', text: r.added === 1 ? 'New fax' : `${r.added} new faxes` }]);   // no names, ever; the first full import isn't an alert
  }
  // Refresh the fax screen whenever something changed, including an earlier download that finally came through.
  if (r && (r.added || r.downloaded)) send('faxes-updated', true);
  if (r && r.ok && r.failed) diag('faxes', 'files retrying', { n: r.failed });
  // A code is needed: say so once, then stop signing in with the saved password until the user finishes it.
  if (r && r.needsLogin && faxes.status().error === 'code' && !faxCodeAt) { faxCodeAt = Date.now(); notify('Doximity needs a code', 'Click to finish signing in (one time).', () => { showWindow(); send('nav', 'settings'); }); }
  send('sync', syncStatus());
  return r;
}
ipcMain.handle('fax:list', () => faxes.list());
// Sorting help: the window sends rendered pages; text is read here (OCR, on this computer) into a category
// and up to three possible patients. Only the category and the suggestions are kept, not the text.
ipcMain.handle('fax:sort', async (_e, id, pages) => {
  const f = faxes.list().find((x) => x.id === String(id)); if (!f) return null;
  try {
    const text = await ocr.read(pages);
    const pats = Object.entries(store.patients.all()).map(([key, p]) => ({ key, first: p.first, last: p.last, dob: p.dob }));
    const meta = { category: ocr.categorize(text, f.from), suggest: ocr.suggest(text, pats), ocrAt: new Date().toISOString() };
    faxes.setMeta(String(id), meta); return meta;
  } catch (e) { faxes.setMeta(String(id), { ocrAt: new Date().toISOString(), ocrError: String(e.message || e).slice(0, 80), category: 'Unreadable' }); return null; }
});
ipcMain.handle('fax:pdf', (_e, id) => faxes.pdf(String(id)));
// Save a copy of a fax wherever Maria picks (the app's own copy stays encrypted). Logged for bookkeeping.
ipcMain.handle('fax:save', async (_e, id) => {
  const f = faxes.pdf(String(id)); if (!f) return { error: 'notdownloaded' };
  const it = (faxes.list ? faxes.list() : []).find((x) => x.id === String(id)) || {};
  const day = it.at ? new Date(it.at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const ext = f.mime === 'application/pdf' ? 'pdf' : 'tif';
  const name = `Fax ${day} ${String(it.from || it.number || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 40)}`.trim() + '.' + ext;
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, Buffer.from(f.data, 'base64'));
  activity.add('Doximity', 'fax-saved', { fax: String(id).slice(0, 12) }, true);
  return { ok: true, path: r.filePath };
});
ipcMain.handle('diag:save', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), `Ruhwell Front Desk diagnostics ${ymd(new Date())}.txt`), filters: [{ name: 'Text', extensions: ['txt'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  const head = `Ruhwell Front Desk ${app.getVersion()} · ${process.platform} ${process.arch} · saved ${new Date().toISOString()}\nAccounts: ${JSON.stringify(accountHealth())}\n\n`;
  fs.writeFileSync(r.filePath, head + diagBundle(7)); return { ok: true, path: r.filePath };
});
ipcMain.handle('fax:read', (_e, id, read) => { try { const f = faxes.update(String(id), { readAt: read === false ? null : new Date().toISOString() }); send('sync', syncStatus()); return !!f; } catch { return false; } });
ipcMain.handle('fax:mark', (_e, id, st) => { if (!['new', 'notpatient', 'spam', 'done'].includes(st)) return false; let f = null; try { f = faxes.update(String(id), { status: st, doneAt: st === 'new' ? null : new Date().toISOString() }); } catch { return false; } activity.add('Doximity', 'fax-marked', { fax: String(id).slice(0, 12), as: st }); send('sync', syncStatus()); return !!f; });
ipcMain.handle('fax:signin', async () => {
  const ok = await faxes.signIn(win);
  activity.add('Doximity', 'sign-in', {}, !!ok);
  if (ok) { setUserOut('faxes', false); faxCodeAt = 0; const f = store.settings.get().faxes || {}; store.settings.set({ ...store.settings.get(), faxes: { ...f, signedIn: true } }); }
  send('sync', syncStatus()); return ok;
});
ipcMain.handle('fax:signout', async () => { await faxes.signOut(); setUserOut('faxes', true); const f = store.settings.get().faxes || {}; store.settings.set({ ...store.settings.get(), faxes: { ...f, signedIn: false } }); send('sync', syncStatus()); return true; });
ipcMain.handle('fax:loginState', () => faxes.loginState());
ipcMain.handle('fax:forgetLogin', () => faxes.forgetLogin());
ipcMain.handle('fax:open', (_e, id) => { const f = faxes.list().find((x) => x.id === String(id)); return inapp.open('doximity', faxes.PART, f ? faxes.faxUrl(f) : 'https://www.doximity.com/inbox/faxes', win); });
ipcMain.handle('fax:retry', async (_e, id) => { const ok = await faxes.retryDownload(String(id)); activity.add('Doximity', 'fax-download', { fax: String(id).slice(0, 12), retry: true }, ok); send('sync', syncStatus()); return ok; });
// Step 1 of filing: find the chart for the patient Maria picked and read it fresh from RxNT (for her to confirm).
// The chart she's shown is remembered here, so step 2 can only file into exactly that chart.
const shownChart = {};   // fax id -> { internalId, chart, key, at }
ipcMain.handle('fax:findChart', async (_e, key, faxId) => {
  const p = store.patients.all()[key]; if (!p) return { error: 'nopatient' };
  if (!store.settings.get().rxntConnected?.[pid()]) return { error: 'signin' };
  const r = await rxnt.findChart(pid(), { patientId: p.patientId, first: p.first, last: p.last, dob: p.dob });
  if (r.needsLogin) { rxntSignedOut(pid()); return { error: 'signin' }; }
  if (r.patient && faxId) shownChart[String(faxId)] = { internalId: String(r.patient.internalId), chart: r.patient.chart, key, at: Date.now() };
  return r;
});
// Step 2: file it. One filing at a time; the fax is claimed and the attempt saved before anything is pressed
// in RxNT. If a past attempt ended uncertain (crash, timeout), the app only checks the chart; it never
// presses Save again by itself.
let filingNow = false;
const faxTitle = (f) => {
  const d = new Date(f.at || Date.now());
  const date = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  return { date, title: `Fax ${String(f.id).replace(/[^a-z0-9]/gi, '').slice(0, 8)} – ${String(f.from || f.number || 'Doximity').replace(/\s+/g, ' ').slice(0, 36)} – ${date}` };
};
ipcMain.handle('fax:file', async (_e, { id, internalId, category, confirmed, again }) => {
  id = String(id);
  if (confirmed !== true || !internalId) return { error: 'confirm' };
  const shown = shownChart[id];
  if (!shown || shown.internalId !== String(internalId) || Date.now() - shown.at > 20 * 60000) return { error: 'confirm' };   // must be the chart she just saw
  if (!shown.chart) return { error: 'nochart' };   // no chart number from RxNT: don't file
  if (filingNow) return { error: 'busy' };
  const f = faxes.list().find((x) => x.id === id); const file = faxes.pdf(id);
  if (!f || !file) return { error: 'nofile' };
  if (f.status === 'filed') return { error: 'already' };
  filingNow = true;   // claimed (synchronously, before any await)
  try {
    const { date, title } = faxTitle(f);
    const prev = f.attempt;
    if (prev && ['saving', 'uncertain'].includes(prev.state)) {   // a past attempt may have saved: check only
      const v = await rxnt.verifyInChart(pid(), prev.internalId, prev.title);
      if (v.needsLogin) { rxntSignedOut(pid()); return { error: 'signin' }; }
      if (v.unknown) return { error: 'uncertain' };   // couldn't read the chart: never treat that as "not there"
      if (v.found) { faxes.update(id, { status: 'filed', doneAt: new Date().toISOString(), filed: { chart: prev.chart, title: prev.title, at: new Date().toISOString() }, attempt: { ...prev, state: 'done' } }); activity.add('RxNT', 'fax-filed', { fax: id.slice(0, 12), chart: prev.chart, document: prev.title, verified: 'yes', note: 'found on re-check' }); send('sync', syncStatus()); return { ok: true, title: prev.title }; }
      // Not in the chart. A new upload needs Maria to say so explicitly ("upload again"), never automatically.
      activity.add('RxNT', 'fax-filed', { fax: id.slice(0, 12), chart: prev.chart, verified: 'no', note: 'earlier attempt not found in chart' }, false);
      if (again !== true) return { error: 'notfound-after', chart: prev.chart };
    }
    faxes.update(id, { attempt: { state: 'uploading', internalId: String(internalId), chart: shown.chart, title, at: new Date().toISOString() } });
    const ext = file.mime === 'image/tiff' ? 'tif' : 'pdf';
    const r = await rxnt.uploadToChart(pid(), internalId, file.data, { fileName: `Fax ${date.replace(/\//g, '-')}.${ext}`, title, category: category || 'Other', docDate: date, mime: file.mime,
      onSaving: () => faxes.update(id, { attempt: { state: 'saving', internalId: String(internalId), chart: shown.chart, title, at: new Date().toISOString() } }) });
    activity.add('RxNT', 'fax-filed', { fax: id.slice(0, 12), chart: shown.chart, document: title, confirmed_by: 'Maria (in app)', verified: r.ok ? 'yes' : 'no', reason: r.error || '' }, !!r.ok);
    if (r.needsLogin) { faxes.update(id, { attempt: null }); rxntSignedOut(pid()); return { error: 'signin' }; }
    if (r.ok) {
      faxes.update(id, { status: 'filed', doneAt: new Date().toISOString(), filed: { chart: shown.chart, title, at: new Date().toISOString() }, attempt: { state: 'done', internalId: String(internalId), chart: shown.chart, title } });
      delete shownChart[id]; send('sync', syncStatus());
      return { ok: true, title };
    }
    if (r.error === 'uncertain') { faxes.update(id, { attempt: { state: 'uncertain', internalId: String(internalId), chart: shown.chart, title, at: new Date().toISOString() } }); return { error: 'uncertain' }; }
    faxes.update(id, { attempt: null });   // nothing was saved (stopped before Save)
    return { error: r.error || 'failed' };
  } finally { filingNow = false; }
});
// Voicemail audio. Finds the recording's message id if the call doesn't have it yet; failures are logged
// (status and type only) so a "didn't play" can be traced.
ipcMain.handle('comms:vmAudio', async (_e, vmId, media) => {
  try {
    if (!vmId) { activity.add('RingRx', 'voicemail-play', { reason: 'no recording id' }, false); return { error: 'noid' }; }
    const r = await ringrx.voicemailAudio(pid(), String(vmId), String(media || ''));
    if (!r || r.error) { activity.add('RingRx', 'voicemail-play', { reason: (r && r.error) || 'failed' }, false); return { error: (r && r.error) || 'failed' }; }
    return r;
  } catch (e) { activity.add('RingRx', 'voicemail-play', { reason: e.code || 'error' }, false); return { error: 'failed' }; }
});
ipcMain.handle('comms:vmPlayFailed', (_e, why) => { activity.add('RingRx', 'voicemail-play', { reason: 'player: ' + String(why || '').slice(0, 80) }, false); return true; });
ipcMain.handle('comms:spamReview', () => { const c = store.callbacks.get(), r = c.spamReview || []; if (r.length) { c.spamReview = []; store.callbacks.set(c); } return r; });
ipcMain.handle('comms:heard', (_e, id, on, vmId) => { on === false ? comms.unmarkHeard(String(id)) : comms.markHeard(String(id)); send('sync', syncStatus()); if (on !== false && vmId) ringrxRead([String(vmId)]); return true; });
ipcMain.handle('comms:unseen', (_e, phone) => { comms.unmarkSeen(ph10(phone)); send('sync', syncStatus()); return true; });
ipcMain.handle('activity:list', (_e, f) => activity.list(f || {}));
ipcMain.handle('activity:export', async (_e, f) => {
  const rows = activity.list(f || {});
  const r = await dialog.showSaveDialog(win, { title: 'Export activity log', defaultPath: `Ruhwell activity ${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  require('fs').writeFileSync(r.filePath, activity.csv(rows)); return { ok: true, n: rows.length };
});
ipcMain.handle('ringrx:openPortal', (_e, page) => shell.openExternal('https://portal.ringrx.com/' + ({ contacts: 'contacts', block: 'my-phone' }[page] || '')));
ipcMain.handle('alerts:test', async () => {
  const to = await ringrx.alertNumber(pid());
  if (!to) return { error: 'Add a number first.' };
  try { await ringrx.sendSms(pid(), to, 'Ruhwell Front Desk: alert texts are working.'); return { ok: true }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('watch:check', () => watcher.check());
ipcMain.handle('watch:alerts', () => watcher.alerts());
ipcMain.handle('watch:read', () => { watcher.markRead(); return true; });
ipcMain.handle('watch:handle', (_e, id) => { watcher.handle(id); return true; });
// Undo for "Done" on Today: t:/c:/p: are texts, calls, portal messages; a: is a schedule alert.
ipcMain.handle('undo:done', (_e, key) => {
  const [kind, ...rest] = String(key || '').split(':'), id = rest.join(':');
  if (kind === 'a') watcher.handle(id, false); else if (['t', 'c', 'p'].includes(kind)) comms.unmarkDone(kind, id);
  send('sync', syncStatus()); return true;
});

// ---------- Sync status + patient directory sync ----------
let patientSync = { running: false, progress: null };
function syncStatus() {
  const st = store.syncState.get(), id = pid(), all = Object.values(store.patients.all());
  return {
    rxnt: !!store.settings.get().rxntConnected?.[id],
    ringrx: id ? ringrx.status(id).connected : false,
    patients: { ...(st.patients || {}), total: all.length, noPhone: all.filter((p) => !p.phone).length, running: patientSync.running, progress: patientSync.progress },
    schedule: st.schedule || null,
    alerts: watcher.status(),
    gmail: mail.status(),
    outbox: outbox.pending(), outboxEmail: outbox.pending('email'), outboxText: outbox.pending('text'),
    // What each part last read and whether it's reading right now (Today shows "Updated 9:42" / "Updating…").
    fresh: { schedule: (dayCache[ymd(new Date())] || {}).at || null, comms: Date.parse(store.ringrxHistory.get().at || '') || null, rx: lastOk.rx || null, gmail: lastOk.gmail || null, faxes: lastOk.faxes || null, portal: lastOk.portal || null },
    running: { ...syncRunning },
    rx: rxtasks.status(),
    needs: (() => { try { return comms.counts(); } catch { return { texts: 0, calls: 0 }; } })(),
    messages: comms.status(),
    portal: { at: portal.at, error: portal.error, waiting: portal.conversations.filter((c) => c.needsReply && !comms.doneSince('p:' + c.id, c.at)).length },
    rxntUser: (() => { const a = rxtasks.extras().account; return a && a.name ? [a.practice, `${a.name}${a.cred ? ', ' + a.cred : ''}`].filter(Boolean).join(' · ') : ''; })(),
    unsigned: rxtasks.extras().unsigned,
    locked: store.raw.lockedFiles().length > 0,
    health: Object.fromEntries(Object.keys(PLAN).filter((k) => k !== 'patients').map((k) => [k, { ok: lastOk[k] || null, failing: (fails[k] || 0) > 0 }])),
    accounts: accountHealth(),
    scheduleStale: scheduleStale(),
    faxes: faxes.status(),
    backup: backups.status(),
  };
}
async function syncPatientsNow() {
  const id = pid();
  if (patientSync.running || !id || !store.settings.get().rxntConnected?.[id]) return { skipped: patientSync.running ? 'already running' : 'RxNT not connected' };
  patientSync = { running: true, progress: { done: 0, total: 26, count: 0 } }; send('sync', syncStatus());
  const db = store.patients.all();
  const byChart = {}; Object.values(db).forEach((p) => { if (p.chart) byChart[p.chart] = p; });
  const knownCharts = new Set(Object.keys(byChart));
  const FRESH = 14 * 864e5;
  // Details are re-read every 14 days, and once for anyone whose email hasn't been looked for yet.
  const needsDetail = (row) => { const c = byChart[row.chart]; return !c || !c.detailAt || !c.emailChecked || Date.now() - c.detailAt > FRESH || (row.listedPhone && row.listedPhone !== c.listedPhone); };
  let count = 0, error = null;
  try {
    const started = Date.now(), LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    // Picks up where the last run stopped (a slow day can't keep skipping the later letters), and letters that
    // timed out last time are tried again first. A full pass is complete only when every letter really loaded.
    const prevState = store.syncState.get().patients || {};
    const startAt = Math.max(0, LETTERS.indexOf(prevState.cursor || 'A'));
    const order = [...new Set([...(prevState.missed || []), ...LETTERS.slice(startAt), ...LETTERS.slice(0, startAt)])];
    const missed = [], doneLetters = new Set(prevState.cursor ? prevState.doneLetters || [] : []);
    let cursor = null;
    for (const [i, L] of order.entries()) {
      if (Date.now() - started > 30 * 60000) { error = 'took too long; continues next time'; cursor = L; diag('patients', 'time limit', { letter: L }); break; }
      let list = await rxQueue((w) => rxnt.listLetter(w, L));
      if (list.needsLogin) { if (await rxntSignedOut(id)) { error = 'RxNT signed out'; cursor = L; break; } list = await rxQueue((w) => rxnt.listLetter(w, L)); }   // signed back in: read this letter again
      if (list.needsLogin || list.timedOut) { missed.push(L); diag('patients', 'letter not loaded', { letter: L }); continue; }
      const quick = [];
      for (const [ri, row] of list.rows.entries()) {
        if (row.done || !needsDetail(row)) { quick.push(row); continue; }
        let r = await rxQueue((w) => rxnt.openPatient(w, L, ri, row));   // one chart per job
        if (r.needsLogin) { if (await rxntSignedOut(id)) { error = 'RxNT signed out'; cursor = L; break; } r = await rxQueue((w) => rxnt.openPatient(w, L, ri, row)); }
        if (r.failed || r.needsLogin) { quick.push({ ...row, emailChecked: false }); continue; }   // chart didn't open or didn't match: retried next run
        if (r.patient) store.patients.upsert([r.patient]);
        count++;
      }
      if (quick.length) store.patients.upsert(quick);
      count += quick.length;
      if (error) break;
      doneLetters.add(L);
      patientSync.progress = { letter: L, done: i + 1, total: order.length, count }; send('sync', syncStatus());
    }
    const complete = !error && LETTERS.every((L) => doneLetters.has(L));
    store.syncState.set({ patients: { ...(store.syncState.get().patients || {}), ...(complete ? { at: new Date().toISOString(), cursor: null, doneLetters: [] } : { cursor: cursor || 'A', doneLetters: [...doneLetters] }), missed, error: error || (missed.length ? `${missed.length} letter${missed.length > 1 ? 's' : ''} didn't load; tried again next time` : null) } });
    if (!error && missed.length) error = `${missed.length} letters didn't load`;
  } catch (e) { error = e.message; store.syncState.set({ patients: { ...(store.syncState.get().patients || {}), error } }); }
  patientSync = { running: false, progress: null }; send('sync', syncStatus());
  // Patients sign themselves up through the RxNT portal: alert on anyone new since the last check.
  if (!error && knownCharts.size) {
    const fresh = Object.values(store.patients.all()).filter((p) => p.chart && !knownCharts.has(p.chart));
    if (fresh.length) watcher.addEvents(fresh.slice(0, 10).map((p) => ({ kind: 'newpatient', key: p.key, text: `New patient in RxNT: ${`${p.first || ''} ${p.last || ''}`.trim() || 'chart ' + p.chart}` })));
  }
  return error ? { error: String(error).slice(0, 120) } : { ok: true };
}
/* ---------- Smart sync ----------
   What matters most is fast: new / cancelled appointments and texts / calls. The rest is slower.
   Office hours (Settings → Sync, weekdays) use the busy rate; evenings and weekends the quiet rate.
   Opening or focusing the app catches up anything older than 15 minutes. */
// Every run is also the real connection check for its account (a pill only turns green on a successful read).
const PLAN = {           // minutes: [busy, quiet]
  schedule: [5, 10],     // RxNT appointments: new, cancelled, rescheduled
  comms: [5, 10],        // RingRx texts and calls
  portal: [10, 20],      // RxNT portal messages
  gmail: [10, 30],
  rx: [10, 30],          // prescriptions and RxNT To-Do
  faxes: [5, 10],        // Doximity fax inbox
  patients: [240, 720],  // patient list (portal sign-ups)
};
const lastSync = { schedule: 0, comms: 0, portal: 0, gmail: 0, rx: 0, faxes: 0, patients: Date.now() };
function busyNow(d = new Date()) {
  const s = store.settings.get().sync || {}, hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.getDay() >= 1 && d.getDay() <= 5 && hm >= (s.busyStart || '08:00') && hm < (s.busyEnd || '17:00');
}
// Every part returns what this attempt proved: { ok: true } (real data read), { error } / { needsLogin }
// (failed), or { skipped } (busy, not connected, checked a moment ago: proves nothing either way).
const RUN = {
  schedule: () => watcher.check(),
  comms: () => syncComms(true),
  portal: async () => { const r = await refreshPortal(); return r.skipped ? r : r.error ? { error: r.error } : { ok: true }; },
  gmail: async () => { const st = await mail.check(); send('sync', syncStatus()); return st && st.error ? { error: st.error === 'signin' ? 'sign-in needed' : st.error, needsLogin: st.error === 'signin' } : st && st.connected ? { ok: true } : { error: 'not connected' }; },
  rx: () => refreshRx(),
  patients: () => syncPatientsNow(),
  faxes: async () => { const r = await syncFaxes(); return r && (r.busy || r.off) ? { skipped: r.busy ? 'already running' : 'off' } : r; },
};
// Longest a part may take before it counts as failed (and is retried); nothing can hold "Syncing…" forever.
const DEADLINE_MIN = { schedule: 4, comms: 3, portal: 3, gmail: 2, rx: 5, faxes: 8, patients: 35 };
// The user can switch a source off in Settings → Connections (Faxes only for now).
const sourceOn = (k) => { if (k !== 'faxes') return true; const f = store.settings.get().faxes || {}; return f.enabled !== false && !userOut('faxes') && (!!f.signedIn || !!faxes.savedLogin()); };
// Did a run work? A failure is retried within minutes (3, then 6, 12…) instead of waiting the full interval.
const lastOk = {}, fails = {}, syncRunning = {}, lastErr = {};
// A short, plain reason for a failed run (shown in Accounts and the sync card, and written to the diagnostics log).
function whyFailed(k, r) {
  if (r && r.needsLogin) return 'sign-in needed';
  if (r && r.error) return String(r.error).slice(0, 120);
  if (r === false) return 'no answer';
  if (k === 'rx' && rxtasks.list().available === false) return (rxtasks.list().error || 'prescriptions page did not load');
  if (k === 'gmail' && mail.status().error) return mail.status().error;
  return '';
}
// Only an explicit success counts. Skipped, busy, empty or unknown answers never move "last checked".
function outcomeOf(k, r) {
  if (r && (r.skipped || r.busy)) return { kind: 'skipped', why: String(r.skipped || 'already running') };
  if (r && r.ok === true && !r.error && !r.needsLogin) return { kind: 'verified' };
  return { kind: 'failed', why: whyFailed(k, r) || 'no confirmed result' };
}
const normalEvery = (k) => (busyNow() ? PLAN[k][0] : PLAN[k][1]);
// One run per part at a time: the timer, Sync now, wake and the sync card all share it and get its real result.
const inflight = {};
function runPart(k, how = 'timer') {
  if (inflight[k]) return inflight[k];
  syncRunning[k] = true; lastSync[k] = Date.now();
  const t0 = Date.now(); let timer;
  const deadline = new Promise((res) => { timer = setTimeout(() => res({ error: `timed out after ${DEADLINE_MIN[k]} min` }), DEADLINE_MIN[k] * 60000); });
  diag(k, 'start', { how });
  inflight[k] = Promise.race([Promise.resolve().then(RUN[k]).catch((e) => ({ error: String((e && e.message) || e || 'error').slice(0, 120) })), deadline]).then((r) => {
    clearTimeout(timer);
    const o = outcomeOf(k, r), every = normalEvery(k);
    syncRunning[k] = false; delete inflight[k];
    if (o.kind === 'skipped') {
      diag(k, 'skipped', { how, why: o.why, ms: Date.now() - t0 });
      if (/running|busy/.test(o.why)) lastSync[k] = Date.now() - every * 60000 + 60000;   // busy: look again in a minute (not signed in: the normal interval)
    } else if (o.kind === 'verified') {
      lastOk[k] = Date.now(); fails[k] = 0; lastErr[k] = '';
      activity.add(SOURCE_OF[k], 'sync', { part: k, ...(how === 'timer' ? {} : { manual: true }) }, true);
      diag(k, 'ok', { how, ms: Date.now() - t0 });
    } else {
      lastErr[k] = o.why; fails[k] = (fails[k] || 0) + 1;
      activity.add(SOURCE_OF[k], 'sync', { part: k, ...(how === 'timer' ? {} : { manual: true }) }, false);
      diag(k, 'failed', { how, ms: Date.now() - t0, why: o.why, tries: fails[k] });
      // Quick first retry (most failures are a slow page or a session settling), then backing off. Based on the
      // normal interval, so a forced run (wake, Sync now) keeps its short retry.
      const retry = Math.min([0.67, 2, 5, 10][Math.min(fails[k], 4) - 1], every) * 60000;
      lastSync[k] = Date.now() - every * 60000 + retry;
    }
    send('sync', syncStatus());
    return o;
  });
  return inflight[k];
}
function syncDue(maxAgeMin) {
  const busy = busyNow(), now = Date.now();
  for (const [k, [b, q]] of Object.entries(PLAN)) {
    if (inflight[k] || !sourceOn(k)) continue;   // never two runs of the same source at once
    // After wake / back online (maxAgeMin given), every part that's overdue is read now, not just a few.
    const every = maxAgeMin != null && k !== 'patients' ? Math.min(maxAgeMin, b) : busy ? b : q;
    if (now - lastSync[k] < every * 60000) continue;
    runPart(k, maxAgeMin != null ? 'catch-up' : 'timer');
  }
}
setInterval(() => syncDue(), 20000);
const SOURCE_OF = { schedule: 'RxNT', rx: 'RxNT', portal: 'RxNT', patients: 'RxNT', comms: 'RingRx', gmail: 'Gmail', faxes: 'Doximity' };
// Why a part didn't work, in plain words.
function partReason(k) {
  const id = pid();
  if (SOURCE_OF[k] === 'RxNT' && !store.settings.get().rxntConnected?.[id]) return 'sign-in needed';
  if (k === 'comms' && !(id && ringrx.status(id).connected)) return 'sign-in needed';
  if (k === 'gmail' && mail.status().error === 'signin') return 'sign-in needed';
  if (k === 'faxes' && faxes.status().error === 'signin') return 'sign-in needed';
  if (k === 'faxes' && faxes.status().error === 'code') return 'needs a code';
  if (!net.isOnline()) return 'no internet';
  return lastErr[k] ? `couldn't load: ${lastErr[k]}` : "couldn't load";
}
// Manual "Sync" / "Check everything": runs one part now and reports how it went (the sync card shows each).
ipcMain.handle('sync:part', async (_e, k) => {
  if (!RUN[k] || k === 'patients') return { ok: false, reason: 'unknown' };
  if (!sourceOn(k)) return { ok: true, off: true };
  if (partReason(k) === 'sign-in needed') { fails[k] = (fails[k] || 0) + 1; return { ok: false, reason: 'sign-in needed' }; }
  // Joins a run already in progress and reports that run's real result.
  const o = await runPart(k, 'manual');
  if (o.kind === 'verified') return { ok: true, reason: '' };
  if (o.kind === 'skipped') return { ok: false, soft: true, reason: o.why === 'already running' ? 'still checking' : o.why };
  return { ok: false, reason: partReason(k) };
});
// Health for each account: green only when the last real read is fresh; amber when stale; red when sign-in is needed.
// One status per account, worked out here only; Settings, the sidebar, Today and the sync card all show this.
//   ok         Working · checked 9:42           (every part had a verified read recently)
//   retrying   Retrying                         (one failed read; the last verified data is still shown)
//   needs      Needs you · exact step           (sign in / code / a page to click / password changed)
//   unconfirmed Can't confirm · last checked X   (two or more failed reads, or nothing verified for too long)
//   offline    Offline · showing saved information
// `level` (green/grey/red/amber/off) and `why` are kept for the existing screens; `short` is the one-line text.
function accountHealth() {
  const w = watcher.status() || {}; if (w.lastRun && !w.lastError) lastOk.schedule = Math.max(lastOk.schedule || 0, Date.parse(w.lastRun) || 0);
  const busy = busyNow(), id = pid(), now = Date.now(), online = net.isOnline();
  const NAMES = { schedule: 'schedule', rx: 'prescriptions', portal: 'portal messages', comms: 'texts and calls', gmail: 'email', faxes: 'faxes' };
  const t = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const NEED = { signin: 'sign-in needed', code: 'needs a verification code', step: 'needs you to finish signing in', password: 'saved password stopped working', account: 'signed in to the wrong account' };
  const lvl = (name, keys, need) => {
    const at = Math.min(...keys.map((k) => lastOk[k] || 0)), atIso = at ? new Date(at).toISOString() : null;
    if (need) return { level: 'red', state: 'needs', action: need, why: NEED[need], short: `${name} ${NEED[need]}`, at: atIso };
    if (!online) return { level: 'grey', state: 'offline', why: 'offline · showing saved information', short: 'Offline · showing saved information', at: atIso };
    // Too old = about three missed reads at the normal pace (and at least an hour in office hours, four after).
    const tooOld = (k) => now - (lastOk[k] || 0) > Math.max(3 * normalEvery(k) * 60000, (busy ? 1 : 4) * 3600e3);
    const bad = keys.filter((k) => (fails[k] || 0) >= 2), retrying = keys.filter((k) => (fails[k] || 0) === 1);
    const stale = keys.filter((k) => lastOk[k] && tooOld(k));
    if (bad.length || stale.length) {
      const which = (bad.length ? bad : stale).map((k) => NAMES[k] || k).join(' and ');
      const why = bad.length ? `${which} couldn't load${lastErr[bad[0]] ? ' · ' + lastErr[bad[0]] : ''}` : `${which} not confirmed lately`;
      return { level: 'amber', state: 'unconfirmed', why, short: `${name}: can't confirm ${which}${at ? ' · last checked ' + t(at) : ''}`, at: atIso };
    }
    if (retrying.length) return { level: 'grey', state: 'retrying', why: 'retrying…', short: `${name}: retrying`, at: atIso };
    const waiting = keys.filter((k) => !lastOk[k]);
    if (waiting.length) return { level: 'grey', state: 'checking', why: `checking ${waiting.map((k) => NAMES[k] || k).join(', ')}…`, short: `${name}: checking…`, at: atIso };
    return { level: 'green', state: 'ok', why: '', short: `${name} · checked ${t(at)}`, at: atIso };
  };
  const g = mail.status(), fx = faxes.status(), rr = id ? ringrx.status(id) : { connected: false };
  const rxOn = !!store.settings.get().rxntConnected?.[id];
  const fxSet = (store.settings.get().faxes || {}).signedIn || faxes.savedLogin();
  return {
    rxnt: lvl('RxNT', ['schedule', 'rx', 'portal'], rxOn ? '' : rxntNeeds || 'signin'),
    ringrx: lvl('RingRx', ['comms'], rr.connected ? '' : rr.needsCode ? 'code' : 'signin'),
    gmail: lvl('Gmail', ['gmail'], g.error === 'signin' || (!g.connected && !lastOk.gmail) ? 'signin' : ''),
    doximity: userOut('faxes') ? { level: 'off', state: 'off', why: 'signed out', short: '' } : !fxSet ? { level: 'off', state: 'off', why: 'not set up', short: '' }
      : sourceOn('faxes') ? lvl('Doximity', ['faxes'], fx.error === 'code' ? 'code' : fx.error === 'signin' ? 'signin' : '') : { level: 'off', state: 'off', why: 'off', short: '' },
  };
}
// The schedule hasn't been read for 20+ minutes in office hours: Today shows a banner.
function scheduleStale() { const w = watcher.status() || {}; const last = Math.max(lastOk.schedule || 0, !w.lastError && w.lastRun ? Date.parse(w.lastRun) || 0 : 0); return busyNow() && pid() && store.settings.get().rxntConnected !== undefined && Date.now() - last > 20 * 60000 && Date.now() - appStarted > 20 * 60000 ? (last ? new Date(last).toISOString() : 'never') : null; }
const appStarted = Date.now();

// Waking from sleep or getting the internet back: catch up right away (schedule, texts and portal first).
let wasOnline = true;
// After waking or Wi-Fi coming back, wait until the internet actually answers (up to a minute) before syncing.
function catchUp() {
  diag('app', 'wake/online: catching up');
  const t0 = Date.now();
  // Wait until the internet is actually back; while offline, keep waiting (saved sign-ins are untouched).
  const tryNow = () => { if (net.isOnline()) setTimeout(() => syncDue(0), 3000); else if (Date.now() - t0 < 30 * 60000) setTimeout(tryNow, Date.now() - t0 > 60000 ? 15000 : 3000); };
  setTimeout(tryNow, 4000);
}
app.whenReady().then(() => {
  powerMonitor.on('resume', catchUp);
  powerMonitor.on('unlock-screen', () => syncDue(15));
  setInterval(() => { const on = net.isOnline(); if (on && !wasOnline) catchUp(); wasOnline = on; }, 20000);
  // Mac: keep macOS from napping the app while its window is hidden during office hours, so checks
  // and alerts stay on time. Released outside office hours to save battery.
  if (process.platform === 'darwin') {
    let napBlock = null;
    const nap = () => {
      const want = busyNow();
      if (want && napBlock === null) napBlock = powerSaveBlocker.start('prevent-app-suspension');
      else if (!want && napBlock !== null) { powerSaveBlocker.stop(napBlock); napBlock = null; }
    };
    nap(); setInterval(nap, 5 * 60000);
  }
});
function syncSoon() { syncDue(15); }   // on open / focus

// ---------- RingRx extras: sending number, replies (STOP opt-out, C confirm) ----------
const fromCache = {};
ipcMain.handle('ringrx:from', async () => {
  const id = pid();
  if (!id || !ringrx.status(id).connected) return '';
  if (fromCache[id] && Date.now() - fromCache[id].at < 6 * 36e5) return fromCache[id].num;
  const num = await ringrx.sendingNumber(id);
  fromCache[id] = { num, at: Date.now() };
  return num;
});
ipcMain.handle('replies:confirmed', () => store.inbound.get().confirmed || {});
// ---------- Morning summary and evening reminder nudge ----------
const dayStamp = {};
function hhmm(d = new Date()) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: icon(), silent: !store.settings.get().sound });
  if (onClick) n.on('click', onClick);
  n.show();
}
async function dailyTasks() {
  const s = store.settings.get(), now = new Date(), today = ymd(now), t = hhmm(now);
  if (!pid() || !s.rxntConnected?.[pid()]) return;
  if (s.summary.on && t >= s.summary.time && dayStamp.summary !== today && t < '23:00') {
    dayStamp.summary = today;
    const r = await loadDay(today);
    if (r.items) {
      const items = r.items.filter((v) => !/cancel|deleted|no ?show|missed|rescheduled/i.test(v.statusText || '')), since = Date.now() - 24 * 36e5;
      const alerts = watcher.alerts().filter((a) => new Date(a.at) > since && !a.quiet && !a.handled);
      const nw = alerts.filter((a) => a.kind === 'new').length, cx = alerts.filter((a) => a.kind === 'cancelled' || a.kind === 'noshow').length;
      const first = items.map((v) => v.start).sort()[0];
      const day = items.length ? `${items.length} visit${items.length === 1 ? '' : 's'} today, first at ${new Date(first).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : 'No visits today.';
      const changes = [nw && `${nw} new booking${nw === 1 ? '' : 's'}`, cx && `${cx} cancellation${cx === 1 ? '' : 's'}`].filter(Boolean).join(', ');
      const body = changes ? `${day} Since yesterday: ${changes}.` : day;
      notify('Good morning', body, () => { showWindow(); send('nav-date', today); });
    }
  }
  if (s.nudge.on && t >= s.nudge.time && dayStamp.nudge !== today && t < '23:00') {
    dayStamp.nudge = today;
    const tm = addDays(today, 1), r = await loadDay(tm);
    if (r.items && r.items.length && !r.closed) notify('Tomorrow\'s reminders', `${r.items.length} visit${r.items.length === 1 ? '' : 's'} tomorrow. Tap to send reminders.`, () => { showWindow(); send('nav-date', tm); });
  }
}
setInterval(() => dailyTasks().catch(() => {}), 60000);
// "Starts in 15 minutes" heads-up for booked visits today (desktop and/or text, per Alert settings).
const soonSent = new Set();
function soonCheck() {
  const s = store.settings.get(), pref = (s.alertPrefs || {}).soon || {};
  if (!pref.desk && !pref.text) return;
  const day = dayCache[ymd(new Date())]; if (!day || !day.items) return;
  const lead = Number(pref.minutes) || 15, now = Date.now(), evs = [];
  for (const a of day.items) {
    const t = new Date(a.start).getTime(), mins = (t - now) / 60000;
    if (soonSent.has(a.appointmentId) || mins > lead || mins < lead - 2) continue;
    if (/cancel|delet|no.?show|missed|resched|complet/i.test(a.statusText || '')) continue;
    soonSent.add(a.appointmentId);
    const tm = new Date(a.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    evs.push({ kind: 'soon', appt: a, text: `Starts in ${lead} min: ${`${a.first || ''} ${a.last || ''}`.trim()} · ${tm}${a.visitType ? ' · ' + a.visitType : ''}` });
  }
  if (evs.length) watcher.addEvents(evs);
}
setInterval(soonCheck, 60000);

// Wrap-up and charting nudges (pop-ups only, never texts):
//  - 5 minutes before the next visit, while a visit is still going: "Wrap up".
//  - Right after a visit ends: "Chart this visit?", which opens RxNT.
const nudged = new Set();
const liveVisit = (a) => !/cancel|delet|no.?show|missed|resched/i.test(a.statusText || '');
function nudgeCheck() {
  const pref = (store.settings.get().alertPrefs || {}).nudge || { desk: true };
  if (!pref.desk) return;
  const day = dayCache[ymd(new Date())]; if (!day || !day.items) return;
  const now = Date.now(), visits = day.items.filter(liveVisit).sort((a, b) => new Date(a.start) - new Date(b.start));
  const tm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nm = (a) => `${a.first || ''} ${a.last || ''}`.trim();
  for (const a of visits) {
    const start = new Date(a.start).getTime(), end = a.end ? new Date(a.end).getTime() : start + 30 * 60000;
    const inVisit = visits.some((b) => b !== a && new Date(b.start).getTime() <= now && (b.end ? new Date(b.end).getTime() : new Date(b.start).getTime() + 30 * 60000) > now);
    const mins = (start - now) / 60000;
    if (inVisit && mins <= 5 && mins > 3 && !nudged.has('w' + a.appointmentId)) {
      nudged.add('w' + a.appointmentId);
      notify('Wrap up', `Next visit at ${tm(a.start)}: ${nm(a)}`, () => { showWindow(); send('nav-date', ymd(new Date())); });
    }
    const after = (now - end) / 60000;
    if (after >= 0 && after < 3 && !nudged.has('c' + a.appointmentId)) {
      nudged.add('c' + a.appointmentId);
      notify('Chart this visit?', `${nm(a)} · ${tm(a.start)} visit ended`, () => openRxntIn('https://app2.rxnt.com/ehrv9/dashboard'));
    }
  }
}
setInterval(nudgeCheck, 60000);

// End of day: at closing time on weekdays, one check of what's still open (or a clear "all done").
let eodStamp = '';
function endOfDay() {
  const s = store.settings.get(), now = new Date(), end = (s.sync || {}).busyEnd || '17:00';
  if (now.getDay() < 1 || now.getDay() > 5 || hhmm(now) !== end || eodStamp === ymd(now) || !pid()) return;
  eodStamp = ymd(now);
  const st = syncStatus(), c = (rxtasks.list().counts) || {}, N = st.needs || {};
  const left = [
    c.unsigned && `${c.unsigned} note${c.unsigned > 1 ? 's' : ''} to sign`,
    (rxtasks.status().count) && `${rxtasks.status().count} prescription${rxtasks.status().count > 1 ? 's' : ''} waiting`,
    N.texts && `${N.texts} text${N.texts > 1 ? 's' : ''} unanswered`,
    N.calls && `${N.calls} call${N.calls > 1 ? 's' : ''} to return`,
    c.labs && `${c.labs} lab${c.labs > 1 ? 's' : ''} to review`,
    c.unposted && `${c.unposted} payment${c.unposted > 1 ? 's' : ''} to post`,
  ].filter(Boolean);
  // Tomorrow at a glance, so the next day doesn't start with a surprise.
  const tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const tv = ((dayCache[ymd(tm)] || {}).items || []).filter(liveVisit).sort((a, b) => new Date(a.start) - new Date(b.start));
  const tomorrow = tv.length ? `Tomorrow: first visit ${new Date(tv[0].start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${tv.length} visit${tv.length > 1 ? 's' : ''}${tv.filter((v) => /new/i.test(v.visitType || '')).length ? ` · ${tv.filter((v) => /new/i.test(v.visitType || '')).length} new` : ''}` : '';
  notify(left.length ? 'Before you go' : 'All done for today', [left.length ? left.join(' · ') : 'Nothing left waiting. Nice work.', tomorrow].filter(Boolean).join('\n'), () => { showWindow(); send('nav', 'today'); });
}
setInterval(endOfDay, 30000);

// "Done today": a running count of things finished, for a visible sense of progress.
// Timer: one at a time. When it ends: a gentle chime, a pop-up, and an in-app "Time's up" with +5 min / Done.
ipcMain.handle('timer:start', (_e, min, label) => timer.start(min, label));
ipcMain.handle('timer:pause', () => timer.pause());
ipcMain.handle('timer:resume', () => timer.resume());
ipcMain.handle('timer:add', (_e, m) => timer.add(m || 5));
ipcMain.handle('timer:stop', () => timer.stop());
ipcMain.handle('timer:get', () => timer.state());
app.whenReady().then(() => timer.init({
  onChange: (st) => send('timer', st),
  menuBar: (txt) => { if (!tray || tray.isDestroyed()) return; if (isMac) tray.setTitle(txt ? ` ${txt}` : ''); tray.setToolTip(txt ? `Ruhwell Front Desk · timer ${txt}` : 'Ruhwell Front Desk'); },
  onEnd: (label) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title: label ? `Time's up: ${label}` : "Time's up", body: 'Open to add 5 minutes or finish.', icon: icon(), silent: false, sound: isMac ? 'Glass' : undefined });
      n.on('click', () => { showWindow(); send('timer-end', label); });
      n.show();
    }
    send('timer-end', label);
  },
}));
// Quick capture from anywhere: Cmd/Ctrl+Shift+Space opens a small box over any app; Return adds the task.
let capWin = null;
function openCapture() {
  if (!pid()) return;
  if (capWin && !capWin.isDestroyed()) { capWin.show(); capWin.focus(); return; }
  const { screen } = require('electron');
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  capWin = new BrowserWindow({ width: 560, height: 118, x: Math.round(area.x + (area.width - 560) / 2), y: Math.round(area.y + area.height * 0.22),
    frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true, skipTaskbar: true, show: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
  capWin.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  capWin.loadFile(path.join(__dirname, 'renderer', 'capture.html'));
  capWin.once('ready-to-show', () => { capWin.show(); capWin.focus(); });
  capWin.on('closed', () => { capWin = null; });
}
ipcMain.handle('capture:close', (_e, added) => { if (capWin && !capWin.isDestroyed()) capWin.close(); if (added) send("checklist-updated", true); return true; });
const CAPTURE_KEY = 'CommandOrControl+Shift+Space';
app.whenReady().then(() => { try { globalShortcut.register(CAPTURE_KEY, openCapture); } catch {} });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
// Patient timeline: visits, schedule changes, texts, calls and prescriptions in one list, newest first.
// Built only from what's already on this computer.
ipcMain.handle('patient:timeline', (_e, key) => {
  const p = store.patients.all()[key]; if (!p) return [];
  const phones = new Set([p.phone, ...(p.otherPhones || [])].filter(Boolean)), name = `${p.first || ''} ${p.last || ''}`.trim().toLowerCase();
  const out = [], since = Date.now() - 180 * 864e5, hm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  for (const e of comms.events()) {
    if (!phones.has(e.phone) || new Date(e.at) < since) continue;
    if (e.type === 'text') out.push({ at: e.at, kind: 'text', title: e.inbound ? 'Text from them' : `Text sent${e.via ? ' · ' + e.via : ''}`, detail: String(e.body || '').slice(0, 160) });
    else out.push({ at: e.at, kind: 'call', title: e.voicemail ? 'Voicemail' : e.inbound ? (e.missed ? 'Missed call' : 'Call in') : 'Call out', detail: e.transcription ? String(e.transcription).slice(0, 160) : e.secs ? `${Math.round(e.secs / 60) || '<1'} min` : '' });
  }
  const seen = new Set();
  for (const day of Object.values(dayCache)) for (const a of (day && day.items) || []) {
    if (String(a.patientId) !== String(p.patientId || '') && `${a.first} ${a.last}`.toLowerCase() !== name) continue;
    if (seen.has(a.appointmentId)) continue; seen.add(a.appointmentId);
    out.push({ at: a.start, kind: 'visit', title: `Visit ${new Date(a.start) > new Date() ? 'booked' : ''}`.trim() + ` · ${hm(a.start)}`, detail: [a.visitType, a.statusText].filter(Boolean).join(' · ') });
  }
  for (const al of store.watchState.get().alerts || []) if (al.appt && (String(al.appt.patientId) === String(p.patientId || '') || phones.has(al.appt.phone)) && !al.quiet && new Date(al.at) >= since) out.push({ at: al.at, kind: 'change', title: al.text, detail: '' });
  for (const r of [...rxtasks.list().items, ...(rxtasks.list().sent || [])]) if (String(r.patient || '').toLowerCase() === name) out.push({ at: r.at || new Date().toISOString(), kind: 'rx', title: { pending: 'Prescription pending', refill: 'Refill request', failed: 'Prescription failed to send', sent: 'Prescription sent', voided: 'Prescription voided' }[r.kind] || 'Prescription', detail: [r.med, r.pharmacy].filter(Boolean).join(' · ') });
  return out.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 80);
});
ipcMain.handle('done:get', () => { const d = store.syncState.get().doneToday || {}; return d.day === ymd(new Date()) ? d.n : 0; });
ipcMain.handle('done:bump', (_e, by = 1) => { const d = store.syncState.get().doneToday || {}, day = ymd(new Date()); const n = Math.max(0, (d.day === day ? d.n : 0) + by); store.syncState.set({ doneToday: { day, n } }); return n; });
// Keep the Windows safety copy fresh (small files only; browser caches are skipped).

// ---------- Backup: one password-protected file (works on any computer) ----------
function encrypt(obj, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from('RFD2'), salt, iv, c.getAuthTag(), data]);
}
function decrypt(buf, password) {
  if (buf.slice(0, 4).toString() !== 'RFD2') throw new Error('Not a Ruhwell Front Desk backup.');
  const salt = buf.slice(4, 20), iv = buf.slice(20, 32), tag = buf.slice(32, 48), data = buf.slice(48);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(password, salt, 32), iv);
  d.setAuthTag(tag);
  try { return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8')); }
  catch { throw new Error('Wrong password, or the file is damaged.'); }
}
ipcMain.handle('backup:export', async (_e, password) => {
  const payload = backups.snapshot();
  const r = await dialog.showSaveDialog(win, { title: 'Save backup', defaultPath: `Ruhwell Front Desk backup ${ymd(new Date())}.rfdbackup`, filters: [{ name: 'Ruhwell backup', extensions: ['rfdbackup'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, encrypt(payload, password));
  return { ok: true, path: r.filePath, patients: Object.keys(payload.patients).length, history: payload.history.length };
});
ipcMain.handle('backup:import', async (_e, password) => {
  const r = await dialog.showOpenDialog(win, { title: 'Restore backup', properties: ['openFile'], filters: [{ name: 'Ruhwell backup', extensions: ['rfdbackup'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try { return { ok: true, ...backups.restore(decrypt(fs.readFileSync(r.filePaths[0]), password)) }; } catch (e) { return { error: /auth|decrypt|bad/i.test(e.message) ? 'Wrong password, or the file is damaged.' : e.message }; }
});
ipcMain.handle('backup:contacts', async () => {
  const { csv, count } = backups.contactsCsv();
  const r = await dialog.showSaveDialog(win, { title: 'Save contacts', defaultPath: `Ruhwell contacts ${ymd(new Date())}.csv`, filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, csv, 'utf8');
  return { ok: true, count };
});
ipcMain.handle('backup:list', () => backups.list());
ipcMain.handle('backup:restoreAuto', (_e, file) => { try { return { ok: true, ...backups.restoreAuto(file) }; } catch (e) { return { error: e.message }; } });
ipcMain.handle('backup:now', () => { try { return backups.autoDaily(true) ? { ok: true } : { error: backups.status().error || "The backup couldn't be made." }; } catch (e) { return { error: e.message }; } });
setInterval(() => { try { backups.autoDaily(); activity.prune(); } catch {} }, 60 * 60 * 1000);

// Each confirmed send carries an operation id; a second request with the same id gets the first result
// instead of sending again (double clicks, retries). A deliberately new message gets a new id.
const sendOps = new Map();
/* ---------- Email (Gmail through Google's sign-in) and the outbox (send later / quiet hours) ---------- */
ipcMain.handle('email:loadKey', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick the Google key file (.json)', properties: ['openFile'], filters: [{ name: 'Google key file', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const out = gapi.loadKeyFile(fs.readFileSync(r.filePaths[0], 'utf8'));
  activity.add('Gmail', 'key-loaded', {}, !!out.ok); send('sync', syncStatus());
  return out;
});
ipcMain.handle('email:connect', async () => { const r = await gapi.signIn(); activity.add('Gmail', 'sign-in', {}, !!r.ok); send('sync', syncStatus()); return r; });
ipcMain.handle('email:status', () => gapi.status());
const mailErr = (e) => ({ error: e.message, code: e.code });
ipcMain.handle('email:list', async (_e, o) => { try { return await gapi.list(o || {}); } catch (e) { return mailErr(e); } });
ipcMain.handle('email:thread', async (_e, id) => { try { return await gapi.thread(String(id)); } catch (e) { return mailErr(e); } });
ipcMain.handle('email:read', async (_e, id, read) => { try { await gapi.markRead(String(id), read !== false); mail.check().then(() => send('sync', syncStatus())); return true; } catch (e) { return mailErr(e); } });
ipcMain.handle('email:spam', async (_e, id, on) => { try { await (on ? gapi.spam(String(id)) : gapi.notSpam(String(id))); return true; } catch (e) { return mailErr(e); } });
ipcMain.handle('email:archive', async (_e, id, undo) => { try { await (undo ? gapi.unarchive(String(id)) : gapi.archive(String(id))); return true; } catch (e) { return mailErr(e); } });
ipcMain.handle('email:saveAttachment', async (_e, msgId, att) => {
  try {
    const b64 = await gapi.attachment(String(msgId), String(att.id));
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), String(att.name || 'attachment').replace(/[\\/:*?"<>|]+/g, ' ')) });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(b64, 'base64')); return { ok: true, path: r.filePath };
  } catch (e) { return mailErr(e); }
});
ipcMain.handle('email:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  return r.filePaths.map((f) => { const b = fs.readFileSync(f); return { name: path.basename(f), size: b.length, mime: MIME[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream', b64: b.toString('base64') }; });
});
// The welcome packet: the bundled PDF until a newer one is chosen in Settings.
const PACKET = 'welcome-packet.bin';
function packet() {
  const own = store.raw.readSecure(PACKET, null);
  if (own && own.b64) return { name: own.name, b64: own.b64, mime: 'application/pdf', custom: true, at: own.at };
  const b = fs.readFileSync(path.join(__dirname, 'assets', 'welcome-packet.pdf'));
  return { name: 'Ruhwell Med - New Patient Welcome Packet.pdf', b64: b.toString('base64'), mime: 'application/pdf', custom: false };
}
ipcMain.handle('email:packetInfo', () => { const p = packet(); return { name: p.name, size: Buffer.byteLength(p.b64, 'base64'), custom: p.custom, at: p.at || null }; });
ipcMain.handle('email:packetReplace', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose the new welcome packet (PDF)', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const b = fs.readFileSync(r.filePaths[0]);
  if (b.slice(0, 4).toString() !== '%PDF') return { error: "That file isn't a PDF." };
  store.raw.writeSecure(PACKET, { name: path.basename(r.filePaths[0]), b64: b.toString('base64'), at: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('email:packetReset', () => { store.raw.writeSecure(PACKET, null); return true; });
ipcMain.handle('email:packetOpen', () => { const p = packet(); const f = path.join(app.getPath('temp'), 'Ruhwell welcome packet.pdf'); fs.writeFileSync(f, Buffer.from(p.b64, 'base64')); shell.openPath(f); return true; });
// Email templates (HTML) and the signature.
ipcMain.handle('email:templates', () => store.emailTemplates.get());
ipcMain.handle('email:templatesSave', (_e, list) => { store.emailTemplates.set(list); return true; });
// Outbox
const outboxEvent = () => { send('outbox', { pending: outbox.pending(), email: outbox.pending('email'), text: outbox.pending('text') }); send('sync', syncStatus()); };
async function sendEmailNow(p) {
  const files = [...(p.files || [])];
  if (p.packet) files.unshift(packet());
  try {
    const r = await gapi.send({ to: p.to, cc: p.cc, subject: p.subject, html: p.html, files, threadId: p.threadId, inReplyTo: p.inReplyTo, refs: p.refs });
    // Once Gmail has it, a local logging hiccup must never turn it into a "failed" (and a second send).
    try { activity.add('Gmail', 'email-sent', { files: files.length, reply: !!p.threadId }, true); } catch {}
    if (p.patientKey) try { store.log.add({ name: p.name || '', phone: p.phone || '', template: p.templateName || 'Email', templateId: p.templateId || null, ok: true, error: '', message: `Email: ${p.subject}`, channel: 'email' }); } catch {}
    return { ok: true, id: r.id, threadId: r.threadId };
  } catch (e) { activity.add('Gmail', 'email-sent', { code: e.code || '' }, false); return { ok: false, error: e.message, code: e.code }; }
}
ipcMain.handle('outbox:add', async (_e, item) => {
  if (!item || !['text', 'email'].includes(item.kind)) return { error: 'bad' };
  if (item.kind === 'text') item.payload = { items: (item.payload.items || []).slice(0, 200) };
  const it = outbox.add(item);
  activity.add(item.kind === 'email' ? 'Gmail' : 'RingRx', 'scheduled', { kind: item.kind, at: it.sendAt }, true);
  // "Now": wait for it, so the window can say Sent or what went wrong.
  if (new Date(it.sendAt) <= new Date(Date.now() + 1000)) { await outbox.tick(); const done = outbox.list().find((x) => x.id === it.id) || it; return done; }
  return it;
});
ipcMain.handle('outbox:list', () => outbox.list());
ipcMain.handle('outbox:cancel', (_e, id) => outbox.cancel(String(id)));
ipcMain.handle('outbox:sendNow', (_e, id) => outbox.sendNow(String(id)));
ipcMain.handle('outbox:reschedule', (_e, id, when) => outbox.reschedule(String(id), when));
ipcMain.handle('outbox:dismiss', (_e, id) => outbox.dismiss(String(id)));
ipcMain.handle('outbox:quiet', () => ({ ...outbox.quiet(), allowedNow: outbox.allowed(), next: outbox.nextAllowed().toISOString() }));
ipcMain.handle('outbox:nextAllowed', (_e, when) => outbox.nextAllowed(new Date(when || Date.now())).toISOString());
app.whenReady().then(() => {
  outbox.start({
    senders: {
      // Each patient is marked as sent in the item as soon as it goes, so a retry or restart never texts them twice.
      text: async (p, item) => {
        const todo = (p.items || []).filter((x) => !x.sentAt);
        const res = await sendTexts(todo, (d) => { if (d.last && d.last.ok) { const cur = outbox.get(item.id); if (cur) { const items = cur.payload.items.map((x) => (x.phone === d.last.phone && x.message === d.last.message && !x.sentAt ? { ...x, sentAt: new Date().toISOString() } : x)); outbox.setPayload(item.id, { ...cur.payload, items }); } } }, { respectQuiet: item.respectQuiet !== false });
        const ok = res.filter((r) => r.ok).length, out = res.find((r) => r.code === 'SIGNED_OUT' || r.code === 'LOCKED'), held = res.some((r) => r.held);
        if (held && !res.some((r) => !r.ok && !r.held)) return { ok: false, code: 'HELD', error: 'Waiting for sending hours' };
        const total = (p.items || []).length, doneBefore = total - todo.length;
        if (out) return { ok: false, code: out.code === 'LOCKED' ? 'LOCKED' : 'SIGNED_OUT', error: `${doneBefore + ok} of ${total} sent · ${out.error}` };   // tried again later; already-sent patients are skipped
        return { ok: ok === res.length, error: ok === res.length ? '' : `${doneBefore + ok} of ${total} sent`, partial: ok < res.length ? res.map((r) => ({ name: r.name, ok: r.ok, error: r.error })) : undefined };
      },
      email: (p) => sendEmailNow(p),
    },
    onChange: () => { try { outboxEvent(); } catch {} },
  });
  powerMonitor.on('resume', () => setTimeout(() => outbox.tick().catch(() => {}), 8000));
});

ipcMain.handle('send:batch', async (e, items, opId, opts) => {
  if (opId) { if (sendOps.has(opId)) return sendOps.get(opId); const p = sendBatch(e, items, opts); sendOps.set(opId, p); setTimeout(() => sendOps.delete(opId), 10 * 60000); return p; }
  return sendBatch(e, items, opts);
});
// Immediate sends follow sending hours too (unless "Send now anyway"): anyone not reached before closing goes to the outbox for the morning.
async function sendBatch(e, items, opts = {}) {
  const res = await sendTexts(items, (d) => { try { e.sender.send('send:progress', d); } catch {} }, { respectQuiet: opts.respectQuiet !== false });
  const held = res.filter((r) => r.held);
  if (held.length) {
    const it = outbox.add({ kind: 'text', label: 'Held for sending hours', to: held.length === 1 ? held[0].name : `${held.length} patients`, payload: { items: held.map(({ held: _h, ok: _o, error: _e, ...x }) => x) }, sendAt: outbox.nextAllowed().toISOString(), id: opts.opId ? opts.opId + ':held' : undefined });
    held.forEach((r) => { r.error = `Will send ${new Date(it.sendAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`; });
  }
  return res;
}
async function sendTexts(items, progress = () => {}, opts = {}) {
  const id = pid();
  // Blocked numbers, read fresh before every single text (a STOP can arrive mid-batch): anyone marked
  // do-not-text (main or extra numbers) and every number that replied STOP. All compared as 10 digits.
  const d10 = (x) => String(x || '').replace(/\D/g, '').slice(-10);
  // If the patient list or the STOP list can't be unlocked, nothing is sent (an unreadable list must never read as "nobody opted out").
  const unreadable = () => { const l = store.raw.lockedFiles(); return l.includes('patients.bin') || l.includes('inbound.bin'); };
  const blocked = () => { const b = new Set(Object.values(store.patients.all()).filter((p) => p.dnt).flatMap((p) => [p.phone, ...(p.otherPhones || [])]).map(d10).filter((x) => x.length === 10)); Object.keys(store.inbound.get().optOut || {}).forEach((ph) => b.add(d10(ph))); return b; };
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let res;
    try {
      // Read both lists, then check that both reads worked: a read is what discovers a lock.
      const may = () => { const b = blocked(); if (unreadable()) throw Object.assign(new Error("Saved data is locked, so the do-not-text list can't be checked. Nothing was sent."), { code: 'LOCKED' }); if (b.has(d10(it.phone))) throw Object.assign(new Error('Marked do-not-text'), { code: 'DNT' }); };
      may();
      // Sending hours, checked for every patient (a batch can run into closing time): the rest wait for the morning.
      if (opts.respectQuiet && !outbox.allowed()) { res = { ...it, ok: false, held: true, error: 'Held for sending hours' }; results.push(res); progress({ done: i + 1, total: items.length, last: res }); continue; }
      try { await ringrx.sendSms(id, it.phone, it.message); }
      catch (err) {
        if (err.code !== 'RETRY') throw err;
        may();   // re-check before the retry too
        await ringrx.sendSms(id, it.phone, it.message);
      }
      res = { ...it, ok: true };
    } catch (err) {
      res = { ...it, ok: false, error: err.message, code: err.code };
    }
    store.log.add({ name: it.name, phone: it.phone, template: it.templateName, templateId: it.templateId, apptId: it.apptId || null, ok: res.ok, error: res.error || '', message: it.message });
    comms.bust();
    results.push(res);
    progress({ done: i + 1, total: items.length, last: res });
    if (res.code === 'SIGNED_OUT' || res.code === 'LOCKED') break;
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return results;
}

// Present a standard Chrome user agent; some sign-in pages stall on "Electron".
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(ruhwell-messenger|Ruhwell Messenger|Ruhwell Front Desk)\/\S+/i, '');

// Start with Windows / Open at login. Exactly one entry: older versions and older names left extra startup
// entries behind (some pointing at programs that no longer exist), so those are cleaned up first.
const LOGIN_NAME = 'Ruhwell Front Desk';
function cleanOldLoginItems() {
  if (process.platform !== 'win32') return;
  const { execFile } = require('child_process');
  const RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', OK = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
  execFile('reg', ['query', RUN], { windowsHide: true }, (err, out) => {
    if (err || !out) return;
    for (const line of String(out).split(/\r?\n/)) {
      const m = /^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line); if (!m) continue;
      const [, name, data] = m;
      if (!/ruhwell/i.test(name + ' ' + data) || name === LOGIN_NAME) continue;   // only ours, never anything else
      execFile('reg', ['delete', RUN, '/v', name, '/f'], { windowsHide: true }, () => {});
      execFile('reg', ['delete', OK, '/v', name, '/f'], { windowsHide: true }, () => {});
    }
  });
}
function applyLoginItem() {
  if (!app.isPackaged) return;
  try {
    cleanOldLoginItems();
    const opts = { openAtLogin: !!store.settings.get().openAtLogin, args: ['--hidden'], openAsHidden: true };
    if (process.platform === 'win32') Object.assign(opts, { name: LOGIN_NAME, path: process.execPath });
    app.setLoginItemSettings(opts);
  } catch {}
}

// Saved data that can't be unlocked (e.g. the Mac Keychain said no after an update) is never treated
// as empty or overwritten. Ask the user to allow access, then try again.
function unlockCheck() {
  const touch = () => { store.patients.all(); store.syncState.get(); store.inbound.get(); store.ringrxHistory.get(); store.calls.get(); };
  touch();
  while (store.raw.lockedFiles().length) {
    const r = dialog.showMessageBoxSync({
      type: 'warning', buttons: ['Try again', 'Continue without it', 'Quit'], defaultId: 0, cancelId: 2,
      title: 'Ruhwell Front Desk', message: "Can't unlock your saved data",
      detail: isMac ? 'Your Mac needs to let Ruhwell Front Desk use its saved key. Click "Try again", then choose "Always Allow" when macOS asks (you may need your Mac password).\n\nNothing has been lost. The app won\'t save over it until it can be unlocked.'
        : 'Windows could not unlock the saved data for this account. Make sure you are signed in to the same Windows account, then click "Try again".\n\nNothing has been lost. The app won\'t save over it until it can be unlocked.',
    });
    if (r === 2) { quitting = true; app.exit(0); return; }
    if (r === 1) return;   // stays locked: shows in the status line, nothing is overwritten
    store.raw.retryLocked(); touch();
  }
}

app.whenReady().then(() => {
  applyLoginItem();
  store.log.migrate();
  store.log.prune(store.settings.get().historyKeep);
  activity.prune();
  try { faxes.cleanTmp(); pruneDiag(); diag('app', `start ${app.getVersion()}`, { os: process.platform }); faxes.repairOnce(); } catch {}
  migrations.run();
  if (process.platform === 'win32') {
    // Windows names notifications after a Start-menu shortcut with the same app ID; without one it shows
    // the raw app ID. Keep a shortcut so they read "Ruhwell Front Desk" with our icon.
    const AUMID = 'RuhwellMed.FrontDesk';
    app.setAppUserModelId(AUMID);
    if (app.isPackaged) {
      try {
        const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ruhwell Front Desk.lnk');
        shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'update' : 'create', { target: process.execPath, appUserModelId: AUMID, icon: process.execPath, iconIndex: 0, description: 'Ruhwell Front Desk' });
      } catch {}
    }
  }
  if (isMac) app.dock?.setIcon(path.join(__dirname, 'assets', 'icon-256.png'));
  unlockCheck();
  createWindow();
  createTray();
  updater.init((st) => send('update', st));
  watcher.init({
    getProfile: pid,
    loadDay,
    afterCheck: () => { preload(); },
    onEvent: (ev) => {
      if (ev.type === 'open-alerts') { showWindow(); const t = ev.target || { view: 'today' }; if (t.date) send('nav-date', t.date); else send('nav', t.view); if (t.phone) send('open-thread', t.phone); return; }
      send('watch', ev);
      if (ev.type === 'watch-status' && !ev.running) { if (!ev.lastError) store.syncState.set({ schedule: { at: new Date().toISOString() } }); send('sync', syncStatus()); }
    },
  });
  setTimeout(() => preload(), 3000);
  setTimeout(rxntKeepAlive, 5000);
  setTimeout(() => { lastSync.schedule = Date.now(); syncDue(); try { backups.autoDaily(); } catch {} }, 8000);   // schedule's first check runs from the watcher
  // First patient sync shortly after launch if never synced or older than 6 hours.
  setTimeout(() => { const at = store.syncState.get().patients?.at; if (!at || Date.now() - new Date(at) > 4 * 36e5) syncPatientsNow(); }, 15000);
  app.on('activate', showWindow);
});
app.on('before-quit', () => { quitting = true; });

// Stay signed in to RxNT across restarts and updates, and keep the session alive between syncs.
function rxntKeepAlive() { const id = pid(); if (id && store.settings.get().rxntConnected?.[id]) { rxnt.keepSignedIn(id); rxnt.ping(id); } }
setInterval(rxntKeepAlive, 5 * 60000);
// RingRx: refresh the sign-in before it expires, every 10 minutes, even when idle. A real sign-out is logged
// (reason only) and shows as "Sign-in needed" right away.
setInterval(async () => {
  const id = pid(); if (!id || !ringrx.status(id).connected) return;
  const r = await ringrx.keepFresh(id);
  if (r.state === 'signedout') { activity.add('RingRx', 'signed-out', { reason: r.code }, false); send('sync', syncStatus()); }
}, 10 * 60000);
// Opened while signed out of RxNT but with a saved sign-in: sign back in quietly.
app.whenReady().then(() => setTimeout(async () => {
  const id = pid(); const c = id && rxnt.savedLogin(id); if (!c || c.bad || userOut('rxnt') || store.settings.get().rxntConnected?.[id]) return;
  const a = await rxnt.autoSignIn(id);   // shares the start-up attempt if one is running, so the password is sent once
  if (a === 'ok') { rxntNeeds = ''; setRxntFlag(id, true); send('sync', syncStatus()); syncDue(0); }
}, 6000));
app.on('before-quit', () => { const id = pid(); if (id) rxnt.keepSignedIn(id); });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
