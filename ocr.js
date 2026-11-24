// Fax sorting help: reads the fax pages on this computer (OCR, nothing leaves it), then suggests a category
// and possible patients. Suggestions only: Maria still picks and confirms the patient before anything is filed.
const path = require('path');
const { app } = require('electron');

let worker = null, idle = null, queue = Promise.resolve();
// The language data ships with the app (unpacked from the asar so the OCR worker can read it).
const langDir = () => path.join(__dirname, 'ocr').replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
async function getWorker() {
  clearTimeout(idle); idle = setTimeout(() => { if (worker) { worker.terminate().catch(() => {}); worker = null; } }, 120000);
  if (worker) return worker;
  const T = require('tesseract.js');
  worker = await T.createWorker('eng', 1, { langPath: langDir(), gzip: true, cachePath: path.join(app.getPath('userData'), 'ocr-cache') });
  return worker;
}
// pages: PNG images as base64 (the window draws them from the PDF). Returns plain text.
function read(pages) {
  const job = queue.then(async () => {
    const w = await getWorker(); let text = '';
    for (const b64 of (pages || []).slice(0, 3)) { const r = await w.recognize(Buffer.from(b64, 'base64')); text += '\n' + (r.data.text || ''); }
    return text;
  });
  queue = job.catch(() => {});
  return job;
}

const CATS = [
  ['Notice', /verification code|verify (your )?prescribers|do not reply|unsubscribe|marketing|advertis|newsletter|this is not a prescription/i],
  ['Prior authorization', /prior auth|covermymeds|\bPA request|authorization request|step therapy|formulary exception|appeal/i],
  ['Pharmacy', /pharmacy|refill request|rx refill|renewal request|walgreens|cvs|h-?e-?b|walmart|kroger|dispense|NCPDP|prescription clarification/i],
  ['Lab results', /laborator|lab results?|specimen|quest diagnostics|labcorp|reference range|collected:|lithium level|CBC|CMP\b/i],
  ['Records', /medical records|records request|request for records|release of information|authorization (to|for) (release|disclose)|HIPAA authorization|subpoena/i],
  ['Referral', /referral|consult(ation)? (request|note)|referring (provider|physician)|intake/i],
  ['Insurance', /insurance|eligibility|claim|explanation of benefits|\bEOB\b|member id|denial|coverage determination/i],
];
function categorize(text, from) {
  const t = `${from || ''}\n${text || ''}`;
  for (const [name, re] of CATS) if (re.test(t)) return name;
  return (text || '').trim().length < 40 ? 'Unreadable' : 'Other';
}
// Possible patients: DOB found in the fax AND/OR the patient's last name. Name + DOB is a strong match.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
function suggest(text, patients) {
  const t = String(text || ''), low = ' ' + t.toLowerCase().replace(/[^a-z0-9/\- ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const dobs = new Set();
  for (const m of t.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g)) {
    let [, mo, d, y] = m; y = y.length === 2 ? (Number(y) > 30 ? '19' : '20') + y : y;
    if (Number(mo) <= 12 && Number(d) <= 31) dobs.add(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  const out = [];
  for (const p of patients) {
    const last = norm(p.last), first = norm(p.first); if (last.length < 3) continue;
    const lastHit = low.includes(' ' + last + ' ') || low.includes(' ' + last + ',');
    const firstHit = first.length >= 3 && low.includes(' ' + first + ' ');
    const dobHit = p.dob && dobs.has(String(p.dob).slice(0, 10));
    const score = (lastHit ? 2 : 0) + (firstHit ? 1 : 0) + (dobHit ? 3 : 0);
    if (score >= 3 && (lastHit || dobHit)) out.push({ key: p.key, score, why: [lastHit && 'name', dobHit && 'DOB'].filter(Boolean).join(' + ') });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

module.exports = { read, categorize, suggest };
