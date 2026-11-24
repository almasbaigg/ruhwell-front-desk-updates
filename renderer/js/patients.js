/* Patients list, patient details, New patient and New message. */
/* ---------- Patients ---------- */
const isMinor = (p) => p.age != null && p.age < 18;
async function loadPatients(keep) {
  patients = (await window.api.patients()).sort((a, b) => `${a.last} ${a.first}`.localeCompare(`${b.last} ${b.first}`));
  indexPatients(patients); history = await window.api.history(); await refreshCallsCache().catch(() => {});
  if (keep && activePatient) { const r = patients.find((p) => p.key === activePatient.key); if (r) Object.assign(activePatient, { ...r, text: activePatient.text, templateId: activePatient.templateId }); }
  renderPatients();
  if (!activePatient) $('p-compose').innerHTML = `<div class="empty-state"><h3>Select a patient</h3><p>Search by name or number, or press ${isMac ? '⌘F' : 'Ctrl+F'}.</p></div>`;
}
document.querySelectorAll('#p-tabs button').forEach((b) => (b.onclick = () => { pTab = b.dataset.tab; pFilter = 'all'; document.querySelectorAll('#p-tabs button').forEach((x) => x.classList.toggle('on', x === b)); renderPatients(); }));
// Same phone + similar last name = probably the same person entered twice (siblings sharing a parent's phone differ by name).
function findDupes() {
  const by = {}, out = new Set();
  patients.forEach((p) => { if (p.phone) (by[p.phone] = by[p.phone] || []).push(p); });
  Object.values(by).forEach((g) => { for (const a of g) for (const b of g) if (a !== b && String(a.last || '').slice(0, 3).toLowerCase() === String(b.last || '').slice(0, 3).toLowerCase() && String(a.first || '')[0]?.toLowerCase() === String(b.first || '')[0]?.toLowerCase()) { out.add(a.key); out.add(b.key); } });
  return out;
}
let dupes = new Set();
function renderPatients() {
  dupes = findDupes();
  const pool = patients.filter((p) => (pTab === 'dnt' ? p.dnt : !p.dnt));
  const F = { all: () => true, nophone: (p) => !p.phone, notcell: (p) => p.phone && /home|listed|saved/i.test(p.phoneSource || ''), edited: (p) => p.phoneSource === 'Typed', minor: isMinor };
  $('p-sub').textContent = `${patients.filter((p) => !p.dnt).length} patients · ${patients.filter((p) => p.dnt).length} do not text`;
  $('p-chips').innerHTML = pTab === 'dnt' ? '' : [['all', 'All'], ['nophone', 'No phone'], ['notcell', 'Not cell'], ['edited', 'Edited'], ['minor', 'Minors']].map(([k, l]) => `<button class="chip ${pFilter === k ? 'on' : ''}" data-k="${k}">${l}<b>${pool.filter(F[k]).length}</b></button>`).join('');
  $('p-chips').querySelectorAll('.chip').forEach((c) => (c.onclick = () => { pFilter = c.dataset.k; renderPatients(); }));
  const q = $('p-search').value.trim().toLowerCase(), qd = digits(q);
  const list = pool.filter(F[pFilter] || F.all).filter((p) => !q || `${p.first} ${p.last}`.toLowerCase().includes(q) || `${p.last}, ${p.first}`.toLowerCase().includes(q) || (qd.length >= 3 && digits(p.phone).includes(qd)));
  $('p-list').innerHTML = list.length ? list.slice(0, 600).map((p) => `
    <div class="prow ${activePatient && activePatient.key === p.key ? 'active' : ''}" data-key="${esc(p.key)}"><div class="avatar">${esc(initials(p))}</div>
    <div style="min-width:0"><strong>${esc(fullName(p))}</strong><p class="small ${p.phone ? 'muted' : 'bad'}">${p.phone ? esc(fmtPhone(p.phone)) : 'No phone'}${p.phoneSource === 'Typed' ? ' · edited' : /home/i.test(p.phoneSource || '') ? ' · home' : ''}${isMinor(p) ? ' · minor' : ''}${p.pending ? ' · not in RxNT yet' : ''}${dupes.has(p.key) ? ' · possible duplicate' : ''}${p.dnt && p.dntReason ? ' · ' + esc(p.dntReason) : ''}</p></div></div>`).join('')
    : `<p class="muted small" style="padding:10px">${patients.length ? 'No matches' : 'Syncing from RxNT…'}</p>`;
  $('p-list').querySelectorAll('.prow').forEach((r) => (r.onclick = () => { const rec = patients.find((p) => p.key === r.dataset.key); activePatient = { ...rec, text: '', templateId: null }; renderPatients(); renderCompose(); }));
  if (activePatient && !patients.find((p) => p.key === activePatient.key)) activePatient = null;
}
$('p-search').oninput = renderPatients;
function renderCompose() {
  const p = activePatient; if (!p) return;
  p.greet = greetName(p, p);
  const rv = lastReview(p.phone), lastText = history.find((h) => digits(h.phone) === digits(p.phone)), lastC = lastCall(p.phone);
  const last = [lastText && { at: lastText.at, label: lastText.direction === 'in' ? 'Reply' : 'Text' }, lastC && { at: lastC.at, label: lastC.missed ? 'Missed call' : 'Call' }].filter(Boolean).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  $('p-compose').innerHTML = `
    <div class="compose-top"><div class="avatar">${esc(initials(p))}</div>
      <div><h2>${esc(fullName(p))}</h2><p class="muted small">${[p.dob ? 'DOB ' + esc(p.dob) : '', p.age != null ? esc(p.age) + ' yrs' : '', p.chart ? 'Chart ' + esc(p.chart) : '', p.lastVisit ? 'Last visit ' + esc(new Date(p.lastVisit).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })) : '', p.nextVisit ? 'Next visit ' + esc(new Date(p.nextVisit).toLocaleDateString([], { month: 'short', day: 'numeric' })) + ' ' + esc(fmtTime(p.nextVisit)) : ''].filter(Boolean).join(' · ') || 'Added in app'}</p></div>
      <label class="switch"><input type="checkbox" id="c-dnt" ${p.dnt ? 'checked' : ''}><span></span><b class="small">Do not text</b></label></div>
    <div class="meta" style="margin-top:-4px">${phoneBadge(p, p)}${minorBadge(p, p)}${p.pending ? '<span class="pill blue">Not in RxNT yet</span>' : ''}${dupes.has(p.key) ? '<span class="pill amber" title="Another record has the same phone and a similar name">Possible duplicate</span>' : ''}${(p.otherPhones || []).length ? `<span class="pill">Also texts from ${esc(p.otherPhones.map(fmtPhone).join(', '))}</span>` : ''}${p.dnt && p.dntReason ? `<span class="pill red">${esc(p.dntReason)}</span>` : ''}${rv ? `<span class="pill teal">Google review asked ${esc(rv.toLocaleDateString([], { month: 'short', day: 'numeric' }))}</span>` : ''}${last ? `<span class="pill">Last contact: ${esc(last.label)} · ${esc(new Date(last.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</span>` : ''}</div>
    <div class="field-grid">
      <label class="field"><span>Phone${p.phoneSource ? ' · ' + esc(p.phoneSource === 'Typed' ? 'edited in app' : p.phoneSource) : ''}</span><input id="c-phone" value="${esc(fmtPhone(p.phone))}" placeholder="No phone in RxNT"></label>
      <label class="field"><span>Texts go to</span><select id="c-to"><option value="patient">Patient</option><option value="parent" ${p.contactType === 'parent' ? 'selected' : ''}>Parent / guardian</option></select></label>
      <label class="field" style="grid-column:1/-1"><span>Email${p.emailTyped ? ' · edited in app' : p.email ? ' · from RxNT' : ''}</span><div class="row-gap"><input id="c-email" value="${esc(p.emailTyped || p.email || '')}" placeholder="No email in RxNT" style="flex:1"><button class="btn small" id="c-mail" ${p.emailTyped || p.email ? '' : 'disabled'}>${I.mail}Email</button><button class="btn small" id="c-welcome" ${p.emailTyped || p.email ? '' : 'disabled'}>Welcome email</button></div></label>
      ${p.contactType === 'parent' ? `<label class="field" style="grid-column:1/-1"><span>Parent / guardian name${p.contactSource === 'RxNT' ? ' · from RxNT' : ''}</span><input id="c-cname" value="${esc(p.contactName || '')}" placeholder="Used in the greeting"></label>` : ''}
    </div>
    ${p.phoneSource === 'Typed' && p.rxPhone && p.rxPhone !== p.phone ? `<p class="small muted">RxNT has ${esc(fmtPhone(p.rxPhone))} · <button class="link-btn" id="c-revert">Use RxNT number</button></p>` : ''}
    ${p.dnt ? '<div class="empty-state" style="padding:20px">Marked do not text</div>' : `<div id="c-comp">${composerHTML(p, { rows: 7 })}</div>
    <div class="row-gap"><span class="from-chip">${sendFrom ? `${I.phone}From ${esc(fmtPhone(sendFrom))}` : ''}</span><span style="flex:1"></span><button class="btn primary" id="c-send">${I.send}Send</button></div>`}
    <div id="c-timeline"></div>`;
  paintTimeline(p);
  const save = async (f) => { Object.assign(p, f); await window.api.updatePatient(p.key, f); const i = patients.findIndex((x) => x.key === p.key); if (i >= 0) Object.assign(patients[i], f); };
  // Email: RxNT's address, unless one is typed here (that one wins and survives RxNT refreshes).
  $('c-email').onchange = async () => { const v = $('c-email').value.trim(); if (v && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return toast('That email looks off.'); await save({ emailTyped: v && v !== p.email ? v : '' }); renderCompose(); };
  $('c-mail').onclick = () => emailCompose({ to: (p.emailTyped || p.email || '').trim(), who: { ...p, email: (p.emailTyped || p.email || '').trim() } });
  $('c-welcome').onclick = () => welcomeEmail(p);
  $('c-dnt').onchange = async (e) => {
    const on = e.target.checked, stop = !on && await window.api.optOutStatus(p.phone);
    if (stop) {   // the number itself said STOP: turning texts back on needs a clear yes from them
      e.target.checked = true;
      openModal(`<h2>This number replied STOP</h2><p class="muted">${esc(fmtPhone(p.phone))} replied STOP on ${esc(new Date(stop.at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))}. Only turn texts back on if they asked to get texts again (for example, they replied START).</p><div class="actions"><button class="btn" id="oo-no">Keep blocked</button><button class="btn primary" id="oo-yes">They opted back in</button></div>`);
      $('oo-no').onclick = closeModal;
      $('oo-yes').onclick = async () => { closeModal(); await window.api.optOutClear(p.phone); await save({ dnt: false, dntReason: '' }); renderPatients(); renderCompose(); toast('Texts turned back on for this number'); };
      return;
    }
    await save({ dnt: on, dntReason: on ? 'Marked in app' : '' }); renderPatients(); renderCompose(); toast(on ? 'Moved to Do not text' : 'Moved to Contacts');
  };
  $('c-phone').onchange = async (e) => { const d = digits(e.target.value); if (d && d.length !== 10) return toast('Enter a 10-digit number.'); await save({ phone: d, phoneSource: d ? 'Typed' : '' }); renderPatients(); renderCompose(); };
  if ($('c-revert')) $('c-revert').onclick = async () => { await save({ phone: p.rxPhone, phoneSource: p.rxPhoneSource || 'Cell' }); renderPatients(); renderCompose(); toast('Using the RxNT number'); };
  $('c-to').onchange = async (e) => { await save({ contactType: e.target.value, contactSetInApp: true, contactSource: 'app' }); renderCompose(); };
  if ($('c-cname')) $('c-cname').onchange = async (e) => { await save({ contactName: e.target.value.trim(), contactSetInApp: true, contactSource: 'app' }); renderCompose(); };
  const ap = $('p-compose').querySelector('.act-parent'); if (ap) ap.onclick = () => { const rec = patients.find((x) => x.key === p.key); parentModal(rec, () => { Object.assign(p, rec); renderPatients(); renderCompose(); }); };
  if ($('c-comp')) {
    const rebind = () => { $('c-comp').innerHTML = composerHTML(p, { rows: 7 }); bindComposer($('c-comp'), p, rebind); };
    bindComposer($('c-comp'), p, rebind);
    $('c-send').onclick = () => {
      if (digits(p.phone).length !== 10) return toast('Enter a valid 10-digit phone number.');
      if (!finalMessage(p)) return toast('Write a message first.');
      confirmAndSend([itemFor(p)], async () => { history = await window.api.history(); p.text = ''; p.templateId = null; renderCompose(); });
    };
  }
}
function patientForm(onSave, preset = {}) {
  openModal(`<h2>New patient</h2>${preset.pending ? '<p class="muted small">Saved here until they\'re registered in RxNT, then linked automatically by phone.</p>' : ''}
    <div class="field-grid"><label class="field"><span>First name</span><input id="n-first"></label><label class="field"><span>Last name</span><input id="n-last"></label></div>
    <label class="field"><span>Phone</span><input id="n-phone" placeholder="(555) 555-5555" value="${esc(preset.phone ? fmtPhone(preset.phone) : '')}"></label>
    <div class="field-grid"><label class="field"><span>Date of birth (optional)</span><input id="n-dob" type="date"></label><label class="field"><span>Texts go to</span><select id="n-to"><option value="patient">Patient</option><option value="parent">Parent / guardian</option></select></label></div>
    <p class="form-err" id="n-err"></p>
    <div class="actions"><button class="btn" id="n-cancel">Cancel</button><button class="btn primary" id="n-save">Save patient</button></div>`);
  $('n-cancel').onclick = closeModal;
  $('n-save').onclick = async () => {
    const first = $('n-first').value.trim(), last = $('n-last').value.trim(), phone = digits($('n-phone').value);
    if (!first && !last) return ($('n-err').textContent = 'Enter a first or last name.');
    if (phone.length !== 10) return ($('n-err').textContent = 'Enter a valid 10-digit phone number.');
    const p = { first, last, phone, phoneSource: 'Typed', dob: $('n-dob').value, contactType: $('n-to').value, ...(preset.pending ? { pending: true } : {}) };
    await window.api.addPatient(p); closeModal(); toast('Patient saved'); onSave(p);
  };
  setTimeout(() => $('n-first').focus(), 50);
}
$('add-patient').onclick = () => patientForm(async (p) => {
  await loadPatients(); const rec = patients.find((x) => x.phone === p.phone && x.first === p.first);
  if (rec) { activePatient = { ...rec, text: '', templateId: null }; renderPatients(); renderCompose(); }
});

/* ---------- New message ---------- */
$('new-msg').onclick = async () => {
  [patients, history] = await Promise.all([window.api.patients(), window.api.history()]); indexPatients(patients);
  const p = { first: '', last: '', phone: '', text: '', templateId: null };
  let picked = null;
  openModal(`<h2>New message</h2>
    <label class="field"><span>To</span><input id="q-to" placeholder="Search a patient or type a phone number" autocomplete="off"></label>
    <div id="q-suggest"></div>
    <div class="field-grid" id="q-names"><label class="field"><span>First name</span><input id="q-first"></label><label class="field"><span>Last name</span><input id="q-last"></label></div>
    <div id="q-comp">${composerHTML(p)}</div>
    <label class="check" id="q-save-wrap"><input type="checkbox" id="q-save" checked><span></span>Save to Patients</label>
    <p class="form-err" id="q-err"></p>
    <div class="actions"><span class="from-chip">${sendFrom ? `${I.phone}From ${esc(fmtPhone(sendFrom))}` : ''}</span><span style="flex:1"></span><button class="btn" id="q-cancel">Cancel</button><button class="btn primary" id="q-next">${I.send}Send</button></div>`);
  const rebind = () => { p.greet = picked ? greetName(p, picked) : (p.first || p.last); $('q-comp').innerHTML = composerHTML(p); bindComposer($('q-comp'), p, rebind); };
  rebind();
  const choose = (rec) => {
    picked = rec; Object.assign(p, { first: rec.first, last: rec.last, phone: rec.phone, rec, age: rec.age, lastVisit: rec.lastVisit, key: rec.key });
    $('q-to').value = `${fullName(rec)} · ${fmtPhone(rec.phone)}`; $('q-suggest').innerHTML = '';
    $('q-names').classList.add('hidden'); $('q-save-wrap').classList.add('hidden'); rebind();
  };
  $('q-to').oninput = () => {
    picked = null; $('q-names').classList.remove('hidden'); $('q-save-wrap').classList.remove('hidden'); $('q-err').textContent = '';
    const q = $('q-to').value.trim().toLowerCase(), qd = digits(q);
    const hits = q.length < 2 ? [] : patients.filter((x) => !x.dnt && x.phone && (`${x.first} ${x.last}`.toLowerCase().includes(q) || (qd.length >= 3 && x.phone.includes(qd)))).slice(0, 5);
    $('q-suggest').innerHTML = hits.length ? `<div class="suggest">${hits.map((h) => `<button data-k="${esc(h.key)}"><span>${esc(fullName(h))}</span><span class="muted">${esc(fmtPhone(h.phone))}</span></button>`).join('')}</div>` : '';
    $('q-suggest').querySelectorAll('button').forEach((b) => (b.onclick = () => choose(patients.find((x) => x.key === b.dataset.k))));
  };
  ['q-first', 'q-last'].forEach((id) => ($(id).oninput = () => { p.first = $('q-first').value.trim(); p.last = $('q-last').value.trim(); }));
  $('q-cancel').onclick = closeModal;
  $('q-next').onclick = async () => {
    if (!picked) {
      p.phone = digits($('q-to').value); p.first = $('q-first').value.trim(); p.last = $('q-last').value.trim();
      if (p.phone.length !== 10) return ($('q-err').textContent = 'Pick a patient or enter a 10-digit phone number.');
      if (!p.first && !p.last) return ($('q-err').textContent = 'Enter a first or last name.');
      if (patients.find((x) => x.phone === p.phone && x.dnt)) return ($('q-err').textContent = 'This number is marked do not text.');
      if ($('q-save').checked) await window.api.addPatient({ first: p.first, last: p.last, phone: p.phone, phoneSource: 'Typed' });
    }
    if (!finalMessage(p)) return ($('q-err').textContent = 'Write a message first.');
    confirmAndSend([itemFor(p)]);
  };
  setTimeout(() => $('q-to').focus(), 50);
};


// Open a patient's page from anywhere (Today, Texts, Calls).
function openPatient(rec) {
  if (!rec) return;
  go('patients');
  setTimeout(() => { const r = patients.find((p) => p.key === rec.key) || rec; activePatient = { ...r, text: '', templateId: null }; renderPatients(); renderCompose(); }, 150);
}

// Timeline: everything about this patient in one list (newest first), so nobody has to piece it together.
const TL_ICON = { text: () => I.msg, call: () => I.phone, visit: () => I.cal, change: () => I.bell, rx: () => I.pill };
async function paintTimeline(p) {
  const host = $('c-timeline'); if (!host || !p.key) return;
  const list = await window.api.patientTimeline(p.key);
  if (!activePatient || activePatient.key !== p.key) return;
  host.innerHTML = `<details class="history" ${list.length ? '' : ''}><summary><span>Timeline</span><em>${list.length ? `${list.length} item${list.length > 1 ? 's' : ''} · last ${esc(ago(list[0].at))}` : 'Nothing yet'}</em></summary>
    <div class="tl">${list.map((e) => `<div class="tl-row k-${e.kind}"><span class="tl-ic">${(TL_ICON[e.kind] || TL_ICON.change)()}</span><div><b>${esc(e.title)}</b>${e.detail ? `<p>${esc(e.detail)}</p>` : ''}</div><time>${esc(new Date(e.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</time></div>`).join('') || '<p class="muted small" style="padding:8px 2px">Texts, calls, visits and prescriptions for this patient will show here.</p>'}</div></details>`;
}
