// Fax sorting help: reads the fax pages on this computer (OCR, nothing leaves it), then suggests a category
// and possible patients. Suggestions only: Maria still picks and confirms the patient before anything is filed.
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { app } = require('electron');

let worker = null, idle = null, queue = Promise.resolve();
// The language data ships with the app (unpacked from the asar so the OCR worker can read it).
const langDir = () => path.join(__dirname, 'ocr').replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
async function getWorker() {
  clearTimeout(idle); idle = setTimeout(() => { if (worker) { worker.terminate().catch(() => {}); worker = null; } }, 120000);
  if (worker) return worker;
  const T = require('tesseract.js');
  // Inside Electron, tesseract treats any langPath as a web address. It always checks its cache folder
  // first with a plain file read, so put the bundled language data there and it never goes looking online.
  const cacheDir = path.join(app.getPath('userData'), 'ocr-cache'), cached = path.join(cacheDir, 'eng.traineddata');
  if (!fs.existsSync(cached)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = cached + '.tmp';
    fs.writeFileSync(tmp, zlib.gunzipSync(fs.readFileSync(path.join(langDir(), 'eng.traineddata.gz'))));
    fs.renameSync(tmp, cached);
  }
  // errorHandler stops an OCR failure from becoming a crash; the job just rejects and the fax stays unsorted.
  try {
    worker = await T.createWorker('eng', 1, { cachePath: cacheDir, langPath: 'https://invalid.local/none', errorHandler: () => {},
      ...(process.env.OCR_DEBUG ? { logger: (m) => console.log('LOG', JSON.stringify(m)) } : {}) });
  } catch (e) { worker = null; throw e; }
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

// What the fax itself says: the patient's name and DOB (from labels like "Patient:", "Name:", "Regarding:",
// "DOB:"), and who sent it (the cover page "From:"). Kept with the fax on this computer only.
function found(text) {
  const t = String(text || '').replace(/\r/g, '');
  const clean = (v) => String(v || '').replace(/[^A-Za-z ,.'\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const nameRe = [/(?:patient(?:\s*name)?|pt(?:\s*name)?|regarding|re)\s*[:\-]\s*([A-Za-z][A-Za-z ,.'\-]{3,40})/i, /\bname\s*[:\-]\s*([A-Za-z][A-Za-z ,.'\-]{3,40})/i, /\bPATIENT\s*\n\s*([A-Z][A-Z ,.'\-]{3,40})/];
  let name = '';
  for (const re of nameRe) { const m = t.match(re); if (m) { name = clean(m[1]).split(/\s{2,}| (?:DOB|D\.O\.B|Date|Sex|Age|MRN|Phone)\b/i)[0].trim(); if (name.split(' ').length >= 2) break; name = ''; } }
  if (/,/.test(name)) { const [l, f] = name.split(',').map((x) => x.trim()); name = `${f} ${l}`.trim(); }
  name = name.split(' ').slice(0, 4).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const dm = t.match(/(?:DOB|D\.O\.B\.?|date\s*of\s*birth|birth\s*date)\s*[:\-]?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/i);
  let dob = '';
  if (dm) { let [, mo, d, y] = dm; y = y.length === 2 ? (Number(y) > 30 ? '19' : '20') + y : y; if (+mo <= 12 && +d <= 31) dob = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  const fm = t.match(/\bfrom\s*[:\-]\s*([^\n]{3,60})/i);
  const sender = fm ? clean(fm[1]).replace(/\b(phone|fax|date|to)\b.*$/i, '').trim().slice(0, 50) : '';
  // When the fax was sent, from the cover page ("Sent: 09/21/2026 12:59", "Date: 07/31/2026"), for faxes whose date Doximity didn't show.
  const sm = t.match(/\b(?:sent|date)\s*[:\-]?\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);
  const sentAt = sm && +sm[1] <= 12 ? new Date(+sm[3], +sm[1] - 1, +sm[2], +(sm[4] || 12), +(sm[5] || 0)).toISOString() : '';
  return { name: name.length >= 5 ? name : '', dob, sender, sentAt };
}
module.exports = { read, categorize, suggest, found };
