// Gmail through Google's own sign-in (the practice's internal "Ruhwell Front Desk" app on Google Cloud).
// Read the inbox, open threads, mark read/unread, archive, and send from hello@ruhwellmed.com.
// The key file and the sign-in are kept encrypted on this computer only; never in the code or on GitHub.
// The app asks only for gmail.modify: read, send, labels. It cannot permanently delete mail.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const store = require('./store');

const KEY = 'google-key.bin', TOKEN = 'google-token.bin';
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SENDER = 'hello@ruhwellmed.com';
let access = null, accessExp = 0, last = { connected: false, account: '', unread: null, at: null, error: null, sendAs: null };

class GmailError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

// ---------- Key file (loaded once per computer from Settings) ----------
function loadKeyFile(text) {
  let j; try { j = JSON.parse(text); } catch { return { error: "That file isn't a Google key file (.json)." }; }
  const k = j.installed || j.web || j;
  if (!k.client_id || !k.client_secret || !/\.apps\.googleusercontent\.com$/.test(k.client_id)) return { error: "That file doesn't have a Google sign-in key in it." };
  store.raw.writeSecure(KEY, { clientId: k.client_id, secret: k.client_secret, project: k.project_id || '' });
  return { ok: true, project: k.project_id || '' };
}
const key = () => store.raw.readSecure(KEY, null);
const hasKey = () => !!(key() && key().clientId);
const tokens = () => store.raw.readSecure(TOKEN, null);

// ---------- Sign-in: Google's page in the normal browser, answered on this computer (127.0.0.1) ----------
let signingIn = null;
function signIn() {
  if (signingIn) return signingIn;
  const k = key(); if (!k) return Promise.resolve({ error: 'nokey' });
  signingIn = new Promise((resolve) => {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { server.close(); } catch {} signingIn = null; resolve(r); };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/oauth') { res.writeHead(404); return res.end(); }
      const page = (msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><title>Ruhwell Front Desk</title><body style="font:16px system-ui;background:#f6f1eb;color:#1f3a3a;display:grid;place-items:center;height:90vh"><div style="text-align:center"><h2 style="color:#005758">${msg}</h2><p>You can close this tab and go back to Ruhwell Front Desk.</p></div>`); };
      if (u.searchParams.get('state') !== state) { page('Something went wrong'); return finish({ error: 'state' }); }
      if (u.searchParams.get('error')) { page('Sign-in cancelled'); return finish({ error: u.searchParams.get('error') }); }
      try {
        const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: u.searchParams.get('code'), client_id: k.clientId, client_secret: k.secret, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }) });
        const t = await r.json();
        if (!t.refresh_token) { page('Sign-in failed'); return finish({ error: t.error_description || t.error || 'notoken' }); }
        store.raw.writeSecure(TOKEN, { refresh: t.refresh_token, at: new Date().toISOString() });
        access = t.access_token; accessExp = Date.now() + (Number(t.expires_in) || 3000) * 1000;
        page('Gmail is connected');
        await check();
        finish({ ok: true, account: last.account });
      } catch (e) { page('Sign-in failed'); finish({ error: String(e.message || e) }); }
    });
    let redirect = '';
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${server.address().port}/oauth`;
      const q = new URLSearchParams({ client_id: k.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state, login_hint: 'admin@ruhwellmed.com', hd: 'ruhwellmed.com' });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
    });
    const timer = setTimeout(() => finish({ error: 'timeout' }), 10 * 60000);
  });
  return signingIn;
}
function signOut() { store.raw.writeSecure(TOKEN, null); access = null; accessExp = 0; last = { connected: false, account: '', unread: null, at: null, error: null, sendAs: null }; }

// One refresh at a time: requests that find the access expired all wait for the same refresh.
let refreshing = null;
function token() {
  if (access && Date.now() < accessExp - 60000) return Promise.resolve(access);
  if (!refreshing) refreshing = refreshToken().finally(() => { refreshing = null; });
  return refreshing;
}
async function refreshToken() {
  const k = key(), t = tokens();
  if (!k || !t || !t.refresh) throw new GmailError('Connect Gmail in Settings first.', 'SIGNED_OUT');
  let r;
  try { r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ client_id: k.clientId, client_secret: k.secret, refresh_token: t.refresh, grant_type: 'refresh_token' }) }); }
  catch { throw new GmailError("Can't reach Google right now.", 'OFFLINE'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (j.error === 'invalid_grant') { store.raw.writeSecure(TOKEN, null); throw new GmailError('Gmail sign-in expired. Sign in again in Settings.', 'SIGNED_OUT'); }
    throw new GmailError("Google isn't answering right now.", 'OFFLINE');
  }
  access = j.access_token; accessExp = Date.now() + (Number(j.expires_in) || 3000) * 1000;
  return access;
}
async function api(path, opts = {}, retried) {
  const res = await fetch(path.startsWith('http') ? path : API + path, { ...opts, signal: AbortSignal.timeout(opts.timeout || 30000),
    headers: { Authorization: `Bearer ${await token()}`, ...(opts.body && !opts.raw ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  // An expired access token: refresh once and try again (Google refused it, so nothing was done the first time).
  if (res.status === 401) { access = null; if (!retried) return api(path, opts, true); throw new GmailError('Gmail sign-in expired.', 'SIGNED_OUT'); }
  const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch {}
  if (!res.ok) throw new GmailError((j && j.error && j.error.message) || `Gmail ${res.status}`, res.status === 429 || res.status >= 500 ? 'OFFLINE' : 'FAILED');
  return j;
}

// ---------- Status ----------
const connected = () => hasKey() && !!(tokens() && tokens().refresh);
async function check() {
  if (!connected()) { last = { ...last, connected: false, error: hasKey() ? 'signin' : 'nokey' }; return last; }
  try {
    const [prof, inbox, sa] = await Promise.all([api('/profile'), api('/labels/INBOX'), api('/settings/sendAs')]);
    const hello = (sa.sendAs || []).find((x) => x.sendAsEmail.toLowerCase() === SENDER);
    last = { connected: true, account: prof.emailAddress, unread: inbox.threadsUnread, at: new Date().toISOString(), error: null,
      sendAs: hello ? { email: hello.sendAsEmail, name: hello.displayName || '', ok: hello.isPrimary || hello.verificationStatus === 'accepted' || !hello.verificationStatus } : null };
  } catch (e) { last = { ...last, connected: e.code !== 'SIGNED_OUT', error: e.code === 'SIGNED_OUT' ? 'signin' : 'failed', at: new Date().toISOString() }; }
  return last;
}
const status = () => ({ ...last, hasKey: hasKey() });

// ---------- Reading ----------
const hdr = (m, name) => ((m.payload && m.payload.headers) || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const b64 = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function addr(v) { const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return m ? { name: m[1].trim(), email: m[2].trim().toLowerCase() } : { name: '', email: String(v || '').trim().toLowerCase() }; }

async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } })); return out; }

// folder: inbox | sent | all ; q: Gmail search words
async function list({ folder = 'inbox', q = '', pageToken = '' } = {}) {
  const p = new URLSearchParams({ maxResults: '30' });
  if (folder === 'inbox') p.set('labelIds', 'INBOX'); else if (folder === 'sent') p.set('labelIds', 'SENT'); else if (folder === 'spam') { p.set('labelIds', 'SPAM'); p.set('includeSpamTrash', 'true'); } else if (folder === 'unread') { p.set('labelIds', 'INBOX'); p.set('q', 'is:unread'); }
  if (q) p.set('q', [p.get('q'), q].filter(Boolean).join(' '));
  if (pageToken) p.set('pageToken', pageToken);
  const r = await api(`/threads?${p}`);
  const threads = await pool(r.threads || [], 8, (t) => api(`/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`));
  return { next: r.nextPageToken || '', items: threads.filter(Boolean).map((t) => {
    const msgs = t.messages || [], lastM = msgs[msgs.length - 1] || {}, first = msgs[0] || {};
    const from = addr(hdr(lastM, 'From')), to = addr(hdr(lastM, 'To'));
    return { id: t.id, subject: hdr(first, 'Subject') || '(no subject)', from, to, count: msgs.length, snippet: lastM.snippet || '',
      at: new Date(Number(lastM.internalDate) || Date.now()).toISOString(), unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')),
      inbox: msgs.some((m) => (m.labelIds || []).includes('INBOX')), attach: msgs.some((m) => (m.labelIds || []).includes('HAS_ATTACHMENT')) || false };
  }) };
}
function walkParts(part, out) {
  if (!part) return out;
  const mime = part.mimeType || '';
  if (part.filename && part.body && (part.body.attachmentId || part.body.data)) out.files.push({ name: part.filename, mime, size: part.body.size || 0, id: part.body.attachmentId || '', inline: (part.headers || []).some((h) => /content-id/i.test(h.name)) });
  else if (mime === 'text/html' && part.body && part.body.data) out.html += b64(part.body.data).toString('utf8');
  else if (mime === 'text/plain' && part.body && part.body.data) out.text += b64(part.body.data).toString('utf8');
  for (const p of part.parts || []) walkParts(p, out);
  return out;
}
async function thread(id) {
  const t = await api(`/threads/${encodeURIComponent(id)}?format=full`);
  return { id: t.id, messages: (t.messages || []).map((m) => {
    const body = walkParts(m.payload, { html: '', text: '', files: [] });
    return { id: m.id, from: addr(hdr(m, 'From')), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), subject: hdr(m, 'Subject'), at: new Date(Number(m.internalDate)).toISOString(),
      msgId: hdr(m, 'Message-ID') || hdr(m, 'Message-Id'), refs: hdr(m, 'References'), unread: (m.labelIds || []).includes('UNREAD'), sent: (m.labelIds || []).includes('SENT'),
      html: body.html, text: body.text, files: body.files.filter((f) => !f.inline) };
  }) };
}
async function attachment(msgId, attId) { const r = await api(`/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(attId)}`); return b64(r.data).toString('base64'); }
const modify = (threadId, add = [], remove = []) => api(`/threads/${encodeURIComponent(threadId)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
const markRead = (id, read = true) => modify(id, read ? [] : ['UNREAD'], read ? ['UNREAD'] : []);
const archive = (id) => modify(id, [], ['INBOX']);
const unarchive = (id) => modify(id, ['INBOX'], []);
const notSpam = (id) => modify(id, ['INBOX'], ['SPAM']);
const spam = (id) => modify(id, ['SPAM'], ['INBOX']);

// ---------- Sending (always from hello@ruhwellmed.com) ----------
const enc = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const wrap = (b) => b.replace(/.{1,76}/g, '$&\r\n');
const plain = (html) => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
const validEmail = (e) => /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(String(e || '').trim());
function mime({ to, cc, subject, html, files = [], inReplyTo, refs, fromName }) {
  const b = () => 'rfd' + crypto.randomBytes(12).toString('hex');
  const mixed = b(), alt = b();
  const head = [`From: ${enc(fromName || 'Ruhwell Med')} <${SENDER}>`, `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), `Subject: ${enc(subject || '')}`, 'MIME-Version: 1.0',
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${[refs, inReplyTo].filter(Boolean).join(' ')}`] : []), `Reply-To: ${SENDER}`];
  const altPart = [`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(plain(html)).toString('base64')),
    `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(html || '').toString('base64')), `--${alt}--`].join('\r\n');
  if (!files.length) return [...head, altPart].join('\r\n');
  const parts = files.map((f) => [`--${mixed}`, `Content-Type: ${f.mime || 'application/octet-stream'}; name="${enc(f.name)}"`, `Content-Disposition: attachment; filename="${enc(f.name)}"`, 'Content-Transfer-Encoding: base64', '', wrap(f.b64)].join('\r\n'));
  return [...head, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, altPart, ...parts, `--${mixed}--`].join('\r\n');
}
async function send(msg) {
  const recips = String(msg.to || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  if (!recips.length || !recips.every(validEmail)) throw new GmailError('Check the email address.', 'BADADDR');
  if (String(msg.cc || '').trim() && !String(msg.cc).split(/[,;]/).map((x) => x.trim()).filter(Boolean).every(validEmail)) throw new GmailError('Check the Cc address.', 'BADADDR');
  const size = (msg.files || []).reduce((n, f) => n + Buffer.byteLength(f.b64 || '', 'base64'), 0);
  if (size > 24 * 1024 * 1024) throw new GmailError('Attachments are over Gmail’s 25 MB limit.', 'TOOBIG');
  // Never fall back to admin@: patients only ever get mail from hello@ruhwellmed.com.
  const st = await check();
  if (!st.connected) throw new GmailError('Gmail is not connected.', 'SIGNED_OUT');
  if (!st.sendAs || !st.sendAs.ok) throw new GmailError(`${SENDER} isn't set up as a "Send mail as" address in Gmail, so nothing was sent.`, 'NOSENDER');
  const raw = mime({ ...msg, to: recips.join(', '), fromName: msg.fromName || store.settings.get().emailFromName || st.sendAs.name || 'Ruhwell Med' });
  const bound = 'rfdup' + crypto.randomBytes(8).toString('hex');
  const body = Buffer.concat([Buffer.from(`--${bound}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(msg.threadId ? { threadId: msg.threadId } : {})}\r\n--${bound}\r\nContent-Type: message/rfc822\r\n\r\n`), Buffer.from(raw), Buffer.from(`\r\n--${bound}--`)]);
  await token();   // a sign-in problem shows up here, before anything is submitted
  let r;
  try { r = await api('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart', { method: 'POST', raw: true, body, timeout: 120000, headers: { 'Content-Type': `multipart/related; boundary=${bound}` } }); }
  catch (e) {
    // Google said no (4xx) or the sign-in was refused: nothing went out. Anything else (timeout, dropped connection,
    // server error) may have been accepted, so it is never sent again automatically.
    if (e instanceof GmailError && (e.code === 'FAILED' || e.code === 'SIGNED_OUT')) throw e;
    throw new GmailError("Not sure this email went out (the connection dropped while sending). Check Sent before sending again.", 'UNCERTAIN');
  }
  return { id: r.id, threadId: r.threadId };
}

module.exports = { loadKeyFile, hasKey, connected, signIn, signOut, check, status, list, thread, attachment, markRead, archive, unarchive, spam, notSpam, send, mime, plain, validEmail, SENDER, GmailError };
