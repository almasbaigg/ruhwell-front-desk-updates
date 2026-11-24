// Diagnostics log: plain text in the data folder (Logs/YYYY-MM-DD.log), 30 days, for troubleshooting.
// Only part names, timings, counts and error reasons. Anything that looks like a phone number, email address,
// long number, token or name-like quoted text is removed before writing.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dir = () => path.join(app.getPath('userData'), 'Data', 'Logs');
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function scrub(v) {
  return String(v == null ? '' : v)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .replace(/\b(bearer|token|password|secret|cookie|code)\b\s*[:=]?\s*\S+/gi, '$1 [hidden]')
    .replace(/"[^"]{2,80}"/g, '"…"')
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
function bundle(days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) { const f = path.join(dir(), `${day(new Date(Date.now() - i * 864e5))}.log`); try { out.push(`===== ${path.basename(f)} =====\n` + fs.readFileSync(f, 'utf8')); } catch {} }
  return out.join('\n');
}
module.exports = { diag, prune, bundle, scrub, dir };
