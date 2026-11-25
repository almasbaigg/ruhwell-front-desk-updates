let todayFaxes = [];
const FAX_IC = '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 14h10v6H7z"/></svg>';
let todayHadItems = false;
// Done on Today: one click counts once; if saving fails the row comes back and says so.
async function markTodayDone(it, btn, row) {
  if (btn.disabled) return; btn.disabled = true; btn.classList.add('ticked'); row.classList.add('leaving');
  let ok = true; try { const r = await it.done(); if (r === false || (r && r.error)) ok = false; } catch { ok = false; }
  if (!ok) { btn.disabled = false; btn.classList.remove('ticked'); row.classList.remove('leaving'); toast("Couldn't mark that done. It's still on your list."); return; }
  bumpDone(); setTimeout(loadToday, 320);
  if (it.key) toast('Marked done', async () => { await window.api.undoDone(it.key); bumpDone(-1); loadToday(); });
}   // so clearing the last item gets a small celebration, but opening to an empty list doesn't
/* Today: the home screen. The day at a glance, what needs attention, today's visits, checklist and notes. */
const ALERT = {
  new: { label: 'New booking', icon: '<path d="M12 5v14M5 12h14"/>', action: ['welcome', 'Send Welcome'] },
  rescheduled: { label: 'Rescheduled', icon: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>' },
  cancelled: { label: 'Cancelled', icon: '<path d="M6 6l12 12M18 6L6 18"/>', action: ['reschedule', 'Offer New Time'] },
  noshow: { label: 'No-show', icon: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', action: ['reschedule', 'Offer New Time'] },
  optout: { label: 'Opted out', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>' },
  confirmed: { label: 'Confirmed', icon: '<path d="M5 12l5 5L20 7"/>' },
  reply: { label: 'New Text', icon: '<path d="M4 20l1.2-4A8 8 0 1 1 8 19z"/>' },
  newpatient: { label: 'New Patient', icon: '<circle cx="10" cy="8" r="4"/><path d="M3 21c.8-4 3.6-6 7-6s6.2 2 7 6M19 8v6M16 11h6"/>', action: ['open', 'Open Patient'] },
  rebooked: { label: 'Rebooked', icon: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5"/>' },
  soon: { label: 'Starting soon', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
};
const hello = () => { const h = new Date().getHours(), n = (settings.userName || '').trim(); return (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (n ? `, ${n}` : ''); };

const byAge = (iso, amberH, redH) => { const h = hoursSince(iso); return h >= redH ? 'red' : h >= amberH ? 'amber' : 'green'; };
function urgency(i) {
  if (i.sec === 'rx') return i.rxItem ? rxUrgency(i.rxItem) : 'amber';
  if (i.sec === 'patients') return byAge(i.at, 1, 4);
  if (i.sec === 'callers') return byAge(i.at, 4, 48) === 'red' ? 'amber' : 'green';
  if (i.sec === 'schedule') { if (!i.apptStart) return 'amber'; const d = (new Date(new Date(i.apptStart).toDateString()) - new Date(new Date().toDateString())) / 864e5; return d <= 1 ? 'red' : 'amber'; }
  if (i.sec === 'fix') return (new Date(i.at) - Date.now()) / 864e5 <= 2 ? 'amber' : 'green';
  return 'green';
}

async function gatherToday() {
  const today = ymd(), tomorrow = addDays(today, 1);
  const [texts, calls, alerts, hist, pats, range, rx, st, snoozed, portal, woke] = await Promise.all([
    window.api.textThreads(30), window.api.callList(30), window.api.watchAlerts(), window.api.history(), window.api.patients(),
    window.api.rxntRange(today, 8), window.api.rxList(), window.api.syncStatus(), window.api.snoozes(), window.api.portalList(), window.api.woke ? window.api.woke() : {},
  ]);
  history = hist; patients = pats; indexPatients(patients); Object.assign(dayStore, range);
  const items = [];
  const WEEK = 7 * 864e5;
  // Texts and calls: patients first; numbers not in your patients get their own group (older than a week drop off here, still in Texts/Calls)
  for (const t of texts.filter((x) => x.needs)) {
    const unk = t.who.kind === 'unknown'; if (unk && Date.now() - new Date(t.needsAt) > WEEK) continue;
    items.push({ key: 't:' + t.phone, phone: t.phone, unk, sec: unk ? 'callers' : 'patients', at: t.needsAt, kind: 'text', icon: I.msg, title: t.who.name || fmtPhone(t.phone), sub: `“${String(t.last.body || '').slice(0, 90)}” · ${ago(t.needsAt)}`, action: ['Reply', () => openThread(t.phone)], done: () => window.api.markDone('t', t.phone) });
  }
  for (const c of calls.filter((x) => x.due)) {
    const unk = c.who.kind === 'unknown'; if (unk && Date.now() - new Date(c.at) > WEEK) continue;
    items.push({ key: 'c:' + c.phone, phone: c.phone, unk, sec: unk ? 'callers' : 'patients', at: c.at, kind: 'call', icon: I.phone, title: c.who.name || fmtPhone(c.phone), sub: `${c.voicemail ? 'Voicemail' + (c.transcription ? `: “${c.transcription.slice(0, 70)}”` : '') : 'Missed call'} · ${ago(c.at)}`, action: ['Text Back', () => openThread(c.phone)], done: () => window.api.markDone('c', c.phone) });
  }
  // RxNT portal messages from patients (the RxNT sidebar chat); replies happen in RxNT
  for (const c of (portal.conversations || []).filter((x) => x.needsReply && !x.done)) {
    items.push({ key: 'p:' + c.id, sec: 'patients', at: c.at, kind: 'text', icon: I.msg, title: c.title, tag: 'RxNT portal', sub: `“${String(c.excerpt || '').slice(0, 90)}” · ${ago(c.at)}`, action: ['Open in RxNT', () => window.api.openRxnt('messages')], done: () => window.api.portalDone(c.id) });
  }
  // Prescriptions needing action in RxNT (pended for the prescriber, refill requests, failed sends)
  // Time-sensitive: they show how long they've waited; Schedule II ones say they need Dr. Baig.
  for (const r of rx.items || []) items.push({ key: `rx:${r.kind}:${r.patient}`, rxItem: r, sec: 'rx', at: r.at || new Date().toISOString(), kind: 'rx', icon: I.pill, title: r.patient || 'Patient',
    tag: r.c2 ? 'Schedule II' : { refill: 'Refill request', pending: 'Pending Rx', failed: 'Failed to send' }[r.kind],
    sub: [r.c2 && 'Needs Dr. Baig', r.at && `waiting ${waitLabel(r.at)}`, r.med, r.pharmacy].filter(Boolean).join(' · ') || r.detail || 'Waiting in RxNT', action: ['Open in RxNT', () => window.api.openRxnt()] });
  // RxNT To-Do, only the critical ones and only when there's something
  const rc = rx.counts || {};
  const TODO = [['labs', 'lab result to review', 'lab results to review', 'red', 'RxNT To-Do'], ['unsigned', 'encounter to sign', 'encounters to sign', 'red', 'RxNT To-Do'],
    ['documents', 'document to review', 'documents to review', 'amber', 'RxNT To-Do'], ['referrals', 'referral', 'referrals', 'amber', 'RxNT To-Do'], ['tasks', 'patient task', 'patient tasks', 'amber', 'RxNT To-Do'],
    ['awaiting', 'visit awaiting billing', 'visits awaiting billing', 'amber', 'Billing'], ['unposted', 'payment to post', 'payments to post', 'amber', 'Billing']];
  // Unsigned notes, one per note, oldest first, with how long each has waited (red: they can't wait).
  const unsigned = (st && st.unsigned) || [];
  if (rc.unsigned > 0 && unsigned.length) {
    for (const n of unsigned.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
      const age = n.at ? Math.floor((Date.now() - new Date(n.at)) / 864e5) : null;
      items.push({ key: 'note:' + n.id, urg: 'red', sec: 'rx', at: n.at || new Date().toISOString(), kind: 'rx', icon: I.edit, title: `Sign note: ${n.first} ${n.last}`.trim(), tag: 'Unsigned',
        sub: [n.at && `visit ${fmtDateShort(n.at)}`, age === 0 ? 'from today' : age === 1 ? 'from yesterday' : age > 1 ? `${age} days` : '', n.complaint].filter(Boolean).join(' · '), action: ['Open in RxNT', () => window.api.openRxnt('unsigned')] });
    }
  }
  // New faxes waiting to be filed into a chart.
  const fx = (st && st.faxes) || {};
  todayFaxes = await window.api.faxList().catch(() => []);
  // New referrals from faxes: first "add the patient in RxNT", then (once the app finds them) "save the fax".
  for (const f of (todayFaxes || []).filter((x) => x.referral && x.status === 'new')) {
    const ready = f.referral.status === 'ready';
    items.push({ key: 'ref:' + f.id, urg: ready ? 'red' : 'amber', sec: 'faxes', at: f.referral.readyAt || f.referral.at, kind: 'fax', icon: FAX_IC,
      title: ready ? 'Referred patient is in RxNT now' : 'New referral: add patient in RxNT', tag: 'Referral',
      sub: ready ? 'Save their fax to the chart' : `${f.found && f.found.name ? 'Named on the fax · ' : ''}the app checks RxNT every 20 min`,
      action: ready ? ['Save to Chart', () => { go('faxes'); setTimeout(() => openFax(f.id), 300); }] : ['Open in RxNT', () => window.api.openRxnt ? window.api.openRxnt('patients') : go('faxes')] });
  }
  if (fx.count) items.push({ key: 'faxes', urg: 'amber', sec: 'faxes', at: fx.lastNewAt || new Date().toISOString(), kind: 'fax', icon: FAX_IC, title: `${fx.count} new fax${fx.count > 1 ? 'es' : ''}`, tag: 'Doximity', sub: 'Pick the patient and add it to their chart', action: ['Open Faxes', () => go('faxes')] });
  for (const [k, one, many, lvl, tag] of TODO) {
    if (k === 'unsigned' && unsigned.length) continue;   // listed one by one above
    if (rc[k] > 0) items.push({ key: 'todo:' + k, urg: lvl, sec: 'rx', at: new Date().toISOString(), kind: 'rx', icon: I.check, title: `${rc[k]} ${rc[k] > 1 ? many : one}`, tag,
      sub: { awaiting: 'Finish the encounter so the biller can bill it', unposted: 'Card charged, not applied to a visit yet' }[k] || 'Waiting in RxNT', action: ['Open in RxNT', () => window.api.openRxnt(tag === 'Billing' ? (k === 'awaiting' ? 'todo' : 'billing') : 'todo')] });
  }
  // Schedule changes that call for a message
  // A cancellation and a new booking for the same patient at the same time is RxNT moving the visit: not news.
  // One card per kind of news per appointment (older duplicates are folded in and marked done together).
  const openAll = alerts.filter((x) => !x.handled && !x.quiet && ALERT[x.kind] && ALERT[x.kind].action && Date.now() - new Date(x.at) < WEEK), dupIds = {};
  const open = openAll.filter((x) => { const k = x.appt && x.appt.appointmentId ? `${x.kind}|${x.appt.appointmentId}` : x.id; if (dupIds[k]) { dupIds[k].push(x.id); return false; } dupIds[k] = [x.id]; return true; });
  const handleAll = (a) => Promise.all((dupIds[a.appt && a.appt.appointmentId ? `${a.kind}|${a.appt.appointmentId}` : a.id] || [a.id]).map((id) => window.api.watchHandle(id)));
  const slot = (x) => `${(x.appt || {}).patientId}|${(x.appt || {}).start}`;
  const newSlots = new Set(open.filter((x) => x.kind === 'new').map(slot)), cxSlots = new Set(open.filter((x) => x.kind === 'cancelled').map(slot));
  const pool = Object.values(range || {}).flatMap((x) => x.items || []);
  const rebooked = (appt) => pool.some((v) => category(v) !== 'cancelled' && samePatient(v, appt) && v.appointmentId !== appt.appointmentId && Math.abs(new Date(v.start) - new Date(appt.start)) <= 14 * 864e5);
  for (const a of open.filter((x) => !((x.kind === 'new' && cxSlots.has(slot(x))) || (x.kind === 'cancelled' && (newSlots.has(slot(x)) || rebooked(x.appt || {})))))) {
    const A = ALERT[a.kind];
    if (a.kind === 'newpatient') { const p = patients.find((x) => x.key === a.key); items.push({ key: 'a:' + a.id, sec: 'schedule', at: a.at, kind: 'change', icon: `<svg viewBox="0 0 24 24">${A.icon}</svg>`, title: a.text.replace('New patient in RxNT: ', ''), tag: 'New Patient', sub: `Registered in RxNT · ${ago(a.at)}`, action: p ? ['Open Patient', () => { go('patients'); openPatient(p); }] : null, done: () => window.api.watchHandle(a.id) }); continue; }
    const appt = a.appt || {}, rec = recordFor(appt);
    if (rec && rec.dnt) continue;
    items.push({ key: 'a:' + a.id, apptStart: appt.start, sec: 'schedule', at: a.at, kind: 'change', icon: `<svg viewBox="0 0 24 24">${A.icon}</svg>`, title: `${A.label}: ${fullName(appt)}`, sub: `${appt.start ? fmtDateShort(appt.start) + ', ' + fmtTime(appt.start) : ''} · ${ago(a.at)}`,
      action: digits(appt.phone).length === 10 ? [A.action[1], () => messageModal({ ...appt, rec, cat: a.kind === 'new' ? 'pending' : 'cancelled' }, A.action[0])] : null, done: () => handleAll(a) });
  }
  // Batches: tomorrow's reminders, today's review requests
  const sentSinceDay = (phone, day) => history.some((h) => h.ok && digits(h.phone) === digits(phone) && new Date(h.at) >= parseYmd(day).getTime() - 864e5);
  const textable = (v) => { const r = recordFor(v); return digits((r && r.phoneSource === 'Typed' && r.phone) || v.phone).length === 10 && !(r && r.dnt); };
  const tm = ((range[tomorrow] || {}).items || []).filter((v) => ['booked', 'confirmed'].includes(stateOf(v)) && textable(v) && !sentSinceDay(v.phone, today));
  if (tm.length) items.push({ sec: 'send', at: new Date().toISOString(), kind: 'batch', icon: I.bell, title: `Send ${tm.length} reminder${tm.length > 1 ? 's' : ''} for tomorrow`, sub: tm.slice(0, 4).map(fullName).join(', ') + (tm.length > 4 ? ` +${tm.length - 4}` : ''), action: ['Review and send', () => { go('visits'); loadDay(tomorrow); }] });
  const td = (range[today] || {}).items || [];
  const rv = td.filter((v) => statusOf(v) === 'seen' && textable(v) && !lastReview(v.phone) && !sentSinceDay(v.phone, today));
  if (rv.length) items.push({ sec: 'send', at: new Date().toISOString(), kind: 'batch', icon: I.check, title: `Send ${rv.length} Google Review Request${rv.length > 1 ? "s" : ""}`, sub: rv.slice(0, 4).map(fullName).join(', ') + (rv.length > 4 ? ` +${rv.length - 4}` : ''), action: ['Review and send', () => { go('visits'); loadDay(today); }] });
  // Fixes for this week's patients
  const seen = new Set();
  for (const d of Object.keys(range).sort()) for (const v of (range[d].items || [])) {
    if (seen.has(v.patientId) || category(v) === 'cancelled') continue; seen.add(v.patientId);
    const r = recordFor(v); if (!r || r.dnt) continue;
    const fix = !digits(r.phone) ? 'No phone number' : (r.age != null && r.age < 18 && r.contactType !== 'parent') ? 'Minor · parent not set' : null;
    if (fix) items.push({ key: 'fix:' + r.key, sec: 'fix', at: v.start, kind: 'fix', icon: I.edit, title: fullName(r), sub: `${fix} · visit ${fmtDateShort(v.start)}`, action: ['Fix', () => openPatient(r)] });
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));   // newest first within each group
  // Color by urgency (red: now, amber: today, green: when you can), hide snoozed, red first.
  const visible = items.filter((i) => !(i.key && snoozed[i.key]));
  const later = items.filter((i) => i.key && snoozed[i.key]).map((i) => ({ ...i, until: snoozed[i.key] })).sort((a, b) => a.until - b.until);
  visible.forEach((i) => { if (i.key && woke && woke[i.key]) { i.tag = 'Back from Later'; i.woke = true; } });
  visible.forEach((i) => { i.urg = i.urg || urgency(i); });
  const RANK = { red: 0, amber: 1, green: 2 };
  visible.sort((a, b) => RANK[a.urg] - RANK[b.urg] || new Date(b.at) - new Date(a.at));
  return { items: visible, later, alerts, range, texts, calls, rx, st };
}

async function loadToday() {
  $('today-hello').textContent = hello();
  $('today-date').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  loadChecklist(); loadNotes();
  if (!$('today-list').children.length) $('today-list').innerHTML = '<div class="loading-line"><span class="spinner"></span>Getting your day ready…</div>';
  const d = await loading(gatherToday);
  todayItems = d.items; todayLater = d.later || []; todaySync = await window.api.syncStatus(); paintTiles(d); paintTodo(d.items); paintVisits(d.range); paintDone(); paintClosing(d);
  paintStale(todaySync); paintChanges(d.alerts); paintFresh(todaySync);
  window.api.watchRead();
}

// Each panel says how fresh it is. While a part is being re-read and what's on screen is older than 10 minutes,
// the panel is dimmed and says "Updating…", so old information never passes for current. It repaints when done.
function paintFresh(st) {
  if (!st || !st.fresh) return;
  const one = (id, keys) => {
    const el = $(id); if (!el) return;
    const ts = keys.map((k) => st.fresh[k]).filter(Boolean), at = ts.length ? Math.min(...ts) : null, run = keys.some((k) => st.running && st.running[k]);
    const old = !at || Date.now() - at > 10 * 60000, panel = el.closest('.panel');
    if (panel) panel.classList.toggle('refreshing', run && old);
    el.className = 'fresh' + (run ? ' run' : !at || Date.now() - at > 30 * 60000 ? ' old' : '');
    el.innerHTML = run ? '<span class="spinner"></span>Updating…' : at ? `Updated ${esc(fmtTime(new Date(at)))}` : 'Not read yet';
    el.title = at ? `Last read ${new Date(at).toLocaleString()}` : '';
  };
  one('fresh-attn', ['comms', 'rx', 'portal']); one('fresh-visits', ['schedule']);
}
let freshPrev = {}, freshT = null;
window.api.onSync((st) => {
  if (view !== 'today') { freshPrev = (st && st.running) || {}; return; }
  paintFresh(st);
  const finished = Object.keys(freshPrev).some((k) => freshPrev[k] && !(st.running || {})[k]);
  freshPrev = (st && st.running) || {};
  if (finished) { clearTimeout(freshT); freshT = setTimeout(loadToday, 400); }
});

// Why prescriptions aren't showing, in plain words.
const rxProblem = (rx) => (rx.error === 'signin' ? 'Sign in to RxNT' : rx.error ? 'Couldn\'t read RxNT · retrying' : 'Checking RxNT…');

// Summary tiles: one number each, click to open.
function paintTiles(d) {
  const td = ((d.range[ymd()] || {}).items || []).filter((v) => category(v) !== 'cancelled');
  const seen = td.filter((v) => statusOf(v) === 'seen').length, left = td.filter((v) => ['booked', 'confirmed'].includes(stateOf(v))).length;
  const G = (d.st || {}).gmail || {};
  const rxN = d.rx.total || 0, rc = d.rx.counts || {};
  const tiles = [
    { key: 'visits', icon: I.cal, n: td.length, label: td.length === 1 ? 'visit today' : 'visits today', sub: td.length ? `${seen} checked in · ${left} to go` : 'Nothing booked', go: () => { go('visits'); loadDay(ymd()); } },
    { key: 'texts', icon: I.msg, n: d.texts.filter((x) => x.needs).length, label: 'texts to answer', sub: (() => { const w = d.texts.filter((x) => x.last && Date.now() - new Date(x.last.at || x.lastAt || 0) < 7 * 864e5).length; return `${w} conversation${w === 1 ? '' : 's'} this week`; })(), go: () => go('texts') },
    { key: 'calls', icon: I.phone, n: d.calls.filter((x) => x.due).length, label: 'calls to return', sub: (() => { const n = d.calls.filter((c) => new Date(c.at).toDateString() === new Date().toDateString()).length; return `${n} call${n === 1 ? '' : 's'} today`; })(), go: () => go('calls') },
    { key: 'email', icon: I.mail, n: G.connected && G.unread != null ? G.unread : '—', label: 'unread emails', sub: G.connected ? ((G.items || [])[0] ? `Latest: ${G.items[0].from}` : (G.account || 'admin@ruhwellmed.com')) : 'Sign in to Gmail', go: () => (G.connected && G.hasKey ? go('emails') : G.connected ? window.api.openGmail() : go('settings')) },
    { key: 'rx', icon: I.pill, n: d.rx.available ? rxN : '—', label: 'prescriptions', sub: d.rx.available ? (rxN ? [rc.pending && `${rc.pending} pending`, rc.refill && `${rc.refill} refill${rc.refill > 1 ? 's' : ''}`, rc.failed && `${rc.failed} failed`].filter(Boolean).join(' · ') : `Nothing waiting${rc.sent ? ` · ${rc.sent} sent` : ''}`) : rxProblem(d.rx), go: () => go('rx') },
  ];
  $('today-tiles').innerHTML = tiles.map((t) => `<button class="tile t-${t.key} ${t.n && t.n !== '—' && t.key !== 'visits' ? 'hot' : ''}" data-k="${t.key}"><span class="ic">${t.icon}</span><b>${esc(t.n)}</b><span class="l">${esc(t.label)}</span><span class="s">${esc(t.sub)}</span></button>`).join('');
  $('today-tiles').querySelectorAll('.tile').forEach((b) => (b.onclick = tiles.find((t) => t.key === b.dataset.k).go));
}

// Needs attention, in groups (most important first). Each group shows 3, with the rest one click away.
const SECTIONS = [['rx', 'Prescriptions & RxNT'], ['faxes', 'Faxes'], ['patients', 'Patients Waiting'], ['schedule', 'Schedule Changes'], ['send', 'Ready to Send'], ['callers', 'New Callers'], ['fix', 'Patient info to fix']];
const openSecs = new Set();
let todayLater = [];
function paintTodo(items) {
  navBadge('nb-today', items.length);   // the same number as Needs attention
  $('todo-count').innerHTML = `${items.length || (todayLater.length ? 0 : '')}${todayLater.length ? `<small> · ${todayLater.length} later</small>` : ''}`;
  const L = $('today-list'); L.innerHTML = '';
  // Next up: the single most urgent thing, so there's one clear place to start.
  const top = items[0], nextShown = !!(top && top.urg !== 'green');
  if (nextShown) {
    const n = document.createElement('div'); n.className = `next-up u-${top.urg}`;
    n.innerHTML = `<span class="lbl">Next up</span><b>${esc(top.title)}</b><span class="d">${esc(top.sub)}</span><div class="nu-acts">${top.action ? `<button class="btn primary act">${esc(top.action[0])}</button>` : ''}${top.key ? `<button class="icon-btn later" title="Later">${I.clock || I.bell}</button>` : ''}${top.done ? `<button class="icon-btn done" title="Done">${I.check}</button>` : ''}</div>`;
    if (top.action) n.querySelector('.act').onclick = top.action[1];
    if (top.key) n.querySelector('.later').onclick = (e) => laterMenu(e.currentTarget, top);
    if (top.done) n.querySelector('.done').onclick = (e) => markTodayDone(top, e.currentTarget, n);
    L.appendChild(n);
  }
  // "All caught up" only when every source actually loaded; otherwise say what couldn't be checked.
  const stale = staleSources(todaySync);
  if (stale.length) { const w = document.createElement('div'); w.className = 'stale-line'; w.innerHTML = `${I.bell}<span>Couldn't check ${esc(stale.map((x) => x.name + (x.since ? ` (since ${fmtTime(new Date(x.since))})` : '')).join(', '))}. Check ${stale.some((x) => x.rxnt) ? 'RxNT' : 'it'} directly if it's urgent.</span>`; L.prepend(w); }
  const hadItems = todayHadItems; todayHadItems = items.length > 0;
  const stillChecking = Object.entries((todaySync || {}).accounts || {}).filter(([, a]) => a && ['checking', 'retrying'].includes(a.state)).map(([k]) => ({ rxnt: 'RxNT', ringrx: 'RingRx', gmail: 'Gmail', doximity: 'faxes' }[k] || k));
  if (!items.length) { L.insertAdjacentHTML('beforeend', stale.length ? `<div class="all-clear partial">${I.check}<b>Nothing waiting from what loaded</b><span>The app keeps retrying the rest.</span></div>` : (stillChecking.length ? `<div class="all-clear partial">${I.check}<b>Nothing waiting so far</b><span>Still checking ${esc(stillChecking.join(', '))}.</span></div>` : '') || `<div class="all-clear ${hadItems ? 'cheer' : ''}">${I.check}<b>All caught up</b><span>Texts, calls, schedule changes and prescriptions that need you show up here.</span></div>`); return; }
  for (const [key, label] of SECTIONS) {
    const list = items.filter((i) => i.sec === key && !(nextShown && i === top)); if (!list.length) continue;   // Next up isn't repeated below
    const head = document.createElement('div'); head.className = 'todo-sec'; head.innerHTML = `<span>${esc(label)}</span><b>${list.length}</b>`; L.appendChild(head);
    const shown = openSecs.has(key) ? list : list.slice(0, 3);
    for (const it of shown) {
      const el = document.createElement('div'); el.className = `todo k-${it.kind} u-${it.urg}`;
      el.innerHTML = `<div class="ic">${it.icon}</div><div class="body"><p class="t"><span class="nm">${esc(it.title)}</span>${it.tag ? `<span class="pill ${it.woke ? 'woke' : 'amber'}">${it.woke ? (I.clock || '') : ''}${esc(it.tag)}</span>` : ''}</p><p class="d">${esc(it.sub)}</p></div>
        <div class="acts">${it.action ? `<button class="btn soft act">${esc(it.action[0])}</button>` : ''}${it.key ? `<button class="icon-btn later" title="Later">${I.clock || I.bell}</button>` : ''}${it.done ? `<button class="icon-btn done" title="Mark as done">${I.check}</button>` : ''}</div>`;
      if (it.key) el.querySelector('.later').onclick = (e) => laterMenu(e.currentTarget, it);
      if (it.action) el.querySelector('.act').onclick = it.action[1];
      if (it.done) el.querySelector('.done').onclick = (e) => markTodayDone(it, e.currentTarget, el);
      L.appendChild(el);
    }
    if (list.length > 3) {
      const more = document.createElement('button'); more.className = 'todo-more';
      more.textContent = openSecs.has(key) ? 'Show less' : `Show ${list.length - 3} more`;
      more.onclick = () => { openSecs.has(key) ? openSecs.delete(key) : openSecs.add(key); paintTodo(items); };
      L.appendChild(more);
    }
  }
  // Later: what's snoozed, with when it comes back. Collapsed to one line until opened.
  if (todayLater.length) {
    const head = document.createElement('button'); head.className = 'todo-sec later-sec' + (openSecs.has('later') ? ' open' : '');
    head.innerHTML = `<span>Later</span><b>${todayLater.length}</b><i class="chev"></i>`; head.onclick = () => { openSecs.has('later') ? openSecs.delete('later') : openSecs.add('later'); paintTodo(items); };
    L.appendChild(head);
    if (openSecs.has('later')) for (const it of todayLater) {
      const el = document.createElement('div'); el.className = 'todo later-item';
      el.innerHTML = `<div class="ic">${I.clock || I.bell}</div><div class="body"><p class="t"><span class="nm">${esc(it.title)}</span></p><p class="d">Back ${esc(new Date(it.until).toDateString() === new Date().toDateString() ? fmtTime(new Date(it.until)) : new Date(it.until).toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtTime(new Date(it.until)))}</p></div>
        <div class="acts"><button class="btn soft now">Bring Back Now</button><button class="icon-btn later" title="Change Time">${I.clock || I.bell}</button></div>`;
      el.querySelector('.now').onclick = async () => { el.classList.add('pop-out'); await window.api.snooze(it.key, 0); setTimeout(loadToday, 220); };
      el.querySelector('.later').onclick = (e) => laterMenu(e.currentTarget, it);
      L.appendChild(el);
    }
  }
}

// "Later": snooze an item, or for numbers not in your patients, ignore them for good.
function laterMenu(anchor, it) {
  const P = $('popover'), inHours = (h) => Date.now() + h * 36e5;
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); };
  // Snoozing hides it for a while; "add to checklist" turns it into a task with a reminder and a link back.
  // "In 3 hours", or "Before closing" when closing comes sooner; each choice shows the exact time.
  const close = (() => { const [h, m] = ((settings.sync || {}).busyEnd || '17:00').split(':').map(Number); const d = new Date(); d.setHours(h, m - 30, 0, 0); return d.getTime(); })();
  const mid = close > inHours(1) && close < inHours(3) ? ['Before Closing', close] : ['In 3 Hours', inHours(3)];
  const at = (t) => `<small>${esc(fmtTime(new Date(t)))}</small>`;
  P.innerHTML = `<div class="menu when-menu"><button data-t="${inHours(1)}"><i></i>In 1 Hour${at(inHours(1))}</button><button data-t="${mid[1]}"><i></i>${mid[0]}${at(mid[1])}</button><button data-t="${tomorrow()}"><i></i>Tomorrow Morning<small>8:00 AM</small></button><hr><button data-cl="1"><i></i>Add to Checklist</button>${it.unk && it.phone ? '<button data-ignore="1"><i></i>Ignore this number</button>' : ''}</div>`;
  const r = anchor.getBoundingClientRect(); P.style.top = `${r.bottom + 6}px`; P.style.left = `${Math.max(12, r.right - 270)}px`; P.style.width = '270px'; P.classList.remove('hidden');
  P.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    hidePopover(); P.style.width = '';
    if (b.dataset.cl) { await addToChecklist(it); await window.api.snooze(it.key, tomorrow()); loadToday(); return; }
    if (b.dataset.ignore) { await window.api.ignoreNumber(it.phone, true); toast('Number ignored. It won\'t show here again.'); }
    else { const until = Number(b.dataset.t); await window.api.snooze(it.key, until); toast(`Snoozed until ${fmtTime(new Date(until))}`, async () => { await window.api.snooze(it.key, 0); loadToday(); }); }
    loadToday();
  }));
}

// Today's visits, in time order.
function paintVisits(range) {
  const td = ((range[ymd()] || {}).items || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!td.length) {
    const next = Object.keys(range).sort().filter((d) => d > ymd()).map((d) => (range[d].items || []).filter((v) => category(v) !== 'cancelled')).find((l) => l.length);
    $('today-visits').innerHTML = `<div class="quiet">${I.cal}<span>No visits today${next ? `<br><small>Next: ${esc(fmtDateShort(next[0].start))}, ${esc(fmtTime(next[0].start))}</small>` : ''}</span></div>`;
    return;
  }
  linkMoves(td, Object.values(range).flatMap((x) => x.items || []));
  $('today-visits').innerHTML = timeStrip(td) + td.map((v) => { const st = stateOf(v), b = ['booked', 'confirmed'].includes(st) ? visitBrief(v) : '';
    if (v.movedTo) return `<button class="visit-line moved" data-d="${esc(ymd())}"><time>${esc(fmtTime(v.start))}</time><span class="nm">${esc(fullName(v))}</span><span class="moved-tag">${esc(movedLabel(v.movedTo, v.start))}</span></button>`;
    return `<button class="visit-line st-${st}" data-d="${esc(ymd())}"><time>${esc(fmtTime(v.start))}</time><span class="nm">${esc(fullName(v))}${v.visitType ? `<small>${esc(v.visitType)}</small>` : ''}${v.movedFrom ? `<small class="brief">Moved from ${esc(new Date(v.movedFrom).toDateString() === new Date(v.start).toDateString() ? fmtTime(v.movedFrom) : fmtDateShort(v.movedFrom))}</small>` : b ? `<small class="brief">${esc(b)}</small>` : ''}</span>${stateTag(st)}</button>`; }).join('');
  $('today-visits').querySelectorAll('.visit-line, .ts-b').forEach((b) => (b.onclick = () => { go('visits'); loadDay(ymd()); }));
}

// One line before each visit: what's still open for this patient, and when they were last seen.
let todayItems = [], todaySync = null;
// Sources that failed or haven't worked recently (during office hours, an hour is too long).
// What Today can't vouch for right now: any account that needs the user, can't confirm its data, or is offline
// (from the one status the app keeps per account). While any is listed, Today never says "All caught up".
function staleSources(st) {
  if (!st || !st.accounts) return [];
  const N = { rxnt: 'RxNT', ringrx: 'RingRx', gmail: 'Gmail', doximity: 'Doximity faxes' };
  return Object.entries(st.accounts).filter(([, a]) => a && ['needs', 'unconfirmed', 'offline'].includes(a.state))
    .map(([k, a]) => ({ name: N[k] || k, since: a.at ? Date.parse(a.at) : null, rxnt: k === 'rxnt', why: a.why }));
}
function visitBrief(v) {
  const d = digits(v.phone), name = fullName(v).toLowerCase(), out = [];
  for (const it of todayItems) {
    if (it.sec === 'rx' && it.rxItem && String(it.rxItem.patient || '').toLowerCase() === name) out.push(it.rxItem.kind === 'refill' ? 'refill pending' : it.rxItem.kind === 'failed' ? 'Rx failed to send' : 'Rx pending');
    else if (d && it.phone === d && it.kind === 'text') out.push(`texted ${ago(it.at)}`);
    else if (d && it.phone === d && it.kind === 'call') out.push(`missed call ${ago(it.at)}`);
  }
  const rec = v.rec || recordFor(v), last = rec && rec.lastVisit && new Date(rec.lastVisit) < parseYmd(ymd()) ? new Date(rec.lastVisit) : null;
  if (last) out.push(`last seen ${last.toLocaleDateString([], { month: 'short', day: 'numeric' })}`);
  else if (/new/i.test(v.visitType || '')) out.push('first visit');
  return [...new Set(out)].slice(0, 3).join(' · ');
}

// The day as a strip: each visit its own block (colored by status), hour ticks, a "now" line, and free time
// labeled only when it's 30 minutes or more. Cancelled and moved visits are left out. Hidden when there's nothing to show.
function timeStrip(td) {
  const live = td.filter((v) => category(v) !== 'cancelled'); if (!live.length) return '';
  const S = settings.sync || {}, base = parseYmd(ymd()), at = (hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(base); d.setHours(h, m, 0, 0); return d.getTime(); };
  const endOf = (v) => (v.end ? new Date(v.end).getTime() : new Date(v.start).getTime() + 30 * 60000);
  const from = Math.min(at(S.busyStart || '08:00'), new Date(live[0].start).getTime()), to = Math.max(at(S.busyEnd || '17:00'), Math.max(...live.map(endOf)));
  const span = to - from, pct = (t) => ((t - from) / span) * 100, now = Date.now();
  let html = '', cursor = from, gaps = [];
  for (const v of live) {
    const s = new Date(v.start).getTime(), e = endOf(v);
    if (s - cursor >= 30 * 60000) gaps.push([cursor, s]);
    const st = stateOf(v), cls = st === 'seen' ? 'in' : st === 'confirmed' || v.confirmed ? 'conf' : st === 'notin' ? 'notin' : 'booked';
    // Colour by status: teal = checked in / now, sage = done, terracotta = started but not checked in, neutral = upcoming.
    const late = s < now && st !== 'seen' ? ' late' : '', done = st === 'seen' && e < now ? ' done' : '';
    html += `<button class="ts-b ${cls}${late}${done} ${e < now ? 'past' : s <= now && now < e ? 'live' : ''}" style="left:calc(${pct(s)}% + 1px);width:calc(${Math.max(0.8, pct(e) - pct(s))}% - 2px)" title="${esc(fmtTime(v.start))} · ${esc(fullName(v))} · ${esc(({ seen: 'Checked In', confirmed: 'Confirmed', notin: 'Not Checked In', booked: 'Booked' })[cls === 'conf' ? 'confirmed' : st] || st)}"></button>`;
    cursor = Math.max(cursor, e);
  }
  if (to - cursor >= 30 * 60000) gaps.push([cursor, to]);
  const labels = gaps.filter(([a, b]) => pct(b) - pct(a) >= 22 && b > now).map(([a, b]) => `<span class="ts-free" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%">${now >= a ? 'Free now' : 'Free'} until ${esc(fmtTime(new Date(b)).replace(':00', ''))}</span>`).join('');
  const ticks = []; for (let t = Math.ceil(from / 3600e3) * 3600e3; t <= to; t += 3600e3) { const h = new Date(t).getHours(); ticks.push(`<i class="ts-tick" style="left:${pct(t)}%"><em>${h % 12 || 12}</em></i>`); }
  const marker = now > from && now < to ? `<i class="ts-now" style="left:${pct(now)}%"></i>` : '';
  return `<div class="timestrip2"><div class="ts-track">${html}${labels}${marker}</div><div class="ts-ticks">${ticks.join('')}</div></div>`;
}

// Progress: a running count of what's been finished today.
async function paintDone() { const n = await window.api.doneGet(); $('today-done').textContent = n ? `${n} done today` : ''; $('today-done').classList.toggle('hidden', !n); }
async function bumpDone(n = 1) { await window.api.doneBump(n); if (view === 'today') paintDone(); }

// After closing time: what's still open before you go, or a clear finish line.
function paintClosing(d) {
  const S = settings.sync || {}, now = new Date(), hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const el = $('today-closing');
  if (now.getDay() < 1 || now.getDay() > 5 || hm < (S.busyEnd || '17:00')) { el.classList.add('hidden'); return; }
  const red = d.items.filter((i) => i.urg !== 'green');
  const tk = addDays(ymd(), now.getDay() === 5 ? 3 : 1), tv = ((d.range[tk] || {}).items || []).filter((v) => category(v) !== 'cancelled').sort((a, b) => new Date(a.start) - new Date(b.start));
  const nw = tv.filter((v) => /new/i.test(v.visitType || '')).length;
  const tomorrow = tv.length ? `<em>${now.getDay() === 5 ? 'Monday' : 'Tomorrow'}: first visit ${esc(fmtTime(tv[0].start))} · ${tv.length} visit${tv.length > 1 ? 's' : ''}${nw ? ` · ${nw} new` : ''}</em>` : '';
  el.classList.remove('hidden');
  el.className = 'closing ' + (red.length ? 'open' : 'clear');
  // Counts, not a run-on list of names: easy to take in at a glance.
  const n = (f) => red.filter(f).length, parts = [
    [n((i) => i.kind === 'text'), 'text', 'texts'], [n((i) => i.kind === 'call'), 'call', 'calls'], [n((i) => i.sec === 'rx' && i.rxItem), 'prescription', 'prescriptions'],
    [n((i) => i.sec === 'rx' && !i.rxItem), 'RxNT item', 'RxNT items'], [n((i) => i.sec === 'schedule'), 'schedule change', 'schedule changes'], [n((i) => ['send', 'fix'].includes(i.sec)), 'to send or fix', 'to send or fix'],
  ].filter(([c]) => c).map(([c, one, many]) => `${c} ${c > 1 ? many : one}`);
  // Each item is its own chip (count + label) that opens the right place.
  const CHIP = { text: ['texts', I.msg], call: ['calls', I.phone || I.msg], prescription: ['rx', I.pill || I.check], 'RxNT item': ['rx', I.pill || I.check], 'schedule change': ['today', I.cal || I.check], 'to send or fix': ['today', I.send || I.check] };
  const chips = parts.map((p) => { const [, c, ...w] = p.match(/^(\d+) (.*)$/) || [, '', p]; const label = w.join(' '); const key = Object.keys(CHIP).find((k) => label.startsWith(k.replace(/s$/, ''))) || 'to send or fix';
    return `<button class="bg-chip" data-go="${CHIP[key][0]}">${CHIP[key][1] || ''}<b>${c}</b><span>${esc(label.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\bTo\b/, 'to').replace(/\bOr\b/, 'or'))}</span></button>`; }).join('');
  el.innerHTML = (red.length ? `<div class="bg-title"><svg viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg><b>Before You Go</b></div><div class="bg-chips">${chips}</div>` : `<div class="bg-title">${I.check}<b>All Done for Today</b></div><span class="bg-sub">Nothing urgent left.</span>`) + tomorrow;
  el.querySelectorAll('.bg-chip').forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

$('tv-open').onclick = () => { go('visits'); loadDay(ymd()); };

$('today-refresh').onclick = async () => {
  $('today-refresh').classList.add('spin');
  await Promise.all([loading(() => window.api.watchCheck()), window.api.commsSync(), window.api.rxRefresh(), window.api.accounts()]);
  $('today-refresh').classList.remove('spin'); loadToday();
};
async function refreshTodayBadge() { try { const d = await gatherToday(); navBadge('nb-today', d.items.length); } catch {} }
setInterval(() => { if (view === 'today') loadToday(); else if (!$('shell').classList.contains('hidden')) refreshTodayBadge(); }, 3 * 60000);
window.api.onWatch((ev) => {
  if (ev.type === 'alerts') {
    const loud = ev.events.filter((e) => !e.quiet);
    if (loud.length) toast(loud[0].text + (loud.length > 1 ? ` (+${loud.length - 1} more)` : ''));
    if (view === 'today') loadToday(); else refreshTodayBadge();
    if (ev.events.some((e) => e.kind === 'optout' || e.kind === 'confirmed')) window.api.confirmed().then((c) => (confirmed = c));
  }
  if (ev.type === 'watch-status') paintSync();
});
window.api.onComms(() => { if (view === 'today') loadToday(); else if (view === 'texts') loadTexts(true); else if (view === 'calls') loadCalls(); });

// The schedule hasn't been read for 20+ minutes in office hours: say so plainly, with a way to fix it.
function paintStale(st) {
  const el = $('today-stale'), v = st && st.scheduleStale;
  if (!v) { el.classList.add('hidden'); return; }
  const rx = ((st.accounts || {}).rxnt || {});
  el.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span><b>Schedule not checked ${v === 'never' ? 'yet' : 'since ' + esc(fmtTime(new Date(v)))}</b> · ${esc(rx.level === 'red' ? 'RxNT needs you to sign in' : 'changes may be missing')}</span><button class="btn small" id="stale-fix">${rx.level === 'red' ? 'Sign In' : 'Check now'}</button>`;
  el.classList.remove('hidden');
  $('stale-fix').onclick = () => (rx.level === 'red' ? go('settings') : syncEverything(['schedule']));
}
// Every schedule change seen today (quiet ones too), so nothing depends on catching a notification.
function paintChanges(alerts) {
  const el = $('today-changes'), today = new Date().toDateString();
  const SCHED = ['new', 'cancelled', 'noshow', 'rescheduled', 'correction', 'backon', 'rebooked', 'checkin', 'status'];
  const list = (alerts || []).filter((a) => SCHED.includes(a.kind) && new Date(a.at).toDateString() === today).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!list.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const wasOpen = el.open;
  // Coloured by what happened (new = teal, cancelled/removed/no-show = terracotta, checked in = sage); changes
  // found after the app was offline get a small marker instead of a repeated "While disconnected:".
  const tone = (k) => (['new', 'rebooked', 'backon'].includes(k) ? 'new' : ['cancelled', 'noshow'].includes(k) ? 'gone' : ['checkin'].includes(k) ? 'done' : 'info');
  el.innerHTML = `<summary>Changes Today <em>${list.length}</em></summary><div class="ch-list">${list.map((a) => `<div class="ch-row ${a.quiet ? 'quiet' : ''} t-${tone(a.kind)}"><time>${esc(fmtTime(new Date(a.at)))}</time><i class="ch-dot"></i><span>${esc(String(a.text || '').replace(/^While disconnected:\s*/, ''))}${a.late ? '<em class="ch-late" title="Found when the app reconnected">while offline</em>' : ''}</span></div>`).join('')}</div>`;
  el.open = wasOpen;
}
