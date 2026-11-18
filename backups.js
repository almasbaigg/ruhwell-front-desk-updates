// Backups: a daily automatic copy in the data folder's "Backups" folder (encrypted for this
// computer's login, last 14 days kept) plus manual password-protected backup files.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const checklist = require('./checklist');

const DIR = 'Backups', KEEP = 14;
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function snapshot() {
  const s = { ...store.settings.get() }; delete s.rxntConnected; delete s.currentProfile;
  return {
    v: 3, createdAt: new Date().toISOString(), settings: s, patients: store.patients.all(), history: store.log.all(),
    inbound: store.inbound.get(), ringrxHistory: store.ringrxHistory.get(), calls: store.calls.get(),
    ringrxContacts: store.ringrxContacts.get(), personal: checklist.exportAll((s.profiles || []).map((x) => x.id)),
  };
}

// Merges a backup into current data: nothing already saved is deleted.
function restore(b) {
  const cur = store.settings.get();
  store.settings.set({ ...cur, ...b.settings, rxntConnected: cur.rxntConnected, currentProfile: cur.currentProfile });
  store.patients.upsert(Object.values(b.patients || {}));
  const have = new Set(store.log.all().map((h) => h.at + h.phone));
  const byMonth = {};
  for (const h of b.history || []) { if (have.has(h.at + h.phone)) continue; const k = String(h.at).slice(0, 7); (byMonth[k] = byMonth[k] || []).push(h); }
  fs.mkdirSync(store.raw.file('History'), { recursive: true });
  for (const [k, list] of Object.entries(byMonth)) { const n = path.join('History', `${k}.bin`); store.raw.writeSecure(n, [...store.raw.readSecure(n, []), ...list]); }
  if (b.ringrxHistory && (b.ringrxHistory.items || []).length) {
    const now = store.ringrxHistory.get(), map = {};
    [...(b.ringrxHistory.items || []), ...(now.items || [])].forEach((m) => { map[m.id] = m; });
    store.ringrxHistory.set({ ...now, items: Object.values(map) });
  }
  if (b.calls && (b.calls.items || []).length) {
    const now = store.calls.get(), map = {};
    [...(b.calls.items || []), ...(now.items || [])].forEach((m) => { map[m.id] = m; });
    store.calls.set({ ...now, items: Object.values(map) });
  }
  if (b.ringrxContacts && (b.ringrxContacts.items || []).length) {
    const now = store.ringrxContacts.get(), map = {};
    [...(b.ringrxContacts.items || []), ...(now.items || [])].forEach((c) => { map[c.id] = c; });
    store.ringrxContacts.set({ ...now, items: Object.values(map) });
  }
  if (b.personal) checklist.importAll(b.personal);
  return { patients: Object.keys(b.patients || {}).length, history: (b.history || []).length };
}

// Contacts as a spreadsheet (CSV) that opens in Excel or imports into Google/iPhone contacts.
// Patients (and their parent contact) plus RingRx contacts. Not encrypted.
function contactsCsv() {
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const fmt = (d) => (d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d || '');
  const rows = [['Name', 'Phone', 'Other phones', 'Type', 'Texts go to', 'Do not text', 'Date of birth', 'Chart']];
  for (const p of Object.values(store.patients.all())) {
    rows.push([`${p.first || ''} ${p.last || ''}`.trim(), fmt(p.phone), (p.otherPhones || []).map(fmt).join('; '), p.pending ? 'New patient (not in RxNT yet)' : 'Patient',
      p.contactType === 'parent' ? `Parent${p.contactName ? ': ' + p.contactName : ''}` : 'Patient', p.dnt ? 'Yes' : '', p.dob || '', p.chart || '']);
  }
  for (const c of store.ringrxContacts.get().items || []) rows.push([c.name, fmt(c.numbers[0]), c.numbers.slice(1).map(fmt).join('; '), 'RingRx contact', '', '', '', '']);
  return { csv: '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n'), count: rows.length - 1 };
}

function list() {
  try {
    return fs.readdirSync(store.raw.file(DIR)).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.bin$/.test(f)).sort().reverse()
      .map((f) => ({ file: f, date: f.slice(5, 15), size: fs.statSync(store.raw.file(path.join(DIR, f))).size }));
  } catch { return []; }
}

// Once a day (called on launch and hourly). Skips if today's backup exists.
function autoDaily() {
  if (store.settings.get().autoBackup === false) return false;
  const name = `auto-${ymd()}.bin`;
  if (list().some((b) => b.file === name)) return false;
  fs.mkdirSync(store.raw.file(DIR), { recursive: true });
  store.raw.writeSecure(path.join(DIR, name), snapshot());
  list().slice(KEEP).forEach((b) => { try { fs.unlinkSync(store.raw.file(path.join(DIR, b.file))); } catch {} });
  return true;
}
function restoreAuto(file) {
  if (!/^auto-\d{4}-\d{2}-\d{2}\.bin$/.test(file)) throw new Error('Unknown backup.');
  const b = store.raw.readSecure(path.join(DIR, file), null);
  if (!b) throw new Error('This backup can\'t be opened on this computer.');
  return restore(b);
}

module.exports = { snapshot, restore, list, autoDaily, restoreAuto, contactsCsv };
