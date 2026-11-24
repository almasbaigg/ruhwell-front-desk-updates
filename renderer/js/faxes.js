/* Faxes: received in Doximity, filed into the patient's RxNT chart.
   The app never guesses the patient: Maria picks one, sees that chart's name, DOB and chart number read
   fresh from RxNT, confirms, and only then is the fax uploaded (then checked in the chart). */
let fxFilter = fixFilter(recall('fx-filter', 'needs'), ['needs', 'all', 'done', 'spam']), fxData = [], fxOpen = null, fxUrl = null, fxSeq = 0, fxCat = '';
const FX_ORDER = ['Prior authorization', 'Pharmacy', 'Lab results', 'Records', 'Referral', 'Insurance', 'Other', 'Unreadable', 'Notice'];
const FX_CATS = ['Other', 'Consults', 'Lab Results', 'Imaging', 'Patient Chart', 'Insurance Scan', 'External CCR/CCD Documents', 'Advanced Directives', 'Patient Consent'];
const fxWhen = (iso, f) => { if (f && f.dateUnknown) return 'date unavailable'; const d = new Date(iso); return isNaN(d) ? '' : `${dayLabel(iso)} · ${fmtTime(d)}`; };
const fxFrom = (f) => f.from || (f.number ? fmtPhone(digits(f.number)) || f.number : 'Unknown sender');
const dobText = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };

const sugName = (x) => { const p = patients.find((q) => q.key === x.key); return p ? `${p.first || ''} ${String(p.last || '').slice(0, 1)}.`.trim() : 'a patient'; };
// Background sorting: draw the first pages of each new fax and have the app read them (OCR on this computer).
let fxSorting = false;
async function sortPending() {
  if (fxSorting || !window.pdfjsLib) return; fxSorting = true;
  try {
    const todo = (await window.api.faxList()).filter((f) => f.download === 'done' && !f.ocrAt);
    for (const f of todo) {
      const file = await window.api.faxPdf(f.id); if (!file || file.mime !== 'application/pdf') { await window.api.faxSort(f.id, []); continue; }
      const pages = [];
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0)), isEvalSupported: false }).promise;
        for (let n = 1; n <= Math.min(2, doc.numPages); n++) {
          const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 2, rotation: pg.rotate || 0 });
          const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
          await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
          pages.push(c.toDataURL('image/png').split(',')[1]);
        }
        doc.destroy();
      } catch {}
      await window.api.faxSort(f.id, pages);
      if (view === 'faxes') { fxData = await window.api.faxList(); renderFaxList(); }
    }
  } finally { fxSorting = false; }
}
let fxShown = null, fxPane = 0;   // which fax the pane is showing, and a token that changes each time the pane is rebuilt
async function loadFaxes() {
  fxData = await window.api.faxList();
  if (!patients.length) { patients = await window.api.patients(); indexPatients(patients); }
  filterCounts('fx-filter', { needs: fxData.filter((f) => f.status === 'new').length, unread: fxData.filter((f) => f.status === 'new' && !f.readAt).length });
  renderFaxList();
  // A background refresh only redraws the open fax if it actually changed, so a patient pick or
  // confirmation in progress isn't thrown away.
  const cur = fxOpen && fxData.find((f) => f.id === fxOpen);
  if (cur) { if (!fxShown || fxShown.id !== cur.id || fxShown.status !== cur.status || fxShown.download !== cur.download) openFax(fxOpen, true); }
  else if (!fxOpen) fxEmpty();
}
function fxEmpty() {
  fxShown = null; fxPane++;
  const st = (window.__lastSync || {}).accounts || {};
  const dx = st.doximity || {}, needSign = dx.why === 'not set up' || dx.level === 'red';
  $('fx-pane').innerHTML = needSign
    ? `<div class="empty-state"><h3>Doximity isn't signed in on this computer</h3><p>The app has its own Doximity sign-in. Sign in once and new faxes come in here by themselves.</p><button class="btn primary" id="fx-signin">Sign in to Doximity</button></div>`
    : `<div class="empty-state">${I.check}<h3>${fxData.some((f) => f.status === 'new') ? 'Pick a fax' : 'No faxes waiting'}</h3><p>New faxes from Doximity show up here. Pick one to file it into a patient's chart.</p></div>`;
  if ($('fx-signin')) $('fx-signin').onclick = async () => { if (await window.api.faxSignIn()) { toast('Doximity connected'); await syncEverything(['faxes']); loadFaxes(); } };
}
// Read / Done times under each fax, like Calls.
const fxShort = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? fmtTime(d) : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${fmtTime(d)}`; };
function fxTimes(f) {
  const bits = [];
  if (f.readAt) bits.push(`Read ${fxShort(f.readAt)}`);
  if (f.doneAt && f.status !== 'new') bits.push(`${f.status === 'filed' ? 'Filed' : f.status === 'spam' ? 'Spam' : 'Done'} ${fxShort(f.doneAt)}`);
  return bits.length ? `<span class="fx-times">${esc(bits.join(' · '))}</span>` : '';
}
function renderFaxList() {
  // Needs you = still to deal with · Unread = never opened · Done = filed or handled here (Not patient-related, Done) · Spam.
  const F = { needs: (f) => f.status === 'new', unread: (f) => f.status === 'new' && !f.readAt, all: (f) => f.status !== 'spam', done: (f) => ['filed', 'done', 'notpatient'].includes(f.status), spam: (f) => f.status === 'spam' };
  const base = fxData.filter(F[fxFilter] || F.needs);
  const counts = {}; base.forEach((f) => { const c = f.category || 'Sorting…'; counts[c] = (counts[c] || 0) + 1; });
  const cats = [...FX_ORDER.filter((c) => counts[c]), ...(counts['Sorting…'] ? ['Sorting…'] : [])];
  if (fxCat && !counts[fxCat]) fxCat = '';
  const chips = cats.length > 1 ? `<div class="fx-chips"><button class="${fxCat ? '' : 'on'}" data-c="">All <em>${base.length}</em></button>${cats.map((c) => `<button class="${fxCat === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} <em>${counts[c]}</em></button>`).join('')}</div>` : '';
  const list = base.filter((f) => !fxCat || (f.category || 'Sorting…') === fxCat);
  let lastDay = '';
  $('fx-list').innerHTML = list.length ? list.map((f) => {
    const day = f.dateUnknown ? 'Date unavailable' : dayLabel(f.at), sep = day !== lastDay ? `<p class="list-day">${esc(day)}</p>` : ''; lastDay = day;
    const h = hoursSince(f.at), tag = f.status === 'new' && f.download === 'failed' ? '<span class="rstat wait">Download failed</span>' : f.status === 'new' && f.download === 'pending' ? '<span class="rstat">Downloading…</span>' : f.status === 'filed' ? '<span class="rstat ok">Filed to chart ✓</span>' : f.status === 'done' ? '<span class="rstat ok">Done</span>' : f.status === 'notpatient' ? '<span class="rstat">Not patient-related</span>' : f.status === 'spam' ? '<span class="rstat">Spam</span>' : `<span class="wait u-${h >= 24 ? 'red' : h >= 4 ? 'amber' : 'green'}">${esc(waitLabel(f.at))}</span>`;
    return `${sep}<button class="trow-btn ${fxOpen === f.id ? 'active' : ''} ${f.status === 'new' && !f.readAt ? 'unread' : ''}" data-id="${esc(f.id)}">
      <span class="avatar unk">${I.fax || '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 14h10v6H7z"/></svg>'}</span>
      <span class="mid"><b>${esc(fxFrom(f))}${f.status === 'new' && !f.readAt ? '<i class="dot-new"></i>' : ''}</b><span class="prev">${f.category ? `<i class="fx-cat-tag c-${esc(f.category.toLowerCase().replace(/[^a-z]/g, ''))}">${esc(f.category)}</i>` : ''}${f.pages ? `${f.pages} page${f.pages > 1 ? 's' : ''} · ` : ''}${esc(f.dateUnknown ? 'time unknown' : fmtTime(new Date(f.at)))}</span>${(f.suggest || []).length && f.status === 'new' ? `<span class="fx-sug">Possibly ${esc(sugName(f.suggest[0]))}</span>` : ''}${fxTimes(f)}</span>${tag}</button>`;
  }).join('') : `<div class="all-clear small-clear">${I.check}<b>${{ needs: 'No faxes waiting', unread: 'Nothing unread', done: 'Nothing done yet', spam: 'No spam faxes' }[fxFilter] || 'No faxes'}</b></div>`;
  if (chips) $('fx-list').insertAdjacentHTML('afterbegin', chips);
  $('fx-list').querySelectorAll('.fx-chips button').forEach((b) => (b.onclick = () => { fxCat = b.dataset.c; renderFaxList(); }));
  $('fx-list').querySelectorAll('.trow-btn').forEach((b) => (b.onclick = () => openFax(b.dataset.id)));
}
// Fax preview: pages drawn by the bundled PDF viewer (pdf.js), straight from memory. Zoom and rotate.
let fxView = { zoom: 'fit', rot: 0, doc: null };
async function previewHTML(f) {
  const file = await window.api.faxPdf(f.id);
  if (fxUrl) { URL.revokeObjectURL(fxUrl); fxUrl = null; }
  if (!file) return `<div class="fx-noprev">${f.download === 'failed' ? "This fax didn't download from Doximity yet." : f.download === 'pending' ? 'Downloading from Doximity…' : "This fax couldn't be loaded."} <div class="row-gap">${f.download !== 'done' ? '<button class="btn small" id="fx-retry-dl">Retry download</button>' : ''}<button class="btn small" id="fx-dox">Open in Doximity</button></div></div>`;
  if (file.mime !== 'application/pdf') return '<div class="fx-noprev">This fax came as a TIF image, which can\'t be previewed here. It can still be added to the chart. <button class="btn small" id="fx-dox">Open in Doximity</button></div>';
  fxView.bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  return `<div class="fx-tools"><button class="icon-btn" id="fx-zo" title="Zoom out">−</button><span id="fx-zv">Fit</span><button class="btn small" id="fx-fit">Fit width</button><button class="icon-btn" id="fx-zi" title="Zoom in">+</button><button class="icon-btn" id="fx-rot" title="Rotate">⟳</button><span class="muted small" id="fx-pg"></span></div><div class="fx-pages" id="fx-pages"><div class="fx-loading"><span class="spin"></span>Opening the fax…</div></div>`;
}
async function drawPages(seq) {
  const host = $('fx-pages'); if (!host || !window.pdfjsLib || !fxView.bytes) return;
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
    const doc = fxView.doc && fxView.docFor === fxOpen ? fxView.doc : await pdfjsLib.getDocument({ data: fxView.bytes.slice(), isEvalSupported: false }).promise;
    if (seq !== fxSeq) return;
    fxView.doc = doc; fxView.docFor = fxOpen;
    host.innerHTML = ''; $('fx-pg').textContent = `${doc.numPages} page${doc.numPages > 1 ? 's' : ''}`;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n); if (seq !== fxSeq) return;
      // Keep the page's own rotation (faxes are often stored turned), plus any turn Maria adds. Default: fit width.
      const rot = ((page.rotate || 0) + fxView.rot) % 360, base = page.getViewport({ scale: 1, rotation: rot });
      const fit = Math.max(0.3, (host.clientWidth - 48) / base.width), scale = fxView.zoom === 'fit' ? fit : fxView.zoom;
      if (n === 1) $('fx-zv').textContent = `${Math.round(scale * 100)}%`;
      const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1), rotation: rot });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
      host.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
  } catch (e) { if (seq === fxSeq) host.innerHTML = `<div class="fx-noprev">The preview couldn't draw this fax. <button class="btn small" id="fx-dox3">Open in Doximity</button></div>`; const b = $('fx-dox3'); if (b) b.onclick = () => window.api.faxOpen(fxOpen); }
}
async function openFax(id, keep) {
  const seq = ++fxSeq;   // only the latest open may draw (clicking quickly must never show another fax's controls)
  if (fxOpen !== id) { if (fxView.doc) try { fxView.doc.destroy(); } catch {} fxView = { zoom: 'fit', rot: 0, doc: null }; }   // each fax opens upright, fit to width
  fxOpen = id; renderFaxList();
  const f = fxData.find((x) => x.id === id); if (!f) return fxEmpty();
  // Opening a fax marks it read (with the time), like texts and emails.
  if (!f.readAt && !keep) { const was = f.readAt; f.readAt = new Date().toISOString(); window.api.faxRead(f.id, true).then((ok) => { if (ok === false) { f.readAt = was; renderFaxList(); toast("Couldn't save that this fax was read."); } }); renderFaxList(); filterCounts('fx-filter', { needs: fxData.filter((x) => x.status === 'new').length, unread: fxData.filter((x) => x.status === 'new' && !x.readAt).length }); }
  const prev = await previewHTML(f);
  if (seq !== fxSeq || fxOpen !== id) return;
  const done = f.status !== 'new';
  // Header: who sent it and when; one primary action (Add to chart), Done, and the rest under ⋯.
  // The patient picker opens as a side sheet over the document, so the fax gets the full width.
  const meta = [f.number, f.pages ? `${f.pages} page${f.pages > 1 ? 's' : ''}` : '', `received ${fxWhen(f.at, f)}`].filter(Boolean).join(' · ');
  const filedNote = f.status === 'filed' ? `<span class="fx-filed">${I.check}Filed to chart ${esc((f.filed || {}).chart || '')}</span>` : '';
  fxShown = { id: f.id, status: f.status, download: f.download }; const pane = ++fxPane;
  $('fx-pane').innerHTML = `
    <div class="fx-head"><div class="fx-title"><h2>${esc(fxFrom(f))}</h2><p class="muted small">${esc(meta)}</p></div>
      <div class="row-gap">${filedNote}${done ? '' : `<button class="btn primary small" id="fx-add">Add to chart</button><button class="icon-btn" id="fx-done" title="Done">${I.check}</button>`}<div class="more-wrap"><button class="icon-btn row-more" id="fx-more" title="More">⋯</button><div class="more-menu hidden" id="fx-menu">${!['pending', 'failed'].includes(f.download) ? '<button id="fx-save">Download PDF</button>' : ''}<button id="fx-dox2">Open in Doximity</button>${done ? (f.status !== 'filed' ? '<button id="fx-back">Move back to To do</button>' : '') : '<button id="fx-unread">Mark unread</button><button id="fx-np">Not patient-related</button><button id="fx-spam">Spam</button>'}</div></div></div></div>
    <div class="fx-body"><div class="fx-prev">${prev}</div>
      <aside class="fx-sheet" id="fx-sheet" inert><button class="icon-btn fx-sheet-x" id="fx-sheet-x" title="Close">${I.x}</button><div class="fx-side" id="fx-side"></div></aside></div>`;
  // Closed sheet is inert (no keyboard focus inside it); closing returns focus to Add to chart.
  let focusT = null;
  const sheet = (open) => { const sh = $('fx-sheet'); if (!sh) return; sh.classList.toggle('open', open); sh.inert = !open; clearTimeout(focusT);
    if (open) focusT = setTimeout(() => { if (sh.classList.contains('open') && $('fx-q')) $('fx-q').focus(); }, 260); else if ($('fx-add')) $('fx-add').focus(); };
  $('fx-sheet-x').onclick = () => sheet(false);
  if ($('fx-add')) $('fx-add').onclick = () => sheet(true);
  drawPages(seq);
  if ($('fx-zo')) { const cur = () => (fxView.zoom === 'fit' ? (parseInt($('fx-zv').textContent, 10) || 100) / 100 : fxView.zoom);
    $('fx-zo').onclick = () => { fxView.zoom = Math.max(0.4, cur() - 0.15); drawPages(++fxSeq); }; $('fx-zi').onclick = () => { fxView.zoom = Math.min(3, cur() + 0.15); drawPages(++fxSeq); }; $('fx-fit').onclick = () => { fxView.zoom = 'fit'; drawPages(++fxSeq); }; $('fx-rot').onclick = () => { fxView.rot = (fxView.rot + 90) % 360; drawPages(++fxSeq); }; }
  if ($('fx-retry-dl')) $('fx-retry-dl').onclick = async () => { $('fx-retry-dl').disabled = true; const ok = await window.api.faxRetry(f.id); toast(ok ? 'Downloaded' : "Still couldn't download it. Open it in Doximity."); loadFaxes(); };
  if ($('fx-save')) $('fx-save').onclick = async () => { const r = await window.api.faxSave(f.id); if (r && r.ok) toast('Saved to ' + r.path.split(/[\\/]/).pop()); else if (r && r.error) toast("This fax isn't downloaded yet."); };
  const dox = () => window.api.faxOpen(f.id);
  if ($('fx-dox')) $('fx-dox').onclick = dox; $('fx-dox2').onclick = dox;
  // The list only changes once the mark is saved; Undo puts back exactly what it was.
  const mark = async (st, msg) => { const prev = f.status; if (!(await window.api.faxMark(f.id, st))) return toast("Couldn't save that. The fax stays where it was."); toast(msg, async () => { await window.api.faxMark(f.id, prev); loadFaxes(); }); fxOpen = null; loadFaxes(); };
  if ($('fx-done')) $('fx-done').onclick = () => mark('done', 'Marked done');
  if ($('fx-more')) $('fx-more').onclick = (e) => { e.stopPropagation(); $('fx-menu').classList.toggle('hidden'); };
  if ($('fx-unread')) $('fx-unread').onclick = async () => { const ok = await window.api.faxRead(f.id, false); if (ok === false) return toast("Couldn't mark it unread. It stays as it was."); f.readAt = null; fxOpen = null; toast('Marked unread'); loadFaxes(); };
  if ($('fx-np')) $('fx-np').onclick = () => mark('notpatient', 'Marked not patient-related');
  if ($('fx-spam')) $('fx-spam').onclick = () => mark('spam', 'Marked as spam');
  if ($('fx-back')) $('fx-back').onclick = async () => { await window.api.faxMark(f.id, 'new'); loadFaxes(); };
  if (done) return;
  pickPatientStep(f, pane);
  // A fax with a likely patient opens the sheet straight away (only when Maria opens it, not on a refresh).
  if ((f.suggest || []).length && !keep) sheet(true);
}
// Step 1: Maria picks the patient. Nothing is pre-selected or guessed.
function pickPatientStep(f, pane = fxPane) {
  const weekAgo = Date.now() - 7 * 864e5, weekOut = Date.now() + 7 * 864e5;
  // Patients seen in the last week or booked in the next week come first (from the schedule the app has read).
  const recent = (p) => [p.lastVisit, p.nextVisit].some((v) => { const t = v ? new Date(v).getTime() : 0; return t > weekAgo && t < weekOut; });
  const when = (p) => { const n = p.nextVisit && new Date(p.nextVisit) > Date.now() - 864e5 ? p.nextVisit : null; return n ? `next visit ${new Date(n).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : p.lastVisit ? `seen ${new Date(p.lastVisit).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : ''; };
  const sug = (f.suggest || []).map((x) => ({ ...x, p: patients.find((p) => p.key === x.key) })).filter((x) => x.p);
  $('fx-side').innerHTML = `<h3 class="fx-q">Which patient is this for?</h3>
    ${sug.length ? `<div class="fx-sugs"><p class="muted small">Found on the fax</p>${sug.map((x) => `<button class="fx-pt sug" data-k="${esc(x.p.key)}"><b>${esc(fullName(x.p))}</b><span>DOB ${esc(dobText(x.p.dob) || '—')} · matches ${esc(x.why)}</span></button>`).join('')}</div>` : ''}
    <label class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="fx-q" placeholder="Type a name or date of birth" autocomplete="off"></label>
    <div class="fx-results" id="fx-results"></div>`;
  const draw = () => {
    const q = $('fx-q').value.trim().toLowerCase(), qd = q.replace(/[^\d]/g, '');
    let hits = patients.filter((p) => p.first || p.last);
    if (q) hits = hits.filter((p) => `${p.first || ''} ${p.last || ''}`.toLowerCase().includes(q) || `${p.last || ''}, ${p.first || ''}`.toLowerCase().includes(q) || (qd.length >= 4 && dobText(p.dob).replace(/\D/g, '').includes(qd)));
    else hits = hits.filter(recent);
    hits = hits.sort((a, b) => (recent(b) - recent(a)) || String(a.last).localeCompare(String(b.last))).slice(0, 40);
    $('fx-results').innerHTML = (q || !hits.length ? '' : '<p class="muted small">This week\'s patients. Type to search everyone.</p>') + (hits.map((p) => `<button class="fx-pt" data-k="${esc(p.key)}"><b>${esc(fullName(p))}</b><span>DOB ${esc(dobText(p.dob) || '—')}${when(p) ? ` · ${esc(when(p))}` : ''}</span></button>`).join('') || `<p class="muted small">${q ? 'No matches. Try the last name or the date of birth (MM/DD/YYYY).' : 'No visits this week yet. Type a name or date of birth to search everyone.'}</p>`);
    $('fx-results').querySelectorAll('.fx-pt').forEach((b) => (b.onclick = () => confirmStep(f, patients.find((p) => p.key === b.dataset.k), pane)));
  };
  $('fx-side').querySelectorAll('.fx-sugs .fx-pt').forEach((b) => (b.onclick = () => confirmStep(f, patients.find((p) => p.key === b.dataset.k), pane)));
  $('fx-q').oninput = draw; draw();
}
// Step 2: read that patient's chart fresh from RxNT and show it next to the fax. She must confirm.
async function confirmStep(f, p, pane = fxPane) {
  if (!p) return;
  // Only the fax still on screen (same pane) may be touched by a late answer from RxNT.
  const live = () => fxOpen === f.id && fxPane === pane;
  if (!live()) return;
  $('fx-side').innerHTML = `<div class="fx-loading"><span class="spin"></span>Opening ${esc(fullName(p))}'s chart in RxNT…</div>`;
  const r = await window.api.faxFindChart(p.key, f.id);
  if (!live()) return;
  if (!r || !r.patient) {
    const why = { signin: 'RxNT needs you to sign in (Settings → Connections).', several: 'RxNT has more than one chart that matches. Open RxNT to add this fax.', notfound: "Couldn't find this patient's chart in RxNT.", mismatch: "The chart RxNT opened didn't match this patient (name, date of birth or chart number), so nothing will be added." }[(r || {}).error] || "Couldn't open the chart in RxNT.";
    $('fx-side').innerHTML = `<div class="fx-warn">${esc(why)}</div><div class="row-gap"><button class="btn" id="fx-again">Pick a different patient</button></div>`;
    $('fx-again').onclick = () => pickPatientStep(f, pane); return;
  }
  const c = r.patient;
  $('fx-side').innerHTML = `<h3 class="fx-q">Is this the right patient?</h3>
    <div class="fx-chart"><p class="muted small">From RxNT, just now</p><b>${esc(`${c.last}, ${c.first}`)}</b><span>DOB <strong>${esc(c.dobText || dobText(c.dob))}</strong></span><span>Chart # <strong>${esc(c.chart || '—')}</strong></span></div>
    <label class="fx-cat">Save as <select id="fx-cat">${FX_CATS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
    <label class="check fx-ack"><input type="checkbox" id="fx-ack"><span></span>I checked the name and date of birth on the fax</label>
    <div class="row-gap"><button class="btn" id="fx-no">No, pick again</button><button class="btn primary" id="fx-yes" disabled>${I.check}Yes, add to this chart</button></div>`;
  if (!c.chart) { $('fx-ack').closest('label').insertAdjacentHTML('beforebegin', '<div class="fx-warn">RxNT didn\'t return a chart number. Open the chart in RxNT to check it; this fax can\'t be filed from here until it does.</div>'); $('fx-ack').disabled = true; }
  $('fx-ack').onchange = (e) => { $('fx-yes').disabled = !e.target.checked || !c.chart; };
  $('fx-no').onclick = () => pickPatientStep(f, pane);
  $('fx-yes').onclick = async () => {
    const cat = $('fx-cat').value;
    $('fx-side').innerHTML = `<div class="fx-loading"><span class="spin"></span>Adding the fax to ${esc(`${c.first} ${c.last}`)}'s chart, then checking it's there…</div>`;
    let res = await window.api.faxFile({ id: f.id, internalId: c.internalId, chart: c.chart, category: cat, confirmed: true });
    if (res && res.ok) { toast(`Filed to ${c.first} ${c.last}'s chart ✓`); loadFaxes(); return; }   // a background filing just updates the list
    if (!live()) { if (res && res.error) toast("A fax you started filing wasn't filed. Open it to try again."); return; }
    if (res && res.error === 'notfound-after') {   // an earlier try didn't show up in the chart: ask before uploading again
      const again = await new Promise((done) => { $('fx-side').innerHTML = `<div class="fx-warn">An earlier try didn't show up in this chart. Look in RxNT first. Upload it again only if it's really not there.</div><div class="row-gap"><button class="btn" id="fx-look">Open in RxNT</button><button class="btn" id="fx-cancel">Cancel</button><button class="btn primary" id="fx-again2">It's not there. Upload again</button></div>`; $('fx-look').onclick = () => window.api.openRxnt('todo'); $('fx-cancel').onclick = () => done(false); $('fx-again2').onclick = () => done(true); });
      if (!again || !live()) return live() && openFax(f.id);
      $('fx-side').innerHTML = `<div class="fx-loading"><span class="spin"></span>Adding the fax, then checking it's there…</div>`;
      res = await window.api.faxFile({ id: f.id, internalId: c.internalId, chart: c.chart, category: cat, confirmed: true, again: true });
      if (res && res.ok) { toast(`Filed to ${c.first} ${c.last}'s chart ✓`); loadFaxes(); return; }
      if (!live()) { toast("A fax you started filing wasn't filed. Open it to try again."); return; }
    }
    const why = { signin: 'RxNT needs you to sign in.', uncertain: "RxNT didn't confirm it yet. Pressing the button again will only check the chart, not upload a second copy.", chart: 'RxNT opened a different chart, so nothing was uploaded.', already: 'This fax is already filed.', busy: 'Another fax is being filed. Try again in a moment.', confirm: 'Please pick the patient and confirm again.', nochart: "RxNT didn't return a chart number, so nothing was filed.", notready: "RxNT's form didn't take the file, so nothing was saved." }[(res || {}).error] || "Didn't upload. Nothing was added.";
    $('fx-side').innerHTML = `<div class="fx-warn">${esc(why)}</div><div class="row-gap"><button class="btn" id="fx-retry">Try again</button><button class="btn" id="fx-rx">Open in RxNT</button></div>`;
    $('fx-retry').textContent = (res || {}).error === 'uncertain' ? 'Check the chart' : 'Try again';
    $('fx-retry').onclick = () => confirmStep(f, p, pane);   // after an uncertain result the next confirm only checks the chart (main.js)
    $('fx-rx').onclick = () => window.api.openRxnt('todo');
  };
}
document.querySelectorAll('#fx-filter button').forEach((x) => x.classList.toggle('on', x.dataset.f === fxFilter));
document.querySelectorAll('#fx-filter button').forEach((b) => (b.onclick = () => { fxFilter = b.dataset.f; remember('fx-filter', fxFilter); document.querySelectorAll('#fx-filter button').forEach((x) => x.classList.toggle('on', x === b)); fxOpen = null; renderFaxList(); fxEmpty(); }));
$('fx-refresh').onclick = async () => { await syncEverything(['faxes']); loadFaxes(); };
window.api.onFaxes(() => { if (view === 'faxes') loadFaxes(); sortPending(); });
setTimeout(sortPending, 8000);
