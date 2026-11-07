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
// Fake native port that answers like the real host, synchronously.
function fakePort() {
  const fp = {
    _h: null,
    postMessage(msg) {
      const base = { id: msg.id, machine_id: 'm-1', hostname: 'TestHost',
                     platform: 'win32', shell: 'powershell', host_version: '1.2.5' };
      let reply = null;
      if (msg.type === 'ping') reply = { type: 'pong', ...base };
      else if (msg.type === 'status') reply = { type: 'state', ...base,
        lease: { state: 'idle', stale: true, owner: null } };
      else if (msg.type === 'connect') reply = { type: 'connected', ...base,
        binding_id: msg.binding_id, session: msg.session, ai: msg.ai, took_over_stale: false };
      else if (msg.type === 'bundle') reply = { type: 'bundle', ...base, guide: 'G', handoff: '', skills: [] };
      else if (msg.type === 'disconnect' || msg.type === 'cancel') reply = { type: 'result', ...base,
        ok: true, exit_code: 0, stdout: '', stderr: '', duration_ms: 0, ts: 0 };
      else if (msg.type === 'exec') reply = { type: 'result', ...base,
        ok: true, exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 1 };
      if (reply && fp._h) fp._h(reply);
    },
    onMessage: { addListener(fn) { fp._h = fn; } },
    onDisconnect: { addListener() {} },
  };
  return fp;
}
const pageSent = [];
function fakePagePort() {
  return {
    postMessage(msg) { pageSent.push(msg); },
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
    connectNative: () => fakePort(),
  },
  action: {
    onClicked: listener('actionClicked'),
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setTitle() {},
  },
  storage: { local: { get() {}, set() {} } },
  tabs: { query: (q, cb) => { if (cb) cb([{ id: 7, url: 'https://muse.ai/thread/abc', title: 't' }]); },
          update() {}, create() {} },
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
if (vm.runInContext('typeof browserName', ctx) !== 'function') {
  throw new Error('browserName missing: background.js must define it');
}
console.log('background split load OK');

// Regression test for the Win11 bugs (2026-11-07): the efc150c split
// moved normalizeSession into session.js, but background.js kept calling
// the bare name, so every content-script hello threw
// "ReferenceError: normalizeSession is not defined" and the page never
// bound (session stayed empty, Connect could never succeed).
const port = fakePagePort();
port.name = 'webai-claw';
port.sender = { tab: { url: 'https://muse.ai/thread/abc', title: 't', id: 7 } };
ctx.__testPort = port;
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

const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // get_state: the exact popup path that was stuck at "checking…".
  // Before the fix, updateBadge() read the undeclared `running` and
  // threw before sendResponse, so the popup never rendered.
  let got = null;
  listeners.message({ type: 'get_state' }, {}, (res) => { got = res; });
  await tick();
  assert.ok(got, 'get_state never responded');
  assert.strictEqual(got.ok, true, 'get_state not ok: ' + JSON.stringify(got));
  assert.strictEqual(got.host.machine_id, 'm-1');
  assert.strictEqual(got.host.hostname, 'TestHost');
  assert.strictEqual(got.host.host_version, '1.2.5');
  console.log('background get_state OK');

  // ping_test (Test Bridge) over the same native port.
  got = null;
  listeners.message({ type: 'ping_test' }, {}, (res) => { got = res; });
  await tick();
  assert.ok(got, 'ping_test never responded');
  assert.strictEqual(got.ok, true, 'ping_test failed: ' + JSON.stringify(got));
  console.log('background ping_test OK');

  // exec: exercises the scheduler state (schedQueue, portGen, hostBusy,
  // running) that the split also left undeclared.
  vm.runInContext('activeBinding = {binding_id: "p-1", session: "https://muse.ai/thread/ghi", ai: "muse", port: __testPort, tabId: 7}', ctx);
  pageSent.length = 0;
  listeners.portMessage({ type: 'exec', id: 'e1', cmd: 'echo hi', binding_id: 'p-1',
    session: 'https://muse.ai/thread/ghi', ai: 'muse', host: 'm-1', gen: 0 });
  await tick();
  assert.strictEqual(vm.runInContext('hostBusy', ctx), false, 'hostBusy stuck true after exec result');
  assert.strictEqual(vm.runInContext('running', ctx), null, 'running stuck after exec result');
  const execRes = pageSent.find((m) => m.type === 'result' && m.id === 'e1');
  assert.ok(execRes, 'exec result never reached the page: ' + JSON.stringify(pageSent));
  assert.strictEqual(execRes.ok, true);
  console.log('background exec OK');

  // connect: exercises browserName() (also dropped by the split) plus the
  // bundle round-trip and the connect_done handshake.
  pageSent.length = 0;
  got = null;
  listeners.message({ type: 'connect' }, {}, (res) => { got = res; });
  await tick();
  assert.ok(pageSent.find((m) => m.type === 'do_connect'), 'do_connect never sent to the page');
  listeners.portMessage({ type: 'connect_done', ok: true, binding_id: 'p-1' });
  await tick();
  assert.ok(got, 'connect never responded');
  assert.strictEqual(got.ok, true, 'connect failed: ' + JSON.stringify(got));
  console.log('background connect OK');

  // disconnect: tears the binding down again.
  got = null;
  listeners.message({ type: 'disconnect' }, {}, (res) => { got = res; });
  await tick();
  assert.ok(got, 'disconnect never responded');
  assert.strictEqual(got.ok, true, 'disconnect failed: ' + JSON.stringify(got));
  console.log('background disconnect OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
