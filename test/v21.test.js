// 2.1: safety fixes from the review (STOP merge on restore, one queue entry per submission, uncertain email
// never re-sent, handled faxes stay handled, shorter look-ahead isn't a cancellation, one RingRx refresh at a time).
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-21-'));
class N { constructor(o) { this.o = o; } on() {} show() {} static isSupported() { return true; } }
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal() {} }, Notification: N, nativeImage: { createFromPath: () => null }, BrowserWindow: class {}, session: { fromPartition: () => ({}) } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const assert = require('assert');
const store = require(APP + '/store');

(async () => {
  // 1) Restore never loses a STOP; a later START (opt-in) wins over an older STOP.
  const backups = require(APP + '/backups');
  store.inbound.set({ seen: [], confirmed: {}, optOut: { '5125550101': { at: '2026-11-01T10:00:00Z' } }, optIn: {} });
  backups.restore({ settings: {}, patients: {}, history: [], inbound: { seen: [], confirmed: {}, optOut: { '5125550102': { at: '2026-10-01T10:00:00Z' }, '5125550103': { at: '2026-09-01T10:00:00Z' } }, optIn: {} } });
  let oo = store.inbound.get().optOut;
  assert.ok(oo['5125550101'] && oo['5125550102'] && oo['5125550103'], 'STOPs from both copies are kept');
  store.inbound.set({ ...store.inbound.get(), optOut: { '5125550101': oo['5125550101'] }, optIn: { '5125550102': { at: '2026-11-10T10:00:00Z' } } });
  backups.restore({ settings: {}, patients: {}, history: [], inbound: { seen: [], confirmed: {}, optOut: { '5125550102': { at: '2026-10-01T10:00:00Z' } } } });
  oo = store.inbound.get().optOut;
  assert.ok(!oo['5125550102'], 'a number that opted back in after its STOP stays opted in');
  assert.ok(oo['5125550101'], 'current STOP still there');

  // 2) Outbox: the same submission id is queued once; an uncertain email is never retried.
  const outbox = require(APP + '/outbox');
  let calls = 0;
  outbox.start({ senders: { email: async () => { calls++; return { ok: false, code: 'UNCERTAIN', error: 'maybe' }; }, text: async () => ({ ok: true }) } });
  const a = outbox.add({ id: 'em-1', kind: 'email', label: 's', payload: {}, respectQuiet: false });
  const b = outbox.add({ id: 'em-1', kind: 'email', label: 's', payload: {}, respectQuiet: false });
  assert.strictEqual(a.id, b.id); assert.strictEqual(outbox.list().filter((x) => x.id === 'em-1').length, 1, 'double click = one entry');
  await outbox.tick(); await outbox.tick();
  assert.strictEqual(calls, 1, 'sent once'); assert.strictEqual(outbox.list().find((x) => x.id === 'em-1').status, 'uncertain', 'ambiguous → "Check this one"');

  // 3) Gmail: a dropped connection while submitting is UNCERTAIN; a 4xx is a clean failure.
  const gapi = require(APP + '/gmailapi');
  gapi.loadKeyFile(JSON.stringify({ installed: { client_id: '1-a.apps.googleusercontent.com', client_secret: 's' } }));
  store.raw.writeSecure('google-token.bin', { refresh: 'r' });
  let mode = 'drop', refreshes = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (o, st = 200) => ({ ok: st < 400, status: st, json: async () => o, text: async () => JSON.stringify(o) });
    if (u.includes('oauth2.googleapis.com/token')) { refreshes++; await new Promise((r) => setTimeout(r, 30)); return json({ access_token: 'A' + refreshes, expires_in: 3600 }); }
    if (u.endsWith('/profile')) return json({ emailAddress: 'admin@ruhwellmed.com' });
    if (u.endsWith('/labels/INBOX')) return json({ threadsUnread: 2 });
    if (u.endsWith('/settings/sendAs')) return json({ sendAs: [{ sendAsEmail: 'hello@ruhwellmed.com', displayName: 'Ruhwell Med', verificationStatus: 'accepted' }] });
    if (u.includes('/messages/send')) { if (mode === 'drop') throw new TypeError('socket hang up'); if (mode === '500') return json({ error: { message: 'backend' } }, 500); if (mode === '400') return json({ error: { message: 'Invalid To header' } }, 400); return json({ id: 'm1', threadId: 't1' }); }
    return json({});
  };
  const msg = { to: 'pat@example.com', subject: 'Hi', html: '<p>Hi</p>' };
  await assert.rejects(() => gapi.send(msg), (e) => e.code === 'UNCERTAIN', 'dropped connection → uncertain');
  mode = '500'; await assert.rejects(() => gapi.send(msg), (e) => e.code === 'UNCERTAIN', 'server error after submit → uncertain');
  mode = '400'; await assert.rejects(() => gapi.send(msg), (e) => e.code === 'FAILED', 'Google refused → failed (safe to fix and resend)');
  mode = 'ok'; assert.strictEqual((await gapi.send(msg)).id, 'm1');
  assert.strictEqual(refreshes, 1, 'one token refresh shared by all requests');

  // 4) Faxes: after the PDF is cleared, a small record stays so Doximity listing it again can't make it new.
  const faxes = require(APP + '/faxes');
  const old = new Date(Date.now() - 40 * 864e5).toISOString();
  store.raw.writeSecure('faxes.bin', { items: [{ id: 'F1', status: 'done', doneAt: old, at: old }, { id: 'F2', status: 'new', at: old }], seeded: 'x', v: 4 });
  faxes.prune();
  const ix = store.raw.readSecure('faxes.bin', {});
  assert.ok(ix.items.find((f) => f.id === 'F1' && f.pruned && f.status === 'done'), 'handled record kept after the PDF is gone');
  assert.ok(!faxes.list().some((f) => f.id === 'F1'), 'cleared faxes are not listed');
  assert.ok(faxes.list().some((f) => f.id === 'F2'), 'faxes still to do are untouched');

  // 5) Watcher: shortening the look-ahead is not a cancellation.
  const watcher = require(APP + '/watcher');
  const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  const at = (n, h) => { const d = day(n); d.setHours(h, 0, 0, 0); return d.toISOString().replace('Z', ''); };
  const byDay = { [ymdOf(day(0))]: [], [ymdOf(day(1))]: [], [ymdOf(day(2))]: [{ appointmentId: 77, patientId: 'p7', first: 'Al', last: 'Ng', dob: '1990-01-01', start: at(2, 11), statusText: 'Booked', statusCode: 'BOO', phone: '5125550177' }] };
  const evs = [];
  watcher.init({ getProfile: () => 'almas', loadDay: async (d) => ({ items: byDay[d] || [] }), onEvent: (e) => { if (e.type === 'alerts') evs.push(...e.events); } });
  store.settings.set({ ...store.settings.get(), currentProfile: 'almas', rxntConnected: { almas: true }, watch: { enabled: true, daysAhead: 3 } });
  await watcher.check({ silent: true });
  store.settings.set({ ...store.settings.get(), watch: { enabled: true, daysAhead: 1 } });
  const realNow = Date.now; let clock = realNow();
  Date.now = () => clock;
  for (let i = 0; i < 4; i++) { clock += 15 * 60000; await watcher.check({ silent: true }); }
  Date.now = realNow;
  assert.ok(!evs.some((e) => e.kind === 'cancelled'), 'no false "removed" for a day that was simply not read');
  const pend = store.watchState.get().pending || [];
  assert.ok(!pend.some((p) => p.e.appt.appointmentId === 77), 'no pending cancellation for it either');

  // 6) RingRx: five requests that find the access expired wait for one refresh; a needed code keeps the saved sign-in.
  const ringrx = require(APP + '/ringrx');
  store.ringrx.set('almas', { username: 'u', refreshToken: 'R', password: 'p' });
  let rr = 0;
  global.fetch = async (url) => { const u = String(url); if (u.includes('/auth/refresh')) { rr++; await new Promise((r) => setTimeout(r, 30)); return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'X', refresh_token: 'R2', expires_in: 3600 }) }; } return { ok: true, status: 200, json: async () => [] }; };
  await Promise.all([1, 2, 3, 4, 5].map(() => ringrx.keepFresh('almas')));
  assert.strictEqual(rr, 1, 'one refresh for five callers');
  assert.strictEqual(store.ringrx.get('almas').refreshToken, 'R2', 'rotated refresh token saved');

  console.log('2.1 OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
