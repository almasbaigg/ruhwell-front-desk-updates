/* First-use tips: new features explain themselves with one small, dismissible tip the first time, never a tour.
   At most one tip at a time, and at most one per app session. */
const TIPS = [
  { id: 'capture', where: '#tm-start', text: `Tip: press ${isMac ? '⌘' : 'Ctrl'}+Shift+Space in any app to jot a task. It lands on your checklist.` },
  { id: 'timer', where: '#tm-start', text: 'Tip: start a timer for anything you\'re doing. It shows here and keeps running when the app is hidden.' },
  { id: 'cl-time', where: '#cl-input', text: 'Tip: add a time like "at 3" or "tomorrow" and you\'ll get a reminder.' },
  { id: 'notes-at', where: '#nt-text', text: 'Tip: type @ and a name to link a patient to your note.' },
  ...(isMac ? [{ id: 'mac-alerts', where: '#clock', text: 'Tip: so alerts stay on screen until you see them, open System Settings → Notifications → Ruhwell Front Desk and choose "Alerts".' }] : []),
];
const seenTips = () => { try { return JSON.parse(localStorage.getItem('rfd-tips') || '[]'); } catch { return []; } };
const markTip = (id) => { try { localStorage.setItem('rfd-tips', JSON.stringify([...new Set([...seenTips(), id])])); } catch {} };
let tipShown = false;
function nextTip() {
  if (tipShown || view !== 'today') return;
  const t = TIPS.find((x) => !seenTips().includes(x.id) && document.querySelector(x.where)); if (!t) return;
  const el = document.querySelector(t.where), r = el.getBoundingClientRect(); if (!r.width) return;
  tipShown = true;
  const b = document.createElement('div'); b.className = 'tip';
  b.innerHTML = `<span>${esc(t.text)}</span><button class="link-btn">Got it</button>`;
  document.body.appendChild(b);
  const w = 280, left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left)), top = r.bottom + 10 + 120 > window.innerHeight ? r.top - 10 - b.offsetHeight : r.bottom + 10;
  Object.assign(b.style, { left: `${left}px`, top: `${top}px`, width: `${w}px` });
  b.querySelector('button').onclick = () => { markTip(t.id); b.remove(); };
  // Leaving Today puts the tip away (it comes back next time until "Got it").
  document.querySelectorAll('.nav').forEach((n) => n.addEventListener('click', () => b.remove(), { once: true }));
}
setTimeout(nextTip, 2500);
