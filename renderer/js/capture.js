// Quick capture: a small box over any app. Type a task (times like "at 3" set a reminder), press Return.
const t = document.getElementById('t'), h = document.getElementById('h');
const fmt = (iso) => { const d = new Date(iso), now = new Date(), tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return d.toDateString() === now.toDateString() ? tm : `${d.toLocaleDateString([], { weekday: 'short' })} ${tm}`; };
let timer = null;
t.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => {
  const v = t.value.trim(); if (!v) { h.textContent = 'Return to add to your checklist · Esc to close'; return; }
  const p = await window.api.checklistParse(v);
  h.innerHTML = p.due || p.repeat ? `Reminder: <b>${p.due ? fmt(p.due) : ''}${p.repeat ? (p.due ? ' · ' : '') + 'repeats ' + p.repeat : ''}</b> · Return to add` : 'Return to add to your checklist · Esc to close';
}, 120); };
t.onkeydown = async (e) => {
  if (e.key === 'Escape') return window.api.captureClose();
  if (e.key === 'Enter' && t.value.trim()) { await window.api.checklistAdd(t.value.trim(), {}); t.value = ''; window.api.captureClose(true); }
};
window.addEventListener('blur', () => window.api.captureClose());
