// Schedule alerts must never cry wolf: half-loaded reads and one-off blips don't alert; real cancellations
// alert only after being seen twice; a reported cancellation that comes back gets a correction.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-a-'));
const shown = [];
class N { constructor(o) { this.o = o; } on() {} show() { shown.push(this.o); } static isSupported() { return true; } }
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, Notification: N, nativeImage: { createFromPath: () => null } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const store = require(APP + '/store');
const assert = require('assert');
store.settings.set({ ...store.settings.get(), currentProfile: 'almas', rxntConnected: { almas: true }, watch: { enabled: true, daysAhead: 1 } });
const day = new Date(); const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const appt = (id, h, status = 'Booked') => ({ appointmentId: id, patientId: 'p' + id, first: 'P', last: String(id), start: at(h), statusText: status, statusCode: status.slice(0, 3).toUpperCase(), phone: '5125550100' });
let reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13)] };
const watcher = require(APP + '/watcher');
const events = [];
watcher.init({ getProfile: () => 'almas', loadDay: async () => reply, onEvent: (e) => { if (e.type === 'alerts') events.push(...e.events); } });
const realNow = Date.now; let clock = realNow();
Date.now = () => clock;
(async () => {
  await watcher.check({ silent: true });                                  // first read: baseline
  reply = { items: [] }; clock += 15 * 60000;
  await watcher.check();                                                  // half-loaded read: everything "gone"
  assert.strictEqual(events.length, 0, 'no alerts from an empty read');
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13, 'Canceled')] }; clock += 15 * 60000;
  await watcher.check();                                                  // a real cancellation, first sighting
  assert.strictEqual(events.filter((e) => e.kind === 'cancelled').length, 0, 'not told on first sighting');
  clock += 3 * 60000;
  await watcher.check();                                                  // seen again: confirmed
  assert.strictEqual(events.filter((e) => e.kind === 'cancelled').length, 1, 'told once confirmed');
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13, 'Booked')] }; clock += 15 * 60000;
  await watcher.check();                                                  // it comes back
  assert.strictEqual(events.filter((e) => e.kind === 'correction').length, 1, 'correction sent');
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13), appt(5, 14, 'Canceled')] }; clock += 15 * 60000;
  await watcher.check();
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13), appt(5, 14, 'Booked')] }; clock += 3 * 60000;
  await watcher.check();                                                  // one-off blip never reported
  assert.strictEqual(events.filter((e) => e.kind === 'cancelled').length, 1, 'blip ignored');
  // Cancel, then rebook a few minutes later = one "rescheduled", no cancellation and no "new booking".
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13), appt(5, 14), { ...appt(6, 15), patientId: 'p9' }] }; clock += 15 * 60000;
  await watcher.check();
  const n0 = events.length;
  const later = (h) => { const d = new Date(); d.setDate(d.getDate() + 5); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const far = (id, h, status = 'Booked') => ({ ...appt(id, h, status), start: later(h) });
  store.settings.set({ ...store.settings.get(), watch: { enabled: true, daysAhead: 1 } });
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13), appt(5, 14), { ...appt(6, 15, 'Canceled'), patientId: 'p9' }] }; clock += 15 * 60000;
  await watcher.check();
  reply = { items: [appt(1, 10), appt(2, 11), appt(3, 12), appt(4, 13), appt(5, 14), { ...appt(6, 15, 'Canceled'), patientId: 'p9' }, { ...appt(7, 16), patientId: 'p9' }] }; clock += 1 * 60000;
  await watcher.check();
  const after = events.slice(n0).filter((e) => !e.quiet);
  assert(after.length === 1 && after[0].kind === 'rescheduled', 'cancel + rebook = one reschedule: ' + JSON.stringify(after.map((e) => e.kind)));
  void far;
  // Base for the next cases: today's day as it stands now.
  let base = reply.items.filter((x) => !(x.patientId === 'p9' && x.statusText === 'Canceled'));
  reply = { items: base }; clock += 30 * 60000; await watcher.check();
  const kinds = (from) => events.slice(from).filter((e) => !e.quiet).map((e) => e.kind);
  // 1. Same visit dragged to a new time (no status change) = "rescheduled".
  let n = events.length;
  base = base.map((x) => (x.appointmentId === 2 ? { ...x, start: at(17) } : x));
  reply = { items: base }; clock += 15 * 60000; await watcher.check();
  assert.deepStrictEqual(kinds(n), ['rescheduled'], 'time change alone is a reschedule');
  // 2. Patient with two bookings: the new one pairs with the nearest cancelled one, not the other.
  base = [...base, { ...appt(20, 9), patientId: 'p20' }, { ...appt(21, 15), patientId: 'p20' }];
  reply = { items: base }; clock += 15 * 60000; await watcher.check();
  n = events.length;
  base = base.map((x) => (x.appointmentId === 21 ? { ...x, statusText: 'Canceled', statusCode: 'CAN' } : x));
  reply = { items: base }; clock += 1 * 60000; await watcher.check();
  base = [...base, { ...appt(22, 16), patientId: 'p20' }];
  reply = { items: base }; clock += 1 * 60000; await watcher.check();
  const r2 = events.slice(n).filter((e) => !e.quiet);
  assert(r2.length === 1 && r2[0].kind === 'rescheduled' && /3:00|15:00/.test(r2[0].text), 'paired with the nearest visit: ' + JSON.stringify(r2.map((e) => e.text)));
  // 3. A visit that vanishes outright needs 3 reads and 10 minutes before it's reported.
  reply = { items: base }; clock += 30 * 60000; await watcher.check();
  n = events.length;
  base = base.filter((x) => x.appointmentId !== 3);
  reply = { items: base }; clock += 1 * 60000; await watcher.check();
  clock += 3 * 60000; await watcher.check();
  assert.deepStrictEqual(kinds(n), [], 'not yet: only 2 reads');
  clock += 3 * 60000; await watcher.check();
  assert.deepStrictEqual(kinds(n), [], 'not yet: under 10 minutes');
  clock += 5 * 60000; await watcher.check();
  assert.deepStrictEqual(kinds(n), ['cancelled'], 'reported after 3 reads and 10 minutes');
  // 4. A reported cancellation rebooked into the same slot = "Back on the schedule".
  n = events.length;
  base = base.map((x) => (x.appointmentId === 1 ? { ...x, statusText: 'Canceled', statusCode: 'CAN' } : x));
  reply = { items: base }; clock += 1 * 60000; await watcher.check();
  clock += 3 * 60000; await watcher.check();
  assert.deepStrictEqual(kinds(n), ['cancelled'], 'cancellation reported');
  n = events.length;
  base = [...base, { ...appt(30, 10), patientId: 'p1' }];
  reply = { items: base }; clock += 30 * 60000; await watcher.check();
  assert.deepStrictEqual(kinds(n), ['backon'], 'back on the schedule');
  console.log('alerts OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
