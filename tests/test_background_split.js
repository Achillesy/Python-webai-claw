const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(path.dirname(__dirname), 'extension');
const sources = {
  'background-ui.js': fs.readFileSync(path.join(root, 'background-ui.js'), 'utf8'),
  'session.js': fs.readFileSync(path.join(root, 'session.js'), 'utf8'),
};
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

const listeners = {};
function listener(name) {
  return { addListener(fn) { listeners[name] = fn; } };
}
function fakePort() {
  return {
    postMessage() {},
    onMessage: { addListener(fn) { listeners.portMessage = fn; } },
    onDisconnect: { addListener() {} },
  };
}
const chrome = {
  runtime: {
    id: 'test',
    onConnect: listener('connect'),
    onMessage: listener('message'),
    onInstalled: listener('installed'),
    getURL: (p) => 'chrome-extension://test/' + p,
    // Regression guard for the Win11 bug (2026-11-07): background.js must
    // be able to open the native port; a missing connectNative used to
    // surface only as a silent failure in the popup.
    connectNative: () => fakePort(),
  },
  action: {
    onClicked: listener('actionClicked'),
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setTitle() {},
  },
  storage: { local: { get() {}, set() {} } },
  tabs: { query() {}, update() {}, create() {} },
  notifications: { onClicked: listener('notifClicked'), onClosed: listener('notifClosed'), create() {}, clear() {} },
};
const ctx = {
  chrome,
  navigator: { userAgent: 'Mozilla/5.0 Chrome/120' },
  console,
  URL,
  setTimeout,
  clearTimeout,
  Promise,
  Map,
  Set,
  Math,
  Date,
  JSON,
  String,
  Object,
  Array,
  RegExp,
  Error,
  parseInt,
  isNaN,
  encodeURIComponent,
};
ctx.self = ctx;
ctx.importScripts = (...files) => {
  for (const f of files) {
    if (!sources[f]) throw new Error('unexpected importScripts: ' + f);
    vm.runInContext(sources[f], ctx);
  }
};
vm.createContext(ctx);
vm.runInContext(bg, ctx);
if (vm.runInContext('typeof updateBadge', ctx) !== 'function') throw new Error('updateBadge missing');
if (vm.runInContext('typeof notifyDisconnected', ctx) !== 'function') throw new Error('notifyDisconnected missing');
if (vm.runInContext('typeof activeBinding', ctx) !== 'object') throw new Error('activeBinding missing');
if (vm.runInContext('typeof WebAIClawSession.normalizeSession', ctx) !== 'function') {
  throw new Error('WebAIClawSession.normalizeSession missing: background.js must import session.js');
}
console.log('background split load OK');

// Regression test for the Win11 bug (2026-11-07): the 5a2f1af refactor
// moved normalizeSession into session.js, but background.js kept calling
// the bare name, so every content-script hello threw
// "ReferenceError: normalizeSession is not defined" and the page never
// bound (session stayed empty, Connect could never succeed).
const port = fakePort();
port.name = 'webai-claw';
port.sender = { tab: { url: 'https://muse.ai/thread/abc', title: 't', id: 7 } };
assert.strictEqual(typeof listeners.connect, 'function', 'onConnect listener missing');
listeners.connect(port);
assert.strictEqual(typeof listeners.portMessage, 'function', 'page port message listener missing');
listeners.portMessage({
  type: 'hello', binding_id: 'p-1',
  session: 'https://muse.ai/thread/abc?x=1', ai: 'muse',
  url: 'https://muse.ai/thread/abc', title: 't',
});
const pageInfo = vm.runInContext('pageInfo', ctx);
const info = pageInfo.get(port);
assert.ok(info, 'pageInfo entry missing after hello');
assert.strictEqual(info.binding_id, 'p-1');
assert.strictEqual(info.session, 'https://muse.ai/thread/abc');
assert.strictEqual(info.ai, 'muse');
// The same bare name was used by session_adopted / session_changed.
listeners.portMessage({ type: 'session_adopted', binding_id: 'p-1', session: 'https://muse.ai/thread/def/', ai: 'muse' });
assert.strictEqual(pageInfo.get(port).session, 'https://muse.ai/thread/def');
listeners.portMessage({ type: 'session_changed', session: 'https://muse.ai/thread/ghi' });
assert.strictEqual(pageInfo.get(port).session, 'https://muse.ai/thread/ghi');
console.log('background hello/session handlers OK');
