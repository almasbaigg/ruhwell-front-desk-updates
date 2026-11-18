/* Today: the home screen. The day at a glance, what needs attention, today's visits, checklist and notes. */
const ALERT = {
  new: { label: 'New booking', icon: '<path d="M12 5v14M5 12h14"/>', action: ['welcome', 'Send welcome'] },
  rescheduled: { label: 'Rescheduled', icon: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>' },
  cancelled: { label: 'Cancelled', icon: '<path d="M6 6l12 12M18 6L6 18"/>', action: ['reschedule', 'Offer new time'] },
  noshow: { label: 'No-show', icon: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', action: ['reschedule', 'Offer new time'] },
  optout: { label: 'Opted out', icon: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>' },
  confirmed: { label: 'Confirmed', icon: '<path d="M5 12l5 5L20 7"/>' },
  reply: { label: 'New text', icon: '<path d="M4 20l1.2-4A8 8 0 1 1 8 19z"/>' },
  newpatient: { label: 'New patient', icon: '<circle cx="10" cy="8" r="4"/><path d="M3 21c.8-4 3.6-6 7-6s6.2 2 7 6M19 8v6M16 11h6"/>', action: ['open', 'Open patient'] },
  soon: { label: 'Starting soon', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
};
const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

const hoursSince = (iso) => (Date.now() - new Date(iso)) / 36e5;
const byAge = (iso, amberH, redH) => { const h = hoursSince(iso); return h >= redH ? 'red' : h >= amberH ? 'amber' : 'green'; };
function urgency(i) {
  if (i.sec === 'rx') return i.rxKind === 'failed' ? 'red' : byAge(i.at, 0, 24) === 'red' ? 'red' : 'amber';
  if (i.sec === 'patients') return byAge(i.at, 1, 4);
  if (i.sec === 'callers') return byAge(i.at, 4, 48) === 'red' ? 'amber' : 'green';
  if (i.sec === 'schedule') { if (!i.apptStart) return 'amber'; const d = (new Date(new Date(i.apptStart).toDateString()) - new Date(new Date().toDateString())) / 864e5; return d <= 1 ? 'red' : 'amber'; }
  if (i.sec === 'fix') return (new Date(i.at) - Date.now()) / 864e5 <= 2 ? 'amber' : 'green';
  return 'green';
}

async function gatherToday() {
  const today = ymd(), tomorrow = addDays(today, 1);
  const [texts, calls, alerts, hist, pats, range, rx, st, snoozed, portal] = await Promise.all([
    window.api.textThreads(14), window.api.callList(14), window.api.watchAlerts(), window.api.history(), window.api.patients(),
    window.api.rxntRange(today, 8), window.api.rxList(), window.api.syncStatus(), window.api.snoozes(), window.api.portalList(),
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
    items.push({ key: 'c:' + c.phone, phone: c.phone, unk, sec: unk ? 'callers' : 'patients', at: c.at, kind: 'call', icon: I.phone, title: c.who.name || fmtPhone(c.phone), sub: `${c.voicemail ? 'Voicemail' + (c.transcription ? `: “${c.transcription.slice(0, 70)}”` : '') : 'Missed call'} · ${ago(c.at)}`, action: ['Text back', () => openThread(c.phone)], done: () => window.api.markDone('c', c.phone) });
  }
  // RxNT portal messages from patients (the RxNT sidebar chat); replies happen in RxNT
  for (const c of (portal.conversations || []).filter((x) => x.needsReply && !x.done)) {
    items.push({ key: 'p:' + c.id, sec: 'patients', at: c.at, kind: 'text', icon: I.msg, title: c.title, tag: 'RxNT portal', sub: `“${String(c.excerpt || '').slice(0, 90)}” · ${ago(c.at)}`, action: ['Open in RxNT', () => window.api.openRxnt('messages')], done: () => window.api.portalDone(c.id) });
  }
  // Prescriptions needing action in RxNT (pended for the prescriber, refill requests, failed sends)
  for (const r of rx.items || []) items.push({ key: `rx:${r.kind}:${r.patient}`, rxKind: r.kind, sec: 'rx', at: r.at || new Date().toISOString(), kind: 'rx', icon: I.pill, title: r.patient || 'Patient', tag: { refill: 'Refill request', pending: 'Pending Rx', failed: 'Failed' }[r.kind], sub: [r.med, r.pharmacy].filter(Boolean).join(' · ') || r.detail || 'Waiting in RxNT', action: ['Open in RxNT', () => window.api.openRxnt()] });
  // RxNT To-Do, only the critical ones and only when there's something
  const rc = rx.counts || {};
  for (const [k, one, many, lvl] of [['labs', 'lab result to review', 'lab results to review', 'red'], ['unsigned', 'encounter to sign', 'encounters to sign', 'red'], ['tasks', 'patient task', 'patient tasks', 'amber'], ['unbilled', 'visit not billed yet', 'visits not billed yet', 'amber']]) {
    if (rc[k] > 0) items.push({ key: 'todo:' + k, urg: lvl, sec: 'rx', at: new Date().toISOString(), kind: 'rx', icon: I.check, title: `${rc[k]} ${rc[k] > 1 ? many : one}`, tag: k === 'unbilled' ? 'Billing' : 'RxNT To-Do', sub: k === 'unbilled' ? 'Close the encounter so the biller can bill' : 'Waiting in RxNT', action: ['Open in RxNT', () => window.api.openRxnt(k === 'unbilled' ? 'billing' : 'todo')] });
  }
  // Schedule changes that call for a message
  // A cancellation and a new booking for the same patient at the same time is RxNT moving the visit: not news.
  const open = alerts.filter((x) => !x.handled && !x.quiet && ALERT[x.kind] && ALERT[x.kind].action && Date.now() - new Date(x.at) < WEEK);
  const slot = (x) => `${(x.appt || {}).patientId}|${(x.appt || {}).start}`;
  const newSlots = new Set(open.filter((x) => x.kind === 'new').map(slot)), cxSlots = new Set(open.filter((x) => x.kind === 'cancelled').map(slot));
  for (const a of open.filter((x) => !((x.kind === 'new' && cxSlots.has(slot(x))) || (x.kind === 'cancelled' && newSlots.has(slot(x)))))) {
    const A = ALERT[a.kind];
    if (a.kind === 'newpatient') { const p = patients.find((x) => x.key === a.key); items.push({ key: 'a:' + a.id, sec: 'schedule', at: a.at, kind: 'change', icon: `<svg viewBox="0 0 24 24">${A.icon}</svg>`, title: a.text.replace('New patient in RxNT: ', ''), tag: 'New patient', sub: `Registered in RxNT · ${ago(a.at)}`, action: p ? ['Open patient', () => { go('patients'); openPatient(p); }] : null, done: () => window.api.watchHandle(a.id) }); continue; }
    const appt = a.appt || {}, rec = recordFor(appt);
    if (rec && rec.dnt) continue;
    items.push({ key: 'a:' + a.id, apptStart: appt.start, sec: 'schedule', at: a.at, kind: 'change', icon: `<svg viewBox="0 0 24 24">${A.icon}</svg>`, title: `${A.label}: ${fullName(appt)}`, sub: `${appt.start ? fmtDateShort(appt.start) + ', ' + fmtTime(appt.start) : ''} · ${ago(a.at)}`,
      action: digits(appt.phone).length === 10 ? [A.action[1], () => messageModal({ ...appt, rec, cat: a.kind === 'new' ? 'pending' : 'cancelled' }, A.action[0])] : null, done: () => window.api.watchHandle(a.id) });
  }
  // Batches: tomorrow's reminders, today's review requests
  const sentSinceDay = (phone, day) => history.some((h) => h.ok && digits(h.phone) === digits(phone) && new Date(h.at) >= parseYmd(day).getTime() - 864e5);
  const textable = (v) => { const r = recordFor(v); return digits((r && r.phoneSource === 'Typed' && r.phone) || v.phone).length === 10 && !(r && r.dnt); };
  const tm = ((range[tomorrow] || {}).items || []).filter((v) => ['booked', 'confirmed'].includes(stateOf(v)) && textable(v) && !sentSinceDay(v.phone, today));
  if (tm.length) items.push({ sec: 'send', at: new Date().toISOString(), kind: 'batch', icon: I.bell, title: `Send ${tm.length} reminder${tm.length > 1 ? 's' : ''} for tomorrow`, sub: tm.slice(0, 4).map(fullName).join(', ') + (tm.length > 4 ? ` +${tm.length - 4}` : ''), action: ['Review and send', () => { go('visits'); loadDay(tomorrow); }] });
  const td = (range[today] || {}).items || [];
  const rv = td.filter((v) => statusOf(v) === 'seen' && textable(v) && !lastReview(v.phone) && !sentSinceDay(v.phone, today));
  if (rv.length) items.push({ sec: 'send', at: new Date().toISOString(), kind: 'batch', icon: I.check, title: `Send ${rv.length} review request${rv.length > 1 ? 's' : ''}`, sub: rv.slice(0, 4).map(fullName).join(', ') + (rv.length > 4 ? ` +${rv.length - 4}` : ''), action: ['Review and send', () => { go('visits'); loadDay(today); }] });
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
  visible.forEach((i) => { i.urg = i.urg || urgency(i); });
  const RANK = { red: 0, amber: 1, green: 2 };
  visible.sort((a, b) => RANK[a.urg] - RANK[b.urg] || new Date(b.at) - new Date(a.at));
  return { items: visible, alerts, range, texts, calls, rx, st };
}

async function loadToday() {
  $('today-hello').textContent = hello();
  $('today-date').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  loadChecklist(); loadNotes();
  if (!$('today-list').children.length) $('today-list').innerHTML = '<div class="loading-line"><span class="spinner"></span>Getting your day ready…</div>';
  const d = await loading(gatherToday);
  paintTiles(d); paintTodo(d.items); paintVisits(d.range);
  window.api.watchRead();
}

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
    { key: 'texts', icon: I.msg, n: d.texts.filter((x) => x.needs).length, label: 'texts to answer', sub: `${d.texts.length} conversation${d.texts.length === 1 ? '' : 's'} this week`, go: () => go('texts') },
    { key: 'calls', icon: I.phone, n: d.calls.filter((x) => x.due).length, label: 'calls to return', sub: (() => { const n = d.calls.filter((c) => new Date(c.at).toDateString() === new Date().toDateString()).length; return `${n} call${n === 1 ? '' : 's'} today`; })(), go: () => go('calls') },
    { key: 'email', icon: I.mail, n: G.connected ? G.unread : '—', label: 'unread emails', sub: G.connected ? ((G.items || [])[0] ? `Latest: ${G.items[0].from}` : (G.account || 'admin@ruhwellmed.com')) : 'Sign in to Gmail', go: () => (G.connected ? window.api.openGmail() : go('settings')) },
    { key: 'rx', icon: I.pill, n: d.rx.available ? rxN : '—', label: 'prescriptions', sub: d.rx.available ? (rxN ? [rc.pending && `${rc.pending} pending`, rc.refill && `${rc.refill} refill${rc.refill > 1 ? 's' : ''}`, rc.failed && `${rc.failed} failed`].filter(Boolean).join(' · ') : `Nothing waiting${rc.sent ? ` · ${rc.sent} sent` : ''}`) : rxProblem(d.rx), go: () => go('rx') },
  ];
  $('today-tiles').innerHTML = tiles.map((t) => `<button class="tile t-${t.key} ${t.n && t.n !== '—' && t.key !== 'visits' ? 'hot' : ''}" data-k="${t.key}"><span class="ic">${t.icon}</span><b>${esc(t.n)}</b><span class="l">${esc(t.label)}</span><span class="s">${esc(t.sub)}</span></button>`).join('');
  $('today-tiles').querySelectorAll('.tile').forEach((b) => (b.onclick = tiles.find((t) => t.key === b.dataset.k).go));
}

// Needs attention, in groups (most important first). Each group shows 3, with the rest one click away.
const SECTIONS = [['rx', 'Prescriptions & RxNT'], ['patients', 'Patients waiting'], ['schedule', 'Schedule changes'], ['send', 'Ready to send'], ['callers', 'New callers'], ['fix', 'Patient info to fix']];
const openSecs = new Set();
function paintTodo(items) {
  navBadge('nb-today', items.filter((i) => i.urg === 'red').length);   // only what's urgent, so the number means something
  $('todo-count').textContent = items.length || '';
  const L = $('today-list'); L.innerHTML = '';
  // Next up: the single most urgent thing, so there's one clear place to start.
  const top = items[0];
  if (top && top.urg !== 'green') {
    const n = document.createElement('div'); n.className = `next-up u-${top.urg}`;
    n.innerHTML = `<span class="lbl">Next up</span><b>${esc(top.title)}</b><span class="d">${esc(top.sub)}</span>${top.action ? `<button class="btn primary">${esc(top.action[0])}</button>` : ''}`;
    if (top.action) n.querySelector('button').onclick = top.action[1];
    L.appendChild(n);
  }
  if (!items.length) { L.innerHTML = `<div class="all-clear">${I.check}<b>All caught up</b><span>Texts, calls, schedule changes and prescriptions that need you show up here.</span></div>`; return; }
  for (const [key, label] of SECTIONS) {
    const list = items.filter((i) => i.sec === key); if (!list.length) continue;
    const head = document.createElement('div'); head.className = 'todo-sec'; head.innerHTML = `<span>${esc(label)}</span><b>${list.length}</b>`; L.appendChild(head);
    const shown = openSecs.has(key) ? list : list.slice(0, 3);
    for (const it of shown) {
      const el = document.createElement('div'); el.className = `todo k-${it.kind} u-${it.urg}`;
      el.innerHTML = `<div class="ic">${it.icon}</div><div class="body"><p class="t"><span class="nm">${esc(it.title)}</span>${it.tag ? `<span class="pill amber">${esc(it.tag)}</span>` : ''}</p><p class="d">${esc(it.sub)}</p></div>
        <div class="acts">${it.action ? `<button class="btn soft act">${esc(it.action[0])}</button>` : ''}${it.key ? `<button class="icon-btn later" title="Later">${I.clock || I.bell}</button>` : ''}${it.done ? `<button class="icon-btn done" title="Mark as done">${I.check}</button>` : ''}</div>`;
      if (it.key) el.querySelector('.later').onclick = (e) => laterMenu(e.currentTarget, it);
      if (it.action) el.querySelector('.act').onclick = it.action[1];
      if (it.done) el.querySelector('.done').onclick = async () => { el.classList.add('leaving'); await it.done(); setTimeout(loadToday, 180); };
      L.appendChild(el);
    }
    if (list.length > 3) {
      const more = document.createElement('button'); more.className = 'todo-more';
      more.textContent = openSecs.has(key) ? 'Show less' : `Show ${list.length - 3} more`;
      more.onclick = () => { openSecs.has(key) ? openSecs.delete(key) : openSecs.add(key); paintTodo(items); };
      L.appendChild(more);
    }
  }
}

// "Later": snooze an item, or for numbers not in your patients, ignore them for good.
function laterMenu(anchor, it) {
  const P = $('popover'), inHours = (h) => Date.now() + h * 36e5;
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d.getTime(); };
  P.innerHTML = `<div class="menu"><button data-t="${inHours(1)}"><i></i>In 1 hour</button><button data-t="${inHours(3)}"><i></i>Later today</button><button data-t="${tomorrow()}"><i></i>Tomorrow morning</button>${it.unk && it.phone ? '<hr><button data-ignore="1"><i></i>Ignore this number</button>' : ''}</div>`;
  const r = anchor.getBoundingClientRect(); P.style.top = `${r.bottom + 6}px`; P.style.left = `${Math.max(12, r.right - 200)}px`; P.style.width = '200px'; P.classList.remove('hidden');
  P.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    hidePopover(); P.style.width = '';
    if (b.dataset.ignore) { await window.api.ignoreNumber(it.phone, true); toast('Number ignored. It won\'t show here again.'); }
    else { await window.api.snooze(it.key, Number(b.dataset.t)); toast('Snoozed'); }
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
  $('today-visits').innerHTML = td.map((v) => { const st = stateOf(v); return `<button class="visit-line st-${st}" data-d="${esc(ymd())}"><time>${esc(fmtTime(v.start))}</time><span class="nm">${esc(fullName(v))}${v.visitType ? `<small>${esc(v.visitType)}</small>` : ''}</span>${stateTag(st)}</button>`; }).join('');
  $('today-visits').querySelectorAll('.visit-line').forEach((b) => (b.onclick = () => { go('visits'); loadDay(ymd()); }));
}

$('tv-open').onclick = () => { go('visits'); loadDay(ymd()); };

/* Checklist */
async function loadChecklist(list) {
  const items = list || await window.api.checklist();
  const open = items.filter((i) => !i.done).length;
  $('cl-left').textContent = items.length ? `${open} left` : '';
  $('cl-list').innerHTML = items.length ? items.map((i) => `<div class="cl-item ${i.done ? 'done' : ''}" data-id="${esc(i.id)}"><label class="check"><input type="checkbox" ${i.done ? 'checked' : ''}><span></span></label><span class="txt">${esc(i.text)}${i.due && !i.done ? `<span class="due ${i.reminded ? 'past' : ''}">${I.bell || ''}${esc(new Date(i.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</span>` : ''}</span>${!i.done && new Date(i.at).toDateString() !== new Date().toDateString() ? '<span class="carried" title="Carried over">since ' + esc(new Date(i.at).toLocaleDateString([], { month: 'short', day: 'numeric' })) + '</span>' : ''}<button class="x" title="Delete">${I.x}</button></div>`).join('') : '<div class="cl-ghost"><i></i><i></i><i></i></div><p class="cl-empty">Your list for today. Unfinished tasks carry over.</p>';
  $('cl-list').querySelectorAll('.cl-item').forEach((el) => {
    el.querySelector('input').onchange = async () => loadChecklist(await window.api.checklistToggle(el.dataset.id));
    el.querySelector('.x').onclick = async () => loadChecklist(await window.api.checklistRemove(el.dataset.id));
  });
}
$('cl-form').onsubmit = async (e) => { e.preventDefault(); const v = $('cl-input').value.trim(); if (!v) return; const t = $('cl-time').value; $('cl-input').value = ''; $('cl-time').value = ''; loadChecklist(await window.api.checklistAdd(v, t)); if (t) toast(`Reminder set for ${fmtClock(t)}`); };
window.api.onChecklist(() => { if (view === 'today') loadChecklist(); });
const fmtClock = (hm) => { const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

/* Notes: saved a moment after typing stops. */
let ntTimer = null;
async function loadNotes() { const n = await window.api.notes(); if (document.activeElement !== $('nt-text')) $('nt-text').value = n.text || ''; }
$('nt-text').oninput = () => { $('nt-state').textContent = 'Saving…'; clearTimeout(ntTimer); ntTimer = setTimeout(async () => { await window.api.notesSave($('nt-text').value); $('nt-state').textContent = 'Saved'; }, 600); };

$('today-refresh').onclick = async () => {
  $('today-refresh').classList.add('spin');
  await Promise.all([loading(() => window.api.watchCheck()), window.api.commsSync(), window.api.rxRefresh(), window.api.accounts()]);
  $('today-refresh').classList.remove('spin'); loadToday();
};
async function refreshTodayBadge() { try { const d = await gatherToday(); navBadge('nb-today', d.items.filter((i) => i.urg === 'red').length); } catch {} }
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
