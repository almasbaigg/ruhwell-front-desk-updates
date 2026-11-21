/* Faxes: received in Doximity, filed into the patient's RxNT chart.
   The app never guesses the patient: Maria picks one, sees that chart's name, DOB and chart number read
   fresh from RxNT, confirms, and only then is the fax uploaded (then checked in the chart). */
let fxFilter = 'new', fxData = [], fxOpen = null, fxUrl = null;
const FX_CATS = ['Other', 'Consults', 'Lab Results', 'Imaging', 'Patient Chart', 'Insurance Scan', 'External CCR/CCD Documents', 'Advanced Directives', 'Patient Consent'];
const fxWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${dayLabel(iso)} · ${fmtTime(d)}`; };
const fxFrom = (f) => f.from || (f.number ? fmtPhone(digits(f.number)) || f.number : 'Unknown sender');
const dobText = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };

async function loadFaxes() {
  fxData = await window.api.faxList();
  if (!patients.length) { patients = await window.api.patients(); indexPatients(patients); }
  const n = fxData.filter((f) => f.status === 'new').length;
  document.querySelector('#fx-filter [data-f="new"]').innerHTML = `To file${n ? `<b>${n}</b>` : ''}`;
  renderFaxList();
  if (fxOpen && fxData.find((f) => f.id === fxOpen)) openFax(fxOpen, true); else if (!fxOpen) fxEmpty();
}
function fxEmpty() {
  const st = (window.__lastSync || {}).accounts || {};
  $('fx-pane').innerHTML = `<div class="empty-state">${I.check}<h3>${fxData.some((f) => f.status === 'new') ? 'Pick a fax' : 'No faxes waiting'}</h3><p>${(st.doximity || {}).level === 'off' ? 'Sign in to Doximity in Settings → Connections to bring faxes in here.' : 'New faxes from Doximity show up here. Pick one to file it into a patient\'s chart.'}</p></div>`;
}
function renderFaxList() {
  const list = fxData.filter((f) => (fxFilter === 'new' ? f.status === 'new' : f.status !== 'new'));
  let lastDay = '';
  $('fx-list').innerHTML = list.length ? list.map((f) => {
    const day = dayLabel(f.at), sep = day !== lastDay ? `<p class="list-day">${esc(day)}</p>` : ''; lastDay = day;
    const h = hoursSince(f.at), tag = f.status === 'filed' ? '<span class="rstat ok">Filed to chart ✓</span>' : f.status === 'notpatient' ? '<span class="rstat">Not patient-related</span>' : f.status === 'spam' ? '<span class="rstat">Spam</span>' : `<span class="wait u-${h >= 24 ? 'red' : h >= 4 ? 'amber' : 'green'}">${esc(waitLabel(f.at))}</span>`;
    return `${sep}<button class="trow-btn ${fxOpen === f.id ? 'active' : ''} ${f.status === 'new' ? 'unread' : ''}" data-id="${esc(f.id)}">
      <span class="avatar unk">${I.fax || '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 14h10v6H7z"/></svg>'}</span>
      <span class="mid"><b>${esc(fxFrom(f))}</b><span class="prev">${f.pages ? `${f.pages} page${f.pages > 1 ? 's' : ''} · ` : ''}${esc(fmtTime(new Date(f.at)))}</span></span>${tag}</button>`;
  }).join('') : `<div class="all-clear small-clear">${I.check}<b>${fxFilter === 'new' ? 'No faxes to file' : 'Nothing filed yet'}</b></div>`;
  $('fx-list').querySelectorAll('.trow-btn').forEach((b) => (b.onclick = () => openFax(b.dataset.id)));
}
async function previewHTML(f) {
  const file = await window.api.faxPdf(f.id);
  if (fxUrl) { URL.revokeObjectURL(fxUrl); fxUrl = null; }
  if (!file) return '<div class="fx-noprev">This fax couldn\'t be loaded. <button class="btn small" id="fx-dox">Open in Doximity</button></div>';
  if (file.mime !== 'application/pdf') return '<div class="fx-noprev">Preview isn\'t available for this fax (TIF). It can still be added to the chart. <button class="btn small" id="fx-dox">Open in Doximity</button></div>';
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  fxUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  return `<iframe class="fx-pdf" src="${fxUrl}#toolbar=1&navpanes=0&view=FitH" title="Fax preview"></iframe>`;
}
async function openFax(id, keep) {
  fxOpen = id; renderFaxList();
  const f = fxData.find((x) => x.id === id); if (!f) return fxEmpty();
  const prev = await previewHTML(f);
  const done = f.status !== 'new';
  $('fx-pane').innerHTML = `
    <div class="convo-head"><span class="avatar unk"><svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 14h10v6H7z"/></svg></span>
      <div><h2>${esc(fxFrom(f))}</h2><p class="muted small">${esc(f.number || '')}${f.pages ? ` · ${f.pages} page${f.pages > 1 ? 's' : ''}` : ''} · received ${esc(fxWhen(f.at))}</p></div>
      <div class="row-gap"><button class="btn small" id="fx-dox2">Open in Doximity</button>${done ? (f.status !== 'filed' ? '<button class="btn small" id="fx-back">Move back to To file</button>' : '') : '<button class="btn small" id="fx-np">Not patient-related</button><button class="btn small" id="fx-spam">Spam</button>'}</div></div>
    <div class="fx-body"><div class="fx-prev">${prev}</div><div class="fx-side" id="fx-side"></div></div>`;
  const dox = () => window.api.faxOpen(f.id);
  if ($('fx-dox')) $('fx-dox').onclick = dox; $('fx-dox2').onclick = dox;
  const mark = async (st, msg) => { await window.api.faxMark(f.id, st); toast(msg, async () => { await window.api.faxMark(f.id, 'new'); loadFaxes(); }); fxOpen = null; loadFaxes(); };
  if ($('fx-np')) $('fx-np').onclick = () => mark('notpatient', 'Marked not patient-related');
  if ($('fx-spam')) $('fx-spam').onclick = () => mark('spam', 'Marked as spam');
  if ($('fx-back')) $('fx-back').onclick = async () => { await window.api.faxMark(f.id, 'new'); loadFaxes(); };
  if (f.status === 'filed') { $('fx-side').innerHTML = `<div class="fx-done">${I.check}<b>Filed to chart</b><p>${esc((f.filed || {}).title || '')}</p><p class="muted small">Chart ${esc((f.filed || {}).chart || '')} · ${esc(fxWhen((f.filed || {}).at || f.doneAt))}</p></div>`; return; }
  if (done) { $('fx-side').innerHTML = '<p class="muted small">Not filed to a chart.</p>'; return; }
  pickPatientStep(f);
}
// Step 1: Maria picks the patient. Nothing is pre-selected or guessed.
function pickPatientStep(f) {
  const weekAgo = Date.now() - 7 * 864e5, weekOut = Date.now() + 7 * 864e5;
  const recent = (p) => { const t = new Date(p.visitAt || 0).getTime(); return t > weekAgo && t < weekOut; };
  $('fx-side').innerHTML = `<h3 class="fx-q">Which patient is this for?</h3>
    <label class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="fx-q" placeholder="Type a name or date of birth" autocomplete="off"></label>
    <div class="fx-results" id="fx-results"></div>`;
  const draw = () => {
    const q = $('fx-q').value.trim().toLowerCase(), qd = q.replace(/[^\d]/g, '');
    let hits = patients.filter((p) => p.first || p.last);
    if (q) hits = hits.filter((p) => `${p.first || ''} ${p.last || ''}`.toLowerCase().includes(q) || `${p.last || ''}, ${p.first || ''}`.toLowerCase().includes(q) || (qd.length >= 4 && dobText(p.dob).replace(/\D/g, '').includes(qd)));
    else hits = hits.filter(recent);
    hits = hits.sort((a, b) => (recent(b) - recent(a)) || String(a.last).localeCompare(String(b.last))).slice(0, 40);
    $('fx-results').innerHTML = (q ? '' : '<p class="muted small">This week\'s patients. Type to search everyone.</p>') + (hits.map((p) => `<button class="fx-pt" data-k="${esc(p.key)}"><b>${esc(fullName(p))}</b><span>DOB ${esc(dobText(p.dob) || '—')}${p.visitAt ? ` · visit ${esc(new Date(p.visitAt).toLocaleDateString([], { month: 'short', day: 'numeric' }))}` : ''}</span></button>`).join('') || '<p class="muted small">No matches</p>');
    $('fx-results').querySelectorAll('.fx-pt').forEach((b) => (b.onclick = () => confirmStep(f, patients.find((p) => p.key === b.dataset.k))));
  };
  $('fx-q').oninput = draw; draw(); setTimeout(() => $('fx-q') && $('fx-q').focus(), 50);
}
// Step 2: read that patient's chart fresh from RxNT and show it next to the fax. She must confirm.
async function confirmStep(f, p) {
  if (!p) return;
  $('fx-side').innerHTML = `<div class="fx-loading"><span class="spin"></span>Opening ${esc(fullName(p))}'s chart in RxNT…</div>`;
  const r = await window.api.faxFindChart(p.key);
  if (fxOpen !== f.id) return;
  if (!r || !r.patient) {
    const why = { signin: 'RxNT needs you to sign in (Settings → Connections).', several: 'RxNT has more than one chart that matches. Open RxNT to add this fax.', notfound: "Couldn't find this patient's chart in RxNT." }[(r || {}).error] || "Couldn't open the chart in RxNT.";
    $('fx-side').innerHTML = `<div class="fx-warn">${esc(why)}</div><div class="row-gap"><button class="btn" id="fx-again">Pick a different patient</button></div>`;
    $('fx-again').onclick = () => pickPatientStep(f); return;
  }
  const c = r.patient;
  $('fx-side').innerHTML = `<h3 class="fx-q">Is this the right patient?</h3>
    <div class="fx-chart"><p class="muted small">From RxNT, just now</p><b>${esc(`${c.last}, ${c.first}`)}</b><span>DOB <strong>${esc(c.dobText || dobText(c.dob))}</strong></span><span>Chart # <strong>${esc(c.chart || '—')}</strong></span></div>
    <label class="fx-cat">Save as <select id="fx-cat">${FX_CATS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
    <label class="check fx-ack"><input type="checkbox" id="fx-ack"><span></span>I checked the name and date of birth on the fax</label>
    <div class="row-gap"><button class="btn" id="fx-no">No, pick again</button><button class="btn primary" id="fx-yes" disabled>${I.check}Yes, add to this chart</button></div>`;
  $('fx-ack').onchange = (e) => { $('fx-yes').disabled = !e.target.checked; };
  $('fx-no').onclick = () => pickPatientStep(f);
  $('fx-yes').onclick = async () => {
    const cat = $('fx-cat').value;
    $('fx-side').innerHTML = `<div class="fx-loading"><span class="spin"></span>Adding the fax to ${esc(`${c.first} ${c.last}`)}'s chart, then checking it's there…</div>`;
    const res = await window.api.faxFile({ id: f.id, internalId: c.internalId, chart: c.chart, category: cat, confirmed: true });
    if (res && res.ok) { toast(`Filed to ${c.first} ${c.last}'s chart ✓`); fxOpen = f.id; loadFaxes(); return; }
    const why = { signin: 'RxNT needs you to sign in.', verify: "It may not have saved: the app couldn't find it in the chart afterwards. Check in RxNT before trying again.", chart: 'RxNT opened a different chart, so nothing was uploaded.', already: 'This fax is already filed.' }[(res || {}).error] || "Didn't upload. Nothing was added.";
    $('fx-side').innerHTML = `<div class="fx-warn">${esc(why)}</div><div class="row-gap"><button class="btn" id="fx-retry">Try again</button><button class="btn" id="fx-rx">Open in RxNT</button></div>`;
    $('fx-retry').onclick = () => confirmStep(f, p);
    $('fx-rx').onclick = () => window.api.openRxnt('todo');
  };
}
document.querySelectorAll('#fx-filter button').forEach((b) => (b.onclick = () => { fxFilter = b.dataset.f; document.querySelectorAll('#fx-filter button').forEach((x) => x.classList.toggle('on', x === b)); fxOpen = null; renderFaxList(); fxEmpty(); }));
$('fx-refresh').onclick = async () => { await syncEverything(['faxes']); loadFaxes(); };
window.api.onFaxes(() => { if (view === 'faxes') loadFaxes(); });
