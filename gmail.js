// Gmail (admin@ruhwellmed.com): sign in once in the app, then read the unread count and the
// newest unread senders/subjects from Gmail's inbox feed. Kept in memory only, never saved.
const { BrowserWindow, session } = require('electron');
const PART = 'persist:google';
let last = { connected: false, unread: null, account: '', at: null, error: null, items: [] };
const unxml = (t) => String(t || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (x, t) => unxml((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
function entries(xml) {
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).slice(0, 8).map((e) => ({
    from: tag(tag(e, 'author') ? e.match(/<author>[\s\S]*?<\/author>/)[0] : '', 'name') || tag(e, 'email'),
    subject: tag(e, 'title') || '(no subject)', snippet: tag(e, 'summary').slice(0, 140),
    at: tag(e, 'issued') || tag(e, 'modified'), id: ((e.match(/message_id=([0-9a-f]+)/) || [])[1]) || '',
  }));
}

function ua() { return session.fromPartition(PART).getUserAgent().replace(/\s(Electron|ruhwell[^ ]*|Ruhwell Front Desk)\/[\d.]+/gi, ''); }

// Keep the Google sign-in from ending when the app closes: cookies that would vanish at the end of the
// session are kept for 6 months on this computer (the same way the browser's "stay signed in" works).
async function keepSignedIn() {
  try {
    const ses = session.fromPartition(PART), until = Math.floor(Date.now() / 1000) + 180 * 86400;
    for (const c of (await ses.cookies.get({})).filter((x) => x.session && /google\.com$/.test(x.domain.replace(/^\./, '')))) {
      await ses.cookies.set({ url: `https://${c.domain.replace(/^\./, '')}${c.path || '/'}`, name: c.name, value: c.value, path: c.path, domain: c.hostOnly ? undefined : c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: until }).catch(() => {});
    }
    await ses.cookies.flushStore();
  } catch {}
}
async function check() {
  try {
    const ses = session.fromPartition(PART);
    const r = await ses.fetch('https://mail.google.com/mail/u/0/feed/atom', { headers: { 'User-Agent': ua() }, redirect: 'manual' });
    if (r.status !== 200) { last = { ...last, connected: false, unread: null, error: r.status === 401 || (r.status >= 300 && r.status < 400) ? 'signin' : 'failed', at: new Date().toISOString() }; return last; }
    const xml = await r.text();
    const n = Number((xml.match(/<fullcount>(\d+)<\/fullcount>/) || [])[1]);
    const account = ((xml.match(/<title>[^<]*for ([^<\s]+)<\/title>/) || [])[1] || '').trim();
    last = { connected: !isNaN(n), unread: isNaN(n) ? null : n, account, at: new Date().toISOString(), error: isNaN(n) ? 'failed' : null, items: isNaN(n) ? [] : entries(xml) };
    if (last.connected) keepSignedIn();
  } catch { last = { ...last, error: 'failed', at: new Date().toISOString() }; }
  return last;
}

// Opens Google's sign-in; finishes once Gmail's inbox loads.
function signIn(parent) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 520, height: 720, parent, modal: !!parent, title: 'Sign in to Gmail', autoHideMenuBar: true, webPreferences: { partition: PART } });
    win.webContents.setUserAgent(ua());
    let done = false;
    const finish = async (ok) => { if (done) return; done = true; if (!win.isDestroyed()) win.close(); resolve(ok ? (await check()).connected : false); };
    win.webContents.on('did-navigate', (_e, url) => { if (/^https:\/\/mail\.google\.com\/mail\//.test(url)) finish(true); });
    win.on('closed', () => finish(false));
    win.loadURL('https://accounts.google.com/ServiceLogin?service=mail&continue=https://mail.google.com/mail/');
  });
}
async function signOut() { await session.fromPartition(PART).clearStorageData(); last = { connected: false, unread: null, account: '', at: null, error: null, items: [] }; }
const status = () => last;
// Opens Gmail in the browser on the practice account (not whichever Google account is first there).
function url(messageId) {
  const who = encodeURIComponent(last.account || 'admin@ruhwellmed.com');
  return `https://mail.google.com/mail/?authuser=${who}#inbox${messageId && /^[0-9a-f]+$/.test(messageId) ? '/' + messageId : ''}`;
}

module.exports = { keepSignedIn, check, signIn, signOut, status, url };
