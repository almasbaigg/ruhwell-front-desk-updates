// The RxNT reader writes page functions out as code. An empty (undefined) argument must not produce invalid
// code like f(a,,b): that silently broke every dashboard read in the first 1.5.0 test build.
const Module = require('module'), os = require('os'), assert = require('assert');
const fake = { app: { getPath: () => os.tmpdir(), isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: function () {}, session: { fromPartition: () => ({}) }, Notification: { isSupported: () => false } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const { argCode } = require('../rxnt-reader');
const fn = (labels, anchor, required) => ({ labels, anchor: anchor || 'default', required });
const run = (args) => new Function(`return (${fn.toString()})(${argCode(args)})`)();
const r = run([{ Pending: 'pending' }, undefined, ['pending']]);
assert(r.anchor === 'default' && r.required[0] === 'pending' && r.labels.Pending === 'pending', 'undefined argument passes through');
assert(run([]).anchor === 'default', 'no arguments');
console.log('reader OK');
