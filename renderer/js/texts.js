/* Texts: one conversation per number (patients, parents, new callers), answered right here. */
let txFilter = 'needs', txData = [], txOpen = null;
const WHO_TAG = { unknown: ['amber', 'Not a patient'], pending: ['blue', 'Not in RxNT yet'], contact: ['', 'RingRx contact'], shared: ['', 'Shared number'] };
const whoTag = (w) => (WHO_TAG[w.kind] ? `<span class="pill ${WHO_TAG[w.kind][0]}">${WHO_TAG[w.kind][1]}</span>` : '');
const whoName = (w, phone) => w.name || fmtPhone(phone);
const whoInitials = (w) => w.kind === 'unknown' ? I.phone : esc(initials({ first: (w.name || '').split(' ')[0], last: (w.name || '').split(' ')[1] }));

async function loadTexts(keep) {
  const days = +$('tx-range').value;
  $('tx-range-label').textContent = `${new Date(Date.now() - days * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric' })} – today`;
  txData = await loading(() => window.api.textThreads(days));
  if (!patients.length) { patients = await window.api.patients(); indexPatients(patients); }
  const n = txData.filter((t) => t.needs).length;
  document.querySelector('#tx-filter [data-f="needs"]').innerHTML = `Needs reply${n ? `<b>${n}</b>` : ''}`;
  renderTextList();
  if (txOpen && keep) openThread(txOpen, true);
  else if (!txOpen) $('tx-pane').innerHTML = `<div class="empty-state">${I.msg}<h3>Pick a conversation</h3><p>Texts from patients, and the texts you send from here or the RingRx app.</p></div>`;
}
function renderTextList() {
  const q = $('tx-search').value.trim().toLowerCase(), qd = digits(q);
  // Needs reply: waiting on us. Inbox: what patients sent (latest first). Sent: what we sent.
  const pick = { needs: (t) => t.needs && t.last, inbox: (t) => t.lastIn, sent: (t) => t.lastSent }[txFilter];
  const match = (t) => !q || (t.who.name || '').toLowerCase().includes(q) || (qd.length >= 3 && t.phone.includes(qd));
  const list = txData.filter((t) => pick(t) && match(t)).sort((a, b) => new Date(pick(b).at) - new Date(pick(a).at));
  $('tx-list').innerHTML = list.length ? list.map((t) => { const m = txFilter === 'needs' ? t.last : pick(t); return `
    <button class="trow-btn ${txOpen === t.phone ? 'active' : ''} ${t.unread ? 'unread' : ''}" data-p="${t.phone}">
      <span class="avatar ${t.who.kind === 'unknown' ? 'unk' : ''}">${whoInitials(t.who)}</span>
      <span class="mid"><b>${esc(whoName(t.who, t.phone))}</b><span class="prev">${txFilter === 'sent' || (txFilter === 'needs' && !t.last.inbound) ? 'You: ' : ''}${esc(String(m.body || '').slice(0, 70))}</span></span>
      <span class="when">${esc(shortWhen(m.at))}${t.unread ? '<i></i>' : ''}</span>
    </button>`; }).join('') : `<p class="muted small" style="padding:12px">${{ needs: 'Nothing waiting for a reply.', inbox: 'No texts received in this range.', sent: 'Nothing sent in this range.' }[txFilter]}</p>`;
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
      <div class="row-gap">${t.needs ? `<button class="btn" id="tx-done">${I.check}Mark done</button>` : ''}${rec ? '<button class="btn" id="tx-patient">Open patient</button>' : ''}${unknown ? `<button class="btn" id="tx-who">${I.user}Who is this?</button>` : ''}</div></div>
    <div class="convo-body" id="tx-body">${bubbles || '<p class="muted small center-text" style="margin-top:30px">No texts yet.</p>'}</div>
    ${rec && rec.dnt ? '<div class="convo-foot muted small">Marked do not text.</div>' : `<div class="convo-foot" id="tx-comp">${composerHTML(p, { rows: 3, placeholder: 'Write a reply…' })}<div class="row-gap foot-actions"><span class="from-chip">${sendFrom ? `${I.phone}From ${esc(fmtPhone(sendFrom))}` : ''}</span><span style="flex:1"></span><button class="btn primary" id="tx-send">${I.send}Send</button></div></div>`}`;
  const body = $('tx-body'); body.scrollTop = body.scrollHeight;
  if ($('tx-done')) $('tx-done').onclick = async () => { await window.api.markDone('t', phone); toast('Marked done'); loadTexts(true); };
  if ($('tx-patient')) $('tx-patient').onclick = () => openPatient(rec);
  if ($('tx-who')) $('tx-who').onclick = () => whoIsThis(phone, () => loadTexts(true));
  if ($('tx-comp')) {
    const rebind = () => { $('tx-comp').querySelector('.composer').outerHTML = composerHTML(p, { rows: 3, placeholder: 'Write a reply…' }); bindComposer($('tx-comp'), p, rebind); };
    bindComposer($('tx-comp'), p, rebind);
    $('tx-send').onclick = () => {
      if (!finalMessage(p)) return toast('Write a message first.');
      confirmAndSend([itemFor(p)], async () => { p.text = ''; await window.api.markDone('t', phone); window.api.commsSync().then(() => loadTexts(true)); history = await window.api.history(); loadTexts(true); });
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
      <button class="who-opt" data-a="block">${I.x}<b>Spam</b><span>Block the number in RingRx.</span></button>
    </div>
    <div class="actions"><button class="btn" id="w-cancel">Cancel</button></div>`);
  $('w-cancel').onclick = closeModal;
  $('modal').querySelectorAll('.who-opt').forEach((b) => (b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'contact' || a === 'block') { closeModal(); window.api.openRingrx('contacts'); toast(a === 'block' ? 'Opened RingRx contacts. Block the number there.' : 'Opened RingRx contacts. Add the name there.'); return; }
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

document.querySelectorAll('#tx-filter button').forEach((b) => (b.onclick = () => { txFilter = b.dataset.f; document.querySelectorAll('#tx-filter button').forEach((x) => x.classList.toggle('on', x === b)); renderTextList(); }));
$('tx-range').onchange = () => loadTexts(true);
$('tx-search').oninput = renderTextList;
