const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const store = require(APP + '/store');
store.ringrx.set('almas', { refreshToken: 'r', username: 'x' });
// Shapes match RingRx's portal API (field names only; made-up numbers).
const OUR = '19795550100', now = new Date(), iso = (m) => new Date(now - m * 60000).toISOString();
const local = (m) => { const d = new Date(now - m * 60000), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const data = {
  '/myphones': { extension: '100', username: 'mbaig', external_callerid_number: OUR, outbound_sms_number: OUR, mobile: '15125550000', name: 'Maria Baig' },
  '/contacts': [{ id: 1, contact_type: 'directory', name: 'Maria Baig', telephone: [{ type: 'work', number: '100' }, { type: 'work', number: 'mbaig' }, { type: 'work', number: '(979) 555-0100' }] },
                { id: 2, contact_type: 'private', name: 'Fiona Mom', telephone: [{ type: 'phone', number: '5125550111' }] }],
  'inbox': [{ id: 'm1', message_type: 'message', caller: '15125550101', called: OUR, created_at: iso(30), message: 'Can I move my visit?', status: 'new' },
            { id: 'm2', message_type: 'message', caller: '15125550102', called: OUR, created_at: iso(20), message: 'STOP', status: 'read' },
            { id: 'v1', message_type: 'voicemail', caller: '15125550199', called: OUR, created_at: iso(61), message: '', transcription: 'please call me back', voicemail: 'x.wav', status: 'new' }],
  'sent': [{ id: 's1', message_type: 'message', caller: 'mbaig', called: '15125550111', created_at: iso(10), message: 'Hi there', status: 'read' }],
  '/cdrs': [{ id: 'c1', direction: 'inbound', caller_id_number: '15125550199', calling_party: '15125550199', called_party: 'mbaig', start_time: local(62), answered_time: local(62), callflow: '+19795550100(1s),100(15s),mbx-', duration: '40', bill_duration: '40' },
            { id: 'c2', direction: 'outbound', calling_party: 'mbaig', dialed_digits: '15125550103', called_party: '15125550103', start_time: local(90), answered_time: local(90), duration: '75', bill_duration: '75' },
            { id: 'c3', direction: 'internal', calling_party: 'mbaig', called_party: 'mbaig', start_time: local(100), duration: '3' },
            { id: 'c4', direction: 'inbound', caller_id_number: '15125550104', calling_party: '15125550104', start_time: local(5), answered_time: '', duration: '0', bill_duration: '0' }],
};
let offline = false;
global.fetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === '/auth/refresh') return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) };
  if (offline) return { ok: false, status: 500, json: async () => ({}) };
  const body = u.pathname === '/voicemails' ? data[u.searchParams.get('message_folder')] : data[u.pathname];
  return { ok: !!body, status: body ? 200 : 404, json: async () => body };
};
const ringrx = require(APP + '/ringrx');
const comms = require(APP + '/comms');
(async () => {
  const m = await ringrx.messages('almas');
  const byId = Object.fromEntries(m.map((x) => [x.id, x]));
  assert(byId.m1.inbound && byId.m1.phone === '5125550101' && byId.m1.body === 'Can I move my visit?', 'inbound text');
  assert(!byId.s1.inbound && byId.s1.phone === '5125550111' && byId.s1.body === 'Hi there', 'sent text keeps its wording');
  assert(byId.v1.kind === 'voicemail', 'voicemail');
  const c = await ringrx.calls('almas');
  assert(!c.find((x) => x.id === 'c3'), 'internal call skipped');
  const cb = Object.fromEntries(c.map((x) => [x.id, x]));
  assert(cb.c1.inbound && cb.c1.voicemail && cb.c1.missed, 'call to voicemail = missed');
  assert(!cb.c2.inbound && cb.c2.phone === '5125550103' && cb.c2.secs === 75, 'outgoing call');
  assert(cb.c4.missed && !cb.c4.answered, 'unanswered call = missed');
  assert(!c.some((x) => x.phone === '9795550100'), 'never lists our own number');
  // conversations
  await comms.sync('almas');
  const t = Object.fromEntries(comms.textThreads(30).map((x) => [x.phone, x]));
  assert(t['5125550101'].needs === 'reply', 'unanswered text needs reply');
  assert(!t['5125550102'].needs, 'STOP needs no reply');
  assert(t['5125550111'].who.kind === 'contact' && t['5125550111'].who.name === 'Fiona Mom', 'RingRx contact name used');
  const calls = comms.callList(30), due = (ph) => calls.find((x) => x.phone === ph && x.due);
  assert(due('5125550199') && due('5125550199').type === 'voicemail' && due('5125550199').transcription === 'please call me back', 'voicemail needs callback, with transcription');
  assert(due('5125550104'), 'missed call needs callback');
  assert(!due('5125550103'), 'our outgoing call needs nothing');
  comms.markDone('c', '5125550104');
  assert(!comms.callList(30).find((x) => x.phone === '5125550104' && x.due), 'done clears it');
  comms.markDone('t', '5125550101');
  assert(!comms.textThreads(30).find((x) => x.phone === '5125550101').needs, 'text done clears it');
  offline = true;
  assert((await ringrx.messages('almas')) === null && (await ringrx.calls('almas')) === null, 'unavailable -> null');
  console.log('RingRx + conversations OK');
})().catch((e) => { console.error(e.message); process.exit(1); });
