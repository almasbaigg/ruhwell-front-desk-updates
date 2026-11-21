// 1.6.0: reschedules across a duplicate chart, visible rebooks, spam memory, activity log hygiene.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-16-'));
class N { constructor(o) { this.o = o; } on() {} show() {} static isSupported() { return true; } }
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, Notification: N, nativeImage: { createFromPath: () => null } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const store = require(APP + '/store');
const assert = require('assert');
store.settings.set({ ...store.settings.get(), currentProfile: 'almas', rxntConnected: { almas: true }, watch: { enabled: true, daysAhead: 2 } });

const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tmr = new Date(); tmr.setDate(tmr.getDate() + 1);
const at = (h) => { const d = new Date(tmr); d.setHours(h, 0, 0, 0); return d.toISOString().replace('Z', ''); };
const appt = (id, pid, h, status = 'Booked', extra = {}) => ({ appointmentId: id, patientId: pid, first: 'Ann', last: 'Lee', dob: '1990-02-03', start: at(h), statusText: status, statusCode: status.slice(0, 3).toUpperCase(), phone: '5125550100', ...extra });
let byDay = {};
const watcher = require(APP + '/watcher');
const events = [];
watcher.init({ getProfile: () => 'almas', loadDay: async (d) => ({ items: byDay[d] || [] }), onEvent: (e) => { if (e.type === 'alerts') events.push(...e.events); } });
const realNow = Date.now; let clock = realNow(); Date.now = () => clock;
const T = ymdOf(tmr);

(async () => {
  // A) Cancelled on one chart, rebooked on a second chart with the same name + DOB = one "rescheduled".
  byDay = { [T]: [appt(1, 'p1', 10), appt(9, 'p9', 15, 'Booked', { first: 'Bo', last: 'Ray', dob: '1980-01-01' }), appt(8, 'p8', 16, 'Booked', { first: 'Cy', last: 'Day', dob: '1970-01-01' })] };
  await watcher.check({ silent: true });
  byDay = { [T]: [appt(1, 'p1', 10, 'Canceled'), appt(2, 'p2-dup', 13), appt(9, 'p9', 15, 'Booked', { first: 'Bo', last: 'Ray', dob: '1980-01-01' }), appt(8, 'p8', 16, 'Booked', { first: 'Cy', last: 'Day', dob: '1970-01-01' })] }; clock += 5 * 60000;
  await watcher.check({ silent: true });
  assert.ok(events.some((e) => e.kind === 'rescheduled'), 'duplicate chart pairs by name + DOB as a reschedule');
  assert.ok(!events.some((e) => e.kind === 'new' && e.appt.appointmentId === 2), 'no separate "new" alert for the rebooked visit');

  // B) Cancelled and booked again into the same slot: a visible "Rebooked" (not quiet).
  events.length = 0;
  byDay = { [T]: [appt(1, 'p1', 10, 'Canceled'), appt(2, 'p2-dup', 13), appt(9, 'p9', 15, 'Canceled', { first: 'Bo', last: 'Ray', dob: '1980-01-01' }), appt(10, 'p9', 15, 'Booked', { first: 'Bo', last: 'Ray', dob: '1980-01-01' }), appt(8, 'p8', 16, 'Booked', { first: 'Cy', last: 'Day', dob: '1970-01-01' })] }; clock += 5 * 60000;
  await watcher.check({ silent: true });
  const rb = events.find((e) => e.kind === 'rebooked');
  assert.ok(rb && !rb.quiet && /^Rebooked:/.test(rb.text), 'same-slot rebook is visible');

  // C) Back after a long gap: changes are labeled "While disconnected".
  events.length = 0; clock += 60 * 60000;
  byDay = { [T]: [appt(1, 'p1', 10, 'Canceled'), appt(2, 'p2-dup', 13), appt(9, 'p9', 15, 'Canceled', { first: 'Bo', last: 'Ray', dob: '1980-01-01' }), appt(10, 'p9', 15, 'Booked', { first: 'Bo', last: 'Ray', dob: '1980-01-01' }), appt(8, 'p8', 16, 'Booked', { first: 'Cy', last: 'Day', dob: '1970-01-01' }), appt(11, 'p11', 17, 'Booked', { first: 'Di', last: 'Fox', dob: '1960-01-01' })] };
  await watcher.check({ silent: true });
  assert.ok(events.some((e) => e.kind === 'new' && /^While disconnected:/.test(e.text)), 'gap changes are labeled');
  Date.now = realNow;

  // D) Spam is remembered, mutes the number, and never sticks to a patient's number unless confirmed.
  const comms = require(APP + '/comms');
  store.calls.set({ items: [{ id: 'c1', inbound: true, phone: '5615550000', at: new Date().toISOString(), secs: 0, answered: false, voicemail: false, missed: true }], at: new Date().toISOString() });
  comms.markSpam('5615550000', true);
  let cl = comms.callList(7);
  assert.ok(cl[0].spam && !cl[0].due, 'spam call is not a callback');
  assert.strictEqual(comms.counts().calls, 0, 'spam not counted');
  store.patients.upsert([{ first: 'Pat', last: 'Ient', phone: '5615550000', cell: '5615550000', patientId: 'pp1', chart: 'c1' }]);
  const moved = comms.spamCleanup();
  assert.deepStrictEqual(moved, ['5615550000'], "a patient's number comes off the spam list");
  assert.ok(!comms.spamMap()['5615550000'], 'removed');
  comms.markSpam('5615550000', true, true);   // confirmed by the user
  assert.ok(comms.callList(7)[0].spam, 'confirmed spam on a patient number sticks');
  assert.deepStrictEqual(comms.spamCleanup(), [], 'confirmed one is left alone');

  // E) Answered status: a later text out marks a missed call answered.
  store.calls.set({ items: [{ id: 'c2', inbound: true, phone: '5125557777', at: new Date(Date.now() - 3600e3).toISOString(), secs: 0, answered: false, missed: true }], at: new Date().toISOString() });
  store.log.add({ at: new Date().toISOString(), name: 'X', phone: '5125557777', ok: true, message: 'hi', template: 't' });
  const c2 = comms.callList(7).find((c) => c.id === 'c2');
  assert.ok(c2.answer && c2.answer.how === 'texted back', 'texted back counts as answered');

  // F) Activity log: no secrets, 90-day prune, CSV export.
  const activity = require(APP + '/activity');
  activity.add('RxNT', 'sign-in', { password: 'hunter2', token: 'abc', chart: '123' }, true);
  const rows = activity.list();
  assert.ok(rows.length === 1 && rows[0].chart === '123' && !('password' in rows[0]) && !('token' in rows[0]), 'never logs secrets');
  const old = path.join('Activity', '2020-01.bin'); store.raw.writeSecure(old, [{ at: '2020-01-05T00:00:00Z', source: 'RxNT', type: 'sync', ok: true }]);
  activity.prune();
  assert.ok(!fs.existsSync(store.raw.file(old)), 'old months removed');
  assert.ok(/^at,source,type,ok,chart/.test(activity.csv(activity.list())), 'csv header');

  console.log('1.6.0 OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
