// Calls & texts: everything the practice line sends and receives, from RingRx, organized into one
// conversation per phone number, plus what still needs a reply or a callback.
const store = require('./store');
const ringrx = require('./ringrx');

const DAY = 864e5;
const d10 = (v) => { const x = String(v || '').replace(/\D/g, ''); return x.length >= 10 ? x.slice(-10) : ''; };
const STOP_RE = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout|opt out)\s*[.!]*\s*$/i;
const CONFIRM_RE = /^\s*(c|confirm|confirmed|yes|y)\s*[.!]*\s*$/i;
let running = false;

// Pull texts, voicemails, calls and contacts from RingRx (last 90 days). Returns new inbound texts for reply handling.
async function sync(pid) {
  if (running || !pid || !ringrx.status(pid).connected) return { skipped: true };
  running = true;
  const since = Date.now() - 90 * DAY, keep = (x) => new Date(x.at) >= since;
  const prevTexts = store.ringrxHistory.get(), prevCalls = store.calls.get();
  let fresh = [], ok = true;
  try {
    const [msgs, calls, contacts] = await Promise.all([
      ringrx.messages(pid, new Date(since).toISOString()), ringrx.calls(pid, 90), ringrx.contacts(pid).catch(() => null),
    ]);
    if (msgs === null) { ok = false; store.ringrxHistory.set({ ...prevTexts, error: 'unavailable', failedAt: new Date().toISOString() }); }
    else {
      const texts = msgs.filter((m) => m.kind === 'text');
      const known = new Set((prevTexts.items || []).map((m) => m.id));
      fresh = texts.filter((m) => m.inbound && !known.has(m.id));
      store.ringrxHistory.set({ items: texts.filter(keep), at: new Date().toISOString(), error: null, v: 2 });
    }
    if (calls === null) { ok = false; store.calls.set({ ...prevCalls, error: 'unavailable', failedAt: new Date().toISOString() }); }
    else {
      // Voicemails come as messages; attach each to its call (same number within 10 minutes) or add it on its own.
      const list = calls.filter(keep);
      for (const vm of (msgs || []).filter((m) => m.kind === 'voicemail')) {
        const t = new Date(vm.at).getTime();
        const call = list.find((c) => c.inbound && c.phone === vm.phone && Math.abs(new Date(c.at) - t) < 10 * 60000);
        if (call) Object.assign(call, { voicemail: true, missed: true, transcription: vm.transcription, vmId: vm.id, media: vm.media });
        else list.push({ id: 'vm-' + vm.id, inbound: true, phone: vm.phone, at: vm.at, secs: 0, answered: false, voicemail: true, missed: true, transcription: vm.transcription, vmId: vm.id, media: vm.media });
      }
      store.calls.set({ items: list, at: new Date().toISOString(), error: null, v: 2 });
    }
    if (contacts) store.ringrxContacts.set({ items: contacts.filter((c) => c.type !== 'directory'), at: new Date().toISOString() });
  } catch (e) {
    ok = false;
    try { store.ringrxHistory.set({ ...store.ringrxHistory.get(), error: 'failed', failedAt: new Date().toISOString() }); } catch {}
  } finally { running = false; }
  // A failed pull keeps the old texts/calls but says so (their "at" stays at the last success).
  try { spamCleanup(); } catch {}
  return { fresh, ok };
}

// Who is behind a number: RxNT patient(s) (main phone or a linked extra number), else a RingRx contact.
function directory() {
  const byPhone = {};
  for (const p of Object.values(store.patients.all())) {
    for (const ph of [p.phone, ...(p.otherPhones || [])].map(d10).filter(Boolean)) (byPhone[ph] = byPhone[ph] || []).push(p);
  }
  const contacts = {};
  for (const c of store.ringrxContacts.get().items || []) for (const n of c.numbers) contacts[n] = c;
  return (phone) => {
    const hits = byPhone[phone] || [];
    if (hits.length === 1) { const p = hits[0]; return { kind: p.pending ? 'pending' : 'patient', name: `${p.first || ''} ${p.last || ''}`.trim() || phone, key: p.key, dnt: !!p.dnt }; }
    if (hits.length > 1) return { kind: 'shared', name: hits.map((p) => p.first || p.last).filter(Boolean).slice(0, 3).join(', '), keys: hits.map((p) => p.key), count: hits.length, dnt: hits.some((p) => p.dnt) || optedOut(phone) };
    if (contacts[phone]) return { kind: 'contact', name: contacts[phone].name, org: contacts[phone].org };
    return { kind: 'unknown', name: '' };
  };
}

// One timeline per phone number: texts both ways (Front Desk and RingRx app) plus calls and voicemails.
function events() {
  const local = store.log.all().filter((h) => h.ok).map((h) => ({ id: 'fd-' + h.at + h.phone, type: 'text', inbound: false, phone: d10(h.phone), at: h.at, body: h.message || '', via: 'Front Desk', by: h.sentBy || '', template: h.template || '' }));
  const rr = (store.ringrxHistory.get().items || []).filter((m) => m.v !== undefined || m.kind || true).map((m) => ({ id: m.id, type: 'text', inbound: !!m.inbound, phone: m.phone, at: m.at, body: m.body || '', via: m.inbound ? '' : 'RingRx', unread: m.unread }));
  // A text sent from Front Desk also shows up in RingRx's sent folder: keep the Front Desk copy.
  const outRR = rr.filter((m) => !m.inbound && !local.some((h) => h.phone === m.phone && Math.abs(new Date(h.at) - new Date(m.at)) < 10 * 60000));
  const calls = (store.calls.get().items || []).map((c) => ({ ...c, type: c.voicemail ? 'voicemail' : 'call' }));
  return [...local, ...outRR, ...rr.filter((m) => m.inbound), ...calls].filter((e) => e.phone);
}

// Done marks: "<phone>@<time>" — anything from them before that time is handled.
function doneMap() {
  const m = {};
  for (const d of store.callbacks.get().done || []) { const [k, at] = String(d).split('@'); if (at) m[k] = Math.max(m[k] || 0, Number(at)); }
  return m;
}
const recentOpen = (e, handledAt) => new Date(e.at).getTime() > (handledAt || 0) && Date.now() - new Date(e.at) < 14 * DAY;

// Texts tab: one conversation per number (texts only), newest first.
// "Needs reply" = their last text came after our last text, isn't STOP/confirm, and wasn't marked done.
function textThreads(days = 30) {
  const who = directory(), done = doneMap(), seen = store.callbacks.get().seen || {}, skip = ignored(), since = Date.now() - days * DAY, by = {};
  for (const e of events().filter((x) => x.type === 'text')) (by[e.phone] = by[e.phone] || []).push(e);
  const out = [];
  for (const [phone, list] of Object.entries(by)) {
    list.sort((a, b) => new Date(a.at) - new Date(b.at));
    const last = list[list.length - 1];
    if (new Date(last.at) < since) continue;
    const lastOut = [...list].reverse().find((e) => !e.inbound), lastIn = [...list].reverse().find((e) => e.inbound);
    const open = list.filter((e) => e.inbound && (!lastOut || new Date(e.at) > new Date(lastOut.at)) && !STOP_RE.test(e.body) && !CONFIRM_RE.test(e.body) && recentOpen(e, done['t:' + phone]));
    const w = who(phone), spam = isSpam(phone, w);
    const answer = lastIn && last.inbound ? answerOf(lastIn, list, done['t:' + phone]) : lastIn ? answerOf(lastIn, list, done['t:' + phone]) : null;
    out.push({ phone, who: w, spam, answer, last: { inbound: last.inbound, at: last.at, body: last.body },
      lastIn: lastIn ? { at: lastIn.at, body: lastIn.body } : null,
      lastSent: lastOut ? { at: lastOut.at, body: lastOut.body } : null, needs: open.length && !w.dnt && !skip.has(phone) && !spam ? 'reply' : null, ignored: skip.has(phone), needsAt: open.length ? open[open.length - 1].at : null, unread: spam ? 0 : list.filter((e) => e.inbound && new Date(e.at) > (seen[phone] || 0)).length, readAt: seen[phone] || null, count: list.length });
  }
  return out.sort((a, b) => new Date(b.last.at) - new Date(a.last.at));
}

// Calls tab: every call (and voicemail) with who it was, plus which still need a callback:
// a missed call or voicemail with no later call out or text to that number, not marked done.
function callList(days = 30) {
  const who = directory(), done = doneMap(), skip = ignored(), since = Date.now() - days * DAY, heard = store.callbacks.get().heard || {};
  const all = events();
  const calls = all.filter((e) => e.type !== 'text').sort((a, b) => new Date(b.at) - new Date(a.at));
  const dueSeen = new Set();
  return calls.filter((c) => new Date(c.at) >= since).map((c) => {
    let due = false; const w = who(c.phone), spam = isSpam(c.phone, w);
    if (c.missed && !spam && !skip.has(c.phone) && !dueSeen.has(c.phone) && recentOpen(c, done['c:' + c.phone])) {
      const t = new Date(c.at);
      const answered = all.some((x) => x.phone === c.phone && new Date(x.at) > t && (!x.inbound || (x.type === 'call' && x.answered)));
      if (!answered) { due = true; dueSeen.add(c.phone); }
    }
    const answer = c.inbound && (c.missed || c.voicemail) ? answerOf(c, all, done['c:' + c.phone]) : null;
    return { ...c, who: w, due, spam, answer, heardAt: c.voicemail ? heard[c.id] || null : null };
  });
}

function thread(phone) { return events().filter((e) => e.phone === phone && e.type === 'text').sort((a, b) => new Date(a.at) - new Date(b.at)); }
// kind: 't' (texts) or 'c' (calls)
// Snooze (hide an item until a time) and ignore (a number never needs attention: sales, spam).
function snooze(key, until) { const c = store.callbacks.get(); c.snooze = Object.fromEntries(Object.entries({ ...(c.snooze || {}), [key]: until }).filter(([, t]) => t > Date.now())); store.callbacks.set(c); }
const snoozes = () => Object.fromEntries(Object.entries(store.callbacks.get().snooze || {}).filter(([, t]) => t > Date.now()));
function ignore(phone, on = true) { const c = store.callbacks.get(), set = new Set(c.ignored || []); on ? set.add(phone) : set.delete(phone); c.ignored = [...set]; store.callbacks.set(c); }
const ignored = () => new Set(store.callbacks.get().ignored || []);
// Spam: remembered for good (callbacks store is encrypted and backed up). A patient's number is never treated
// as spam: if a saved spam number turns out to be a patient's, it's taken off the list and flagged once.
const spamMap = () => store.callbacks.get().spam || {};
function markSpam(phone, on = true, force = false) { const c = store.callbacks.get(), m = { ...(c.spam || {}) }; if (on) m[phone] = force ? -Date.now() : Date.now(); else delete m[phone]; c.spam = m; store.callbacks.set(c); }   // negative time = she confirmed it even though it's a patient's number
function spamList() { const who = directory(); return Object.entries(spamMap()).map(([phone, at]) => ({ phone, at: Math.abs(at), forced: at < 0, who: who(phone) })).sort((a, b) => b.at - a.at); }
// Spam numbers that now belong to a patient: un-spam them and report them once.
function spamCleanup(who = directory()) {
  const m = spamMap(), hit = Object.keys(m).filter((ph) => m[ph] > 0 && ['patient', 'pending', 'shared'].includes(who(ph).kind));
  if (!hit.length) return [];
  const c = store.callbacks.get(); c.spam = Object.fromEntries(Object.entries(m).filter(([ph]) => !hit.includes(ph))); c.spamReview = [...new Set([...(c.spamReview || []), ...hit])]; store.callbacks.set(c);
  return hit;
}
const isSpam = (phone, w) => { const v = spamMap()[phone]; return !!v && (v < 0 || !['patient', 'pending', 'shared'].includes((w || {}).kind)); };
// Listened marks for voicemails: id -> time first played (or transcript opened).
function markHeard(id) { const c = store.callbacks.get(); if ((c.heard || {})[id]) return; c.heard = { ...(c.heard || {}), [id]: Date.now() }; const keys = Object.keys(c.heard); if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete c.heard[k]; store.callbacks.set(c); }
function unmarkHeard(id) { const c = store.callbacks.get(); if (c.heard) delete c.heard[id]; store.callbacks.set(c); }
function unmarkSeen(phone) { const c = store.callbacks.get(); if (c.seen) delete c.seen[phone]; store.callbacks.set(c); }
// How an incoming call/voicemail/text got answered: the first later call out, text out, or answered call back in.
function answerOf(e, all, handledAt) {
  const t = new Date(e.at);
  const nx = all.filter((x) => x.phone === e.phone && new Date(x.at) > t && (!x.inbound || (x.type === 'call' && x.answered && e.type !== 'text'))).sort((a, b) => new Date(a.at) - new Date(b.at))[0];
  if (nx) return { how: nx.type === 'text' ? 'texted back' : nx.inbound ? 'talked' : 'called back', at: nx.at };
  if (handledAt && handledAt > t.getTime()) return { how: 'handled', at: new Date(handledAt).toISOString() };
  return null;
}
// Read marks: opening a conversation clears its dot (it can still need a reply).
function markSeen(phone) { const c = store.callbacks.get(); c.seen = { ...(c.seen || {}), [phone]: Date.now() }; store.callbacks.set(c); }
// True when an item was marked done after the given time (used for RxNT portal conversations too).
// Undo a "done" (the last few seconds' click): forget when it was marked.
function unmarkDone(kind, id) { const k = `${kind}:${id}@`; const c = store.callbacks.get(); c.done = (c.done || []).filter((d) => !String(d).startsWith(k)); store.callbacks.set(c); }
const doneSince = (key, iso) => (doneMap()[key] || 0) > new Date(iso).getTime();
function markDone(kind, phone) { const k = `${kind}:${phone}`; const c = store.callbacks.get(); c.done = [...(c.done || []).filter((d) => !String(d).startsWith(k + '@')), `${k}@${Date.now()}`].slice(-3000); store.callbacks.set(c); }
// Texts badge = conversations with something unread that still needs a reply (drops as soon as you open one).
const counts = () => ({ texts: textThreads(14).filter((t) => t.needs && t.unread).length, calls: callList(14).filter((c) => c.due || (c.voicemail && !c.heardAt && !c.spam && Date.now() - new Date(c.at) < 3 * DAY)).length });

// Numbers that replied STOP. The number itself is blocked, for everyone who uses it (siblings, a parent's phone).
const optedOut = (phone) => !!((store.inbound.get().optOut || {})[String(phone || '').replace(/\D/g, '').slice(-10)]);
function clearOptOut(phones) { const st = store.inbound.get(), o = { ...(st.optOut || {}) }; phones.forEach((ph) => delete o[ph]); store.inbound.set({ ...st, optOut: o }); }
const fullName = (p) => `${p.first || ''} ${p.last || ''}`.trim();

// Replies: STOP blocks the number (always); recent "C" replies confirm the visit that was actually reminded.
// On a number shared by several patients, nothing is pinned on one of them by guesswork.
function handleReplies(fresh, addEvents) {
  if (!fresh || !fresh.length) return;
  const st = store.inbound.get(), all = Object.values(store.patients.all()), events = [];
  const recent = (m) => Date.now() - new Date(m.at) < 3 * DAY;
  // Oldest first, so a later STOP always wins over an earlier START (and vice versa).
  for (const m of [...fresh].sort((a, b) => new Date(a.at) - new Date(b.at))) {
    const hits = all.filter((x) => x.phone === m.phone || (x.otherPhones || []).includes(m.phone)), p = hits.length === 1 ? hits[0] : null;
    const who = hits.length > 1 ? `${hits.map((x) => x.first || x.last).filter(Boolean).slice(0, 3).join(', ')} (shared number)` : p ? fullName(p) : m.phone;
    if (STOP_RE.test(m.body)) {
      const prev = (st.optOut || {})[m.phone];
      if (!prev || new Date(m.at) >= new Date(prev.at)) st.optOut = { ...(st.optOut || {}), [m.phone]: { at: m.at } };
      for (const x of hits) store.patients.update(x.key, { dnt: true, dntReason: 'Replied STOP', dntAt: new Date().toISOString() });
      if (!hits.length) store.patients.upsert([{ first: '', last: '', phone: m.phone, phoneSource: 'Typed', dnt: true, dntReason: 'Replied STOP' }]);
      if (recent(m)) events.push({ kind: 'optout', text: `Opted out: ${who} replied STOP`, appt: { first: p?.first, last: p?.last, phone: m.phone } });
    } else if (/^\s*(start|unstop)\s*[.!]?\s*$/i.test(m.body) && (st.optOut || {})[m.phone] && new Date(m.at) > new Date(st.optOut[m.phone].at)) {   // only a START sent after the STOP counts
      // They texted START: texts are allowed again on this number (the standard way to opt back in).
      const o = { ...(st.optOut || {}) }; delete o[m.phone]; st.optOut = o;
      for (const x of hits) if (x.dntReason === 'Replied STOP') store.patients.update(x.key, { dnt: false, dntReason: '' });
      if (recent(m)) events.push({ kind: 'reply', text: `${who} replied START (texts allowed again)`, appt: { first: p?.first, last: p?.last, phone: m.phone } });
    } else if (recent(m) && CONFIRM_RE.test(m.body)) {
      // Credit the confirmation to whoever was last texted on this number (the reminder), not just anyone on it.
      const sent = store.log.all().filter((h) => h.ok && h.phone === m.phone && new Date(h.at) <= new Date(m.at) && new Date(m.at) - new Date(h.at) < 4 * DAY).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
      const forName = sent ? sent.name : p ? fullName(p) : '';
      st.confirmed = { ...(st.confirmed || {}), [m.phone]: { at: m.at, name: forName } };
      events.push({ kind: 'confirmed', text: `Confirmed: ${forName || who} replied ${m.body.trim()}`, appt: { first: p?.first, last: p?.last, phone: m.phone } });
    } else if (recent(m)) {
      events.push({ kind: 'reply', text: `New text from ${who}`, appt: { first: p?.first, last: p?.last, phone: m.phone } });
    }
  }
  store.inbound.set(st);
  if (events.length) addEvents(events);
}

const status = () => { const h = store.ringrxHistory.get(), c = store.calls.get(); return { running, at: h.at, error: h.error || c.error, texts: (h.items || []).length, calls: (c.items || []).length }; };

module.exports = { markSpam, spamList, spamCleanup, spamMap, markHeard, unmarkHeard, unmarkSeen, answerOf, unmarkDone, optedOut, clearOptOut, sync, textThreads, callList, thread, markDone, doneSince, markSeen, snooze, snoozes, ignore, counts, handleReplies, status, events, directory, d10 };
