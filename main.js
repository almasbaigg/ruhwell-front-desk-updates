const { app, BrowserWindow, ipcMain, shell, nativeImage, Tray, Menu, dialog, Notification } = require('electron');
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
const gmail = require('./gmail');
const checklist = require('./checklist');
const rxtasks = require('./rxtasks');
const backups = require('./backups');
const migrations = require('./migrations');
const updater = require('./updater');

let win, tray, quitting = false;
const startHidden = process.argv.includes('--hidden');
const isMac = process.platform === 'darwin';
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-256.png'));

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function createWindow() {
  win = new BrowserWindow({
    width: 1300, height: 840, minWidth: 1040, minHeight: 660, show: !startHidden,
    backgroundColor: '#f6f1eb', title: 'Ruhwell Front Desk', icon: icon(),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isMac ? undefined : { color: '#f6f1eb', symbolColor: '#005758', height: 44 },
    trafficLightPosition: { x: 18, y: 16 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (startHidden) win.once('ready-to-show', () => win.hide());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  // Tray options: close and/or minimize keep the app running in the tray (alerts keep working).
  win.on('close', (e) => { if (!quitting && store.settings.get().closeToTray) { e.preventDefault(); win.hide(); } });
  win.on('minimize', (e) => { if (store.settings.get().minimizeToTray) { e.preventDefault(); win.hide(); } });
  win.on('focus', () => syncSoon());   // coming back to the app catches up anything stale
}
function showWindow() { if (!win || win.isDestroyed()) createWindow(); win.show(); win.focus(); }

function createTray() {
  tray = new Tray(icon().resize({ width: 16, height: 16 }));
  tray.setToolTip('Ruhwell Front Desk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Ruhwell Front Desk', click: showWindow },
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
async function rxntSignedOut(id) {
  if (!confirming) confirming = rxnt.status(id).then((r) => { if (!r.connected && !r.unknown) { setRxntFlag(id, false); send('sync', syncStatus()); } return !r.connected && !r.unknown; }).finally(() => { setTimeout(() => (confirming = null), 60000); });
  return confirming;
}
function setRxntFlag(id, v) { const s = store.settings.get(); s.rxntConnected = { ...(s.rxntConnected || {}), [id]: v }; store.settings.set(s); }

ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion(), dataDir: store.dataDir() }));
ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:check', () => updater.checkNow());
ipcMain.handle('update:restart', () => { quitting = true; return updater.restart(); });
ipcMain.handle('app:openData', () => shell.openPath(store.dataDir()));

ipcMain.handle('accounts:status', async () => {
  const id = pid();
  const g = gmail.status().at ? gmail.status() : await gmail.check();
  return { profile: id, rxnt: { connected: !!store.settings.get().rxntConnected?.[id] }, ringrx: id ? ringrx.status(id) : { connected: false }, gmail: g };
});
// ---------- Gmail, checklist, prescriptions ----------
ipcMain.handle('gmail:signin', async () => { const ok = await gmail.signIn(win); send('sync', syncStatus()); return ok; });
ipcMain.handle('gmail:signout', async () => { await gmail.signOut(); send('sync', syncStatus()); return true; });
ipcMain.handle('gmail:open', (_e, id) => shell.openExternal(gmail.url(id)));
ipcMain.handle('checklist:list', () => checklist.list(pid()));
ipcMain.handle('checklist:add', (_e, t, opts) => checklist.add(pid(), t, opts || {}));
ipcMain.handle('checklist:star', (_e, id) => checklist.star(pid(), id));
ipcMain.handle('checklist:due', (_e, id, due) => checklist.setDue(pid(), id, due));
ipcMain.handle('checklist:reorder', (_e, ids) => checklist.reorder(pid(), ids));
ipcMain.handle('checklist:parse', (_e, t) => checklist.parse(t));
ipcMain.handle('gmail:check', async () => { const g = await gmail.check(); send('sync', syncStatus()); return g; });
ipcMain.handle('notes:get', (_e, day) => checklist.notes.get(pid(), day || checklist.dayKey()));
ipcMain.handle('notes:set', (_e, day, text) => checklist.notes.set(pid(), day, text));
ipcMain.handle('notes:pin', (_e, day, on) => checklist.notes.pin(pid(), day, on));
ipcMain.handle('notes:search', (_e, q) => checklist.notes.search(pid(), q));
ipcMain.handle('checklist:toggle', (_e, id) => checklist.toggle(pid(), id));
ipcMain.handle('checklist:remove', (_e, id) => checklist.remove(pid(), id));
ipcMain.handle('rx:list', () => rxtasks.list());
ipcMain.handle('rx:refresh', async () => { await refreshRx(); return rxtasks.list(); });
ipcMain.handle('rx:open', (_e, where) => shell.openExternal({ todo: 'https://app2.rxnt.com/ehrv9/dashboard', billing: 'https://app2.rxnt.com/BillingV2/#/', messages: 'https://app2.rxnt.com/dashboard/' }[where] || 'https://app2.rxnt.com/ehrv9/legacy/prescriberDashboard#/dashboard/rx/pending'));
async function refreshRx() {
  if (!store.settings.get().rxntConnected?.[pid()]) return;
  // Its own hidden window, so prescriptions never hold up or reset the schedule reader.
  await rxtasks.refresh(() => rxnt.readPendingOnce(pid()));
  rxWaitingAlerts();
  send('sync', syncStatus());
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
  if (ok) { setRxntFlag(pid(), true); rxnt.keepSignedIn(pid()); if (rx.win && !rx.win.isDestroyed()) rx.win.destroy(); rx.win = null; watcher.reschedule(); setTimeout(() => preload(), 1500); setTimeout(syncPatientsNow, 8000); }
  return ok;
});
ipcMain.handle('rxnt:logout', async () => { await rxnt.logout(pid()); setRxntFlag(pid(), false); return true; });
// ---------- One shared RxNT reader window, with a queue so jobs never collide ----------
const rx = { win: null, pid: null, high: [], low: [], busy: false };
function reader() {
  const id = pid();
  if (!rx.win || rx.win.isDestroyed() || rx.pid !== id) {
    if (rx.win && !rx.win.isDestroyed()) rx.win.destroy();
    rx.win = rxnt.openReader(id); rx.pid = id;
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
    if (/too long/.test(e.message) && rx.win && !rx.win.isDestroyed()) { rx.win.destroy(); rx.win = null; }
    next.reject(e);
  }
  clearTimeout(timer);
  rx.busy = false;
  if (!rx.high.length && !rx.low.length) send('rx-busy', { high: 0, low: 0 });
  pump();
}
const inFlight = {};

// Day cache: visits + provider blocks per date, refreshed in the background.
const dayCache = {};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return ymd(x); };
async function loadDay(date, priority = 'low') {
  const key = date + priority;
  if (inFlight[key]) return inFlight[key];
  return (inFlight[key] = loadDayNow(date, priority).finally(() => delete inFlight[key]));
}
async function loadDayNow(date, priority) {
  const id = pid();
  const r = await rxQueue((w) => rxnt.fetchDay(id, date, w), priority);
  if (r.needsLogin) { rxntSignedOut(id); return r; }
  if (r.items) {
    setRxntFlag(id, true);
    dayCache[date] = { ...r, at: Date.now() };
    store.patients.upsert(r.items.filter((i) => i.patientId).map((i) => ({
      patientId: i.patientId, chart: i.chart, first: i.first, last: i.last, dob: i.dob, age: i.age,
      cell: i.cell, home: i.home, preferred: i.preferred, visitAt: i.start, visitType: i.visitType,
    })));
    store.syncState.set({ schedule: { at: new Date().toISOString() } });
    send('day', { date, ...dayCache[date] }); send('sync', syncStatus());
  }
  return r;
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
  try { return { ok: true, ...(await ringrx.login(pid(), username, password, otp)) }; }
  catch (e) { return { ok: false, error: e.message, code: e.code }; }
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
ipcMain.handle('patients:update', (_e, key, fields) => store.patients.update(key, fields));
ipcMain.handle('sync:status', () => syncStatus());
ipcMain.handle('sync:patients', () => { syncPatientsNow(); return true; });
ipcMain.handle('patients:add', (_e, p) => { const db = store.patients.upsert([p]); send('sync', syncStatus()); return Object.values(db).find((x) => x.phone === p.phone && (x.first || '') === (p.first || '') && (x.last || '') === (p.last || ''))?.key || null; });
ipcMain.handle('history:list', () => historyForChecks());
// ---------- Calls & texts (RingRx) ----------
async function syncComms(force) {
  const st = comms.status();
  if (!force && st.at && Date.now() - new Date(st.at) < 4 * 60000) return false;
  send('sync', syncStatus());
  const r = await comms.sync(pid());
  if (r && r.fresh) comms.handleReplies(r.fresh, (ev) => watcher.addEvents(ev));
  send('sync', syncStatus()); send('comms-updated', true);
  return true;
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
ipcMain.handle('comms:seen', (_e, phone) => { comms.markSeen(String(phone || '').replace(/\D/g, '').slice(-10)); send('sync', syncStatus()); return true; });
// RxNT portal messages (sidebar chat): read-only, alert on new patient messages.
let portal = { at: null, error: null, me: null, conversations: [] };
async function refreshPortal() {
  const id = pid(); if (!id || !store.settings.get().rxntConnected?.[id]) return portal;
  try {
    const r = await rxnt.readMessages(id);
    if (r.error) { portal = { ...portal, error: r.error, at: new Date().toISOString() }; return portal; }
    const before = new Map(portal.conversations.map((c) => [c.id, c.at]));
    portal = { at: new Date().toISOString(), error: null, me: r.me, conversations: r.conversations };
    if (before.size || portal.seeded) {
      const fresh = r.conversations.filter((c) => c.needsReply && c.unread && before.get(c.id) !== c.at);
      if (fresh.length) watcher.addEvents(fresh.map((c) => ({ kind: 'portal', text: `RxNT portal message from ${c.title}` })));
    }
    portal.seeded = true;
    send('comms-updated', true); send('sync', syncStatus());
  } catch (e) { portal = { ...portal, error: 'failed', at: new Date().toISOString() }; }
  return portal;
}
ipcMain.handle('portal:list', () => ({ ...portal, conversations: portal.conversations.map((c) => ({ ...c, done: comms.doneSince('p:' + c.id, c.at) })) }));
ipcMain.handle('portal:done', (_e, id) => { comms.markDone('p', String(id)); return true; });
ipcMain.handle('portal:refresh', async () => { await refreshPortal(); return true; });
ipcMain.handle('comms:snooze', (_e, key, until) => { comms.snooze(String(key), Number(until)); return true; });
ipcMain.handle('comms:snoozes', () => comms.snoozes());
ipcMain.handle('comms:ignore', (_e, phone, on) => { comms.ignore(String(phone || '').replace(/\D/g, '').slice(-10), on !== false); send('sync', syncStatus()); return true; });
ipcMain.handle('comms:done', (_e, kind, phone) => { comms.markDone(kind, phone); send('sync', syncStatus()); return true; });
ipcMain.handle('ringrx:openPortal', (_e, page) => shell.openExternal('https://portal.ringrx.com/' + ({ contacts: 'contacts', calls: 'calls', messages: 'messages' }[page] || 'dashboard')));
ipcMain.handle('alerts:test', async () => {
  const to = await ringrx.alertNumber(pid());
  if (!to) return { error: 'Add a number first.' };
  try { await ringrx.sendSms(pid(), to, 'Ruhwell Front Desk: alert texts are working.'); return { ok: true }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('watch:check', () => watcher.check());
ipcMain.handle('watch:alerts', () => watcher.alerts());
ipcMain.handle('watch:read', () => { watcher.markRead(); return true; });
ipcMain.handle('watch:handle', (_e, id) => { watcher.handle(id); return true; });

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
    gmail: gmail.status(),
    rx: rxtasks.status(),
    needs: (() => { try { return comms.counts(); } catch { return { texts: 0, calls: 0 }; } })(),
    messages: comms.status(),
    portal: { at: portal.at, error: portal.error, waiting: portal.conversations.filter((c) => c.needsReply && !comms.doneSince('p:' + c.id, c.at)).length },
    rxntUser: portal.me ? portal.me.name : '',
  };
}
async function syncPatientsNow() {
  const id = pid();
  if (patientSync.running || !id || !store.settings.get().rxntConnected?.[id]) return;
  patientSync = { running: true, progress: { done: 0, total: 26, count: 0 } }; send('sync', syncStatus());
  const db = store.patients.all();
  const byChart = {}; Object.values(db).forEach((p) => { if (p.chart) byChart[p.chart] = p; });
  const knownCharts = new Set(Object.keys(byChart));
  const FRESH = 14 * 864e5;
  const needsDetail = (row) => { const c = byChart[row.chart]; return !c || !c.detailAt || Date.now() - c.detailAt > FRESH || (row.listedPhone && row.listedPhone !== c.listedPhone); };
  let count = 0, error = null;
  try {
    for (const [i, L] of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].entries()) {
      const list = await rxQueue((w) => rxnt.listLetter(w, L));
      if (list.needsLogin) { if (await rxntSignedOut(id)) { error = 'RxNT signed out'; break; } continue; }
      const quick = [];
      for (const [ri, row] of list.rows.entries()) {
        if (row.done || !needsDetail(row)) { quick.push(row); continue; }
        const r = await rxQueue((w) => rxnt.openPatient(w, L, ri, row));   // one chart per job
        if (r.needsLogin) { if (await rxntSignedOut(id)) { error = 'RxNT signed out'; break; } continue; }
        if (r.patient) store.patients.upsert([r.patient]);
        count++;
      }
      if (quick.length) store.patients.upsert(quick);
      count += quick.length;
      if (error) break;
      patientSync.progress = { letter: L, done: i + 1, total: 26, count }; send('sync', syncStatus());
    }
  } catch (e) { error = e.message; }
  store.syncState.set({ patients: error ? { ...(store.syncState.get().patients || {}), error } : { at: new Date().toISOString(), error: null } });
  patientSync = { running: false, progress: null }; send('sync', syncStatus());
  // Patients sign themselves up through the RxNT portal: alert on anyone new since the last check.
  if (!error && knownCharts.size) {
    const fresh = Object.values(store.patients.all()).filter((p) => p.chart && !knownCharts.has(p.chart));
    if (fresh.length) watcher.addEvents(fresh.slice(0, 10).map((p) => ({ kind: 'newpatient', key: p.key, text: `New patient in RxNT: ${`${p.first || ''} ${p.last || ''}`.trim() || 'chart ' + p.chart}` })));
  }
}
/* ---------- Smart sync ----------
   What matters most is fast: new / cancelled appointments and texts / calls. The rest is slower.
   Office hours (Settings → Sync, weekdays) use the busy rate; evenings and weekends the quiet rate.
   Opening or focusing the app catches up anything older than 15 minutes. */
const PLAN = {           // minutes: [busy, quiet]
  schedule: [15, 60],    // RxNT appointments: new, cancelled, rescheduled
  comms: [15, 60],       // RingRx texts and calls
  portal: [15, 60],      // RxNT portal messages
  gmail: [30, 120],
  rx: [60, 240],         // prescriptions and RxNT To-Do
  patients: [240, 720],  // patient list (portal sign-ups)
};
const lastSync = { schedule: 0, comms: 0, portal: 0, gmail: 0, rx: 0, patients: Date.now() };
function busyNow(d = new Date()) {
  const s = store.settings.get().sync || {}, hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.getDay() >= 1 && d.getDay() <= 5 && hm >= (s.busyStart || '08:00') && hm < (s.busyEnd || '17:00');
}
const RUN = {
  schedule: () => watcher.check(),
  comms: () => syncComms(true),
  portal: () => refreshPortal(),
  gmail: () => gmail.check().then(() => send('sync', syncStatus())),
  rx: () => refreshRx(),
  patients: () => syncPatientsNow(),
};
function syncDue(maxAgeMin) {
  const busy = busyNow(), now = Date.now();
  for (const [k, [b, q]] of Object.entries(PLAN)) {
    const every = maxAgeMin && (k === 'schedule' || k === 'comms' || k === 'portal') ? Math.min(maxAgeMin, b) : busy ? b : q;
    if (now - lastSync[k] >= every * 60000) { lastSync[k] = now; Promise.resolve().then(RUN[k]).catch(() => {}); }
  }
}
setInterval(() => syncDue(), 60000);
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
      notify('Chart this visit?', `${nm(a)} · ${tm(a.start)} visit ended`, () => shell.openExternal('https://app2.rxnt.com/ehrv9/dashboard'));
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
  notify(left.length ? 'Before you go' : 'All done for today', left.length ? left.join(' · ') : 'Nothing left waiting. Nice work.', () => { showWindow(); send('nav', 'today'); });
}
setInterval(endOfDay, 30000);

// "Done today": a running count of things finished, for a visible sense of progress.
ipcMain.handle('done:get', () => { const d = store.syncState.get().doneToday || {}; return d.day === ymd(new Date()) ? d.n : 0; });
ipcMain.handle('done:bump', (_e, by = 1) => { const d = store.syncState.get().doneToday || {}, day = ymd(new Date()); const n = (d.day === day ? d.n : 0) + by; store.syncState.set({ doneToday: { day, n } }); return n; });
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
ipcMain.handle('backup:now', () => { try { const f = `auto-${ymd(new Date())}.bin`; const p2 = store.raw.file(path.join('Backups', f)); if (fs.existsSync(p2)) fs.unlinkSync(p2); backups.autoDaily(); return { ok: true }; } catch (e) { return { error: e.message }; } });
setInterval(() => { try { backups.autoDaily(); } catch {} }, 60 * 60 * 1000);

ipcMain.handle('send:batch', async (e, items) => {
  const id = pid();
  const dnt = new Set(Object.values(store.patients.all()).filter((p) => p.dnt && p.phone).map((p) => p.phone));
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let res;
    try {
      if (dnt.has(String(it.phone).replace(/\D/g, '').slice(-10))) throw Object.assign(new Error('Marked do-not-text'), { code: 'DNT' });
      try { await ringrx.sendSms(id, it.phone, it.message); }
      catch (err) { if (err.code === 'RETRY') await ringrx.sendSms(id, it.phone, it.message); else throw err; }
      res = { ...it, ok: true };
    } catch (err) {
      res = { ...it, ok: false, error: err.message, code: err.code };
    }
    store.log.add({ name: it.name, phone: it.phone, template: it.templateName, templateId: it.templateId, ok: res.ok, error: res.error || '', message: it.message });
    results.push(res);
    e.sender.send('send:progress', { done: i + 1, total: items.length, last: res });
    if (res.code === 'SIGNED_OUT') break;
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return results;
});

// Present a standard Chrome user agent; some sign-in pages stall on "Electron".
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(/\s(ruhwell-messenger|Ruhwell Messenger|Ruhwell Front Desk)\/\S+/i, '');

function applyLoginItem() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!store.settings.get().openAtLogin, args: ['--hidden'], openAsHidden: true }); } catch {}
}

app.whenReady().then(() => {
  applyLoginItem();
  store.log.migrate();
  store.log.prune(store.settings.get().historyKeep);
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
setInterval(rxntKeepAlive, 10 * 60000);
app.on('before-quit', () => { const id = pid(); if (id) rxnt.keepSignedIn(id); });
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
