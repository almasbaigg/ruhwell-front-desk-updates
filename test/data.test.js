const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, Notification: { isSupported: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = require('path').join(__dirname, '..') + '';
const store = require(APP + '/store');
const assert = require('assert');
console.log('dataDir', store.dataDir());
// 1) last/next visit
const past = new Date(Date.now() - 2 * 864e5).toISOString(), fut = new Date(Date.now() + 3 * 864e5).toISOString();
store.patients.upsert([{ patientId: 7, chart: 'C7', first: 'Fi', last: 'Cl', age: 12, cell: '5125550177', visitAt: fut, visitType: 'Follow Up' }]);
let p = Object.values(store.patients.all())[0];
assert(!p.lastVisit && p.nextVisit === fut, 'future goes to nextVisit');
store.patients.upsert([{ patientId: 7, chart: 'C7', visitAt: past, visitType: 'New Patient' }]);
p = Object.values(store.patients.all())[0];
assert(p.lastVisit === past && p.nextVisit === fut, 'past goes to lastVisit');
assert(!('visitType' in p), 'no stray visitType');
// 2) old bad data: lastVisit in the future gets moved
store.patients.update(p.key, { lastVisit: fut, nextVisit: undefined });
store.patients.upsert([{ patientId: 7, chart: 'C7' }]);
p = Object.values(store.patients.all())[0];
assert(!p.lastVisit && p.nextVisit === fut, 'future lastVisit repaired');
// 3) parent from RxNT, app choice wins
store.patients.upsert([{ patientId: 7, chart: 'C7', guardianFirst: 'Sarah', guardianLast: 'Cl' }]);
p = Object.values(store.patients.all())[0];
assert(p.contactType === 'parent' && p.contactName === 'Sarah' && p.contactSource === 'RxNT', 'guardian applied');
store.patients.update(p.key, { contactType: 'patient', contactSetInApp: true });
store.patients.upsert([{ patientId: 7, chart: 'C7', guardianFirst: 'Sarah' }]);
p = Object.values(store.patients.all())[0];
assert(p.contactType === 'patient', 'app choice kept');
// 4) adult guardian ignored
store.patients.upsert([{ patientId: 8, chart: 'C8', first: 'A', last: 'B', age: 40, cell: '5125550000', guardianFirst: 'X' }]);
assert(Object.values(store.patients.all()).find((x) => x.chart === 'C8').contactType !== 'parent', 'adult no parent');
// 5) typed phone wins over RxNT
const k8 = Object.values(store.patients.all()).find((x) => x.chart === 'C8').key;
store.patients.update(k8, { phone: '5125551111', phoneSource: 'Typed' });
store.patients.upsert([{ chart: 'C8', cell: '5125550000' }]);
assert(store.patients.all()[k8].phone === '5125551111' && store.patients.all()[k8].rxPhone === '5125550000', 'typed phone kept');
// 6) migrations from a 1.x settings file
store.settings.set({ currentProfile: 'almas', watch: { enabled: true, minutes: 5, daysAhead: 3, smsTo: '9795550100' }, templates: [{ id: 'review', name: 'Review', text: 'x', seenOnly: true }, { id: 'voicemail', name: 'VM', text: 'y' }] });
require(APP + '/migrations').run();
let s = store.settings.get();
assert(s.schemaVersion === 7 && s.watch.minutes === undefined && s.sync.busyStart === '08:00', 'migrated');
assert(s.alertCells && s.alertCells.almas === '9795550100', 'alert cell moved to user');
assert(s.templates.find((t) => t.id === 'review').audience === 'after' && !s.templates.find((t) => t.id === 'voicemail') && s.templates.find((t) => t.id === 'reminder'), 'templates migrated');
assert(s.alertPrefs.schedule.text === true && !s.alertPrefs.new && s.alertPrefs.soon.minutes === 15, 'alert prefs migrated');
require(APP + '/migrations').run(); assert(store.settings.get().templates.length === s.templates.length, 'migrations idempotent');
// 6b) no user picker: a desk that last used Maria's logins keeps them
store.settings.set({ ...store.settings.get(), currentProfile: null, schemaVersion: 4, rxntConnected: { maria: true } });
require(APP + '/migrations').run(); assert(store.settings.get().currentProfile === 'maria', 'keeps the profile with logins');
store.settings.set({ ...store.settings.get(), currentProfile: 'almas' });
// 6c) checklist reminders and notes
const cl = require(APP + '/checklist');
const pastT = new Date(Date.now() - 60000), hm = `${String(pastT.getHours()).padStart(2, '0')}:${String(pastT.getMinutes()).padStart(2, '0')}`;
cl.add('almas', 'No time'); cl.add('almas', 'Timed', '23:59');
const it = cl.list('almas').find((i) => i.text === 'Timed'); assert(it.due, 'due set');
const raw = store.raw.readSecure('checklist-almas.bin', []); raw.find((i) => i.text === 'Timed').due = pastT.toISOString(); store.raw.writeSecure('checklist-almas.bin', raw);
assert(cl.dueNow('almas').length === 1 && cl.dueNow('almas').length === 0, 'reminder fires once');
cl.notes.set('almas', 'hello'); assert(cl.notes.get('almas').text === 'hello', 'notes saved');
void hm;
// 7) backups
const backups = require(APP + '/backups');
store.log.add({ at: new Date().toISOString(), name: 'Fi Cl', phone: '5125550177', ok: true, template: 'Review request' });
assert(backups.autoDaily() === true && backups.autoDaily() === false && backups.list().length === 1, 'auto backup once a day');
const snap = backups.snapshot();
fs.rmSync(path.join(dir, 'patients.bin')); fs.rmSync(path.join(dir, 'History'), { recursive: true, force: true });
assert(Object.keys(store.patients.all()).length === 0);
const r = backups.restoreAuto(backups.list()[0].file);
assert(Object.keys(store.patients.all()).length === 2 && store.log.all().length === 1, 'restore works ' + JSON.stringify(r));
backups.restore(snap); assert(store.log.all().length === 1, 'restore does not duplicate history');
assert(snap.personal && snap.personal.almas.notes.text === 'hello', 'backup has notes');
assert(backups.contactsCsv().csv.includes('Name,') || backups.contactsCsv().csv.includes('"Name"'), 'contacts csv');
// 8) pending patient links up when RxNT has them
store.patients.upsert([{ first: 'New', last: 'Caller', phone: '5125557777', phoneSource: 'Typed', pending: true, contactType: 'parent', contactName: 'Mom', contactSetInApp: true }]);
store.patients.upsert([{ chart: 'C99', patientId: 99, first: 'New', last: 'Caller', cell: '5125557777', age: 9 }]);
const linked = Object.values(store.patients.all()).filter((x) => x.phone === '5125557777');
assert(linked.length === 1 && linked[0].chart === 'C99' && !linked[0].pending && linked[0].contactName === 'Mom', 'pending patient linked ' + JSON.stringify(linked));
console.log('ALL TESTS PASSED');
