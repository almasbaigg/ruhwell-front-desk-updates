// 2.1.1: findings from the second review (chart identity conflicts, sibling merge, email vs text timeline,
// sticky Mark unread, STOP processed marker, safe backup replacement).
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-211-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, session: { fromPartition: () => ({}) } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const assert = require('assert');
const store = require(APP + '/store');

(async () => {
  // Chart identity: a matching chart number is not enough when the DOB or name disagrees.
  const rx = require(APP + '/rxnt-reader');
  const who = { patientId: '19888266', first: 'Randy', last: 'Wester', dob: '1989-03-15' };
  assert.ok(rx.sameChart({ chart: '19888266', first: 'Randy', last: 'Wester', dob: '1989-03-15' }, who));
  assert.ok(!rx.sameChart({ chart: '19888266', first: 'Randy', last: 'Wester', dob: '1990-03-15' }, who), 'same chart + name, different DOB → stop');
  assert.ok(!rx.sameChart({ chart: '19888266', first: 'Randy', last: 'Western', dob: '1989-03-15' }, who), 'same chart + DOB, different name → stop');
  assert.ok(rx.sameChart({ chart: '', first: 'José', last: 'Núñez', dob: '1980-01-01' }, { first: 'Jose', last: 'Nunez', dob: '1980-01-01' }), 'accents compare equal');
  assert.ok(!rx.sameChart({ chart: '', first: '', last: '', dob: '1980-01-01' }, { first: '', last: '', dob: '1980-01-01' }), 'no names at all → not enough');

  // Siblings sharing a parent's number: importing one chart doesn't swallow the other pending record.
  store.patients.upsert([{ first: 'Amy', last: 'Cole', phone: '5125550150', phoneSource: 'Typed', pending: true, contactType: 'parent', contactName: 'Dana' }]);
  store.patients.upsert([{ patientId: 'p2', chart: '200', first: 'Ben', last: 'Cole', cell: '5125550150' }]);
  let all = Object.values(store.patients.all());
  assert.ok(all.some((p) => p.first === 'Amy' && p.pending), "a sibling's chart on the same number doesn't swallow Amy");
  store.patients.upsert([{ patientId: 'p1', chart: '100', first: 'Amy', last: 'Cole', cell: '5125550150' }]);
  all = Object.values(store.patients.all());
  assert.ok(all.find((p) => p.chart === '100' && p.contactName === 'Dana') && !all.some((p) => p.pending && p.first === 'Amy'), 'her own chart still merges');

  // An email to a patient doesn't answer their text.
  const comms = require(APP + '/comms');
  const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
  store.ringrxHistory.set({ items: [{ id: 'x1', kind: 'text', inbound: true, phone: '5125550160', at: iso(30), body: 'Can I get a refill?' }], at: iso(0), v: 2 });
  store.log.add({ name: 'Zed', phone: '5125550160', template: 'Email', ok: true, message: 'Email: Welcome', channel: 'email' });
  comms.bust();
  const t = comms.textThreads(7).find((x) => x.phone === '5125550160');
  assert.ok(t.needs, 'still needs a reply'); assert.ok(!comms.thread('5125550160').some((m) => /Email:/.test(m.body)), 'no email bubble in the text thread');

  // Mark unread sticks even when RingRx has it as read.
  store.ringrxHistory.set({ items: [{ id: 'x2', kind: 'text', inbound: true, phone: '5125550161', at: iso(30), body: 'hi', unread: false }], at: iso(0), v: 2 });
  comms.bust(); comms.markSeen('5125550161');
  assert.strictEqual(comms.textThreads(7).find((x) => x.phone === '5125550161').unread, 0);
  comms.unmarkSeen('5125550161');
  assert.ok(comms.textThreads(7).find((x) => x.phone === '5125550161').unread >= 1, 'Mark unread shows as unread');
  comms.markSeen('5125550161');
  assert.strictEqual(comms.textThreads(7).find((x) => x.phone === '5125550161').unread, 0, 'opening it again clears it');

  // STOP: the "processed" marker is saved together with the opt-out.
  comms.handleReplies([{ id: 's1', inbound: true, phone: '5125550170', at: iso(5), body: 'STOP' }], () => {});
  const ib = store.inbound.get();
  assert.ok(ib.optOut['5125550170'] && ib.processed.includes('s1'), 'STOP applied and marked processed in one save');

  // Backup now: works with daily backups off, and a failed attempt keeps the old copy.
  const backups = require(APP + '/backups');
  store.settings.set({ ...store.settings.get(), autoBackup: false });
  assert.strictEqual(backups.autoDaily(true), true, 'Back up now works even with daily backups off');
  const name = backups.list()[0].file, before = fs.readFileSync(store.raw.file(path.join('Backups', name)));
  const realWrite = store.raw.writeSecure; store.raw.writeSecure = (rel, v) => { if (/Backups/.test(rel)) throw new Error('disk full'); return realWrite(rel, v); };
  assert.strictEqual(backups.autoDaily(true), false, 'reports the failure');
  store.raw.writeSecure = realWrite;
  assert.ok(fs.readFileSync(store.raw.file(path.join('Backups', name))).equals(before), 'old backup untouched');

  console.log('2.1.1 OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
