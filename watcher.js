// Watches RxNT for schedule changes (new bookings, cancellations, reschedules,
// no-shows, check-ins) and raises alerts. Runs every few minutes while the app
// is open (it keeps running from the system tray when the window is closed).
const { Notification, nativeImage } = require('electron');
const path = require('path');
const ICON = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon-256.png'));
const store = require('./store');
const ringrx = require('./ringrx');

let recheck = null, timer = null, running = false, onEvent = () => {}, getProfile = () => null, loadDay = null, afterCheck = () => {};
let lastRun = null, lastError = null;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const name = (a) => `${a.first} ${a.last}`.trim();
// RxNT statuses: Completed, Check-In Completed, Called, Intake Completed, Rescheduled, Pending, Waitlist,
// Booked, Canceled, Deleted, No Show, Confirmed, Missed, Late Cancellation.
const isCancel = (a) => /cancel|delet/i.test(a.statusText) || (!a.statusText && /^(CAN|CNL|CXL|CC|DEL|LC)/i.test(a.statusCode));
const isNoShow = (a) => /no.?show|missed/i.test(a.statusText) || (!a.statusText && /^(NS|MIS)/i.test(a.statusCode));
const isSeen = (a) => /^(completed|check-?in completed)$/i.test(String(a.statusText).trim()) || (!a.statusText && /^(CKC|COM|CMP)/i.test(a.statusCode));

// Pairs each new booking with at most one earlier visit of the same patient that went away (removed or
// cancelled), the nearest in time, so a patient with several bookings can't get a wrong "rescheduled from".
function pairMoves(newOnes, goneOnes) {
  const pairs = new Map(), used = new Set();
  const cand = newOnes.map((n) => goneOnes.filter((g) => g.patientId === n.patientId).map((g) => ({ n, g, d: Math.abs(new Date(n.start) - new Date(g.start)) })))
    .flat().sort((x, y) => x.d - y.d);
  for (const { n, g } of cand) { if (pairs.has(n.appointmentId) || used.has(g.appointmentId)) continue; pairs.set(n.appointmentId, g); used.add(g.appointmentId); }
  return pairs;
}

function diff(prev, cur, prevRange) {
  const events = [];
  const inPrev = (date) => prevRange && date >= prevRange.from && date <= prevRange.to;
  const today = ymd(new Date());
  const added = Object.values(cur).filter((a) => !prev[a.appointmentId] && inPrev(a.date));
  // Visits that went away since last time: no longer listed, or newly cancelled.
  const gone = [...Object.values(prev).filter((p) => !cur[p.appointmentId] && p.date >= today && inPrev(p.date)),
    ...Object.values(cur).filter((x) => isCancel(x) && prev[x.appointmentId] && !isCancel(prev[x.appointmentId]))];
  const moves = pairMoves(added.filter((a) => !isCancel(a)), gone);
  const movedFrom = new Set([...moves.values()].map((g) => g.appointmentId));
  for (const a of added) {
    // RxNT often "moves" a visit by cancelling it and booking a new one. Same patient + same time = just an edit.
    const twin = Object.values(cur).find((x) => x !== a && x.patientId === a.patientId && x.start === a.start && isCancel(x));
    if (twin && !isCancel(a)) { events.push({ kind: 'rebooked', appt: a, text: `${name(a)} rebooked for ${when(a.start)}`, quiet: true }); continue; }
    if (isCancel(a)) continue;
    const from = moves.get(a.appointmentId);
    if (from && from.start !== a.start) events.push({ kind: 'rescheduled', appt: a, text: `${name(a)} rescheduled from ${when(from.start)} to ${when(a.start)}` });
    else if (!from) events.push({ kind: 'new', appt: a, text: `New appointment: ${name(a)}, ${when(a.start)}${a.visitType ? ' · ' + a.visitType : ''}` });
  }
  for (const [id, a] of Object.entries(cur)) {
    const p = prev[id]; if (!p) continue;
    // Same visit moved to a new time (no cancel/rebook in RxNT): that's a reschedule too.
    if (p.start !== a.start && !isCancel(a) && !isNoShow(a)) { events.push({ kind: 'rescheduled', appt: a, text: `${name(a)} rescheduled from ${when(p.start)} to ${when(a.start)}` }); continue; }
    if (p.statusCode === a.statusCode) continue;
    if (isCancel(a)) { if (!movedFrom.has(id)) events.push({ kind: 'cancelled', appt: a, text: `Cancelled: ${name(a)}, ${when(a.start)}` }); }
    else if (isNoShow(a)) events.push({ kind: 'noshow', appt: a, text: `No-show: ${name(a)}, ${when(a.start)}` });
    else if (isSeen(a) && !isSeen(p)) events.push({ kind: 'checkin', appt: a, text: `Checked in: ${name(a)}`, quiet: true });
    else events.push({ kind: 'status', appt: a, text: `${name(a)}: ${p.statusText || p.statusCode} → ${a.statusText || a.statusCode}`, quiet: true });
  }
  for (const [id, p] of Object.entries(prev)) {
    if (cur[id] || p.date < today || !inPrev(p.date) || movedFrom.has(id)) continue;   // moved: reported as rescheduled above
    events.push({ kind: 'cancelled', removed: true, appt: p, text: `Removed from schedule: ${name(p)}, ${when(p.start)}` });
  }
  return events;
}

async function check({ silent = false } = {}) {
  if (running) return { busy: true };
  const settings = store.settings.get();
  const pid = getProfile();
  if (!pid || !settings.rxntConnected?.[pid]) return { skipped: 'RxNT not connected' };
  running = true; onEvent({ type: 'watch-status', running: true });
  try {
    const days = Math.max(1, Math.min(31, settings.watch.daysAhead || 7));
    const start = new Date(); const cur = {}; let all = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const r = await loadDay(ymd(d));
      if (r.needsLogin) throw new Error('RxNT signed out. Sign in again to keep alerts running.');
      if (r.error) throw new Error(r.error);
      for (const a of r.items) { cur[a.appointmentId] = { ...a, date: ymd(d) }; all.push(a); }
    }
    const lastDay = new Date(start); lastDay.setDate(lastDay.getDate() + days - 1);
    const range = { from: ymd(start), to: ymd(lastDay) };
    const state = store.watchState.get(), prevSnap = state.snapshot || {};
    // Guard against half-loaded reads: a day that suddenly lost most of its visits is re-checked, not believed.
    const byDay = (snap) => { const m = {}; Object.values(snap).forEach((a) => { m[a.date] = (m[a.date] || 0) + 1; }); return m; };
    const was = byDay(prevSnap), now = byDay(cur), suspect = new Set();
    const strikes = { ...(state.suspect || {}) };
    for (const [d, n] of Object.entries(was)) {
      if (d >= range.from && n >= 2 && (now[d] || 0) <= Math.floor(n / 2)) { strikes[d] = (strikes[d] || 0) + 1; if (strikes[d] < 3) suspect.add(d); }   // believed after 3 reads in a row
      else delete strikes[d];
    }
    for (const [id, a] of Object.entries(prevSnap)) if (suspect.has(a.date) && !cur[id]) cur[id] = a;   // keep what we knew
    const events = state.snapshot ? diff(prevSnap, cur, state.range) : [];
    // Cancellations and removals must be seen twice, a few minutes apart, before anyone hears about them.
    const isCx = (e) => e.kind === 'cancelled' || e.kind === 'noshow';
    const stillTrue = (e) => { const a = cur[e.appt.appointmentId]; return e.removed ? !a : !!a && (e.kind === 'noshow' ? isNoShow(a) : isCancel(a)); };
    // Same-day/next-day changes confirm on the next read; later visits wait 20 minutes, because staff usually
    // cancel and rebook in one go and that should arrive as one "rescheduled", not two alerts.
    const hold = (e) => { const d = (new Date(new Date(e.appt.start).toDateString()) - new Date(new Date().toDateString())) / 864e5; return d <= 1 ? 90000 : 20 * 60000; };
    // A visit that vanished outright (RxNT normally keeps cancelled visits, marked Canceled) is more likely a bad
    // read, so it must still be gone on at least 3 reads, 10+ minutes apart in total, even on a one-visit day.
    const still = (state.pending || []).filter((p) => stillTrue(p.e)).map((p) => ({ ...p, n: (p.n || 1) + 1 }));   // n = reads it has held true
    const ready = (p) => Date.now() - p.seen >= (p.e.removed ? Math.max(hold(p.e), 10 * 60000) : hold(p.e)) && (!p.e.removed || p.n >= 3);
    const confirmed = still.filter(ready).map((p) => p.e);
    const waiting = still.filter((p) => !ready(p));
    const fresh = events.filter(isCx).filter((e) => ![...confirmed, ...waiting.map((p) => p.e)].some((x) => x.appt.appointmentId === e.appt.appointmentId && x.kind === e.kind));
    const pending = [...waiting, ...fresh.map((e) => ({ e, seen: Date.now(), n: 1 }))];
    // A cancellation we already reported that turns out to still be scheduled gets a correction.
    const corrections = [];
    for (const old of state.alerts || []) {
      if (!isCx(old) || old.handled || old.corrected || !old.appt || Date.now() - new Date(old.at) > 3 * 864e5) continue;
      const a = cur[old.appt.appointmentId];
      if (a && !isCancel(a) && !isNoShow(a)) { old.corrected = true; old.handled = true; corrections.push({ kind: 'correction', appt: a, text: `Correction: ${name(a)} is still scheduled, ${when(a.start)}` }); }
    }
    // Cancel + rebook for the same patient = one "Rescheduled" (whether the rebooking comes in now or arrived earlier).
    let out = [...events.filter((e) => !isCx(e)), ...confirmed, ...corrections];
    const pid = (e) => e.appt && e.appt.patientId;
    const pendingCx = [...waiting.map((p) => p.e), ...fresh], usedCx = new Set();
    const near = (list, nw) => list.filter((c) => pid(c) === pid(nw) && !usedCx.has(c)).sort((x, y) => Math.abs(new Date(x.appt.start) - new Date(nw.appt.start)) - Math.abs(new Date(y.appt.start) - new Date(nw.appt.start)))[0];
    for (const nw of out.filter((e) => e.kind === 'new')) {
      const cx = near(pendingCx, nw) || near(confirmed, nw);
      const earlier = cx ? null : near((state.alerts || []).filter((a) => isCx(a) && !a.handled && Date.now() - new Date(a.at) < 864e5), nw);
      if (cx) usedCx.add(cx); if (earlier) usedCx.add(earlier);
      const from = cx || earlier; if (!from) continue;
      out = out.filter((e) => e !== nw && e !== cx);
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].e === cx) pending.splice(i, 1);
      if (earlier) earlier.handled = true;
      out.push({ kind: 'rescheduled', appt: nw.appt, text: `${name(nw.appt)} rescheduled from ${when(from.appt.start)} to ${when(nw.appt.start)}` });
    }
    const stamped = out.map((e) => ({ ...e, at: new Date().toISOString(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }));
    // A visit cancelled earlier and now rebooked at the same time: if that cancellation was already reported,
    // say it's back on the schedule; either way the old "cancelled" alert no longer needs you.
    for (const e of stamped.filter((x) => x.kind === 'rebooked')) (state.alerts || []).forEach((old) => {
      if (old.kind === 'cancelled' && !old.handled && old.appt && old.appt.patientId === e.appt.patientId && old.appt.start === e.appt.start) {
        old.handled = true; e.quiet = false; e.kind = 'backon'; e.text = `Back on the schedule: ${name(e.appt)}, ${when(e.appt.start)}`;
      }
    });
    store.watchState.set({ snapshot: cur, range, pending, suspect: Object.fromEntries(Object.entries(strikes).filter(([d]) => suspect.has(d))), alerts: [...stamped, ...(state.alerts || [])].slice(0, 500), unread: (state.unread || 0) + stamped.filter((e) => !e.quiet).length });
    lastRun = new Date().toISOString(); lastError = null;
    if (stamped.length) { onEvent({ type: 'alerts', events: stamped }); if (!silent) deliver(stamped); }
    if (pending.length || suspect.size) { clearTimeout(recheck); recheck = setTimeout(() => check(), 3 * 60000); }   // confirm soon
    return { ok: true, events: stamped.length };
  } catch (e) {
    lastError = e.message;
    return { error: e.message };
  } finally {
    running = false;
    onEvent({ type: 'watch-status', running: false, lastRun, lastError });
    try { afterCheck(); } catch {}
  }
}

// The app's sync planner (main.js) decides when to check; this only runs the first check after start.
function schedule() {
  clearTimeout(timer);
  if (!store.settings.get().watch.enabled) return;
  timer = setTimeout(() => check({ silent: !store.watchState.get().snapshot }), 4000);
}


/* ---------- Delivery: three levels ----------
   Now  – visit starting soon; confirmed change for today or tomorrow; corrections of those. Pops up at once;
          texts (if chosen) only during office hours.
   Soon – everything else worth knowing: bundled into one notification every 30 minutes, never texted.
   FYI  – quiet events: shown in the app only. */
const PREF_KEY = { backon: 'schedule', rx: 'rx', new: 'schedule', cancelled: 'schedule', noshow: 'schedule', rescheduled: 'schedule', correction: 'schedule', optout: 'reply', confirmed: 'reply', reply: 'reply', soon: 'soon', newpatient: 'newpatient', portal: 'reply' };
const TEXT_LABEL = { backon: 'Back on the schedule', rx: 'Prescription waiting', new: 'New booking', cancelled: 'Cancellation', rescheduled: 'Reschedule', noshow: 'No-show', correction: 'Correction: still scheduled', optout: 'Patient replied STOP', confirmed: 'Patient confirmed', reply: 'New patient text', soon: 'Starting soon', newpatient: 'New patient registered', portal: 'RxNT portal message' };
const SCHEDULE_KINDS = ['new', 'cancelled', 'noshow', 'rescheduled', 'correction'];
function tierOf(e) {
  if (e.quiet) return 'fyi';
  if (e.kind === 'rx') return 'now';
  if (e.kind === 'soon') return 'now';
  if (SCHEDULE_KINDS.includes(e.kind) && e.appt && e.appt.start) {
    const days = (new Date(new Date(e.appt.start).toDateString()) - new Date(new Date().toDateString())) / 864e5;
    if (days >= 0 && days <= 1) return 'now';
  }
  return 'soon';
}
function officeHours(d = new Date()) {
  const s = store.settings.get().sync || {}, hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.getDay() >= 1 && d.getDay() <= 5 && hm >= (s.busyStart || '08:00') && hm < (s.busyEnd || '17:00');
}
function popup(title, lines, target = { view: 'today' }) {
  if (!lines.length || !Notification.isSupported()) return;
  const n = new Notification({ title, body: lines.slice(0, 4).join('\n') + (lines.length > 4 ? `\n+${lines.length - 4} more` : ''), icon: ICON, silent: !store.settings.get().sound });
  n.on('click', () => onEvent({ type: 'open-alerts', target }));
  n.show();
}
// Where a click on an alert should land: the exact place to act on it.
function targetOf(e) {
  if (!e) return { view: 'today' };
  if (e.kind === 'reply' || e.kind === 'optout' || e.kind === 'confirmed') return { view: 'texts', phone: e.phone || (e.appt && e.appt.phone) };
  if (e.kind === 'portal' || e.kind === 'rx') return { view: 'rx' };
  if (e.kind === 'newpatient') return { view: 'patients' };
  if (e.appt && e.appt.start) return { view: 'visits', date: new Date(e.appt.start).toISOString().slice(0, 10) };
  return { view: 'today' };
}
let digest = [];
setInterval(() => { if (digest.length) { const d = digest; digest = []; popup(d.length === 1 ? (TEXT_LABEL[d[0].kind] || 'Update') : `${d.length} updates`, d.map((e) => e.text), d.length === 1 ? targetOf(d[0]) : { view: 'today' }); } }, 30 * 60000);

function deliver(events) {
  const settings = store.settings.get(), prefs = settings.alertPrefs || {}, pid = getProfile();
  const wants = (e, ch) => (prefs[PREF_KEY[e.kind]] || {})[ch];
  const now = events.filter((e) => tierOf(e) === 'now' && wants(e, 'desk'));
  digest.push(...events.filter((e) => tierOf(e) === 'soon' && wants(e, 'desk')));
  popup(now.length === 1 ? (TEXT_LABEL[now[0].kind] || 'Update') : `${now.length} updates`, now.map((e) => e.text), now.length === 1 ? targetOf(now[0]) : { view: 'today' });
  const text = events.filter((e) => tierOf(e) === 'now' && wants(e, 'text'));
  if (text.length && officeHours() && pid && ringrx.status(pid).connected) ringrx.alertNumber(pid).then((to) => {
    if (!to) return;
    const lines = text.slice(0, 5).map((e) => `${TEXT_LABEL[e.kind] || 'Update'}${e.appt && e.appt.start ? ': ' + when(e.appt.start) : ''}`);
    return ringrx.sendSms(pid, to, `Ruhwell Front Desk\n${lines.join('\n')}${text.length > 5 ? `\n+${text.length - 5} more` : ''}\nOpen the app for details.`);
  }).catch(() => {});
}

module.exports = {
  init(opts) { onEvent = opts.onEvent; getProfile = opts.getProfile; loadDay = opts.loadDay; afterCheck = opts.afterCheck || afterCheck; schedule(); },
  reschedule: schedule,
  check,
  status: () => ({ running, lastRun, lastError, enabled: store.settings.get().watch.enabled }),
  alerts: () => store.watchState.get().alerts || [],
  // Events from elsewhere (e.g. STOP / confirm replies) shown alongside schedule alerts.
  addEvents(events) {
    const stamped = events.map((e) => ({ ...e, at: new Date().toISOString(), id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }));
    const st = store.watchState.get();
    store.watchState.set({ ...st, alerts: [...stamped, ...(st.alerts || [])].slice(0, 500), unread: (st.unread || 0) + stamped.length });
    onEvent({ type: 'alerts', events: stamped });
    deliver(stamped);
  },
  deliver,
  officeHours,
  handle(id, on = true) { const s = store.watchState.get(); (s.alerts || []).forEach((a) => { if (a.id === id) a.handled = on; }); store.watchState.set(s); },
  markRead() { const s = store.watchState.get(); s.unread = 0; store.watchState.set(s); },
  unread: () => store.watchState.get().unread || 0,
};
