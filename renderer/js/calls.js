/* Calls: the RingRx call log. Calls can't be answered from the app, so this shows who called, what's
   still waiting for a callback, and a quick way to text back. */
let caFilter = 'all', caData = [];

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

function callRow(c, due) {
  const unknown = c.who.kind === 'unknown';
  return `<div class="call-row ${due ? 'due' : ''} ${c.missed ? 'missed' : ''}" data-id="${esc(c.id)}">
    <span class="avatar ${unknown ? 'unk' : ''}">${whoInitials(c.who)}</span>
    <div class="who"><b>${esc(whoName(c.who, c.phone))}</b><span>${unknown ? '' : esc(fmtPhone(c.phone)) + ' '}${whoTag(c.who)}${c.transcription ? `<em class="vm">“${esc(c.transcription.slice(0, 120))}”</em>` : ''}</span></div>
    <span class="kind k-${c.missed ? 'missed' : c.inbound ? 'in' : 'out'}">${callIcon(c)}${callKind(c)}${dur(c.secs) ? ' · ' + dur(c.secs) : ''}</span>
    <time>${esc(due ? ago(c.at) : fmtTime(c.at))}</time>
    <div class="row-gap acts">${!(c.who.dnt) ? `<button class="btn outline-teal act-text">${I.msg}Text</button>` : ''}${unknown ? `<button class="btn act-who" title="Who is this?">${I.user}</button>` : ''}${due ? `<button class="icon-btn act-done" title="Called back / done">${I.check}</button>` : ''}</div>
  </div>`;
}
function renderCalls() {
  const q = $('ca-search').value.trim().toLowerCase(), qd = digits(q);
  const due = caData.filter((c) => c.due);
  $('ca-due').innerHTML = due.length ? `<div class="section-head"><h2>Needs a callback</h2><span class="muted small">${due.length}</span></div><div class="list">${due.map((c) => callRow(c, true)).join('')}</div>` : '';
  const list = caData.filter((c) => (caFilter === 'all' || (caFilter === 'in' ? c.inbound : !c.inbound)) && (!q || (c.who.name || '').toLowerCase().includes(q) || (qd.length >= 3 && c.phone.includes(qd))));
  let html = '', last = '';
  for (const c of list.slice(0, 600)) {
    const d = new Date(c.at), day = d.toDateString() === new Date().toDateString() ? 'Today' : d.toDateString() === new Date(Date.now() - 864e5).toDateString() ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    if (day !== last) { last = day; const dl = list.filter((x) => new Date(x.at).toDateString() === d.toDateString()); html += `<div class="group-head">${esc(day)} · ${dl.length} call${dl.length === 1 ? '' : 's'}</div>`; }
    html += callRow(c, false);
  }
  $('ca-list').innerHTML = html || `<div class="empty-state">${I.phone}<h3>No calls</h3><p>Nothing in this range.</p></div>`;
  document.querySelectorAll('#view-calls .call-row').forEach((el) => {
    const c = caData.find((x) => x.id === el.dataset.id); if (!c) return;
    const t = el.querySelector('.act-text'); if (t) t.onclick = () => openThread(c.phone);
    const w = el.querySelector('.act-who'); if (w) w.onclick = () => whoIsThis(c.phone, loadCalls);
    const d = el.querySelector('.act-done'); if (d) d.onclick = async () => { await window.api.markDone('c', c.phone); toast('Marked done'); loadCalls(); };
  });
}
document.querySelectorAll('#ca-filter button').forEach((b) => (b.onclick = () => { caFilter = b.dataset.f; document.querySelectorAll('#ca-filter button').forEach((x) => x.classList.toggle('on', x === b)); renderCalls(); }));
$('ca-range').onchange = loadCalls;
$('ca-search').oninput = renderCalls;
