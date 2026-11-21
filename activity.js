// Activity log for bookkeeping: one line per thing the app does with RxNT, Doximity and RingRx
// (fax received/filed, uploads, sign-ins, sync reads, alerts sent). Kept 90 days, then pruned.
// Chart numbers instead of patient names; never fax content or passwords. Encrypted on disk,
// append-only (there is no way to edit an old line from the app).
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DIR = 'Activity', KEEP_DAYS = 90;
const month = (d) => d.toISOString().slice(0, 7);
const fileFor = (m) => path.join(DIR, `${m}.bin`);
const SECRET = /pass(word)?|token|cookie|secret/i;

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (SECRET.test(k) || v === undefined || v === null || typeof v === 'function') continue;
    out[k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300);
  }
  return out;
}

// source: 'RxNT' | 'Doximity' | 'RingRx' | 'Gmail' | 'App'; type: short slug; ok: true/false
function add(source, type, info = {}, ok = true) {
  try {
    const now = new Date();
    fs.mkdirSync(store.raw.file(DIR), { recursive: true });
    const f = fileFor(month(now));
    const list = store.raw.readSecure(f, []);
    list.push({ at: now.toISOString(), source, type, ok: ok !== false, ...clean(info) });
    store.raw.writeSecure(f, list);
  } catch {}
}

function prune() {
  try {
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5);
    const dir = store.raw.file(DIR); if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const m = /^(\d{4}-\d{2})\.bin$/.exec(name); if (!m) continue;
      const end = new Date(`${m[1]}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1);
      if (end < cutoff) { fs.unlinkSync(path.join(dir, name)); continue; }
      if (new Date(`${m[1]}-01T00:00:00Z`) < cutoff) {   // straddles the cutoff: drop the old lines
        const f = path.join(DIR, name), list = store.raw.readSecure(f, []);
        const keep = list.filter((x) => new Date(x.at) >= cutoff);
        if (keep.length !== list.length) store.raw.writeSecure(f, keep);
      }
    }
  } catch {}
}

function list({ from, to, source, type } = {}) {
  const dir = store.raw.file(DIR); if (!fs.existsSync(dir)) return [];
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const out = [];
  for (const name of fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}\.bin$/.test(n)).sort()) out.push(...store.raw.readSecure(path.join(DIR, name), []));
  return out.filter((x) => new Date(x.at) >= cutoff && (!from || x.at >= from) && (!to || x.at <= to + 'T23:59:59.999Z') && (!source || x.source === source) && (!type || x.type === type))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

function csv(rows) {
  const keys = ['at', 'source', 'type', 'ok', ...new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => !['at', 'source', 'type', 'ok'].includes(k)))];
  const q = (v) => { const s = v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => q(r[k])).join(','))].join('\n');
}

module.exports = { add, list, prune, csv, KEEP_DAYS };
