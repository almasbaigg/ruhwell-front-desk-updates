/* Texts: one conversation per number (patients, parents, new callers), answered right here. */
let txFilter = recall('tx-filter', 'needs'), txData = [], txOpen = null;
const WHO_TAG = { unknown: ['amber', 'Not a patient'], pending: ['blue', 'Not in RxNT yet'], contact: ['', 'RingRx contact'], shared: ['', 'Shared number'] };
const whoTag = (w) => (WHO_TAG[w.kind] ? `<span class="pill ${WHO_TAG[w.kind][0]}">${WHO_TAG[w.kind][1]}</span>` : '');
const whoName = (w, phone) => w.name || fmtPhone(phone);
const whoInitials = (w) => w.kind === 'unknown' ? I.phone : esc(initials({ first: (w.name || '').split(' ')[0], last: (w.name || '').split(' ')[1] }));

// "Answered · called back 3:40" / "texted back" / "handled"
const answerLabel = (a) => `Answered · ${a.how} ${fmtTime(new Date(a.at))}`;
// Spam: patients' numbers ask first. Shared by Texts and Calls (one list).
async function markSpamFlow(t, after) {
  const force = ['patient', 'pending', 'shared'].includes(t.who.kind);
  const doIt = async () => {
    closeModal(); await window.api.markSpam(t.phone, true, force);
    toast('Marked as spam. Future calls and texts from this number go to Spam.', async () => { await window.api.markSpam(t.phone, false); after && after(); });
    after && after();
  };
  if (['patient', 'pending', 'shared'].includes(t.who.kind)) {
    openModal(`<h2>This is a patient's number</h2><p>${esc(whoName(t.who, t.phone))} · ${esc(fmtPhone(t.phone))}. Mark it as spam anyway?</p><div class="actions"><button class="btn" id="sp-no">Cancel</button><button class="btn danger" id="sp-yes">Mark as spam</button></div>`);
    $('sp-no').onclick = closeModal; $('sp-yes').onclick = doIt; return;
  }
  doIt();
}
async function loadTexts(keep) {
  const days = +$('tx-range').value;
  $('tx-range-label').textContent = `${new Date(Date.now() - days * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric' })} – today`;
  txData = await loading(() => window.api.textThreads(days));
  if (!patients.length) { patients = await window.api.patients(); indexPatients(patients); }
  const n = txData.filter((t) => t.needs).length, nu = txData.filter((t) => !t.spam && t.unread).length, na = txData.filter((t) => !t.spam && t.lastIn && !t.answer && !t.who.dnt).length;
  document.querySelector('#tx-filter [data-f="needs"]').innerHTML = `Needs reply${n ? `<b>${n}</b>` : ''}`;
  document.querySelector('#tx-filter [data-f="unread"]').innerHTML = `Unread${nu ? `<b>${nu}</b>` : ''}`;
  document.querySelector('#tx-filter [data-f="unanswered"]').innerHTML = `Unanswered${na ? `<b>${na}</b>` : ''}`;
  renderTextList();
  if (txOpen && keep) openThread(txOpen, true);
  else if (!txOpen) $('tx-pane').innerHTML = `<div class="empty-state">${I.msg}<h3>Pick a conversation</h3><p>Texts from patients, and the texts you send from here or the RingRx app.</p></div>`;
}
function renderTextList() {
  const q = $('tx-search').value.trim().toLowerCase(), qd = digits(q);
  // Needs reply: waiting on us. Inbox: what patients sent (latest first). Sent: what we sent.
  const pick = { needs: (t) => !t.spam && t.needs && t.last, unread: (t) => !t.spam && t.unread && t.lastIn, unanswered: (t) => !t.spam && t.lastIn && !t.answer && !t.who.dnt && t.lastIn, inbox: (t) => !t.spam && t.lastIn, sent: (t) => t.lastSent, spam: (t) => t.spam && t.last }[txFilter] || ((t) => t.last);
  const match = (t) => !q || (t.who.name || '').toLowerCase().includes(q) || (qd.length >= 3 && t.phone.includes(qd));
  const list = txData.filter((t) => pick(t) && match(t)).sort((a, b) => new Date(pick(b).at) - new Date(pick(a).at));
  // Grouped by day so a long list reads in chunks; in Needs reply, how long they've waited is colored by urgency.
  let lastDay = '';
  $('tx-list').innerHTML = list.length ? list.map((t) => { const m = txFilter === 'needs' ? t.last : pick(t);
    const day = dayLabel(m.at), sep = day !== lastDay ? `<p class="list-day">${esc(day)}</p>` : ''; lastDay = day;
    const h = hoursSince(m.at), wait = txFilter === 'needs' && m.inbound ? `<span class="wait u-${h >= 4 ? 'red' : h >= 1 ? 'amber' : 'green'}">${esc(waitLabel(m.at))}</span>` : `<span class="when">${esc(shortWhen(m.at))}</span>`;
    return `${sep}
    <button class="trow-btn ${txOpen === t.phone ? 'active' : ''} ${t.unread ? 'unread' : ''}" data-p="${t.phone}">
      <span class="avatar ${t.who.kind === 'unknown' ? 'unk' : ''}">${whoInitials(t.who)}</span>
      <span class="mid"><b>${esc(whoName(t.who, t.phone))}${t.unread ? '<i class="dot-new"></i>' : ''}</b>${t.lastIn && !t.spam ? `<span class="rstat ${t.answer ? 'ok' : 'wait'}">${t.answer ? esc(answerLabel(t.answer)) : 'Unanswered'}</span>` : ''}<span class="prev">${txFilter === 'sent' || (txFilter === 'needs' && !t.last.inbound) ? 'You: ' : ''}${esc(String(m.body || '').slice(0, 60))}</span></span>
      ${wait}
    </button>`; }).join('') : `<div class="all-clear small-clear">${I.check}<b>${{ needs: 'Nothing waiting for a reply', inbox: 'No texts received in this range', sent: 'Nothing sent in this range' }[txFilter] || { unread: 'Nothing unread', unanswered: 'Every text has been answered', spam: 'No spam numbers' }[txFilter]}</b></div>`;
  $('tx-list').querySelectorAll('.trow-btn').forEach((b) => (b.onclick = () => openThread(b.dataset.p)));
}

async function openThread(phone, keepDraft) {
  if (view !== 'texts') { go('texts'); await new Promise((r) => setTimeout(r, 60)); }
  txOpen = phone;
  const tr = txData.find((x) => x.phone === phone); if (tr && tr.unread) { tr.unread = 0; window.api.markSeen(phone); }
  renderTextList();
  const t = txData.find((x) => x.phone === phone) || { phone, who: { kind: 'unknown', name: '' }, needs: null };
  const msgs = await window.api.thread(phone);
  const rec = recordFor({ phone });
  const draft = keepDraft && txOpen === phone && $('tx-pane').querySelector('textarea') ? $('tx-pane').querySelector('textarea').value : '';
  const p = rec ? { ...rec, rec, text: draft, templateId: null } : { first: '', last: '', phone, text: draft, templateId: null };
  p.greet = greetName(p, rec);
  let lastDay = '';
  const bubbles = msgs.map((m) => {
    const d = new Date(m.at), day = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const sep = day !== lastDay ? `<div class="day-sep">${esc(day)}</div>` : ''; lastDay = day;
    return `${sep}<div class="bubble-row ${m.inbound ? 'in' : 'out'}"><div class="bubble">${esc(m.body)}</div><span class="meta-line">${esc(fmtTime(d))}${m.inbound ? '' : ` · ${esc(m.via === 'Front Desk' ? 'Front Desk' : 'RingRx app')}`}</span></div>`;
  }).join('');
  const unknown = t.who.kind === 'unknown';
  $('tx-pane').innerHTML = `
    <div class="convo-head"><span class="avatar ${unknown ? 'unk' : ''}">${whoInitials(t.who)}</span>
      <div><h2>${esc(whoName(t.who, phone))} ${whoTag(t.who)}</h2>${unknown ? '' : `<p class="muted small">${esc(fmtPhone(phone))}</p>`}</div>
      <div class="row-gap">${t.needs ? `<button class="btn" id="tx-done">${I.check}Mark done</button>` : ''}${rec ? '<button class="btn" id="tx-patient">Open patient</button>' : ''}${unknown ? `<button class="btn" id="tx-who">${I.user}Who is this?</button>` : ''}<button class="btn" id="tx-unread" title="Mark unread">Mark unread</button>${t.spam ? '<button class="btn" id="tx-block">Block in RingRx</button><button class="btn" id="tx-notspam">Not spam</button>' : `<button class="btn spam-btn" id="tx-spam" title="Mark this number as spam">${I.x}Spam</button>`}</div></div>
    ${t.lastIn ? `<div class="receipt-line">${t.readAt ? `Read ${esc(fmtTime(new Date(t.readAt)))}` : 'New'} · ${t.answer ? esc(answerLabel(t.answer)) : '<b class="amber-t">Unanswered</b>'}</div>` : ''}
    <div class="convo-body" id="tx-body">${bubbles || '<p class="muted small center-text" style="margin-top:30px">No texts yet.</p>'}</div>
    ${rec && rec.dnt ? '<div class="convo-foot muted small">Marked do not text.</div>' : `<div class="convo-foot" id="tx-comp">${composerHTML(p, { rows: 3, placeholder: 'Write a reply…' })}<div class="row-gap foot-actions"><span class="from-chip">${sendFrom ? `${I.phone}From ${esc(fmtPhone(sendFrom))}` : ''}</span><span style="flex:1"></span><button class="btn primary" id="tx-send">${I.send}Send</button></div></div>`}`;
  const body = $('tx-body'); body.scrollTop = body.scrollHeight;
  if ($('tx-done')) $('tx-done').onclick = async () => { await window.api.markDone('t', phone); bumpDone(); toast('Marked done'); loadTexts(true); };
  if ($('tx-patient')) $('tx-patient').onclick = () => openPatient(rec);
  $('tx-unread').onclick = async () => { await window.api.markUnseen(phone); txOpen = null; toast('Marked unread', async () => { await window.api.markSeen(phone); loadTexts(true); }); loadTexts(true); };
  if ($('tx-spam')) $('tx-spam').onclick = () => markSpamFlow(t, () => { txOpen = null; loadTexts(true); });
  if ($('tx-block')) $('tx-block').onclick = () => { window.api.openRingrx('block'); toast('Opened RingRx. Add the number to your block list there.'); };
  if ($('tx-notspam')) $('tx-notspam').onclick = async () => { await window.api.markSpam(phone, false); toast('Not spam'); loadTexts(true); };
  if ($('tx-who')) $('tx-who').onclick = () => whoIsThis(phone, () => loadTexts(true));
  if ($('tx-comp')) {
    const rebind = () => { $('tx-comp').querySelector('.composer').outerHTML = composerHTML(p, { rows: 3, placeholder: 'Write a reply…' }); bindComposer($('tx-comp'), p, rebind); };
    bindComposer($('tx-comp'), p, rebind);
    $('tx-send').onclick = () => {
      if (!finalMessage(p)) return toast('Write a message first.');
      confirmAndSend([itemFor(p)], async () => { p.text = ''; await window.api.markDone('t', phone); bumpDone(); window.api.commsSync().then(() => loadTexts(true)); history = await window.api.history(); loadTexts(true); });
    };
  }
}

// Unknown numbers: link to an RxNT patient, add as a new patient, or handle in RingRx.
function whoIsThis(phone, after) {
  openModal(`<h2>Who is ${esc(fmtPhone(phone))}?</h2>
    <div class="who-options">
      <button class="who-opt" data-a="link">${I.user}<b>An existing patient</b><span>A patient or parent texting from a new number. Links it to their record.</span></button>
      <button class="who-opt" data-a="new">${I.plus}<b>A new patient</b><span>Not in RxNT yet. Links up automatically once they're registered.</span></button>
      <button class="who-opt" data-a="contact">${I.edit}<b>Pharmacy, lab or office</b><span>Save the name in RingRx contacts so it shows everywhere.</span></button>
      <button class="who-opt" data-a="block">${I.x}<b>Spam</b><span>Moves it to Spam and mutes this number from now on.</span></button>
    </div>
    <div class="actions"><button class="btn" id="w-cancel">Cancel</button></div>`);
  $('w-cancel').onclick = closeModal;
  $('modal').querySelectorAll('.who-opt').forEach((b) => (b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'block') { closeModal(); return markSpamFlow({ phone, who: { kind: 'unknown' } }, after); }
    if (a === 'contact') { closeModal(); window.api.openRingrx('contacts'); toast('Opened RingRx contacts. Add the name there.'); return; }
    if (a === 'new') { closeModal(); return patientForm(async () => { closeModal(); toast('Saved as a new patient'); after && after(); }, { phone, pending: true }); }
    linkToPatient(phone, after);
  }));
}
function linkToPatient(phone, after) {
  openModal(`<h2>Link ${esc(fmtPhone(phone))} to a patient</h2>
    <label class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="lk-q" placeholder="Search patient name" autocomplete="off"></label>
    <div id="lk-list" class="lines" style="max-height:260px;overflow:auto"></div>
    <div class="actions"><button class="btn" id="lk-cancel">Cancel</button></div>`);
  const draw = () => {
    const q = $('lk-q').value.trim().toLowerCase();
    const hits = patients.filter((p) => !q || `${p.first} ${p.last}`.toLowerCase().includes(q)).slice(0, 30);
    $('lk-list').innerHTML = hits.map((p) => `<div class="line"><div><strong>${esc(fullName(p))}</strong><div class="muted small">${esc(fmtPhone(p.phone) || 'No phone')}${p.chart ? ' · Chart ' + esc(p.chart) : ''}</div></div><button class="btn" data-k="${esc(p.key)}">Link</button></div>`).join('') || '<p class="muted small">No matches</p>';
    $('lk-list').querySelectorAll('button[data-k]').forEach((b) => (b.onclick = async () => {
      const rec = patients.find((p) => p.key === b.dataset.k);
      await window.api.updatePatient(rec.key, { otherPhones: [...new Set([...(rec.otherPhones || []), phone])] });
      patients = await window.api.patients(); indexPatients(patients);
      closeModal(); toast(`Linked to ${fullName(rec)}`); after && after();
    }));
  };
  $('lk-q').oninput = draw; draw(); $('lk-cancel').onclick = closeModal; setTimeout(() => $('lk-q').focus(), 50);
}

document.querySelectorAll('#tx-filter button').forEach((b) => (b.onclick = () => { txFilter = b.dataset.f; remember('tx-filter', txFilter); document.querySelectorAll('#tx-filter button').forEach((x) => x.classList.toggle('on', x === b)); renderTextList(); }));
$('tx-range').onchange = () => loadTexts(true);
$('tx-search').oninput = renderTextList;

// A notification click lands on the exact conversation.
window.api.onOpenThread(async (phone) => { if (!phone) return; go('texts'); await loadTexts(true); openThread(phone); });

document.querySelectorAll('#tx-filter button').forEach((x) => x.classList.toggle('on', x.dataset.f === txFilter));
