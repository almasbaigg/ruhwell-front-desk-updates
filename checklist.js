// Daily checklist ("sticky pad"): quick to-dos per user. Unfinished items carry over to the next day;
// finished ones show on the day they were finished, then drop off.
const store = require('./store');
const file = (pid) => `checklist-${pid}.bin`;
const today = () => new Date().toDateString();

function list(pid) {
  const items = store.raw.readSecure(file(pid), []);
  return items.filter((i) => !i.done || new Date(i.doneAt).toDateString() === today());
}
function save(pid, items) {
  // Keep a short tail of finished items, everything open.
  const keep = items.filter((i) => !i.done || Date.now() - new Date(i.doneAt) < 30 * 864e5).slice(-400);
  store.raw.writeSecure(file(pid), keep);
}
// due: optional "HH:MM" (today, or tomorrow if that time has passed) for a reminder.
function dueAt(hm) {
  if (!/^\d{2}:\d{2}$/.test(hm || '')) return null;
  const [h, m] = hm.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0);
  if (d < new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}
function add(pid, text, hm) {
  const t = String(text || '').trim().slice(0, 300); if (!t) return list(pid);
  const items = store.raw.readSecure(file(pid), []);
  items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: t, done: false, at: new Date().toISOString(), due: dueAt(hm) });
  save(pid, items); return list(pid);
}
function toggle(pid, id) {
  const items = store.raw.readSecure(file(pid), []);
  const i = items.find((x) => x.id === id); if (i) { i.done = !i.done; i.doneAt = i.done ? new Date().toISOString() : null; }
  save(pid, items); return list(pid);
}
// Open tasks whose reminder time has come; each fires once.
function dueNow(pid) {
  const items = store.raw.readSecure(file(pid), []), now = Date.now(), hits = [];
  for (const i of items) if (!i.done && i.due && !i.reminded && new Date(i.due) <= now) { i.reminded = true; hits.push(i); }
  if (hits.length) save(pid, items);
  return hits;
}
function remove(pid, id) { save(pid, store.raw.readSecure(file(pid), []).filter((x) => x.id !== id)); return list(pid); }

// Private notes: one free-text pad per user, encrypted on this computer.
const notesFile = (pid) => `notes-${pid}.bin`;
const notes = {
  get: (pid) => store.raw.readSecure(notesFile(pid), { text: '', at: null }),
  set: (pid, text) => { const v = { text: String(text || '').slice(0, 20000), at: new Date().toISOString() }; store.raw.writeSecure(notesFile(pid), v); return v; },
};

// For backups: every user's checklist and notes.
function exportAll(pids) { const o = {}; for (const id of pids) o[id] = { checklist: store.raw.readSecure(file(id), []), notes: notes.get(id) }; return o; }
function importAll(data) {
  for (const [id, v] of Object.entries(data || {})) {
    if (!/^[a-z0-9_-]+$/i.test(id)) continue;
    const cur = store.raw.readSecure(file(id), []), have = new Set(cur.map((i) => i.id));
    save(id, [...cur, ...(v.checklist || []).filter((i) => !have.has(i.id))]);
    if (v.notes && v.notes.text && !notes.get(id).text) store.raw.writeSecure(notesFile(id), v.notes);
  }
}

module.exports = { list, add, toggle, remove, dueNow, notes, exportAll, importAll };
