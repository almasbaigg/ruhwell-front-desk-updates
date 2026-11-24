// RingRx REST API (portal.ringrx.com). Sign in once; the refresh token is kept
// encrypted on this computer so you stay signed in.
const store = require('./store');

const BASE = 'https://portal.ringrx.com';
const cache = {};   // profileId -> { access, exp }

class RingRxError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

async function post(path, body, token, query, timeoutMs) {
  const url = new URL(BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: 'POST', signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data, text };
}

function keep(pid, tokens, username, password) {
  const exp = Number(tokens.expires_in) || 0;
  cache[pid] = { access: tokens.access_token, exp: exp > 1e9 ? exp * 1000 : Date.now() + 5 * 60 * 1000 };
  const saved = store.ringrx.get(pid) || {};
  // The password is kept (encrypted on this computer) only so the app can sign back in by itself if the
  // long-lived RingRx token ever expires. It is saved only after RingRx accepted it.
  const pw = password !== undefined ? password : saved.password;
  store.ringrx.set(pid, {
    username: username || saved.username,
    refreshToken: tokens.refresh_token || saved.refreshToken,
    ...(pw && store.settings.get().rememberRingrx !== false ? { password: pw } : {}),
  });
}

async function login(pid, username, password, otp) {
  const body = { username, password };
  if (otp) body.otp = otp;
  const r = await post('/auth/token', body);
  if (r.status === 423) throw new RingRxError('Enter the 6-digit code from your authenticator.', 'OTP_REQUIRED');
  if (r.status === 401) throw new RingRxError('That username or password (or code) is incorrect.', 'BAD_LOGIN');
  if (!r.ok || !r.data?.access_token) throw new RingRxError(`RingRx sign-in failed (${r.status}).`, 'FAILED');
  keep(pid, r.data, username, password);
  return { username };
}

// One refresh at a time per account: everything that finds the access expired waits for the same one.
const inflight = {};
function token(pid) {
  const c = cache[pid];
  if (c && Date.now() < c.exp - 30000) return Promise.resolve(c.access);
  if (!inflight[pid]) inflight[pid] = refreshAccess(pid).finally(() => { delete inflight[pid]; });
  return inflight[pid];
}
async function refreshAccess(pid) {
  const saved = store.ringrx.get(pid);
  if (saved && saved.needsCode) throw new RingRxError('RingRx needs a verification code. Sign in again in Settings.', 'SIGNED_OUT');
  if (!saved?.refreshToken) throw new RingRxError('Sign in to RingRx first.', 'SIGNED_OUT');
  let r;
  try { r = await post('/auth/refresh', { refresh_token: saved.refreshToken }); }
  catch { throw new RingRxError("Can't reach RingRx right now.", 'OFFLINE'); }   // offline is not signed out
  if (r.ok && r.data?.access_token) { keep(pid, r.data); return cache[pid].access; }
  if (r.status >= 500 || r.status === 429) throw new RingRxError("RingRx isn't answering right now.", 'OFFLINE');
  // The token really expired: sign back in once with the saved sign-in (never retried, so it can't lock anything).
  if (saved.password && saved.username) {
    try { await login(pid, saved.username, saved.password); return cache[pid].access; }
    catch (e) {
      // Only a definite "wrong password / needs a code" ends the sign-in. A dropped connection keeps everything saved.
      if (e.code !== 'BAD_LOGIN' && e.code !== 'OTP_REQUIRED') throw new RingRxError("Can't reach RingRx right now.", 'OFFLINE');
      // A code is needed: keep the saved sign-in (so only the code is asked for) and stop trying until then,
      // so the password is never sent over and over.
      if (e.code === 'OTP_REQUIRED') { store.ringrx.set(pid, { ...store.ringrx.get(pid), refreshToken: undefined, needsCode: true }); throw new RingRxError('RingRx needs a verification code. Sign in again in Settings.', 'SIGNED_OUT'); }
      store.ringrx.set(pid, { ...store.ringrx.get(pid), password: undefined });
    }
  }
  store.ringrx.clear(pid);
  throw new RingRxError('Your RingRx sign-in expired. Please sign in again.', 'SIGNED_OUT');
}

// Keep the RingRx sign-in fresh even when nothing else is happening: refresh well before it expires.
// Returns 'ok', 'offline' or 'signedout' (with the reason code; never a password).
async function keepFresh(pid) {
  const c = cache[pid];
  if (c && c.exp - Date.now() < 15 * 60000) delete cache[pid];   // expiring soon: refresh now, not mid-send
  try { await token(pid); return { state: 'ok' }; }
  catch (e) { return { state: e.code === 'OFFLINE' ? 'offline' : 'signedout', code: e.code || 'ERROR' }; }
}

function normalize(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) throw new RingRxError(`"${phone}" isn't a valid 10-digit number.`, 'BAD_NUMBER');
  return d;
}

// A send whose answer never arrived (connection dropped, timeout, server error) may still have gone out.
// Before reporting anything, look in RingRx's sent texts: if it's there it was sent; if not, say we couldn't
// confirm it, so nobody blindly sends it twice.
async function sendSms(pid, to, message) {
  const num = normalize(to), started = Date.now();
  let r;
  try { r = await post('/messaging/send_message', null, await token(pid), { to: num, message }, 30000); }
  catch { r = null; }
  if (r && r.status === 401) { delete cache[pid]; throw new RingRxError('RingRx session expired. Try again.', 'RETRY'); }
  if (r && r.ok) return true;
  if (r && r.status >= 400 && r.status < 500) throw new RingRxError(`RingRx couldn't send (${r.status}). ${String(r.text).slice(0, 160)}`, 'SEND_FAILED');
  if (await wentOut(pid, num, message, started)) return true;
  throw new RingRxError("Couldn't confirm this text went out. Check the conversation in Texts in a minute before sending it again.", 'UNCERTAIN');
}
async function wentOut(pid, num, message, since) {
  const d = String(num).replace(/\D/g, '').slice(-10), body = String(message).trim();
  for (let i = 0; i < 3; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    try {
      const list = await messages(pid, new Date(since - 2 * 60000).toISOString());
      if (list && list.some((m) => !m.inbound && m.phone === d && String(m.body || '').trim() === body)) return true;
    } catch {}
  }
  return false;
}

function status(pid) {
  const s = store.ringrx.get(pid);
  return s?.refreshToken ? { connected: true, username: s.username } : { connected: false };
}

async function get(pid, path, query, retried) {
  const url = new URL(BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token(pid)}` } });
  if (res.status === 401 && !retried) { delete cache[pid]; return get(pid, path, query, true); }   // access ran out early: refresh once, read again
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
      // Any link RingRx gives for the recording (field name isn't documented; keep the first URL-looking one).
      const media = kind === 'voicemail' ? ['file', 'url', 'recording', 'recording_url', 'audio', 'audio_url', 'media_url', 'attachment', 'file_url', 'download_url'].map((k) => r[k]).find((v) => typeof v === 'string' && /^(https?:)?\/\//.test(v) || (typeof v === 'string' && v.startsWith('/'))) || '' : '';
      out.push({ id: String(r.id), kind, inbound, phone, at, body: String(r.message || '').trim(), transcription: r.transcription ? String(r.transcription) : '', unread: r.status === 'new', media, secs: kind === 'voicemail' ? vmSeconds(r.duration) : 0 });
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
    // Sent to the mailbox. That doesn't mean a message was left: only a voicemail message from RingRx proves that.
    const toMailbox = inbound && /mbx-/.test(String(r.callflow || ''));
    const secs = Number(r.bill_duration || r.duration) || 0;
    out.push({ id: String(r.id), inbound, phone, at, secs, answered, toMailbox, voicemail: false, missed: inbound && (!answered || toMailbox) });
  }
  return out;
}

// Voicemail audio, fetched on demand and kept only in memory. Returns { mime, data(base64) } or null (the app then offers "Listen in RingRx").
async function voicemailAudio(pid, id, media) {
  // RingRx's own web app plays voicemails from /voicemails/<id>/voice_payload (octet-stream means WAV).
  const tries = [`/voicemails/${encodeURIComponent(id)}/voice_payload`, media].filter(Boolean);
  const why = [];
  for (const t of tries) {
    try {
      const url = new URL(t.startsWith('//') ? 'https:' + t : t, BASE);
      const sameHost = url.host === new URL(BASE).host;
      const res = await fetch(url, { headers: sameHost ? { Authorization: `Bearer ${await token(pid)}` } : {} });
      let mime = String(res.headers.get('content-type') || '').split(';')[0];
      if (mime === 'application/octet-stream' || !mime) mime = 'audio/wav';
      if (!res.ok || !/^audio\//.test(mime)) { why.push(`${res.status} ${mime}`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500) { why.push(`short ${buf.length}`); continue; }
      return { mime, data: buf.toString('base64') };
    } catch (e) { why.push(e.code || 'error'); }
  }
  return { error: why.join('; ') || 'no audio' };   // reason only (status/type), for the activity log
}

function logout(pid) { delete cache[pid]; store.ringrx.clear(pid); }

// RingRx gives voicemail length in milliseconds (a 16 s message comes back as 16128).
function vmSeconds(d) { const n = Number(d) || 0; return Math.round(n >= 1000 ? n / 1000 : n); }
// Mark texts/voicemails read in RingRx, the same call RingRx's own website makes when you open one
// (PATCH /voicemails/<id> with status "read"). Only the read status is sent; nothing else can change.
async function markRead(pid, ids) {
  const done = [];
  for (const id of [...new Set(ids || [])].map(String).filter((x) => x && x.length <= 100)) {
    try {
      const res = await fetch(`${BASE}/voicemails/${encodeURIComponent(id)}`, { method: 'PATCH', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${await token(pid)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ voicemail: { status: 'read' } }) });
      if (res.ok) done.push(id);
    } catch {}
  }
  return done;
}
module.exports = { markRead, keepFresh, voicemailAudio, login, sendSms, status, logout, normalize, sendingNumber, alertNumber, me, contacts, messages, calls, RingRxError };
