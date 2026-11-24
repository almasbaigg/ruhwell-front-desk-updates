// Outbox: texts and emails that go out later ("Send later", or held by quiet hours).
// Kept encrypted on this computer. Sent only while the app is running; if the computer was asleep, they go out
// when it wakes, but never inside quiet hours. Nothing is ever sent twice: an item is marked "sending" before it
// goes, and one that was mid-send when the app closed is shown as "Check this one" instead of being re-sent.
const store = require('./store');
const FILE = 'outbox.bin';
let senders = {}, onChange = () => {}, timer = null, busy = false;

const all = () => store.raw.readSecure(FILE, { items: [] }).items || [];
const save = (items) => { store.raw.writeSecure(FILE, { items }); onChange(); };
const quiet = () => ({ start: 8, end: 20, days: [1, 2, 3, 4, 5, 6], ...(store.settings.get().quietHours || {}) });

// Allowed to send at this moment? (start/end in hours, local time; days 0 = Sunday)
function allowed(d = new Date(), q = quiet()) {
  const h = d.getHours() + d.getMinutes() / 60;
  return q.days.includes(d.getDay()) && h >= q.start && h < q.end;
}
// The next moment sending is allowed, at or after d.
function nextAllowed(d = new Date(), q = quiet()) {
  if (allowed(d, q)) return d;
  const t = new Date(d);
  for (let i = 0; i < 8; i++) {
    const start = new Date(t); start.setHours(Math.floor(q.start), Math.round((q.start % 1) * 60), 0, 0);
    if (q.days.includes(start.getDay()) && start > d) return start;
    t.setDate(t.getDate() + 1); t.setHours(0, 0, 0, 0);
  }
  return d;   // no allowed days configured: don't hold forever
}

function add(item) {
  const items = all();
  // The same submission (double click, a retried call) is only ever queued once.
  if (item.id) { const dup = items.find((x) => x.id === item.id); if (dup) return dup; }
  const at = new Date(item.sendAt || Date.now());
  const it = { id: item.id ? String(item.id).slice(0, 80) : `ob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), status: 'scheduled',
    kind: item.kind, label: String(item.label || '').slice(0, 120), to: String(item.to || '').slice(0, 200), payload: item.payload,
    sendAt: (item.respectQuiet === false ? at : nextAllowed(at)).toISOString(), respectQuiet: item.respectQuiet !== false };
  items.push(it); save(items); kick();
  return it;
}
function update(id, fields) { const items = all(); const i = items.findIndex((x) => x.id === id); if (i < 0) return null; items[i] = { ...items[i], ...fields }; save(items); return items[i]; }
function cancel(id) { const it = all().find((x) => x.id === id); if (!it || it.status !== 'scheduled') return false; update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() }); return true; }
function sendNow(id) { const it = all().find((x) => x.id === id); if (!it || it.status !== 'scheduled') return false; update(id, { sendAt: new Date().toISOString(), respectQuiet: false }); kick(); return true; }
function reschedule(id, when) { const it = all().find((x) => x.id === id); if (!it || it.status !== 'scheduled') return false; update(id, { sendAt: nextAllowed(new Date(when)).toISOString(), respectQuiet: true }); return true; }
// Shown in the Scheduled list: everything waiting, plus the last 7 days of results.
function list() {
  const week = Date.now() - 7 * 864e5;
  return all().filter((x) => x.status === 'scheduled' || x.status === 'uncertain' || new Date(x.doneAt || x.createdAt) > week)
    .map(({ payload, ...x }) => ({ ...x, preview: payload && (payload.subject || (payload.items && payload.items[0] && payload.items[0].message) || '') }))
    .sort((a, b) => (a.status === 'scheduled') - (b.status === 'scheduled') || new Date(a.sendAt) - new Date(b.sendAt));
}
const pending = () => all().filter((x) => x.status === 'scheduled').length;

async function tick() {
  if (busy) return; busy = true;
  try {
    for (let guard = 0; guard < 100; guard++) {
      const now = new Date();
      const due = all().find((x) => x.status === 'scheduled' && new Date(x.sendAt) <= now);
      if (!due) break;
      // Quiet hours can start while an item waits (asleep through the evening): hold it to the next morning.
      if (due.respectQuiet !== false && !allowed(now)) { const n = nextAllowed(now); update(due.id, { sendAt: (n > now ? n : new Date(now.getTime() + 3600e3)).toISOString() }); continue; }
      const fn = senders[due.kind];
      if (!fn) { update(due.id, { status: 'failed', error: 'Unknown kind', doneAt: now.toISOString() }); continue; }
      update(due.id, { status: 'sending', startedAt: now.toISOString() });
      let r;
      try { r = await fn(due.payload, due); } catch (e) { r = { ok: false, error: e.message, code: e.code }; }
      // Offline / signed out: try again in 10 minutes (still scheduled), anything else is a real failure.
      if (!r.ok && r.code === 'HELD') { update(due.id, { status: 'scheduled', sendAt: nextAllowed(new Date(Date.now() + 60000)).toISOString() }); continue; }
      if (!r.ok && (r.code === 'OFFLINE' || r.code === 'SIGNED_OUT' || r.code === 'LOCKED') && (due.tries || 0) < 12) update(due.id, { status: 'scheduled', tries: (due.tries || 0) + 1, sendAt: new Date(Date.now() + 10 * 60000).toISOString(), error: r.error });
      // The provider may already have it (a timeout or server error after submitting): never send again on our own.
      else if (!r.ok && r.code === 'UNCERTAIN') update(due.id, { status: 'uncertain', error: r.error || 'Not sure it went out. Check Sent before sending again.', doneAt: new Date().toISOString() });
      else update(due.id, { status: r.ok ? 'sent' : 'failed', error: r.ok ? '' : r.error || 'Failed', doneAt: new Date().toISOString(), result: r.partial || undefined });
    }
  } finally { busy = false; }
}
function kick() { setTimeout(() => tick().catch(() => {}), 200); }

function start(opts) {
  senders = opts.senders || {}; onChange = opts.onChange || (() => {});
  // Anything caught mid-send when the app last closed: don't guess, ask.
  const items = all(); let changed = false;
  for (const x of items) if (x.status === 'sending') { x.status = 'uncertain'; x.error = 'The app closed while this was sending. Check whether it went out.'; changed = true; }
  // Keep 60 days.
  const keep = items.filter((x) => x.status === 'scheduled' || x.status === 'uncertain' || new Date(x.doneAt || x.createdAt) > Date.now() - 60 * 864e5);
  if (changed || keep.length !== items.length) save(keep);
  clearInterval(timer); timer = setInterval(() => tick().catch(() => {}), 30000);
  kick();
}

const get = (id) => all().find((x) => x.id === id) || null;
function setPayload(id, payload) { const items = all(); const i = items.findIndex((x) => x.id === id); if (i >= 0) { items[i].payload = payload; store.raw.writeSecure(FILE, { items }); } }
module.exports = { get, setPayload, start, add, cancel, sendNow, reschedule, list, pending, allowed, nextAllowed, quiet, tick, dismiss: (id) => update(id, { status: 'checked', doneAt: new Date().toISOString() }) };
