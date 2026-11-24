/* Ruhwell Front Desk — shared helpers, state, templates, patients index and statuses.
   Loaded first; every other screen file builds on these. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const fmtPhone = (s) => { const d = digits(s); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (s || ''); };
const initials = (p) => (((p.first || p.last || '?')[0]) + (((p.first && p.last) ? p.last[0] : '') || '')).toUpperCase();
const fullName = (p) => `${p.first || ''} ${p.last || ''}`.trim() || fmtPhone(p.phone) || 'Unknown';
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const shortWhen = (iso) => { const d = new Date(iso); return d.toDateString() === new Date().toDateString() ? fmtTime(d) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const fmtDateShort = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const hoursSince = (iso) => (Date.now() - new Date(iso)) / 36e5;
const dayLabel = (iso) => { const d = new Date(iso), t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? d.toLocaleDateString([], { weekday: 'long' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
const waitLabel = (iso) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h${m % 60 && m < 600 ? ` ${m % 60} m` : ''}` : `${Math.floor(m / 1440)} d`; };
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const isMac = navigator.platform.toLowerCase().includes('mac');
// Small remembered choices (filters), kept on this computer only.
const remember = (k, v) => { try { localStorage.setItem('rfd-' + k, v); } catch {} };
const recall = (k, d) => { try { return localStorage.getItem('rfd-' + k) || d; } catch { return d; } };
const I = {
  send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7z"/></svg>',
  msg: '<svg viewBox="0 0 24 24"><path d="M4 20l1.2-4A8 8 0 1 1 8 19z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  newp: '<svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4"/><path d="M3 21c1-4 3.6-6 7-6 1.4 0 2.6.3 3.6.9M18 14v6M15 17h6"/></svg>',
  follow: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  clockd: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/><path d="M12 7v5l3 2"/></svg>',
  okc: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>',
  xc: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  noshow: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6M3 3l18 18"/></svg>',
  chatok: '<svg viewBox="0 0 24 24"><path d="M4 20l1.2-4A8 8 0 1 1 8 19z"/><path d="M9 12l2 2 4-4"/></svg>',
  suitcase: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M4 12h14M14 7l5 5-5 5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  inbox: '<svg viewBox="0 0 24 24"><path d="M20 12H4M10 6l-6 6 6 6"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pill: '<svg viewBox="0 0 24 24"><rect x="3.5" y="8.5" width="17" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M9.5 9.5l5 5"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
};

let settings = null, accounts = { rxnt: {}, ringrx: {} }, info = null, sendFrom = '';
let visits = [], history = [], patients = [], confirmed = {}, idx = { byPhone: {}, byPid: {}, byChart: {} };
let currentDate = ymd(), weekStart = null, weekData = {}, activePatient = null, pTab = 'contacts', pFilter = 'all', lastSync = null, busy = { high: 0, low: 0 }, localLoading = 0;

// Texts, Emails, Calls and Faxes share one set of filters: To do · All · Sent (Done for faxes) · Spam.
// Unread shows in the list itself (dot + bold), not as a separate filter.
const FILTER_LABEL = { needs: 'To do' };
function filterCounts(id, counts) { for (const [k, n] of Object.entries(counts)) { const b = document.querySelector(`#${id} [data-f="${k}"]`); if (b) b.innerHTML = `${FILTER_LABEL[k] || b.textContent.replace(/\d+$/, '')}${n ? `<b>${n}</b>` : ''}`; } }
const fixFilter = (v, allowed) => (allowed.includes(v) ? v : v === 'inbox' || v === 'unanswered' || v === 'in' ? 'all' : v === 'out' ? 'sent' : 'needs');
// Read and Done carry a time everywhere ("Read 9:42 PM", "Done 9:50 PM").
const stamp = (label, at) => (at ? `<span class="stamp">${esc(label)} ${esc(shortWhen(new Date(typeof at === 'number' ? at : at).toISOString()))}</span>` : '');

document.addEventListener('click', () => document.querySelectorAll('.more-menu').forEach((m) => m.classList.add('hidden')));
// Toasts. With an undo function they get an Undo button and stay a little longer (misclicks happen when rushing).
function toast(msg, undo) {
  const t = $('toast'); t.innerHTML = ''; t.append(document.createTextNode(msg));
  if (undo) { const b = document.createElement('button'); b.className = 'toast-undo'; b.textContent = 'Undo'; b.onclick = async () => { t.classList.add('hidden'); await undo(); }; t.append(b); }
  t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), undo ? 6000 : 3200);
}
function openModal(html) { $('modal').innerHTML = html; $('overlay').classList.remove('hidden'); }
function closeModal() { $('overlay').classList.add('hidden'); }
const modalLocked = () => !!$('modal').querySelector('.ring.counting, .send-list.live, .em-compose') || !!document.querySelector('.sub-overlay, .ec-prev-wrap');
$('overlay').addEventListener('mousedown', (e) => { if (e.target === $('overlay') && !modalLocked()) closeModal(); });
function paintTopbar() { $('topbar').classList.toggle('on', busy.high > 0 || localLoading > 0); }
window.api.onBusy((b) => { busy = b; paintTopbar(); paintSync(); });
const loading = async (fn) => { localLoading++; paintTopbar(); try { return await fn(); } finally { localLoading--; paintTopbar(); } };

/* ---------- Templates & messages ---------- */
// audience: after (checked-in) · upcoming (booked, not yet seen) · cancelled · any
const audienceOf = (t) => t.audience || (t.seenOnly || t.id === 'review' ? 'after' : 'any');
const tplById = (id) => (settings.templates || []).find((t) => t.id === id);
const ctxFor = (p) => p.cat === 'seen' ? 'after' : p.cat === 'cancelled' ? 'cancelled' : p.cat === 'pending' ? 'upcoming' : (p.lastVisit ? 'patient-seen' : 'patient');
function templatesFor(ctx) {
  return (settings.templates || []).filter((t) => {
    const a = audienceOf(t);
    if (a === 'any') return true;
    if (ctx === 'patient-seen' || ctx === 'patient') return true; // free compose from Patients: every template
    return a === ctx;
  });
}
function fill(text, p) {
  const when = p.start ? new Date(p.start) : null;
  return String(text || '')
    .replace(/\{first\}|\[First Name\]/gi, p.greet || p.first || '')
    .replace(/\{last\}|\[Last Name\]/gi, p.last || '')
    .replace(/\{date\}/gi, when ? when.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : '')
    .replace(/\{time\}/gi, when ? fmtTime(when) : '')
    .replace(/\{slots\}/gi, p.slots || '')
    .replace(/\{review_link\}|\[Review Link\]/gi, settings.reviewLink || '')
    .trim();
}
const withSig = (m) => { const sig = (settings.signature || '').trim(); return !m || !settings.signatureOn || !sig || /ruhwell med\s*$/i.test(m) ? m : `${m}\n\n${sig}`; };
const finalMessage = (p) => withSig(String(p.text || '').trim());
function segments(msg) {
  const gsm = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/.test(msg);
  const n = msg.length, per = gsm ? (n > 160 ? 153 : 160) : (n > 70 ? 67 : 70), parts = Math.max(1, Math.ceil(n / per));
  return `${n} characters · ${parts} text${parts > 1 ? 's' : ''}${settings.signatureOn && n ? ' · sign-off included' : ''}`;
}
const templateName = (p) => { const t = tplById(p.templateId); if (!t) return 'Custom message'; return t.name + (String(p.text || '').trim() !== fill(t.text, p) ? ' (edited)' : ''); };
const greetName = (p, rec) => (rec && rec.contactType === 'parent' && rec.contactName) ? rec.contactName : p.first;

/* Clinic hours and open slots, learned from the RxNT calendar itself (blocks + visits). No setup. */
const minsOf = (iso) => { const d = new Date(iso); return isNaN(d) ? NaN : d.getHours() * 60 + d.getMinutes(); };
const dayStore = {};   // every day the app has seen from RxNT
function inferHours() {
  let lo = Infinity, hi = -Infinity; const durs = {}, days = new Set();
  Object.entries(dayStore).forEach(([d, w]) => {
    if (!w || w.closed) return;
    const xs = [...(w.items || []), ...(w.blocks || [])];
    if (xs.length) days.add(parseYmd(d).getDay());
    xs.forEach((x) => { const a = minsOf(x.start), z = minsOf(x.end); if (isFinite(a)) lo = Math.min(lo, a); if (isFinite(z)) hi = Math.max(hi, z); });
    (w.items || []).forEach((v) => { const m = Math.round((new Date(v.end) - new Date(v.start)) / 60000); if (m >= 10 && m <= 120) durs[m] = (durs[m] || 0) + 1; });
  });
  const slot = +(Object.entries(durs).sort((a, b) => b[1] - a[1])[0] || [20])[0] || 20;
  if (!isFinite(lo) || !isFinite(hi) || hi - lo < 120) { lo = 600; hi = 1020; }
  return { start: lo, end: hi, slot: Math.max(15, Math.min(slot, 60)), days: days.size ? [...days] : [1, 2, 3, 4, 5] };
}
function freeRanges(d, w, H) {
  if (!w || w.closed || !H.days.includes(parseYmd(d).getDay())) return [];
  const taken = [...(w.items || []).filter((v) => category(v) !== 'cancelled'), ...(w.blocks || [])].map((x) => [minsOf(x.start), minsOf(x.end || x.start)]);
  const nowM = d === ymd() ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
  if (d < ymd()) return [];
  const out = []; let runA = null, m = H.start;
  for (; m + H.slot <= H.end; m += H.slot) {
    const free = m > nowM && !taken.some(([a, b]) => m < b && m + H.slot > a);
    if (free) { if (runA == null) runA = m; } else if (runA != null) { out.push([runA, m]); runA = null; }
  }
  if (runA != null) out.push([runA, m]);
  return out;
}
async function openSlots(limit = 3) {
  const from = addDays(ymd(), 1), data = { ...(await window.api.rxntRange(from, 7)) };
  Object.assign(dayStore, data);
  const H = inferHours(), out = [];
  for (let i = 0; i < 7 && out.length < limit; i++) {
    const d = addDays(from, i); let perDay = 0;
    for (const [a, z] of freeRanges(d, data[d], H)) {
      for (let m = a; m + H.slot <= z && out.length < limit && perDay < 2; m += H.slot * 3) {
        const dt = parseYmd(d); dt.setHours(Math.floor(m / 60), m % 60);
        out.push(`${dt.toLocaleDateString([], { weekday: 'short' })} ${dt.getMonth() + 1}/${dt.getDate()} at ${fmtTime(dt)}`); perDay++;
      }
      if (out.length >= limit || perDay >= 2) break;
    }
  }
  return out.length > 1 ? out.slice(0, -1).join(', ') + ' or ' + out[out.length - 1] : (out[0] || 'later this week');
}
const hm = (m) => fmtTime(new Date(2000, 0, 1, Math.floor(m / 60), m % 60));

// Composer: template chips + editable message box.
function composerHTML(p, { rows = 6, placeholder = 'Write a message…' } = {}) {
  const tpls = templatesFor(ctxFor(p));
  return `<div class="composer">
    ${tpls.length || p.text ? `<div class="tpl-bar"><span>Templates</span>${tpls.map((t) => `<button type="button" class="tpl-chip" data-tpl="${esc(t.id)}">${I.plus}${esc(t.name)}</button>`).join('')}${p.text ? `<button type="button" class="tpl-chip clear" data-clear="1">${I.x}Clear</button>` : ''}</div>` : ''}
    <textarea rows="${rows}" placeholder="${esc(placeholder)}">${esc(p.text || '')}</textarea>
    <div class="seg">${segments(finalMessage(p))}</div></div>`;
}
function bindComposer(root, p, rerender) {
  const ta = root.querySelector('.composer textarea'), seg = root.querySelector('.composer .seg');
  root.querySelectorAll('.tpl-chip[data-tpl]').forEach((b) => (b.onclick = async () => {
    const t = tplById(b.dataset.tpl); if (!t) return;
    p.templateId = t.id;
    if (/\{slots\}/i.test(t.text)) { b.disabled = true; p.slots = await loading(() => openSlots()); }
    p.text = fill(t.text, p); rerender();
  }));
  const c = root.querySelector('.tpl-chip[data-clear]'); if (c) c.onclick = () => { p.text = ''; p.templateId = null; rerender(); };
  ta.oninput = () => { p.text = ta.value; if (!p.text) p.templateId = null; seg.textContent = segments(finalMessage(p)); };
}

/* ---------- Patients index, categories, history checks ---------- */
function indexPatients(list) {
  idx = { byPhone: {}, byPid: {}, byChart: {} };
  list.forEach((p) => { [p.phone, ...(p.otherPhones || [])].forEach((ph) => { if (ph) idx.byPhone[ph] = p; }); if (p.patientId) idx.byPid[p.patientId] = p; if (p.chart) idx.byChart[p.chart] = p; });
}
const recordFor = (v) => idx.byPid[v.patientId] || idx.byChart[v.chart] || idx.byPhone[digits(v.phone)] || null;
// RxNT statuses: Completed, Check-In Completed, Called, Intake Completed, Rescheduled, Pending, Waitlist,
// Booked, Canceled, Deleted, No Show, Confirmed, Missed, Late Cancellation.
function statusOf(v) {
  const t = String(v.statusText || '').trim().toLowerCase(), c = String(v.statusCode || '').toUpperCase();
  if (/no.?show|missed/.test(t) || (!t && /^(NS|MIS)/.test(c))) return 'noshow';
  if (/cancel|delet/.test(t) || (!t && /^(CAN|CNL|CXL|DEL|LC)/.test(c))) return 'cancelled';
  if (/resched/.test(t)) return 'moved';
  if (/^(completed|check-?in completed)$/.test(t) || (!t && /^(CKC|COM|CMP)/.test(c))) return 'seen';
  if (/confirm/.test(t) || (!t && c === 'PNF')) return 'confirmed';   // PNF = patient confirmed (often through the RxNT portal)
  return 'booked';   // Pending, Booked, Waitlist, Called, Intake Completed
}
// Cancelled + booked again (same patient: same chart, or same name and DOB; within 14 days) = moved.
// Marks the old visit with movedTo and the new one with movedFrom. A no-show is never a move.
const normNm = (v) => `${String(v.last || '').toLowerCase().replace(/[^a-z]/g, '')}|${String(v.first || '').toLowerCase().replace(/[^a-z]/g, '')}`;
const samePatient = (a, b) => (a.patientId && b.patientId && String(a.patientId) === String(b.patientId)) || (!!a.dob && !!b.dob && String(a.dob).slice(0, 10) === String(b.dob).slice(0, 10) && normNm(a) === normNm(b));
function linkMoves(items, pool) {
  pool = pool || items;
  for (const v of pool) { delete v.movedTo; delete v.movedFrom; }
  for (const c of items) {
    if (category(c) !== 'cancelled' || statusOf(c) === 'noshow') continue;
    const t = new Date(c.start).getTime();
    const other = pool.filter((v) => v !== c && category(v) !== 'cancelled' && samePatient(v, c) && Math.abs(new Date(v.start) - t) <= 14 * 864e5 && !v.movedFrom)
      .sort((a, b) => Math.abs(new Date(a.start) - t) - Math.abs(new Date(b.start) - t))[0];
    if (other) { c.movedTo = other.start; other.movedFrom = c.start; }
  }
  return items;
}
const movedLabel = (to, from) => { const d = new Date(to), same = new Date(from).toDateString() === d.toDateString(); return `Cancelled · moved to ${same ? fmtTime(d) : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`; };
function category(v) { const s = statusOf(v); return s === 'seen' ? 'seen' : (s === 'noshow' || s === 'cancelled' || s === 'moved') ? 'cancelled' : 'pending'; }
// What a visit looks like right now: a booking whose time has passed without check-in is "Not checked in".
function stateOf(v) {
  const s = statusOf(v);
  if (s === 'booked' || s === 'confirmed') { const end = new Date(v.end || v.start); if (!isNaN(end) && end < new Date()) return 'notin'; }
  return s;
}
const STATE = {
  seen: { label: 'Checked in', icon: 'okc' }, booked: { label: 'Booked', icon: 'clock' }, confirmed: { label: 'Confirmed', icon: 'chatok' },
  notin: { label: 'Not checked in', icon: 'clockd' }, cancelled: { label: 'Cancelled', icon: 'xc' }, noshow: { label: 'No-show', icon: 'noshow' }, moved: { label: 'Rescheduled', icon: 'move' },
};
const stateTag = (st, extra = '') => `<span class="st-tag st-${st}">${I[STATE[st].icon]}${STATE[st].label}${extra}</span>`;
const typeTag = (t) => !t ? '' : `<span class="type-tag">${/new/i.test(t) ? I.newp : I.follow}${esc(t)}</span>`;
const blockIcon = (label) => /out of office|vacation|leave/i.test(label) ? I.suitcase : /closed/i.test(label) ? I.lock : I.moon;
const CAT = { seen: 'Checked in', pending: 'Booked', cancelled: 'Cancelled / no-show' };
const isReview = (h) => h.templateId === 'review' || /^review/i.test(h.template || '') || (h.direction !== 'in' && settings.reviewLink && String(h.message || '').includes(settings.reviewLink));
const lastReview = (phone) => { const d = digits(phone); const h = history.find((x) => x.ok && x.direction !== 'in' && isReview(x) && digits(x.phone) === d); return h && Date.now() - new Date(h.at) < 90 * 864e5 ? new Date(h.at) : null; };
const sentSince = (phone, since) => { const t = parseYmd(since).getTime() - 864e5; return history.filter((h) => h.ok && h.direction !== 'in' && digits(h.phone) === digits(phone) && new Date(h.at).getTime() >= t); };
// "C" confirmations: tied to the person who was texted (older entries are just a time). On a shared family
// number only that person's visit shows Confirmed.
const isConfirmed = (phone, who) => {
  const c = confirmed[digits(phone)]; if (!c) return false;
  const at = typeof c === 'string' ? c : c.at; if (Date.now() - new Date(at) >= 4 * 864e5) return false;
  return typeof c === 'string' || !c.name || !who || c.name.toLowerCase() === String(who).toLowerCase();
};

// Phone status badges: no phone · not a cell · edited in app
function phoneBadge(p, rec) {
  const r = rec || p, ph = digits(p.phone);
  if (ph.length !== 10) return `<span class="pill red">${I.phone}No phone</span>`;
  if (r.phoneSource === 'Typed') return `<span class="pill blue" title="${r.rxPhone ? 'RxNT has ' + esc(fmtPhone(r.rxPhone)) : 'Not in RxNT'}">${I.edit}Edited in app</span>`;
  if (/home|listed|saved/i.test(r.phoneSource || '')) return `<span class="pill amber" title="From the RxNT ${esc(r.phoneSource)} number">${I.phone}${r.phoneSource === 'Home' ? 'Home · may be landline' : 'Not marked cell'}</span>`;
  return '';
}
function minorBadge(p, rec, clickable = true) {
  if (!(p.age != null && p.age < 18)) return rec && rec.contactType === 'parent' ? `<span class="pill">Parent: ${esc(rec.contactName || '')}</span>` : '';
  if (rec && rec.contactType === 'parent' && rec.contactName) return `<span class="pill amber">Minor · parent: ${esc(rec.contactName)}</span>`;
  return `<span class="pill amber ${clickable ? 'click act-parent' : ''}">${I.user}Minor · add parent</span>`;
}
function parentModal(rec, after) {
  if (!rec) return toast('This patient hasn\'t synced yet. Try again shortly.');
  openModal(`<h2>Parent or guardian</h2><p class="muted small">${esc(fullName(rec))} · ${esc(fmtPhone(rec.phone) || 'No phone')}</p>
    <label class="field"><span>Name used in the greeting</span><input id="pm-name" value="${esc(rec.contactName || '')}" placeholder="e.g. Sarah"></label>
    <label class="check"><input type="checkbox" id="pm-to" ${rec.contactType !== 'patient' ? 'checked' : ''}><span></span>This number belongs to the parent</label>
    <div class="actions"><button class="btn" id="pm-cancel">Cancel</button><button class="btn primary" id="pm-save">Save</button></div>`);
  $('pm-cancel').onclick = closeModal;
  $('pm-save').onclick = async () => {
    const f = { contactName: $('pm-name').value.trim(), contactType: $('pm-to').checked ? 'parent' : 'patient', contactSetInApp: true, contactSource: 'app' };
    if (f.contactType === 'parent' && !f.contactName) return toast('Enter the parent\'s name.');
    await window.api.updatePatient(rec.key, f); Object.assign(rec, f); closeModal(); toast('Saved'); after && after();
  };
  setTimeout(() => $('pm-name').focus(), 50);
}

// Placeholders a template uses that came out blank for this person (e.g. no visit time), or leftover {braces}.
function missingFields(tplText, p, msg) {
  const out = [], t = String(tplText || '');
  if (/\{first\}|\[First Name\]/i.test(t) && !(p.greet || p.first)) out.push('the first name');
  if (/\{date\}|\{time\}/i.test(t) && !p.start) out.push('the visit date and time');
  if (/\{slots\}/i.test(t) && !p.slots) out.push('the open times');
  if (/\{review_link\}|\[Review Link\]/i.test(t) && !settings.reviewLink) out.push('the review link');
  if (/\{(first|last|date|time|slots|review_link)\}/i.test(msg || '')) out.push('a placeholder that was never filled in');
  return [...new Set(out)];
}
function itemFor(p) {
  const warn = [], t = tplById(p.templateId) || {}, aud = audienceOf(t);
  if (p.cat === 'pending' && aud === 'after') warn.push('Not checked in');
  if (p.cat === 'cancelled' && aud !== 'cancelled' && aud !== 'any') warn.push('Cancelled / no-show');
  if (p.templateId && aud === 'after') { const rv = lastReview(p.phone); if (rv) warn.push(`Review already asked ${rv.toLocaleDateString([], { month: 'short', day: 'numeric' })}`); }
  const rec = p.rec || (p.key ? p : null);
  if (p.age != null && p.age < 18 && !(rec && rec.contactType === 'parent')) warn.push('Minor · parent not set');
  if (rec && /home|listed/i.test(rec.phoneSource || '')) warn.push('Not a cell number');
  if (rec && rec.phoneSource === 'Typed') warn.push('Number edited in app');
  const d = digits(p.phone), sharers = patients.filter((x) => x.phone === d || (x.otherPhones || []).includes(d));
  if (sharers.length > 1) warn.push(`Shared number: ${sharers.map((x) => x.first || x.last).filter(Boolean).slice(0, 3).join(', ')}`);
  const msg = finalMessage(p), gaps = missingFields(t.text, p, msg);
  return { name: fullName(p), phone: d, message: msg, templateName: templateName(p), templateId: p.templateId || 'custom', apptId: p.appointmentId || null, warn, blocked: gaps.length ? `This text is missing ${gaps.join(' and ')}. Fix it before sending.` : '' };
}


// Recent calls (from RingRx), for "Called today" on visits and "Last contact" on patients.
let callsCache = { at: 0, items: [] };
async function refreshCallsCache() { if (Date.now() - callsCache.at < 60000) return; callsCache = { at: Date.now(), items: await window.api.callList(30) }; }
function lastCall(phone) { const d = digits(phone); return callsCache.items.find((c) => c.phone === d) || null; }
