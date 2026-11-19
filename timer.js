// Timer for anything she's doing ("Charting", "Call pharmacy"). Lives in the background process, so it keeps
// going when the window is hidden. Shows in the Mac menu bar, ends with a gentle chime and a pop-up.
const { Notification } = require('electron');

let t = null;          // { label, total, endsAt, left (ms, when paused), paused }
let tick = null, hooks = { onChange: () => {}, onEnd: () => {}, menuBar: () => {} };

const leftMs = () => (!t ? 0 : t.paused ? t.left : Math.max(0, t.endsAt - Date.now()));
const state = () => (t ? { label: t.label, total: t.total, left: leftMs(), paused: t.paused, running: true } : { running: false });
const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function loop() {
  clearInterval(tick);
  if (!t) { hooks.menuBar(''); hooks.onChange(state()); return; }
  tick = setInterval(() => {
    if (!t) return loop();
    const left = leftMs();
    hooks.menuBar(t.paused ? `⏸ ${mmss(left)}` : mmss(left));
    hooks.onChange(state());
    if (!t.paused && left <= 0) end();
  }, 1000);
  hooks.onChange(state());
}
function end() {
  const label = t.label; t = null; clearInterval(tick); hooks.menuBar(''); hooks.onChange(state());
  hooks.onEnd(label);
}

function start(minutes, label) {
  const total = Math.max(1, Math.min(240, Number(minutes) || 0)) * 60000;
  t = { label: String(label || '').trim().slice(0, 40), total, endsAt: Date.now() + total, paused: false };
  loop(); return state();
}
function pause() { if (t && !t.paused) { t.left = leftMs(); t.paused = true; } loop(); return state(); }
function resume() { if (t && t.paused) { t.endsAt = Date.now() + t.left; t.paused = false; } loop(); return state(); }
function add(minutes = 5) {
  if (!t) return state();
  const ms = minutes * 60000;
  if (t.paused) t.left += ms; else t.endsAt += ms;
  t.total += ms; loop(); return state();
}
function stop() { t = null; loop(); return state(); }
function init(h) { hooks = { ...hooks, ...h }; }

module.exports = { init, start, pause, resume, add, stop, state, mmss };
