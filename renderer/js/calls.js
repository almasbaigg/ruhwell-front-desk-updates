/* Calls: the RingRx call log. Calls can't be answered from the app, so this shows who called, what's
   still waiting for a callback, and a quick way to text back. */
let caFilter = recall('ca-filter', 'all'), caData = [];

async function loadCalls() {
  const days = +$('ca-range').value;
  caData = await loading(() => window.api.callList(days));
  if (!patients.length) { patients = await window.api.patients(); indexPatients(patients); }
  $('cl-range-label').textContent = `${new Date(Date.now() - days * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric' })} – today · ${caData.length} call${caData.length === 1 ? '' : 's'}`;
  renderCalls();
}
const callIcon = (c) => c.voicemail ? '<svg viewBox="0 0 24 24"><circle cx="7" cy="13" r="3.5"/><circle cx="17" cy="13" r="3.5"/><path d="M7 16.5h10"/></svg>'
  : c.missed ? '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/><path d="M15 3l6 6M21 3l-6 6"/></svg>'
  : c.inbound ? '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/><path d="M21 3l-6 6M15 4v5h5"/></svg>'
  : '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/><path d="M15 9l6-6M16 3h5v5"/></svg>';
const callKind = (c) => c.voicemail ? 'Voicemail' : c.missed ? 'Missed' : c.inbound ? 'Incoming' : 'Outgoing';
const dur = (s) => !s ? '' : s >= 60 ? `${Math.round(s / 60)} min` : `${s} sec`;

// RingRx-style timing, kept short so it never wraps: "In · 0:43 · Voicemail 0:16".
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, '0')}`;
function callDetail(c) {
  if (!c.inbound) return c.secs ? `Outgoing · ${mmss(c.secs)}` : 'Outgoing · no answer';
  if (c.voicemail) return `Incoming${c.secs ? ' · ' + mmss(c.secs) : ''} · Voicemail${c.vmSecs ? ' ' + mmss(c.vmSecs) : ''}`;
  if (c.noMessage) return `Incoming · ${mmss(c.secs)} · Hung up at voicemail`;
  if (c.answered) return `Incoming · ${mmss(c.secs)} · Answered`;
  return `Incoming · Missed${c.secs ? ' · rang ' + mmss(c.secs) : ''}`;
}
const kindCls = (c) => c.voicemail ? 'k-vm' : c.missed ? 'k-missed' : c.inbound ? 'k-in' : 'k-out';
// One status chip per card, the thing that matters: is it handled?
function callStatus(c) {
  if (c.spam) return '<span class="rstat">Spam</span>';
  if (c.voicemail && !c.heardAt) return '<span class="rstat new">New voicemail</span>';
  if (c.inbound && (c.missed || c.voicemail)) return c.answer ? `<span class="rstat ok">${esc(c.answer.how.charAt(0).toUpperCase() + c.answer.how.slice(1) + " " + fmtTime(new Date(c.answer.at)))}</span>` : '<span class="rstat wait">Not called back</span>';
  return '';
}
// Back-and-forth with the same number within an hour (missed → voicemail → you call back) is one card.
function groupCalls(list) {
  const out = [];
  for (const c of list) {
    const g = out[out.length - 1];
    if (g && g.phone === c.phone && Math.abs(new Date(g.calls[g.calls.length - 1].at) - new Date(c.at)) < 3600e3) g.calls.push(c);
    else out.push({ phone: c.phone, calls: [c] });
  }
  // The card speaks for the call that matters most: a voicemail, then a missed call, then the newest.
  for (const g of out) g.main = g.calls.find((c) => c.voicemail) || g.calls.find((c) => c.inbound && c.missed) || g.calls[0];
  return out;
}
function callRow(c, due, group) {
  const unknown = c.who.kind === 'unknown', calls = group ? group.calls : [c], first = calls[calls.length - 1];
  const h = hoursSince(c.at), urg = due ? ` u-${h >= 4 ? 'red' : h >= 1 ? 'amber' : 'green'}` : '';
  const trail = calls.length > 1 ? `<div class="c-trail">${calls.slice().reverse().map((x) => `<span class="${kindCls(x)}">${callIcon(x)}<b>${esc(fmtTime(new Date(x.at)))}</b> ${esc(callDetail(x))}</span>`).join('')}</div>` : '';
  return `<div class="call-row ${due ? 'due' : ''}${urg}" data-id="${esc(c.id)}">
    <div class="c-time"><b>${esc(fmtTime(new Date((calls.length > 1 ? first : c).at)))}</b><span>${esc(due ? 'waiting ' + waitLabel(c.at) : calls.length > 1 ? calls.length + ' calls' : dayLabel(c.at))}</span></div>
    <div class="who">
      <div class="c-name"><b>${esc(whoName(c.who, c.phone))}</b>${c.voicemail && !c.heardAt && !c.spam ? '<i class="dot-new"></i>' : ''}${whoTag(c.who)}${callStatus(c)}</div>
      <div class="c-sub">${whoName(c.who, c.phone) === fmtPhone(c.phone) ? '' : `<span class="c-phone">${esc(fmtPhone(c.phone))}</span>`}${calls.length > 1 ? '' : `<span class="c-kind ${kindCls(c)}">${callIcon(c)}${esc(callDetail(c))}</span>`}</div>
      ${trail}
      ${c.transcription ? `<em class="vm">“${esc(c.transcription)}”</em>` : ''}
      ${c.voicemail ? '<div class="vm-player"></div>' : ''}
    </div>
    <div class="acts">${c.inbound && c.who.kind !== 'patient' ? (c.spam ? '<button class="btn act-block">Block in RingRx</button><button class="btn act-notspam">Not spam</button>' : `<button class="icon-btn ghost act-spam" title="Mark as spam">${I.x}</button>`) : ''}${unknown ? `<button class="icon-btn ghost act-who" title="Who is this?">${I.user}</button>` : ''}${due ? `<button class="icon-btn ghost act-done" title="Called back / done">${I.check}</button>` : ''}${c.voicemail && c.vmId ? `<button class="btn act-play" title="Play voicemail"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>Play</button>` : ''}${!(c.who.dnt) && !c.spam ? `<button class="btn outline-teal act-text">${I.msg}Text</button>` : ''}</div>
  </div>`;
}
function renderCalls() {
  const q = $('ca-search').value.trim().toLowerCase(), qd = digits(q);
  const due = caFilter === 'spam' ? [] : caData.filter((c) => c.due);
  $('ca-due').innerHTML = due.length ? `<div class="section-head"><h2>Needs a callback</h2><span class="muted small">${due.length}</span></div><div class="list">${due.map((c) => callRow(c, true)).join('')}</div>` : '';
  const F = { all: (c) => !c.spam, in: (c) => !c.spam && c.inbound, out: (c) => !c.inbound, spam: (c) => c.spam, unheard: (c) => !c.spam && c.voicemail && !c.heardAt, unanswered: (c) => !c.spam && c.inbound && (c.missed || c.voicemail) && !c.answer };
  const list = caData.filter((c) => (F[caFilter] || F.all)(c) && (!q || (c.who.name || '').toLowerCase().includes(q) || (qd.length >= 3 && c.phone.includes(qd))));
  // Today stays open; earlier days fold into one "Earlier" section so the page stays short.
  const today = new Date().toDateString(), todays = list.filter((c) => new Date(c.at).toDateString() === today), older = list.filter((c) => new Date(c.at).toDateString() !== today);
  let html = `<div class="group-head">Today · ${todays.length} call${todays.length === 1 ? '' : 's'}</div>` + (todays.length ? groupCalls(todays).map((g) => callRow(g.main, false, g)).join('') : '<p class="muted small" style="padding:6px 4px 10px">No calls yet today.</p>');
  if (older.length) {
    let inner = '', last = '';
    const days = [];
    for (const c of older.slice(0, 600)) { const day = dayLabel(c.at); if (!days.length || days[days.length - 1].day !== day) days.push({ day, calls: [] }); days[days.length - 1].calls.push(c); }
    for (const d of days) inner += `<div class="group-head">${esc(d.day)} · ${d.calls.length} call${d.calls.length === 1 ? '' : 's'}</div>` + groupCalls(d.calls).map((g) => callRow(g.main, false, g)).join('');
    html += `<details class="history" ${q ? 'open' : ''}><summary><span>Earlier</span><em>${older.length} call${older.length === 1 ? '' : 's'}</em></summary><div class="hist-body">${inner}</div></details>`;
  }
  $('ca-list').innerHTML = list.length ? html : `<div class="empty-state">${I.phone}<h3>No calls</h3><p>Nothing in this range.</p></div>`;
  document.querySelectorAll('#view-calls .call-row').forEach((el) => {
    const c = caData.find((x) => x.id === el.dataset.id); if (!c) return;
    const t = el.querySelector('.act-text'); if (t) t.onclick = () => openThread(c.phone);
    const w = el.querySelector('.act-who'); if (w) w.onclick = () => whoIsThis(c.phone, loadCalls);
    const sp = el.querySelector('.act-spam'); if (sp) sp.onclick = () => markSpamFlow(c, loadCalls);
    const bl = el.querySelector('.act-block'); if (bl) bl.onclick = () => { window.api.openRingrx('block'); toast('Opened RingRx. Add the number to your block list there.'); };
    const ns = el.querySelector('.act-notspam'); if (ns) ns.onclick = async () => { await window.api.markSpam(c.phone, false); toast('Not spam'); loadCalls(); };
    const pl = el.querySelector('.act-play'); if (pl) pl.onclick = () => playVoicemail(c, el.querySelector('.vm-player'), pl);
    const tr = el.querySelector('em.vm'); if (tr) tr.onclick = () => { tr.classList.toggle('full'); if (c.voicemail && !c.heardAt) { window.api.markHeard(c.id, true, c.vmId); c.heardAt = Date.now(); } };
    const d = el.querySelector('.act-done'); if (d) d.onclick = async () => { await window.api.markDone('c', c.phone); bumpDone(); toast('Marked done'); loadCalls(); };
  });
}
document.querySelectorAll('#ca-filter button').forEach((b) => (b.onclick = () => { caFilter = b.dataset.f; remember('ca-filter', caFilter); document.querySelectorAll('#ca-filter button').forEach((x) => x.classList.toggle('on', x === b)); renderCalls(); }));
$('ca-range').onchange = loadCalls;
$('ca-search').oninput = renderCalls;

document.querySelectorAll('#ca-filter button').forEach((x) => x.classList.toggle('on', x.dataset.f === caFilter));

// Voicemail player: fetched from RingRx when tapped, played from memory, never saved to disk.
let vmAudio = null;
async function playVoicemail(c, box, btn) {
  if (vmAudio && vmAudio.dataset.id === c.id) { vmAudio.paused ? vmAudio.play() : vmAudio.pause(); return; }
  if (vmAudio) { vmAudio.pause(); URL.revokeObjectURL(vmAudio.src); vmAudio.closest('.vm-player') && (vmAudio.closest('.vm-player').innerHTML = ''); vmAudio = null; }
  btn.disabled = true; box.innerHTML = '<span class="muted small">Loading…</span>';
  const r = await window.api.vmAudio(c.vmId, c.media || '');
  btn.disabled = false;
  if (!r || r.error) { box.innerHTML = `<span class="muted small">Couldn't play this one here${r && r.error ? ' (' + esc(String(r.error).slice(0, 40)) + ')' : ''}.</span> <button class="btn small act-ringrx">Listen in RingRx</button>`; box.querySelector('.act-ringrx').onclick = () => window.api.openRingrx('voicemail'); return; }
  const bytes = Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0));
  const a = new Audio(URL.createObjectURL(new Blob([bytes], { type: r.mime })));
  a.dataset.id = c.id; vmAudio = a;
  box.innerHTML = `<div class="vm-bar"><button class="icon-btn vm-pp" title="Play/pause"></button><div class="vm-track"><i></i></div><span class="vm-time">0:00</span><div class="vm-speed">${[1, 1.5, 2].map((x) => `<button data-s="${x}" class="${x === 1 ? 'on' : ''}">${x}×</button>`).join('')}</div></div>`;
  box.prepend(a); a.hidden = true;
  const pp = box.querySelector('.vm-pp'), fill = box.querySelector('.vm-track i'), tm = box.querySelector('.vm-time');
  const icon = () => { pp.innerHTML = a.paused ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'; };
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  a.ontimeupdate = () => { fill.style.width = `${(a.currentTime / (a.duration || 1)) * 100}%`; tm.textContent = mmss(a.currentTime); if (a.currentTime >= 5 && !c.heardAt) { c.heardAt = Date.now(); window.api.markHeard(c.id, true, c.vmId); } };
  a.onplay = a.onpause = icon; a.onended = () => { icon(); if (!c.heardAt) { c.heardAt = Date.now(); window.api.markHeard(c.id, true, c.vmId); } };
  pp.onclick = () => (a.paused ? a.play() : a.pause());
  box.querySelector('.vm-track').onclick = (e) => { const r2 = e.currentTarget.getBoundingClientRect(); if (a.duration) a.currentTime = ((e.clientX - r2.left) / r2.width) * a.duration; };
  box.querySelectorAll('.vm-speed button').forEach((b) => (b.onclick = () => { a.playbackRate = +b.dataset.s; box.querySelectorAll('.vm-speed button').forEach((x) => x.classList.toggle('on', x === b)); }));
  icon(); a.onerror = () => window.api.vmPlayFailed('cannot decode'); a.play().catch((e) => { window.api.vmPlayFailed(e && e.name); box.querySelector('.vm-time').textContent = 'Tap ▶ to play'; });
}
