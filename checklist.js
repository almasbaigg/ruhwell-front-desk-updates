// Daily checklist and notes, encrypted on this computer.
// Checklist: unfinished items carry over; finished ones show on the day they were finished, then drop off.
// Tasks can have a reminder time, repeat daily or weekly, be starred into the day's Top 3, link back to the
// text/call/RxNT item they came from, and be put in any order.
const store = require('./store');
const file = (pid) => `checklist-${pid}.bin`;
const today = () => new Date().toDateString();
const read = (pid) => store.raw.readSecure(file(pid), []);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Repeating tasks wait until their day comes round before they show.
const visible = (i) => !i.showFrom || new Date(i.showFrom) <= new Date();
function list(pid) {
  return read(pid).filter((i) => visible(i) && (!i.done || new Date(i.doneAt).toDateString() === today()))
    .sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || (a.order ?? 1e9) - (b.order ?? 1e9) || new Date(a.at) - new Date(b.at));
}
function save(pid, items) {
  // Keep open items and a short tail of finished ones.
  const keep = items.filter((i) => !i.done || Date.now() - new Date(i.doneAt) < 30 * 864e5).slice(-400);
  store.raw.writeSecure(file(pid), keep);
}

/* Plain-language times: "call pharmacy at 3", "payroll tomorrow", "fax check every day at 9",
   "labs in 30 min", "refill list friday 2pm". Returns the task text without the time words. */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function parse(input, now = new Date()) {
  let text = ` ${String(input || '').trim()} `, due = null, repeat = null, day = null;
  const take = (re) => { const m = text.match(re); if (m) text = text.replace(m[0], ' '); return m; };
  if (take(/\s(every\s?day|daily)\b/i)) repeat = 'daily';
  let m = take(/\severy\s(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i);
  if (m) { repeat = 'weekly'; day = DAYS.findIndex((d) => d.startsWith(m[1].toLowerCase().slice(0, 3))); }
  if (take(/\sweekly\b/i)) repeat = 'weekly';
  m = take(/\sin\s(\d{1,3})\s?(m|min|mins|minutes|h|hr|hrs|hour|hours)\b/i);
  if (m) due = new Date(now.getTime() + Number(m[1]) * (/^h/i.test(m[2]) ? 36e5 : 6e4));
  let dayShift = null;
  if (take(/\stomorrow\b/i)) dayShift = 1;
  else if (take(/\stoday\b|\stonight\b/i)) dayShift = 0;
  m = day === null ? (take(/\s(?:on\s)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i) || take(/\son\s(sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)\b/i)) : null;   // short day names only after \"on\" (so \"sat\" or \"sun\" in a sentence isn't a day)
  if (m) day = DAYS.findIndex((d) => d.startsWith(m[1].toLowerCase().slice(0, 3)));
  m = take(/\s(?:at|@)\s?(\d{1,2})(?::(\d{2}))?\s?(am|pm|a|p)?\b/i) || take(/\s(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i) || take(/\s(\d{1,2}):(\d{2})\b/);
  let hm = null;
  if (m) {
    let h = Number(m[1]); const min = Number(m[2] || 0), ap = (m[3] || '').toLowerCase();
    if (ap.startsWith('p') && h < 12) h += 12;
    if (ap.startsWith('a') && h === 12) h = 0;
    if (!ap && h >= 1 && h <= 6) h += 12;   // "at 3" during a workday means 3 PM
    if (h <= 23 && min <= 59) hm = [h, min];
  }
  if (!due && (hm || dayShift !== null || day !== null)) {
    const d = new Date(now); d.setSeconds(0, 0);
    if (dayShift) d.setDate(d.getDate() + dayShift);
    if (day !== null && day >= 0) { const add = (day - d.getDay() + 7) % 7 || (dayShift === null && !hm ? 7 : 0); d.setDate(d.getDate() + add); }
    if (hm) d.setHours(hm[0], hm[1], 0, 0); else d.setHours(8, 0, 0, 0);
    if (d <= now && dayShift === null && day === null) d.setDate(d.getDate() + 1);
    due = d;
  }
  return { text: text.replace(/\s+/g, ' ').trim(), due: due ? due.toISOString() : null, repeat };
}

// opts: { due (ISO), repeat, link: { view, key, phone }, raw: true to skip parsing }
function add(pid, input, opts = {}) {
  const p = opts.raw ? { text: String(input || '').trim(), due: null, repeat: null } : parse(input);
  const t = p.text.slice(0, 300); if (!t) return list(pid);
  const items = read(pid);
  const due = opts.due || p.due, showFrom = due && new Date(due).toDateString() !== today() && new Date(due) > new Date() ? new Date(new Date(due).setHours(0, 0, 0, 0)).toISOString() : null;
  items.push({ id: newId(), text: t, done: false, at: new Date().toISOString(), due, repeat: opts.repeat || p.repeat, link: opts.link || null, showFrom });
  save(pid, items); return list(pid);
}
// Done: a repeating task comes back on its next day.
function toggle(pid, id) {
  const items = read(pid);
  const i = items.find((x) => x.id === id);
  if (i) {
    i.done = !i.done; i.doneAt = i.done ? new Date().toISOString() : null;
    if (i.done && i.repeat && !i.nextId) {
      const step = i.repeat === 'weekly' ? 7 : 1, base = new Date(i.due || Date.now()), next = new Date(base);
      next.setDate(next.getDate() + step); while (next < new Date()) next.setDate(next.getDate() + step);
      const n = { id: newId(), text: i.text, done: false, at: new Date().toISOString(), due: i.due ? next.toISOString() : null, repeat: i.repeat, showFrom: new Date(new Date(next).setHours(0, 0, 0, 0)).toISOString(), order: i.order };
      i.nextId = n.id; items.push(n);
    }
  }
  save(pid, items); return list(pid);
}
// Top 3: the few things that must happen today.
function star(pid, id) {
  const items = read(pid), i = items.find((x) => x.id === id);
  if (i) { if (!i.top && list(pid).filter((x) => x.top && !x.done).length >= 3) return { error: 'top3', items: list(pid) }; i.top = !i.top; }
  save(pid, items); return list(pid);
}
function setDue(pid, id, due) { const items = read(pid), i = items.find((x) => x.id === id); if (i) { i.due = due || null; i.reminded = false; } save(pid, items); return list(pid); }
function reorder(pid, ids) { const items = read(pid); ids.forEach((id, n) => { const i = items.find((x) => x.id === id); if (i) i.order = n; }); save(pid, items); return list(pid); }
// Open tasks whose reminder time has come; each fires once.
function dueNow(pid) {
  const items = read(pid), now = Date.now(), hits = [];
  for (const i of items) if (!i.done && i.due && !i.reminded && new Date(i.due) <= now) { i.reminded = true; hits.push(i); }
  if (hits.length) save(pid, items);
  return hits;
}
function remove(pid, id) { save(pid, read(pid).filter((x) => x.id !== id)); return list(pid); }

/* Notes: one page per day, older days kept and searchable; any page can be pinned to stay on top. */
const notesFile = (pid) => `notes-${pid}.bin`;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function notesDb(pid) {
  const v = store.raw.readSecure(notesFile(pid), { pages: {} });
  if (!v.pages) {   // older single pad: keep it as a pinned page so nothing is lost
    const pages = {}; if (v.text) pages['earlier'] = { text: v.text, at: v.at, pinned: true, title: 'Earlier notes' };
    return { pages };
  }
  return v;
}
const notes = {
  get(pid, day = dayKey()) {
    const db = notesDb(pid), p = db.pages[day] || { text: '' };
    const days = Object.entries(db.pages).filter(([, v]) => (v.text || '').trim()).map(([k, v]) => ({ day: k, title: v.title || null, pinned: !!v.pinned, at: v.at })).sort((a, b) => (b.day > a.day ? 1 : -1));
    return { day, text: p.text || '', pinned: !!p.pinned, title: p.title || null, at: p.at || null, days };
  },
  set(pid, day, text) {
    const db = notesDb(pid); const p = db.pages[day] || {};
    db.pages[day] = { ...p, text: String(text || '').slice(0, 20000), at: new Date().toISOString() };
    store.raw.writeSecure(notesFile(pid), db); return notes.get(pid, day);
  },
  pin(pid, day, on) { const db = notesDb(pid); db.pages[day] = { ...(db.pages[day] || { text: '' }), pinned: !!on }; store.raw.writeSecure(notesFile(pid), db); return notes.get(pid, day); },
  search(pid, q) {
    const s = String(q || '').trim().toLowerCase(); if (!s) return [];
    return Object.entries(notesDb(pid).pages).filter(([, v]) => (v.text || '').toLowerCase().includes(s)).map(([day, v]) => {
      const t = v.text, i = t.toLowerCase().indexOf(s);
      return { day, title: v.title || null, snippet: (i > 30 ? '…' : '') + t.slice(Math.max(0, i - 30), i + s.length + 50).replace(/\s+/g, ' ') + '…' };
    }).sort((a, b) => (b.day > a.day ? 1 : -1)).slice(0, 30);
  },
};

// For backups: every user's checklist and notes.
function exportAll(pids) { const o = {}; for (const id of pids) o[id] = { checklist: read(id), notes: notesDb(id) }; return o; }
function importAll(data) {
  for (const [id, v] of Object.entries(data || {})) {
    if (!/^[a-z0-9_-]+$/i.test(id)) continue;
    const cur = read(id), have = new Set(cur.map((i) => i.id));
    save(id, [...cur, ...(v.checklist || []).filter((i) => !have.has(i.id))]);
    const n = v.notes || {};
    const db = notesDb(id);
    if (n.pages) { for (const [k, p] of Object.entries(n.pages)) if (!db.pages[k] || !(db.pages[k].text || '').trim()) db.pages[k] = p; }
    else if (n.text && !db.pages.earlier) db.pages.earlier = { text: n.text, at: n.at, pinned: true, title: 'Earlier notes' };
    store.raw.writeSecure(notesFile(id), db);
  }
}

module.exports = { list, add, toggle, star, setDue, reorder, remove, dueNow, parse, notes, dayKey, exportAll, importAll };
