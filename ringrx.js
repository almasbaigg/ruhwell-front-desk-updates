// RingRx REST API (portal.ringrx.com). Sign in once; the refresh token is kept
// encrypted on this computer so you stay signed in.
const store = require('./store');

const BASE = 'https://portal.ringrx.com';
const cache = {};   // profileId -> { access, exp }

class RingRxError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

async function post(path, body, token, query) {
  const url = new URL(BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

function keep(pid, tokens, username) {
  const exp = Number(tokens.expires_in) || 0;
  cache[pid] = { access: tokens.access_token, exp: exp > 1e9 ? exp * 1000 : Date.now() + 5 * 60 * 1000 };
  const saved = store.ringrx.get(pid) || {};
  store.ringrx.set(pid, {
    username: username || saved.username,
    refreshToken: tokens.refresh_token || saved.refreshToken,
  });
}

async function login(pid, username, password, otp) {
  const body = { username, password };
  if (otp) body.otp = otp;
  const r = await post('/auth/token', body);
  if (r.status === 423) throw new RingRxError('Enter the 6-digit code from your authenticator.', 'OTP_REQUIRED');
  if (r.status === 401) throw new RingRxError('That username or password (or code) is incorrect.', 'BAD_LOGIN');
  if (!r.ok || !r.data?.access_token) throw new RingRxError(`RingRx sign-in failed (${r.status}).`, 'FAILED');
  keep(pid, r.data, username);
  return { username };
}

async function token(pid) {
  const c = cache[pid];
  if (c && Date.now() < c.exp - 30000) return c.access;
  const saved = store.ringrx.get(pid);
  if (!saved?.refreshToken) throw new RingRxError('Sign in to RingRx first.', 'SIGNED_OUT');
  const r = await post('/auth/refresh', { refresh_token: saved.refreshToken });
  if (!r.ok || !r.data?.access_token) {
    store.ringrx.clear(pid);
    throw new RingRxError('Your RingRx sign-in expired. Please sign in again.', 'SIGNED_OUT');
  }
  keep(pid, r.data);
  return cache[pid].access;
}

function normalize(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) throw new RingRxError(`"${phone}" isn't a valid 10-digit number.`, 'BAD_NUMBER');
  return d;
}

async function sendSms(pid, to, message) {
  const num = normalize(to);
  const r = await post('/messaging/send_message', null, await token(pid), { to: num, message });
  if (r.status === 401) { delete cache[pid]; throw new RingRxError('RingRx session expired. Try again.', 'RETRY'); }
  if (!r.ok) throw new RingRxError(`RingRx couldn't send (${r.status}). ${String(r.text).slice(0, 160)}`, 'SEND_FAILED');
  return true;
}

function status(pid) {
  const s = store.ringrx.get(pid);
  return s?.refreshToken ? { connected: true, username: s.username } : { connected: false };
}

async function get(pid, path, query) {
  const url = new URL(BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token(pid)}` } });
  if (!res.ok) throw new RingRxError(`RingRx ${path} ${res.status}`, 'GET_FAILED');
  return res.json();
}
const digits10 = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

// ---------- Reading texts, voicemails, calls and contacts ----------
// Same sources the RingRx website's Activity page uses:
//   /myphones                                  this user (extension, username, caller ID, SMS number, mobile)
//   /contacts?max=25000                        contacts: "directory" = users on this account, "private" = saved contacts
//   /voicemails?message_folder=inbox|sent      texts (message_type "message") and voicemails ("voicemail")
//   /cdrs?startDate=DD-MM-YYYY&endDate=...     call log (direction inbound / outbound / internal)
const meCache = {};
async function me(pid) {
  if (meCache[pid] && Date.now() - meCache[pid].at < 30 * 60000) return meCache[pid].v;
  const m = await get(pid, '/myphones');
  const v = {
    name: m.name || '', extension: String(m.extension || ''), username: String(m.username || ''),
    callerId: digits10(m.external_callerid_number), smsNumber: digits10(m.outbound_sms_number), mobile: digits10(m.mobile),
  };
  meCache[pid] = { v, at: Date.now() };
  return v;
}
async function sendingNumber(pid) { try { const m = await me(pid); return m.smsNumber || m.callerId || ''; } catch { return ''; } }

// Where alert texts go: the number set in Settings, otherwise the practice's RingRx number,
// (979) 205-5460 (Ruhwell Med's main line).
const PRACTICE_NUMBER = '9792055460';
async function alertNumber(pid) {
  const s = store.settings.get(), set = (s.alertCells || {})[pid] || s.watch.smsTo;
  return set || (await sendingNumber(pid)) || PRACTICE_NUMBER;
}

async function contacts(pid) {
  const list = await get(pid, '/contacts', { max: 25000 });
  return (Array.isArray(list) ? list : []).map((c) => ({
    id: String(c.id), name: String(c.name || '').trim(), type: String(c.contact_type || ''), org: c.org || '', user: c.user || '',
    numbers: (c.telephone || []).map((t) => digits10(t.number)).filter(Boolean),
    handles: (c.telephone || []).map((t) => String(t.number || '').trim()).filter((x) => x && !digits10(x)),   // extensions / usernames
  }));
}

// Everything that is "us": this user's numbers, extension and username, plus every Directory user's.
async function ours(pid) {
  const m = await me(pid);
  const set = new Set([m.callerId, m.smsNumber, m.extension, m.username].filter(Boolean));
  try { (await contacts(pid)).filter((c) => c.type === 'directory').forEach((c) => { c.numbers.forEach((n) => set.add(n)); c.handles.forEach((h) => set.add(h)); if (c.user) set.add(c.user); }); } catch {}
  return set;
}
const isOurs = (set, raw) => { const s = String(raw || '').trim(); return !s || set.has(s) || set.has(digits10(s)) || !digits10(s); };

// Texts and voicemails in both folders. Returns null if RingRx won't share them.
async function messages(pid, sinceISO) {
  const since = sinceISO || new Date(Date.now() - 90 * 864e5).toISOString();
  let inbox, sent;
  try { [inbox, sent] = await Promise.all([get(pid, '/voicemails', { message_folder: 'inbox', since }), get(pid, '/voicemails', { message_folder: 'sent', since })]); } catch { return null; }
  const us = await ours(pid);
  const out = [];
  for (const [folder, rows] of [['inbox', inbox], ['sent', sent]]) {
    for (const r of Array.isArray(rows) ? rows : []) {
      // Direction comes from who it's from: anything from one of our numbers is outgoing.
      const inbound = folder === 'inbox' && !isOurs(us, r.caller);
      const phone = digits10(inbound ? r.caller : r.called);
      if (!phone || us.has(phone)) continue;   // internal / our own lines
      const at = r.created_at ? new Date(r.created_at).toISOString() : null;
      if (!at) continue;
      const kind = r.message_type === 'voicemail' ? 'voicemail' : 'text';
      out.push({ id: String(r.id), kind, inbound, phone, at, body: String(r.message || '').trim(), transcription: r.transcription ? String(r.transcription) : '', unread: r.status === 'new' });
    }
  }
  return out;
}

// Call log for the last `days` days. Internal calls and calls between our own lines are dropped.
async function calls(pid, days = 90) {
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  const end = new Date(Date.now() + 864e5), start = new Date(Date.now() - days * 864e5);
  let rows;
  try { rows = await get(pid, '/cdrs', { startDate: fmt(start), endDate: fmt(end), getAll: 'false' }); } catch { return null; }
  const us = await ours(pid);
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r.direction === 'internal') continue;
    const inbound = r.direction === 'inbound' ? true : r.direction === 'outbound' ? false : isOurs(us, r.calling_party) ? false : true;
    const phone = digits10(inbound ? (r.caller_id_number || r.calling_party) : (r.dialed_digits || r.called_party));
    if (!phone || us.has(phone)) continue;
    // RingRx gives call times in the account's local time ("2026-11-16 14:34:06").
    const at = r.start_time ? new Date(String(r.start_time).replace(' ', 'T')).toISOString() : null;
    if (!at) continue;
    const answered = !!r.answered_time;
    const voicemail = inbound && /mbx-/.test(String(r.callflow || ''));
    const secs = Number(r.bill_duration || r.duration) || 0;
    out.push({ id: String(r.id), inbound, phone, at, secs, answered, voicemail, missed: inbound && (!answered || voicemail) });
  }
  return out;
}

function logout(pid) { delete cache[pid]; store.ringrx.clear(pid); }

module.exports = { login, sendSms, status, logout, normalize, sendingNumber, alertNumber, me, contacts, messages, calls, RingRxError };
