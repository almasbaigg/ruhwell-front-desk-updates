// Diagnostics log: plain text in the data folder (Logs/YYYY-MM-DD.log), 30 days, for troubleshooting.
// Only part names, timings, counts and error reasons. Anything that looks like a phone number, email address,
// long number, token or name-like quoted text is removed before writing.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dir = () => path.join(app.getPath('userData'), 'Data', 'Logs');
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const SAFE = new Set(('RxNT RingRx Gmail Google Doximity Availability Front Desk Ruhwell Med Couldn\'t Can\'t Didn\'t Wouldn\'t Isn\'t Check Sign Try Open The A An No Not Can Couldn Retrying Requested Timed Today ' +
  'Mon Tue Wed Thu Fri Sat Sun Monday Tuesday Wednesday Thursday Friday Saturday Sunday Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec AM PM HTTP OK Error Internal Server Bad Request ' +
  'Gateway Service Unavailable Too Many Requests Forbidden Unauthorized Network Failed TypeError AbortError TimeoutError Electron Windows Mac Accounts Settings Connections Patient Visits ' +
  'GET POST GET_FAILED SIGNED_OUT OFFLINE FAILED BAD_LOGIN OTP_REQUIRED Retry Retrying Waiting').split(' '));
function scrub(v) {
  return String(v == null ? '' : v)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .replace(/\b(bearer|token|password|secret|cookie|code)\b\s*[:=]?\s*\S+/gi, '$1 [hidden]')
    .replace(/"[^"]{2,80}"/g, '"…"')
    // Any capitalised word that isn't one of the app's own words could be a name: hidden.
    .replace(/\b[A-Z][a-zA-Z'’-]+\b/g, (w) => (SAFE.has(w) ? w : '[word]'))
    .slice(0, 400);
}
let ready = false;
function write(line) {
  try {
    if (!ready) { fs.mkdirSync(dir(), { recursive: true }); ready = true; }
    fs.appendFileSync(path.join(dir(), `${day()}.log`), line + '\n');
  } catch {}
}
// diag('schedule', 'failed', { ms: 1234, why: 'timeout' })
function diag(part, what, info) {
  const t = new Date();
  const extra = info ? ' ' + Object.entries(info).map(([k, v]) => `${k}=${scrub(v)}`).join(' ') : '';
  write(`${t.toTimeString().slice(0, 8)} ${String(part).padEnd(9)} ${scrub(what)}${extra}`);
}
function prune() { try { const cut = day(new Date(Date.now() - 30 * 864e5)); for (const f of fs.readdirSync(dir())) if (/^\d{4}-\d\d-\d\d\.log$/.test(f) && f.slice(0, 10) < cut) fs.rmSync(path.join(dir(), f), { force: true }); } catch {} }
// The last `days` days in one text, newest last (Settings → App → Save diagnostics).
// A short summary of the last days at the top of the saved file: failures by part, slowest reads, odd events.
function summary(text) {
  const fails = {}, slow = {}, events = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\d\d:\d\d:\d\d (\S+)\s+(\S+)/); if (!m) continue;
    const [, part, what] = m;
    if (what === 'failed') fails[part] = (fails[part] || 0) + 1;
    const ms = line.match(/ ms=(\d+)/); if (ms && what === 'ok') slow[part] = Math.max(slow[part] || 0, +ms[1]);
    if (/timers were paused|ended stale run|reader rebuilt|quiet sign-in|layout|error|page scrolls/.test(line)) { const k = `${part} ${line.slice(19).split(' ').slice(0, 3).join(' ')}`; events[k] = (events[k] || 0) + 1; }
  }
  const f = (o, unit = '') => Object.entries(o).map(([k, v]) => `${k} ${unit === 's' ? Math.round(v / 1000) + 's' : v}`).join(', ') || 'none';
  return `Summary: failures: ${f(fails)} · slowest ok read: ${f(slow, 's')}\nNotable: ${Object.entries(events).slice(0, 15).map(([k, v]) => `${k} ×${v}`).join(' · ') || 'none'}\n`;
}
function bundle(days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const f = path.join(dir(), `${day(new Date(Date.now() - i * 864e5))}.log`); try { out.push(`===== ${path.basename(f)} =====\n` + fs.readFileSync(f, 'utf8')); } catch {} }
  const all = out.join('\n');
  return summary(all) + '\n' + all;
}
module.exports = { diag, prune, bundle, scrub, dir };
