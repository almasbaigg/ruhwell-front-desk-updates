/* Checklist and Notes on Today: the everyday pad.
   Checklist: type naturally ("call pharmacy at 3"), quick reminder times, Top 3 stars, overdue colors,
   daily/weekly repeats, drag to reorder, and tasks that link back to the text, call or RxNT item they came from.
   Notes: a page per day (older days kept and searchable), pin a page, @ to link a patient, any line → task. */

/* ---------- Checklist ---------- */
let clItems = [], clPicked = null;   // clPicked: a time/repeat chosen with the bell for the next task
const clockOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dueLabel(iso) {
  const d = new Date(iso), t = new Date(); const sameDay = d.toDateString() === t.toDateString();
  const tmr = new Date(t); tmr.setDate(t.getDate() + 1);
  return sameDay ? clockOf(iso) : d.toDateString() === tmr.toDateString() ? `Tomorrow ${clockOf(iso)}` : `${d.toLocaleDateString([], { weekday: 'short' })} ${clockOf(iso)}`;
}
// Overdue turns amber, then red after an hour.
const dueUrg = (i) => { if (!i.due || i.done) return ''; const late = (Date.now() - new Date(i.due)) / 36e5; return late >= 1 ? 'red' : late >= 0 ? 'amber' : ''; };

async function loadChecklist(list) {
  clItems = list || await window.api.checklist();
  const open = clItems.filter((i) => !i.done);
  $('cl-left').textContent = clItems.length ? `${open.length} left` : '';
  if (!clItems.length) {
    $('cl-list').innerHTML = `<div class="cl-empty-state">${I.check}<b>Nothing on your list</b><span>Type a task above. Add a time like “at 3” or “tomorrow” and you'll get a reminder.</span></div>`;
    return;
  }
  const tops = clItems.filter((i) => i.top && !i.done);
  $('cl-list').innerHTML = (tops.length ? '<p class="cl-sec">Top 3 today</p>' : '') + clItems.map((i, n) => {
    const sep = tops.length && !i.top && (n === 0 || clItems[n - 1].top) ? '<p class="cl-sec">Everything else</p>' : '';
    const carried = !i.done && new Date(i.at).toDateString() !== new Date().toDateString();
    return `${sep}<div class="cl-item ${i.done ? 'done' : ''} ${i.top ? 'top' : ''} ${dueUrg(i) ? 'late-' + dueUrg(i) : ''}" data-id="${esc(i.id)}" draggable="${i.done ? 'false' : 'true'}">
      <span class="grip" title="Drag to reorder"></span>
      <label class="check"><input type="checkbox" ${i.done ? 'checked' : ''}><span></span></label>
      <span class="txt ${i.link ? 'linked' : ''}">${esc(i.text)}
        ${i.due && !i.done ? `<span class="due ${dueUrg(i)}">${esc(dueLabel(i.due))}</span>` : ''}
        ${i.repeat ? `<span class="rep" title="Repeats ${i.repeat}">${i.repeat === 'daily' ? 'Daily' : 'Weekly'}</span>` : ''}
        ${carried ? `<span class="carried">since ${esc(new Date(i.at).toLocaleDateString([], { month: 'short', day: 'numeric' }))}</span>` : ''}</span>
      <span class="cl-acts">${i.done ? '' : `<button class="ico star ${i.top ? 'on' : ''}" title="${i.top ? 'Remove from Top 3' : 'Add to Top 3'}"><svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z"/></svg></button><button class="ico bell" title="Reminder"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></button>`}<button class="ico x" title="Delete">${I.x}</button></span></div>`;
  }).join('');
  $('cl-list').querySelectorAll('.cl-item').forEach((el) => {
    const it = clItems.find((x) => x.id === el.dataset.id);
    el.querySelector('input').onchange = async () => { const was = it.done; loadChecklist(await window.api.checklistToggle(it.id)); if (!was) { bumpDone(); toast('Done', async () => { loadChecklist(await window.api.checklistToggle(it.id)); bumpDone(-1); }); } };
    el.querySelector('.x').onclick = async () => { loadChecklist(await window.api.checklistRemove(it.id)); toast('Task deleted', async () => loadChecklist(await window.api.checklistRestore(it))); };
    const st = el.querySelector('.star'); if (st) st.onclick = async () => { const r = await window.api.checklistStar(it.id); if (r && r.error === 'top3') { toast('Top 3 is full. Unstar one first.'); return; } loadChecklist(r); };
    const bl = el.querySelector('.bell'); if (bl) bl.onclick = (e) => whenMenu(e.currentTarget, async (due) => loadChecklist(await window.api.checklistDue(it.id, due)), !!it.due);
    if (it.link) el.querySelector('.txt').onclick = () => openLink(it.link);
    // Drag to reorder
    el.ondragstart = (e) => { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
    el.ondragend = async () => { el.classList.remove('dragging'); const ids = [...$('cl-list').querySelectorAll('.cl-item')].map((x) => x.dataset.id); loadChecklist(await window.api.checklistReorder(ids)); };
    el.ondragover = (e) => { e.preventDefault(); const d = $('cl-list').querySelector('.dragging'); if (!d || d === el) return; const r = el.getBoundingClientRect(); el.parentNode.insertBefore(d, e.clientY < r.top + r.height / 2 ? el : el.nextSibling); };
  });
}
function openLink(l) {
  if (l.phone) return openThread(l.phone);
  if (l.view === 'rx') return go('rx');
  if (l.view === 'calls') return go('calls');
  go(l.view || 'today');
}

// Reminder picker: quick choices instead of fiddling with a time box.
function whenMenu(anchor, pick, hasDue) {
  const P = $('popover'), at = (h, m = 0, add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const inH = (h) => new Date(Date.now() + h * 36e5).toISOString();
  const lastVisit = (((dayStore[ymd()] || {}).items) || []).filter((v) => category(v) !== 'cancelled').map((v) => new Date(v.end || new Date(v.start).getTime() + 30 * 60000)).sort((a, b) => b - a)[0];
  const opts = [['In 1 hour', inH(1)], ['In 3 hours', inH(3)], ...(lastVisit && lastVisit > new Date() ? [['After visits', new Date(lastVisit.getTime() + 5 * 60000).toISOString()]] : []), ['Tomorrow 8 AM', at(8, 0, 1)]];
  P.innerHTML = `<div class="menu when-menu">${opts.map(([l, v]) => `<button data-v="${v}"><i></i>${l}<small>${esc(dueLabel(v))}</small></button>`).join('')}
    <div class="when-pick"><input type="time" id="wm-time"><button class="btn soft" id="wm-set">Set</button></div>${hasDue ? '<hr><button data-v=""><i></i>No reminder</button>' : ''}</div>`;
  const r = anchor.getBoundingClientRect(); P.style.top = `${r.bottom + 6}px`; P.style.left = `${Math.max(12, r.right - 230)}px`; P.style.width = '230px'; P.classList.remove('hidden');
  P.querySelectorAll('button[data-v]').forEach((b) => (b.onclick = () => { hidePopover(); P.style.width = ''; pick(b.dataset.v || null); }));
  $('wm-set').onclick = () => { const v = $('wm-time').value; if (!v) return; const [h, m] = v.split(':').map(Number); let d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); hidePopover(); P.style.width = ''; pick(d.toISOString()); };
}
$('cl-when').onclick = (e) => whenMenu(e.currentTarget, (due) => { clPicked = due; paintHint(); $('cl-input').focus(); }, !!clPicked);

// As you type, show what time the task will remind you, so there are no surprises.
let hintTimer = null;
async function paintHint() {
  const v = $('cl-input').value.trim(), h = $('cl-hint');
  if (clPicked) { h.textContent = `Reminder: ${dueLabel(clPicked)}`; h.classList.remove('hidden'); return; }
  if (!v) { h.classList.add('hidden'); return; }
  const p = await window.api.checklistParse(v);
  if (!p.due && !p.repeat) { h.classList.add('hidden'); return; }
  h.textContent = `${p.due ? 'Reminder: ' + dueLabel(p.due) : ''}${p.repeat ? `${p.due ? ' · ' : ''}Repeats ${p.repeat}` : ''}`;
  h.classList.remove('hidden');
}
$('cl-input').oninput = () => { clearTimeout(hintTimer); hintTimer = setTimeout(paintHint, 150); };
$('cl-form').onsubmit = async (e) => {
  e.preventDefault(); const v = $('cl-input').value.trim(); if (!v) return;
  const opts = clPicked ? { due: clPicked } : {};
  $('cl-input').value = ''; clPicked = null; $('cl-hint').classList.add('hidden');
  const list = await window.api.checklistAdd(v, opts); loadChecklist(list);
  const added = list.filter((i) => !i.done).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  if (added && added.due) toast(`Reminder set for ${dueLabel(added.due)}`);
};
window.api.onChecklist(() => { if (view === 'today') loadChecklist(); });

// "Later" on a text, call or RxNT item can drop it onto the checklist with a link back.
async function addToChecklist(it, due) {
  const link = it.phone ? { phone: it.phone } : it.sec === 'rx' ? { view: 'rx' } : { view: 'today' };
  const list = await window.api.checklistAdd(`${it.title}${it.tag ? ` (${it.tag})` : ''}`, { raw: true, due, link });
  if (view === 'today') loadChecklist(list);
  toast(due ? `Added to checklist · reminder ${dueLabel(due)}` : 'Added to checklist');
}

/* ---------- Notes ---------- */
let ntDay = null, ntPage = null, ntTimer = null;
const todayKey = () => ymd();
const dayTitle = (k, title) => title || (k === todayKey() ? 'Today' : k === addDays(todayKey(), -1) ? 'Yesterday' : parseYmd(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }));
// A pending edit is saved for the day it was typed on, with the text as it was typed (switching days can't mix them up).
let ntPending = null, ntSeq = 0;
async function flushNote() {
  clearTimeout(ntTimer); const p = ntPending; ntPending = null; if (!p) return true;
  try { const page = await window.api.notesSave(p.day, p.text); if (!page) throw new Error('not saved'); if (p.day === ntDay) { ntPage = page; $('nt-state').textContent = 'Saved'; paintLinks(); } return true; }
  catch { if (!ntPending) ntPending = p; if (p.day === ntDay) $('nt-state').textContent = "Couldn't save · retrying"; clearTimeout(ntTimer); ntTimer = setTimeout(flushNote, 5000); return false; }
}
async function loadNotes(day) {
  // Leaving a day whose text didn't save: stay on it (nothing typed is ever shown under another day).
  if (ntPending && day && day !== ntPending.day && !(await flushNote())) { toast("This page hasn't saved yet. Staying here until it does."); return; }
  if (day) ntDay = day; if (!ntDay) ntDay = todayKey();
  const seq = ++ntSeq, want = ntDay, page = await window.api.notes(want);
  if (seq !== ntSeq || want !== ntDay) return;   // a newer page was asked for meanwhile
  ntPage = page;
  if (!ntPending && (document.activeElement !== $('nt-text') || day)) $('nt-text').value = ntPage.text || '';
  $('nt-day').textContent = dayTitle(ntDay, ntPage.title);
  $('nt-pin').classList.toggle('on', !!ntPage.pinned);
  $('nt-next').disabled = ntDay >= todayKey();
  const pins = ntPage.days.filter((d) => d.pinned && d.day !== ntDay);
  $('nt-pins').innerHTML = pins.map((d) => `<button class="nt-pin-chip" data-d="${esc(d.day)}">📌 ${esc(dayTitle(d.day, d.title))}</button>`).join('') + (ntDay !== todayKey() ? `<button class="nt-pin-chip back" data-d="${todayKey()}">Back to today</button>` : '');
  $('nt-pins').querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => loadNotes(b.dataset.d)));
  $('nt-state').textContent = ntPage.at ? `Saved ${ago(ntPage.at)}` : '';
  paintLinks();
}
// Earlier/later: jumps to the next day that has notes (or today).
function stepDay(dir) {
  const days = (ntPage.days || []).map((d) => d.day).filter((d) => /^\d{4}-/.test(d)).sort();
  const t = todayKey(), all = [...new Set([...days, t])].sort(), i = all.indexOf(ntDay);
  const next = dir < 0 ? (i > 0 ? all[i - 1] : addDays(ntDay, -1)) : all[i + 1] || t;
  loadNotes(next > t ? t : next);
}
$('nt-prev').onclick = () => stepDay(-1);
$('nt-next').onclick = () => stepDay(1);
$('nt-day').onclick = () => loadNotes(todayKey());
$('nt-pin').onclick = async () => { ntPage = await window.api.notesPin(ntDay, !ntPage.pinned); toast(ntPage.pinned ? 'Pinned. It stays one click away.' : 'Unpinned'); loadNotes(ntDay); };
$('nt-text').oninput = () => {
  $('nt-state').textContent = 'Saving…'; clearTimeout(ntTimer);
  ntPending = { day: ntDay, text: $('nt-text').value };
  ntTimer = setTimeout(flushNote, 600);
  mentionCheck();
};
window.addEventListener('beforeunload', () => { if (ntPending) window.api.notesSave(ntPending.day, ntPending.text); });

// Line → task: the line the cursor is on becomes a checklist task (times like "at 3" still work).
$('nt-task').onclick = async () => {
  const t = $('nt-text'), v = t.value, pos = t.selectionStart;
  const start = v.lastIndexOf('\n', pos - 1) + 1, end = v.indexOf('\n', pos) === -1 ? v.length : v.indexOf('\n', pos);
  const line = v.slice(start, end).replace(/^[-*•\s]+/, '').trim();
  if (!line) return toast('Put the cursor on a line first.');
  loadChecklist(await window.api.checklistAdd(line, {}));
  toast('Added to checklist');
};

// @patient: type @ and a name to link a patient; linked patients show under the page (click to open).
function mentionCheck() {
  const t = $('nt-text'), before = t.value.slice(0, t.selectionStart), m = before.match(/@([A-Za-z][A-Za-z'-]*(?: [A-Za-z'-]*)?)$/);
  const P = $('popover');
  if (!m || m[1].length < 2) { if (P.dataset.for === 'mention') { hidePopover(); P.dataset.for = ''; } return; }
  const q = m[1].toLowerCase(), hits = patients.filter((p) => `${p.first} ${p.last}`.toLowerCase().includes(q)).slice(0, 6);
  if (!hits.length) { hidePopover(); return; }
  P.dataset.for = 'mention';
  P.innerHTML = `<div class="menu">${hits.map((p, n) => `<button data-n="${n}"><i></i>${esc(fullName(p))}</button>`).join('')}</div>`;
  const r = t.getBoundingClientRect(); P.style.top = `${r.top + 34}px`; P.style.left = `${r.left + 12}px`; P.style.width = '220px'; P.classList.remove('hidden');
  P.querySelectorAll('button').forEach((b) => (b.onmousedown = (e) => {
    e.preventDefault(); const p = hits[+b.dataset.n], name = `@${p.first} ${p.last}`;
    const at = before.length - m[0].length; t.value = t.value.slice(0, at) + name + ' ' + t.value.slice(t.selectionStart);
    t.selectionStart = t.selectionEnd = at + name.length + 1; hidePopover(); P.dataset.for = ''; P.style.width = ''; t.dispatchEvent(new Event('input'));
  }));
}
function paintLinks() {
  const text = $('nt-text').value, found = [];
  for (const p of patients) { const tag = `@${p.first} ${p.last}`; if (p.first && text.includes(tag) && !found.includes(p)) found.push(p); }
  $('nt-links').innerHTML = found.slice(0, 5).map((p, n) => `<button class="nt-link" data-n="${n}">${I.user}${esc(fullName(p))}</button>`).join('');
  $('nt-links').querySelectorAll('.nt-link').forEach((b) => (b.onclick = () => { go('patients'); openPatient(found[+b.dataset.n]); }));
}

// Search every day's notes.
$('nt-find').onclick = () => {
  openModal(`<h2>Search notes</h2><label class="search-box"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg><input id="ns-q" placeholder="Search all your notes" autocomplete="off"></label><div id="ns-list" class="lines" style="max-height:320px;overflow:auto"></div><div class="actions"><button class="btn" id="ns-close">Close</button></div>`);
  let tm = null;
  $('ns-q').oninput = () => { clearTimeout(tm); tm = setTimeout(async () => {
    const hits = await window.api.notesSearch($('ns-q').value);
    $('ns-list').innerHTML = hits.map((h) => `<button class="line ns-hit" data-d="${esc(h.day)}"><div><strong>${esc(dayTitle(h.day, h.title))}</strong><div class="muted small">${esc(h.snippet)}</div></div></button>`).join('') || ($('ns-q').value.trim() ? '<p class="muted small">No matches</p>' : '');
    $('ns-list').querySelectorAll('.ns-hit').forEach((b) => (b.onclick = () => { closeModal(); loadNotes(b.dataset.d); }));
  }, 200); };
  $('ns-close').onclick = closeModal; setTimeout(() => $('ns-q').focus(), 50);
};
