// Local storage. Anything with patient info or credentials is encrypted with the
// operating system's keychain (Windows DPAPI / macOS Keychain) via safeStorage.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const dir = () => app.getPath('userData');
const file = (name) => path.join(dir(), name);

function readPlain(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writePlain(name, data) {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2));
}
function readSecure(name, fallback) {
  try {
    const buf = fs.readFileSync(file(name));
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(text);
  } catch { return fallback; }
}
function writeSecure(name, data) {
  fs.mkdirSync(dir(), { recursive: true });
  const text = JSON.stringify(data);
  const out = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
  fs.writeFileSync(file(name), out, { mode: 0o600 });
}

const REVIEW = `Hi {first}, this is Ruhwell Med!

Thank you for choosing Ruhwell Med! We're grateful for the opportunity to provide your care.

As a growing practice, your feedback means a lot to us and helps others learn about our services. If you'd like to share your experience, you're welcome to leave us a Google review here: {review_link}

Please avoid sharing personal health information in your public review.`;
const REMINDER = `Hi {first}, this is a reminder of your appointment with Ruhwell Med tomorrow, {date} at {time}. Reply C to confirm or call us if you need to reschedule.`;
const WELCOME = `Hi {first}, welcome to Ruhwell Med! Your appointment is set for {date} at {time}. We look forward to meeting you. Reply here if you have any questions.`;
const RESCHEDULE = `Hi {first}, we're sorry we missed you. We'd be happy to find a new time. We have openings {slots}. Reply with what works best, or let us know another day.`;
// audience: after = checked-in visits · upcoming = booked, not yet seen · cancelled = cancelled/no-show · any = everywhere
const DEFAULT_TEMPLATES = [
  { id: 'review', name: 'Review request', text: REVIEW, audience: 'after' },
  { id: 'reminder', name: 'Appointment reminder', text: REMINDER, audience: 'upcoming' },
  { id: 'welcome', name: 'Welcome', text: WELCOME, audience: 'upcoming' },
  { id: 'reschedule', name: 'Reschedule offer', text: RESCHEDULE, audience: 'cancelled' },
];

const DEFAULT_SETTINGS = {
  // One shared desk. currentProfile is only the storage key for logins and personal files.
  profiles: [{ id: 'almas', name: 'Ruhwell Med' }],
  currentProfile: 'almas',
  rxntConnected: {},
  watch: { enabled: true, daysAhead: 3, smsTo: '' },
  sync: { busyStart: '08:00', busyEnd: '17:00' },   // office hours for smart sync (weekdays)
  summary: { on: true, time: '07:30' },
  nudge: { on: true, time: '17:00' },
  historyKeep: 'forever',
  // Per-event alerts: desk = notification on this computer, text = text to your cell (watch.smsTo).
  alertPrefs: {
    schedule: { desk: true, text: false },   // new bookings, cancellations, no-shows, reschedules
    reply: { desk: true, text: false },      // patient texts and RxNT portal messages
    newpatient: { desk: true, text: false }, task: { desk: true, text: false }, soon: { desk: true, text: false, minutes: 15 },
  },

  autoBackup: true,
  signature: '- Ruhwell Med',
  signatureOn: true,
  openAtLogin: true,
  closeToTray: true,
  minimizeToTray: false,
  sound: true,
  reviewLink: 'https://g.page/r/CW229TaZjdKhEBM/review',
  defaultTemplate: 'review',
  templates: DEFAULT_TEMPLATES,
};

module.exports = {
  dataDir: dir,
  settings: {
    get: () => {
      const saved = readPlain('settings.json', {});
      const out = { ...DEFAULT_SETTINGS, ...saved };
      for (const k of ['watch', 'summary', 'nudge', 'sync']) out[k] = { ...DEFAULT_SETTINGS[k], ...(saved[k] || {}) };
      out.alertPrefs = Object.fromEntries(Object.entries(DEFAULT_SETTINGS.alertPrefs).map(([k, v]) => [k, { ...v, ...((saved.alertPrefs || {})[k] || {}) }]));
      return out;
    },
    set: (s) => writePlain('settings.json', s),
  },
  ringrx: {
    get: (pid) => readSecure(`ringrx-${pid}.bin`, null),
    set: (pid, v) => writeSecure(`ringrx-${pid}.bin`, v),
    clear: (pid) => { try { fs.unlinkSync(file(`ringrx-${pid}.bin`)); } catch {} },
  },
  watchState: {
    get: () => readSecure('watch-state.bin', { snapshot: null, alerts: [] }),
    set: (v) => writeSecure('watch-state.bin', v),
  },
  // Patient directory: synced from RxNT (search + charts + schedules), keyed by chart number.
  patients: {
    all: () => readSecure('patients.bin', {}),
    upsert(list) {
      const db = readSecure('patients.bin', {});
      const byPid = {}, byChart = {};
      for (const [k, v] of Object.entries(db)) { if (v.patientId) byPid[v.patientId] = k; if (v.chart) byChart[v.chart] = k; }
      for (const p of list) {
        const key = (p.key && db[p.key] && p.key) || (p.chart && byChart[p.chart]) || (p.patientId && byPid[p.patientId])
          || (p.chart ? `ch:${p.chart}` : p.patientId ? `rx:${p.patientId}` : `ph:${String(p.phone || '').replace(/\D/g, '')}`);
        const cur = db[key] || {};
        const m = { ...cur };
        const { visitAt, ...rest } = p;
        for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null && v !== '') m[k] = v;
        // Last visit = most recent appointment that has already started; next visit = earliest one still ahead.
        if (visitAt) {
          const t = new Date(visitAt), now = new Date();
          if (!isNaN(t)) {
            if (t <= now) { if (!cur.lastVisit || new Date(cur.lastVisit) < t || new Date(cur.lastVisit) > now) { m.lastVisit = visitAt; m.lastVisitType = p.visitType || m.lastVisitType; } }
            else if (!cur.nextVisit || new Date(cur.nextVisit) > t || new Date(cur.nextVisit) < now) { m.nextVisit = visitAt; m.nextVisitType = p.visitType || ''; }
          }
        }
        if (m.lastVisit && new Date(m.lastVisit) > new Date()) { if (!m.nextVisit || new Date(m.lastVisit) < new Date(m.nextVisit)) m.nextVisit = m.lastVisit; delete m.lastVisit; }
        if (m.nextVisit && new Date(m.nextVisit) < new Date(Date.now() - 864e5)) delete m.nextVisit;
        delete m.visitType;
        // Best number to text: cell, then preferred, then the listed phone, then home. A number typed in the app wins.
        {
          const d = (v) => { const x = String(v || '').replace(/\D/g, '').slice(-10); return x.length === 10 && !/^0+$/.test(x) ? x : ''; };
          const opts = [['Cell', m.cell], ['Preferred', m.preferred], ['Listed', m.listedPhone], ['Home', m.home]];
          const hit = opts.find(([, v]) => d(v));
          m.rxPhone = hit ? d(hit[1]) : ''; m.rxPhoneSource = hit ? hit[0] : '';
          if (m.phoneSource !== 'Typed') { m.phone = m.rxPhone || d(m.phone); m.phoneSource = m.rxPhone ? m.rxPhoneSource : (m.phone ? 'Saved' : ''); }
        }
        if ((m.age == null || m.age === '') && m.dob) {
          const dt = new Date(String(m.dob).includes('/') ? m.dob : m.dob + 'T00:00:00');
          if (!isNaN(dt)) { const t = new Date(); let a = t.getFullYear() - dt.getFullYear(); if (t < new Date(t.getFullYear(), dt.getMonth(), dt.getDate())) a--; m.age = a; }
        }
        // Minors: if RxNT lists a parent/guardian and nobody set one in the app, texts go to that parent.
        if (m.guardianFirst && !m.contactSetInApp && m.age != null && m.age < 18) { m.contactType = 'parent'; m.contactName = m.guardianFirst; m.contactSource = 'RxNT'; }
        m.key = key; m.updatedAt = new Date().toISOString();
        // A patient added in the app before they were in RxNT links up once RxNT has them (same phone).
        if (m.chart && m.phone) {
          for (const [k2, q] of Object.entries(db)) {
            if (k2 === key || !q.pending || !(q.phone === m.phone || (q.otherPhones || []).includes(m.phone))) continue;
            for (const f of ['contactType', 'contactName', 'contactSetInApp', 'dnt', 'dntReason']) if (q[f] !== undefined && m[f] === undefined) m[f] = q[f];
            m.otherPhones = [...new Set([...(m.otherPhones || []), ...(q.otherPhones || [])])];
            delete db[k2];
          }
        }
        if (m.chart) delete m.pending;
        db[key] = m;
        if (m.patientId) byPid[m.patientId] = key; if (m.chart) byChart[m.chart] = key;
      }
      writeSecure('patients.bin', db);
      return db;
    },
    remove(key) { const db = readSecure('patients.bin', {}); delete db[key]; writeSecure('patients.bin', db); },
    update(key, fields) {
      const db = readSecure('patients.bin', {});
      if (!db[key]) return false;
      db[key] = { ...db[key], ...fields, updatedAt: new Date().toISOString() };
      writeSecure('patients.bin', db);
      return true;
    },
  },
  syncState: {
    get: () => readPlain('sync-state.json', {}),
    set: (v) => writePlain('sync-state.json', { ...readPlain('sync-state.json', {}), ...v }),
  },
  log: {
    // History/YYYY-MM.bin — one encrypted file per month, newest first when read.
    monthFile: (d) => path.join('History', `${d.slice(0, 7)}.bin`),
    all() {
      const hdir = file('History');
      let months = [];
      try { months = fs.readdirSync(hdir).filter((f) => /^\d{4}-\d{2}\.bin$/.test(f)).sort().reverse(); } catch {}
      return months.flatMap((f) => readSecure(path.join('History', f), [])).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    },
    add(entry) {
      const at = new Date().toISOString();
      const local = new Date(); const key = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}`;
      fs.mkdirSync(file('History'), { recursive: true });
      const name = path.join('History', `${key}.bin`);
      const list = readSecure(name, []);
      list.push({ ...entry, at });
      writeSecure(name, list);
    },
    migrate() {
      // v1 kept everything in history.bin; split it into monthly files once.
      const old = readSecure('history.bin', null);
      if (!old || !old.length) return;
      fs.mkdirSync(file('History'), { recursive: true });
      const by = {};
      for (const e of old) { const d = new Date(e.at); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (by[k] = by[k] || []).push(e); }
      for (const [k, list] of Object.entries(by)) { const n = path.join('History', `${k}.bin`); writeSecure(n, [...readSecure(n, []), ...list]); }
      try { fs.renameSync(file('history.bin'), file('history.v1-migrated.bin')); } catch {}
    },
    prune(keep) {
      if (!keep || keep === 'forever') return;
      const years = keep === '1y' ? 1 : 2;
      const cut = new Date(); cut.setFullYear(cut.getFullYear() - years);
      const ck = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}`;
      try { fs.readdirSync(file('History')).forEach((f) => { if (/^\d{4}-\d{2}\.bin$/.test(f) && f.slice(0, 7) < ck) fs.unlinkSync(file(path.join('History', f))); }); } catch {}
    },
  },
  // Inbound replies seen (STOP opt-outs, C confirmations) so each is handled once.
  calls: {
    get: () => readSecure('ringrx-calls.bin', { items: [], at: null, error: null }),
    set: (v) => writeSecure('ringrx-calls.bin', v),
  },
  callbacks: {
    get: () => readPlain('callbacks.json', { done: [] }),
    set: (v) => writePlain('callbacks.json', v),
  },
  ringrxContacts: {
    get: () => readSecure('ringrx-contacts.bin', { items: [], at: null }),
    set: (v) => writeSecure('ringrx-contacts.bin', v),
  },
  ringrxHistory: {
    get: () => readSecure('ringrx-history.bin', { items: [], at: null, error: null }),
    set: (v) => writeSecure('ringrx-history.bin', v),
  },
  inbound: {
    get: () => readSecure('inbound.bin', { seen: [], confirmed: {} }),
    set: (v) => writeSecure('inbound.bin', v),
  },
  // Raw access for backup/restore.
  raw: { readSecure, writeSecure, readPlain, writePlain, file },
  DEFAULT_TEMPLATES,
};
