// Saved data: never treated as empty when it can't be unlocked, never overwritten while locked,
// never saved unencrypted in the installed app, and saves are crash-safe (temp file + swap).
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-safe-'));
let encOK = true, decryptOK = true, packaged = true;
const fake = { app: { getPath: () => dir, get isPackaged() { return packaged; } }, safeStorage: {
  isEncryptionAvailable: () => encOK,
  encryptString: (t) => Buffer.from('X' + Buffer.from(t).toString('base64')),
  decryptString: (b) => { if (!decryptOK) throw new Error('keychain denied'); return Buffer.from(String(b).slice(1), 'base64').toString(); },
} };
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const store = require('../store');

store.raw.writeSecure('p.bin', { a: 1 });
const onDisk = fs.readFileSync(path.join(dir, 'p.bin'));
assert(onDisk.subarray(0, 4).toString() === 'RFE1' && !onDisk.includes('"a"'), 'saved encrypted with header');
assert(store.raw.readSecure('p.bin', {}).a === 1, 'reads back');
assert(!fs.readdirSync(dir).some((f) => f.includes('.tmp-')), 'no temp files left');

// Keychain says no: data looks empty to the app, but it's marked locked and can't be overwritten.
decryptOK = false;
assert.deepStrictEqual(store.raw.readSecure('p.bin', {}), {}, 'locked read returns fallback');
assert(store.raw.lockedFiles().includes('p.bin'), 'marked locked');
assert.throws(() => store.raw.writeSecure('p.bin', {}), /locked/, 'refuses to overwrite');
decryptOK = true; store.raw.retryLocked();
assert(store.raw.readSecure('p.bin', {}).a === 1, 'original data intact after unlocking');

// No encryption in the installed app: refuse to save rather than write plain text.
encOK = false;
assert.throws(() => store.raw.writeSecure('q.bin', { b: 2 }), /not saved/, 'no plaintext');
assert(!fs.existsSync(path.join(dir, 'q.bin')), 'nothing written');
// An existing file that can't be read, or is empty, is locked too (never treated as "no data").
encOK = true; fs.writeFileSync(path.join(dir, 'z.bin'), '');
store.raw.readSecure('z.bin', {});
assert(store.raw.lockedFiles().includes('z.bin') && (() => { try { store.raw.writeSecure('z.bin', {}); return false; } catch { return true; } })(), 'empty file locked');
console.log('data safety OK');
