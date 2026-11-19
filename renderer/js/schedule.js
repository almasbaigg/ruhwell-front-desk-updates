/* Schedule: Day timeline (visits) and Week calendar. */
/* ---------- Visits ---------- */
const dayMode = () => currentDate > ymd() ? 'future' : currentDate === ymd() ? 'today' : 'past';
function buildVisit(it, prev) {
  const rec = recordFor(it), cat = category(it);
  const v = { ...it, cat, rec, already: sentSince(it.phone, currentDate), review: lastReview(it.phone), confirmed: isConfirmed(it.phone, `${it.first || ''} ${it.last || ''}`.trim()) || statusOf(it) === 'confirmed' };
  if (rec && rec.phoneSource === 'Typed' && rec.phone) v.phone = rec.phone;
  v.greet = greetName(v, rec);
  if (prev) return { ...v, text: prev.text, templateId: prev.templateId, selected: prev.selected, open: prev.open, editing: prev.editing };
  const mode = dayMode(), canText = digits(v.phone).length === 10 && !(rec && rec.dnt);
  let tid = null;
  if (cat === 'seen') tid = settings.defaultTemplate && audienceOf(tplById(settings.defaultTemplate) || {}) === 'after' ? settings.defaultTemplate : (templatesFor('after')[0] || {}).id;
  else if (cat === 'pending' && mode === 'future') tid = (tplById('reminder') && audienceOf(tplById('reminder')) === 'upcoming') ? 'reminder' : (templatesFor('upcoming')[0] || {}).id;
  const t = tid && tplById(tid);
  v.templateId = t ? t.id : null; v.text = t ? fill(t.text, v) : '';
  const already = v.already.some((h) => h.templateId === v.templateId);
  v.selected = !!t && canText && !already && (cat === 'seen' ? mode !== 'future' && !(v.review && audienceOf(t) === 'after') : cat === 'pending' && mode === 'future');
  return v;
}
function applyDay(d) {
  const prev = Object.fromEntries(visits.map((v) => [v.appointmentId, v]));
  knownDays[d.date || currentDate] = (d.items || []).length; dayStore[d.date || currentDate] = d;
  visits = (d.items || []).map((it) => buildVisit(it, prev[it.appointmentId])).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  visits.blocks = d.blocks || []; visits.closed = !!d.closed; visits.loaded = true;
  renderVisits();
}
function paintDayHeader() {
  const d = parseYmd(currentDate), mode = dayMode();
  $('day-label').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  $('day-eyebrow').textContent = mode === 'today' ? 'Today' : currentDate === addDays(ymd(), 1) ? 'Tomorrow' : currentDate === addDays(ymd(), -1) ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long' });
  $('day-title').textContent = d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  $('day-today').disabled = mode === 'today';
}
async function loadDay(date, force) {
  currentDate = date; paintDayHeader();
  const seq = (loadDay.seq = (loadDay.seq || 0) + 1);
  [history, patients, confirmed] = await Promise.all([window.api.history(), window.api.patients(), window.api.confirmed(), refreshCallsCache().catch(() => {})]);
  indexPatients(patients);
  if (!force) {
    visits = []; $('summary').innerHTML = '';
    $('visit-list').innerHTML = '<div class="loading-line"><span class="spinner"></span>Loading visits from RxNT…</div>' + '<div class="sk-row"><div class="sk circle"></div><div><div class="sk l1"></div><div class="sk l2"></div></div><div class="sk btn"></div></div>'.repeat(3);
    updateBar();
  }
  $('refresh').classList.add('spin');
  const r = await loading(() => window.api.rxntDay(date, !!force));
  if (seq !== loadDay.seq) return;
  $('refresh').classList.remove('spin');
  if (r.needsLogin) {
    paintConnections();
    $('visit-list').innerHTML = `<div class="empty-state"><h3>RxNT signed you out</h3><p style="margin:6px 0 14px">Sign in again to continue.</p><button class="btn primary" id="relogin">Sign in to RxNT</button></div>`;
    $('relogin').onclick = async () => { if (await window.api.rxntSignIn()) { paintConnections(); loadDay(currentDate, true); } };
    return;
  }
  if (r.error) {
    if (!loadDay.retried) { loadDay.retried = true; return loadDay(date, true); }
    loadDay.retried = false;
    $('visit-list').innerHTML = `<div class="empty-state"><h3>RxNT is slow to respond</h3><p style="margin:6px 0 14px">Give it a moment and try again.</p><button class="btn" id="retry-day">Try again</button></div>`;
    $('retry-day').onclick = () => loadDay(currentDate, true);
    return;
  }
  loadDay.retried = false;
  if (!force) visits = [];
  applyDay(r);
}
window.api.onDay((d) => {
  knownDays[d.date] = (d.items || []).length; dayStore[d.date] = d;
  if (d.date === currentDate && view === 'visits' && visits.loaded && !document.activeElement?.closest?.('.item textarea')) applyDay(d);
  if (weekStart && d.date >= weekStart && d.date <= addDays(weekStart, 6)) { weekData[d.date] = d; dayStore[d.date] = d; if (view === 'calendar') renderWeek(); }
});
$('refresh').onclick = () => loadDay(currentDate, true);
$('day-prev').onclick = () => loadDay(addDays(currentDate, -1));
$('day-next').onclick = () => loadDay(addDays(currentDate, 1));
$('day-today').onclick = () => loadDay(ymd());

// Merge identical blocks (e.g. Maria and the Virtual Room both closed 10–11) into one line.
function mergedBlocks(blocks) {
  const m = {};
  (blocks || []).forEach((b) => {
    const kind = String(b.label || '').replace(/^not available\s*·?\s*/i, '').trim() || 'Not available';
    const k = `${b.start}|${b.end}|${kind}`;
    (m[k] = m[k] || { ...b, kind, whos: [] }).whos.push(b.who);
  });
  return Object.values(m).map((b) => ({ ...b, who: [...new Set(b.whos.filter(Boolean).map((w) => w.replace(/,.*$/, '')))].join(' and ') }));
}
function emptyReason(blocks, H) {
  const span = H.end - H.start; if (!blocks.length || span <= 0) return null;
  const cov = blocks.reduce((t, b) => t + Math.max(0, Math.min(minsOf(b.end), H.end) - Math.max(minsOf(b.start), H.start)), 0);
  const who = (blocks[0].whos || [blocks[0].who])[0] || ''; const first = String(who).split(/[ ,]/)[0];
  const ooo = blocks.some((b) => /out of office/i.test(b.label));
  if (cov >= span * 0.9) return `${first || 'The provider'} is ${ooo ? 'out of office' : 'unavailable'} all day`;
  if (cov >= span * 0.5) return `${first || 'The provider'} is ${ooo ? 'out' : 'unavailable'} most of the day`;
  return null;
}
function renderVisits() {
  const L = $('visit-list'), mode = dayMode(), H = inferHours();
  const n = (fn) => visits.filter(fn).length;
  $('summary').innerHTML = visits.length ? [
    [visits.length === 1 ? 'visit' : 'visits', visits.length, ''], ['checked in', n((v) => v.cat === 'seen'), 'seen'], ['booked', n((v) => stateOf(v) === 'booked' || stateOf(v) === 'confirmed'), 'pending'],
    ['not checked in', n((v) => stateOf(v) === 'notin'), 'notin'], ['cancelled', n((v) => v.cat === 'cancelled'), 'cancelled'], ['messaged', n((v) => v.already.length), 'sent'],
  ].filter(([, c], i) => i < 2 || c).map(([l, c, k]) => `<span class="sum ${k}">${k ? '<i></i>' : ''}<b>${c}</b>${l}</span>`).join('') : '';
  const blocks = mergedBlocks(visits.blocks);
  // One timeline: blocks and visits in time order.
  const rows = [...blocks.map((b) => ({ t: 'block', start: b.start, b })), ...visits.map((v) => ({ t: 'visit', start: v.start, v }))]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) || (a.t === 'block' ? -1 : 1));
  if (!visits.length) {
    const why = visits.closed ? 'Closed' : emptyReason(blocks, H) || 'No visits';
    L.innerHTML = rows.map((r) => `<div class="trow">${rowHTML(r)}</div>`).join('') + `<div class="empty-state">${I.cal}<h3>${esc(why)}</h3><p>${visits.closed ? 'RxNT doesn\'t show this day on the schedule.' : 'Nothing booked in RxNT for this day.'}</p></div>`;
    updateBar(); return;
  }
  L.innerHTML = '';
  for (const r of rows) {
    const wrap = document.createElement('div'); wrap.className = 'trow';
    if (r.t === 'block') { wrap.innerHTML = rowHTML(r); L.appendChild(wrap); continue; }
    const v = r.v, st = stateOf(v);
    const dnt = !!(v.rec && v.rec.dnt), hasPhone = digits(v.phone).length === 10;
    const selectable = !!v.templateId && !dnt && hasPhone && (v.cat === 'seen' ? mode !== 'future' : v.cat === 'pending' && mode === 'future');
    const dur = Math.round((new Date(v.end) - new Date(v.start)) / 60000);
    const sentThis = !v.resend && v.templateId && v.already.find((h) => h.templateId === v.templateId);
    wrap.innerHTML = `<div class="tcol"><b>${esc(fmtTime(v.start))}</b>${dur > 0 ? `<span>${dur} min</span>` : ''}</div>
      <div class="item st-${st}${v.selected ? ' selected' : ''}${dnt ? ' muted-item' : ''}">
        ${selectable ? `<label class="check"><input type="checkbox" ${v.selected ? 'checked' : ''}><span></span></label>` : '<span></span>'}
        <div class="avatar">${esc(initials(v))}</div>
        <div class="main">
          <p class="name">${esc(fullName(v))} ${typeTag(v.visitType)}</p>
          <p class="sub-line">${hasPhone ? `<span class="phone">${esc(fmtPhone(v.phone))}</span>` : `<span class="phone"><input placeholder="Add a phone number" value="${esc(v.phone)}"></span>`}${stateTag(v.confirmed && st === 'booked' ? 'confirmed' : st)}</p>
          <div class="meta">${phoneBadge(v, v.rec)}${minorBadge(v, v.rec)}${dnt ? '<span class="pill red">Do not text</span>' : ''}${(() => { const c = lastCall(v.phone); return c && new Date(c.at) >= parseYmd(currentDate) ? `<span class="pill">${I.phone}${c.missed ? 'Missed call' : c.inbound ? 'Called in' : 'Called'} ${esc(fmtTime(c.at))}</span>` : ''; })()}${v.review ? `<span class="pill teal">Review asked ${esc(v.review.toLocaleDateString([], { month: 'short', day: 'numeric' }))}</span>` : ''}</div>
          ${v.editing ? composerHTML(v) : v.open ? `<div class="preview">${esc(finalMessage(v)) || '<span class="muted">No message</span>'}</div>` : ''}
          ${v.editing ? '<div class="row-actions"><button class="link-btn act-done">Done</button></div>' : ''}
        </div>
        <div class="actions">${dnt ? '' : sentThis && !v.editing
          ? `<span class="sent-note">${I.check}${esc((tplById(v.templateId) || {}).name || 'Message')} sent ${esc(fmtTime(sentThis.at))}</span><button class="type-btn act-type" title="Send something else">${I.down}</button>`
          : `<button class="type-btn act-type">${esc(v.templateId ? (tplById(v.templateId) || {}).name || 'Message' : 'Message')}${I.down}</button><button class="btn send-btn act-send">${I.send}Send</button>`}</div>
      </div>`;
    const q = (x) => wrap.querySelector(x);
    const cb = q('input[type=checkbox]'); if (cb) cb.onchange = (e) => { v.selected = e.target.checked; q('.item').classList.toggle('selected', v.selected); updateBar(); };
    const pi = q('.phone input'); if (pi) pi.onchange = async (e) => { const d = digits(e.target.value); if (d.length !== 10) return toast('Enter a 10-digit number.'); v.phone = d; if (v.rec) { await window.api.updatePatient(v.rec.key, { phone: d, phoneSource: 'Typed' }); v.rec.phone = d; v.rec.phoneSource = 'Typed'; } renderVisits(); };
    if (q('.act-parent')) q('.act-parent').onclick = () => parentModal(v.rec, () => { v.greet = greetName(v, v.rec); if (v.templateId && !v.editing) v.text = fill(tplById(v.templateId).text, v); renderVisits(); });
    if (q('.act-done')) q('.act-done').onclick = () => { v.editing = false; v.open = true; renderVisits(); };
    if (v.editing && q('.composer')) bindComposer(wrap, v, renderVisits);
    if (q('.act-type')) q('.act-type').onclick = (e) => typeMenu(e.currentTarget, v);
    if (q('.act-send')) q('.act-send').onclick = async () => {
      if (!hasPhone) return toast(`Add a phone number for ${fullName(v)}.`);
      if (!v.templateId && !v.text) return typeMenu(q('.act-type'), v);
      if (!finalMessage(v)) { v.editing = true; renderVisits(); return toast('Write a message first.'); }
      confirmAndSend([itemFor(v)], refreshAlready);
    };
    L.appendChild(wrap);
  }
  const free = currentDate >= ymd() ? freeRanges(currentDate, dayStore[currentDate], H) : [];
  const tail = free.length && free[free.length - 1][1] >= H.end - H.slot ? free[free.length - 1] : null;
  if (tail) { const t = document.createElement('div'); t.className = 'trow'; t.innerHTML = `<div class="tcol muted-t"><b>${esc(hm(tail[0]))}</b></div><div class="open-line">Open until ${esc(hm(tail[1]))}</div>`; L.appendChild(t); }
  updateBar();
}
function rowHTML(r) {
  const b = r.b;
  return `<div class="tcol"><b>${esc(fmtTime(b.start))}</b><span>${Math.round((new Date(b.end) - new Date(b.start)) / 60000)} min</span></div>
    <div class="block-line">${blockIcon(b.label)}<b>${esc(b.kind)}</b><span>${esc(fmtTime(b.start))}–${esc(fmtTime(b.end))}${b.who ? ' · ' + esc(b.who) : ''}</span></div>`;
}
// Message control next to Send: pick a template, or edit the message.
function typeMenu(anchor, v) {
  const tpls = templatesFor(ctxFor(v)), P = $('popover');
  // Pick a template, or edit the words (starts from the chosen template, or blank).
  P.innerHTML = `<div class="menu">${tpls.map((t) => `<button data-t="${esc(t.id)}" class="${v.templateId === t.id ? 'on' : ''}">${v.templateId === t.id ? I.check : '<i></i>'}${esc(t.name)}</button>`).join('')}<hr>
    <button data-a="edit" class="${!v.templateId && v.text ? 'on' : ''}">${!v.templateId && v.text ? I.check : I.edit}${v.text ? 'Edit message' : 'Write my own'}</button></div>`;
  const r = anchor.getBoundingClientRect(); P.style.top = `${r.bottom + 6}px`; P.style.left = `${Math.max(12, r.right - 220)}px`; P.style.width = '220px'; P.classList.remove('hidden');
  P.querySelectorAll('button').forEach((b) => (b.onclick = async () => {
    hidePopover(); P.style.width = ''; v.resend = true;
    if (b.dataset.a === 'edit') { v.editing = true; v.open = false; return renderVisits(); }
    const t = tplById(b.dataset.t);
    if (/\{slots\}/i.test(t.text)) v.slots = await loading(() => openSlots());
    v.templateId = t.id; v.text = fill(t.text, v); renderVisits();
  }));
}
function updateBar() {
  const sel = visits.filter((v) => v.selected), n = sel.length;
  const kinds = [...new Set(sel.map((v) => (tplById(v.templateId) || {}).name || 'message'))];
  $('sel-count').textContent = n ? `${n} selected` : '';
  $('bulk-send').innerHTML = `${I.send}${n ? (kinds.length === 1 ? `Send ${n} ${kinds[0].toLowerCase()}${n > 1 ? 's' : ''}` : `Send ${n} messages`) : 'Send'}`;
  $('actionbar').classList.toggle('show', n > 0);
}
$('sel-clear').onclick = () => { visits.forEach((v) => (v.selected = false)); renderVisits(); };
$('bulk-send').onclick = () => {
  const sel = visits.filter((v) => v.selected);
  for (const v of sel) {
    if (digits(v.phone).length !== 10) return toast(`Add a phone number for ${fullName(v)}.`);
    if (!finalMessage(v)) return toast(`Write a message for ${fullName(v)}.`);
  }
  confirmAndSend(sel.map(itemFor), refreshAlready);
};
async function refreshAlready() {
  history = await window.api.history();
  visits.forEach((v) => { v.already = sentSince(v.phone, currentDate); v.review = lastReview(v.phone); if (v.already.some((h) => h.templateId === v.templateId)) v.selected = false; });
  renderVisits();
}

/* ---------- Calendar (week) ---------- */
function mondayOf(s) { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
async function loadWeek(start) {
  weekStart = start;
  renderWeek();
  weekData = { ...weekData, ...(await loading(() => window.api.rxntRange(start, 7))) }; Object.assign(dayStore, weekData);
  if (!history.length) history = await window.api.history();
  if (!patients.length) { patients = await window.api.patients(); indexPatients(patients); }
  confirmed = await window.api.confirmed();
  renderWeek();
}
function renderWeek() {
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i)), today = ymd(), nowD = new Date();
  const s = parseYmd(days[0]), e = parseYmd(days[6]), sameMonth = s.getMonth() === e.getMonth();
  $('wk-title').textContent = `${s.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${sameMonth ? e.getDate() : e.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`;
  $('wk-sub').textContent = days.includes(today) ? 'This week' : days[0] > today ? 'Upcoming week' : 'Past week';
  const HH = inferHours();
  let lo = Math.min(HH.start, 9 * 60), hi = Math.max(HH.end, 17 * 60);
  days.forEach((d) => { const w = weekData[d]; if (!w) return; [...(w.items || []), ...(w.blocks || [])].forEach((x) => { const a = minsOf(x.start), z = minsOf(x.end); if (isFinite(a)) { lo = Math.min(lo, a); hi = Math.max(hi, (isFinite(z) ? z : a) + 20); } }); });
  const h0 = Math.floor(lo / 60), h1 = Math.min(24, Math.ceil(hi / 60)), PX = 52, top = (m) => ((m - h0 * 60) / 60) * PX, H = (h1 - h0) * PX;
  const off = (d) => { const w = weekData[d]; return (w && w.closed) || !HH.days.includes(parseYmd(d).getDay()); };
  let head = '<div class="wk-head"><div></div>';
  days.forEach((d) => {
    const dt = parseYmd(d), w = weekData[d], cnt = w ? (w.items || []).length : 0;
    head += `<div class="wk-day ${d === today ? 'today' : ''} ${off(d) ? 'off' : ''}" data-d="${d}"><b>${dt.toLocaleDateString([], { weekday: 'short' })}, ${dt.toLocaleDateString([], { month: 'short', day: 'numeric' })}</b><em>${d === today ? '<i class="today-tag">Today</i>' : ''}${!w ? 'Loading…' : off(d) && !cnt ? 'Closed' : `${cnt} visit${cnt === 1 ? '' : 's'}`}</em></div>`;
  });
  head += '</div>';
  let times = `<div class="wk-times" style="height:${H}px">`; for (let h = h0; h < h1; h++) times += `<span style="top:${(h - h0) * PX}px">${new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' })}</span>`; times += '</div>';
  let cols = '';
  days.forEach((d) => {
    let c = `<div class="wk-col ${d === today ? 'today' : ''} ${off(d) ? 'off' : ''}" style="height:${H}px">`;
    for (let h = h0; h < h1; h++) c += `<div class="wk-line" style="top:${(h - h0) * PX}px"></div><div class="wk-line half" style="top:${(h - h0) * PX + PX / 2}px"></div>`;
    const w = weekData[d];
    if (w && !w.closed) {
      const items = (w.items || []).filter((v) => isFinite(minsOf(v.start)));
      for (const [a, z] of freeRanges(d, w, HH)) c += `<div class="open-slot" style="top:${top(a) + 2}px;height:${top(z) - top(a) - 4}px" title="Open ${hm(a)}–${hm(z)}"></div>`;
      mergedBlocks((w.blocks || []).filter((b) => isFinite(minsOf(b.start)))).forEach((b) => { const a = minsOf(b.start), z = Math.max(minsOf(b.end || b.start) || 0, a + 15); c += `<div class="blk" style="top:${top(a)}px;height:${top(z) - top(a)}px" title="${esc(b.kind)} · ${esc(b.who)}"><em>${blockIcon(b.label)}${esc(b.kind)}</em></div>`; });
      items.forEach((v) => {
        const a = minsOf(v.start), z = Math.max(minsOf(v.end || v.start) || 0, a + 20), st = stateOf(v), h = Math.max(top(z) - top(a) - 2, 20);
        const t = fmtTime(v.start).replace(/ (AM|PM)/, '');
        c += `<div class="ev st-${st}" data-d="${d}" data-id="${v.appointmentId}" style="top:${top(a) + 1}px;height:${h}px" title="${esc(fmtTime(v.start))} · ${esc(fullName(v))} · ${esc(STATE[st].label)}">${h < 34 ? `<b>${I[STATE[st].icon]}${esc(t)} · ${esc(fullName(v))}</b>` : `<b>${I[STATE[st].icon]}${esc(fullName(v))}</b><span>${esc(fmtTime(v.start))}${v.visitType ? ' · ' + esc(v.visitType) : ''}</span>`}</div>`;
      });
    }
    if (d === today) { const m = nowD.getHours() * 60 + nowD.getMinutes(); if (m >= h0 * 60 && m <= h1 * 60) c += `<div class="wk-now" style="top:${top(m)}px"></div>`; }
    cols += c + '</div>';
  });
  $('week').innerHTML = head + `<div class="wk-body">${times}${cols}</div>`;
  $('week').querySelectorAll('.wk-day').forEach((x) => (x.onclick = () => { go('visits'); loadDay(x.dataset.d); }));
  $('week').querySelectorAll('.ev').forEach((x) => (x.onclick = () => {
    const v = (weekData[x.dataset.d].items || []).find((i) => String(i.appointmentId) === x.dataset.id); if (!v) return;
    const rec = recordFor(v), cat = category(v);
    openModal(`<div class="compose-top"><div class="avatar">${esc(initials(v))}</div><div><h2>${esc(fullName(v))}</h2><p class="muted small">${esc(parseYmd(x.dataset.d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))} · ${esc(fmtTime(v.start))}–${esc(fmtTime(v.end))}</p></div></div>
      <div class="meta">${stateTag(stateOf(v))}${stateOf(v) === 'notin' ? '<span class="pill">Still Pending in RxNT</span>' : ''}${v.visitType ? `<span class="pill">${esc(v.visitType)}</span>` : ''}${phoneBadge(v, rec)}${minorBadge(v, rec, false)}${rec && rec.dnt ? '<span class="pill red">Do not text</span>' : ''}${isConfirmed(v.phone, `${v.first || ''} ${v.last || ''}`.trim()) ? `<span class="pill green">${I.check}Confirmed</span>` : ''}</div>
      <p>${esc(fmtPhone(v.phone) || 'No phone in RxNT')}</p>
      <div class="actions"><button class="btn" id="ev-day">Open day</button>${rec && rec.dnt ? '' : `<button class="btn primary" id="ev-msg">${I.msg}Message</button>`}</div>`);
    $('ev-day').onclick = () => { closeModal(); go('visits'); loadDay(x.dataset.d); };
    if ($('ev-msg')) $('ev-msg').onclick = () => messageModal({ ...v, cat, rec }, cat === 'cancelled' ? 'reschedule' : null);
  }));
}
$('wk-prev').onclick = () => loadWeek(addDays(weekStart, -7));
$('wk-next').onclick = () => loadWeek(addDays(weekStart, 7));
$('wk-today').onclick = () => loadWeek(mondayOf(ymd()));

