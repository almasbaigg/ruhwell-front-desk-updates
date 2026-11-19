/* Timer: for anything she's doing. One click to start; time shown as a disc that empties (easier to read at a
   glance than numbers), teal → amber at 5 min → terracotta at the last minute. Keeps running when the window is
   hidden (it lives in the background) and shows in the Mac menu bar. Ends gently: chime + "Time's up". */
const PAUSE_I = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>', PLAY_I = '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>';
let tmLast = { running: false };
function paintTimer(st) {
  tmLast = st;
  $('tm-start').classList.toggle('hidden', st.running);
  $('tm-run').classList.toggle('hidden', !st.running);
  if (!st.running) return;
  const frac = Math.max(0, Math.min(1, st.left / st.total)), mins = st.left / 60000;
  $('tm-disc').style.setProperty('--p', `${(frac * 360).toFixed(2)}deg`);   // the colored slice is the time left
  const cls = mins <= 1 ? 'last' : mins <= 5 ? 'soon' : '';
  $('tm-disc').className = 'disc ' + cls + (st.paused ? ' paused' : '');
  $('tm-left').className = 'timer-left ' + cls;
  const s = Math.ceil(st.left / 1000);
  $('tm-left').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('tm-label').textContent = st.paused ? `Paused${st.label ? ' · ' + st.label : ''}` : st.label || 'Timer';
  $('tm-pause').innerHTML = st.paused ? PLAY_I : PAUSE_I;
  $('tm-pause').title = st.paused ? 'Resume' : 'Pause';
}
// Start: quick lengths, or any number of minutes, and an optional label.
$('tm-start').onclick = (e) => {
  const P = $('popover'), r = e.currentTarget.getBoundingClientRect();
  P.innerHTML = `<div class="menu timer-menu"><input id="tmp-label" placeholder="What for? (optional)" maxlength="40" autocomplete="off">
    <div class="tm-picks">${[5, 10, 15, 25, 45].map((m) => `<button data-m="${m}">${m} min</button>`).join('')}</div>
    <div class="when-pick"><input id="tmp-min" type="number" min="1" max="240" placeholder="Minutes"><button class="btn soft" id="tmp-go">Start</button></div></div>`;
  P.style.top = `${r.bottom + 6}px`; P.style.left = `${r.left}px`; P.style.width = '250px'; P.classList.remove('hidden');
  const go = async (m) => { if (!(m > 0)) return; const label = $('tmp-label').value; hidePopover(); P.style.width = ''; paintTimer(await window.api.timerStart(m, label)); };
  P.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => go(+b.dataset.m)));
  $('tmp-go').onclick = () => go(+$('tmp-min').value);
  $('tmp-min').onkeydown = (k) => { if (k.key === 'Enter') go(+$('tmp-min').value); };
  setTimeout(() => $('tmp-label').focus(), 30);
};
$('tm-pause').onclick = async () => paintTimer(await (tmLast.paused ? window.api.timerResume() : window.api.timerPause()));
$('tm-add').onclick = async () => paintTimer(await window.api.timerAdd(5));
$('tm-stop').onclick = async () => paintTimer(await window.api.timerStop());
window.api.onTimer(paintTimer);
window.api.timerGet().then(paintTimer);
// Time's up: a calm card in the app with the two things she'd want next.
window.api.onTimerEnd((label) => {
  openModal(`<div class="center-text timeup"><div class="disc done"><b>${I.check}</b></div>
    <h2>Time's up${label ? `: ${esc(label)}` : ''}</h2><p class="muted">Need a little longer?</p>
    <div class="actions center"><button class="btn" id="tu-more">+5 min</button><button class="btn primary" id="tu-done">Done</button></div></div>`);
  $('tu-more').onclick = async () => { closeModal(); paintTimer(await window.api.timerStart(5, label)); };
  $('tu-done').onclick = () => { closeModal(); bumpDone(); };
});
