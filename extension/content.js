// webai-claw content script (core layer, site-agnostic)
//
// Architecture: core layer + adapter layer (one per site).
// Adapters register via window.__webaiClawAdapters[hostname];
// the core picks one by location.hostname and calls its:
//   findBlocks()  → returns candidate element array
//   fillResult()  → fills the input box, returns bool
//   clickSend()   → clicks send, returns bool
// Adding a new Web AI = new adapters/xxx.js + register in manifest;
// zero core changes.
//
// Rules: caught blocks go to the local host for real execution. Results are
// filled back into the input box and are auto-sent only when the corresponding
// popup option is enabled. Executed ids are stored in chrome.storage.local so a
// page refresh never replays old commands.

(function () {
'use strict';

var STABLE_MS = 1000;
var VERSION = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : "?";
var MAX_RESULT = 6000;
var MAX_CMD_BYTES = 512 * 1024; // per-block command cap: Chrome native messaging hard limit is 1MB per message; keep margin (host-side file chunks use 500KB likewise)
var KEEP_HEAD = 2000;
var KEEP_TAIL = 3500;
var STORE_KEY = 'mh_processed_ids_v2';  // session-scoped keys: <session>|<id>
var AUTO_KEY = 'mh_auto_send';
var ATTACH_AUTO_KEY = 'mh_auto_send_attachments';
var HOSTNAME_KEY = 'mh_local_hostname';
var MACHINE_KEY = 'mh_machine_id';
var PLATFORM_KEY = 'mh_platform';

// ---------- pick adapter ----------
var adapters = window.__webaiClawAdapters || {};
var adapter = adapters[location.hostname] || null;
if (!adapter) {
  console.log('[webai-claw] no adapter for this site: ' + location.hostname + '; content script disabled');
  return;
}
console.log('[webai-claw] adapter selected: ' + adapter.name + ' (' + location.hostname + ')');

function elementText(el) {
  return el.innerText || el.textContent || '';
}

// ---------- state ----------
var processed = {};
var inFlight = {};
var cmdById = {};
var firstSeenAt = {};
var stableTimers = {};
var ready = false;
var pagePort = null;
var localHostname = null;
var localMachineId = null;  // local UUID (install-time identity, shown in Connect)
var localPlatform = null;
var incompleteAt = {};
var pendingResults = [];
var flushTimer = null;
var flushHardDeadline = 0;
var incompleteWarned = {};
var attachMeta = {};
var baselineIds = {};
var PLACEHOLDER_IDS = { "your-id": 1, "example-id": 1, "sample-id": 1, "xxx": 1 };
function isPlaceholderId(id) {
  var s = String(id || '');
  return !!PLACEHOLDER_IDS[id] || /^(example|sample)[-_]/i.test(s);
}

var WARMUP_MIN_MS = 2000;
var WARMUP_QUIET_MS = 3000;
var WARMUP_MAX_MS = 12000;
var warmupStart = Date.now();
var warmupDone = false;
var warmupQuietTimer = null;
var userAborted = false;
var selfActing = false;

// ---------- machine binding / session ----------
// BINDING_ID identifies this page instance, not its URL. The native host
// stores it in the machine lease; other tabs/browsers (even with the same
// URL) cannot take over while this page owns the lease.
var BINDING_ID = (function () {
  try { return 'p-' + crypto.randomUUID(); }
  catch (e) { return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
})();
var bound = false;
var boundSession = null;
var boundAi = null;
var paused = false;
var autoSentCount = 0;
var PAUSE_AFTER = 10;
var MIN_AUTO_SEND_INTERVAL_MS = 2000;
var MAX_AUTO_SENDS_PER_MINUTE = 20;
var lastAutoSendAt = 0;
var autoSendTimes = [];

function resetAutoSendState() {
  autoSentCount = 0;
  lastAutoSendAt = 0;
  autoSendTimes = [];
}

function notifyWaiting(reason) {
  if (!bound) return;
  try {
    getPort().postMessage({
      type: 'waiting', reason: reason || 'next-command',
      binding_id: BINDING_ID, gen: gen
    });
  } catch (e) {}
}

function notifyConnectDone(ok, error) {
  try {
    getPort().postMessage({
      type: 'connect_done', ok: !!ok, error: error || '',
      binding_id: BINDING_ID, gen: gen
    });
  } catch (e) {}
}

function normalizeSession(v) {
  try {
    var u = new URL(v, location.href);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch (e) {
    return String(v || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function sessionKeyOf() {
  try {
    if (adapter && typeof adapter.sessionKey === 'function') {
      return normalizeSession(adapter.sessionKey());
    }
  } catch (e) {}
  return normalizeSession(location.origin + location.pathname);
}

function aiType() {
  return (adapter && (adapter.ai || adapter.name)) || 'unknown';
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; }
  catch (e) { return false; }
}

function isProvisionalSession(s) {
  try {
    var u = new URL(s);
    var p = u.pathname.replace(/\/+$/, '');
    if (u.hostname === 'muse.ai') {
      return p === '' || p === '/thread/new' || p === '/new';
    }
    if (u.hostname === 'chat.deepseek.com') {
      // A real DeepSeek chat is /a/chat/s/<uuid>. The new-chat page is the
      // bare origin or /a/chat (no session id yet); adopt the first real id.
      var m = /^(\/a)?\/chat\/s\/([^/]+)$/.exec(p);
      return !m || m[2] === 'new';
    }
  } catch (e) {}
  return false;
}

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function targetGate(block) {
  if (!localMachineId) return 'defer';
  var got = String(block.host || '').trim().toLowerCase();
  if (!UUID_RE.test(got)) return 'missing';  // missing, hostname, *, or placeholder
  if (got !== String(localMachineId).trim().toLowerCase()) return 'ignore';
  return 'pass';
}

var missingHostWarned = {};
function warnMissingHost(block) {
  if (missingHostWarned[block.id]) return;
  missingHostWarned[block.id] = true;
  var msg = '[claw:error] id=' + block.id +
    ' error=missing/invalid host; every command must include "host":"<UUID>" and "v":3. ' +
    'This machine: ' + (localHostname || '?') + ' (' + (localPlatform || '?') +
    '), host=' + (localMachineId || '?');
  try {
    if (adapter.fillResult(msg)) {
      sendWithRetry({ tag: 'host-warning', maxWaitMs: 8000, intervalMs: 400,
                      respectAuto: false, respectPause: false, countAuto: false });
    }
  } catch (e) {}
}

function notifyHello() {
  try {
    getPort().postMessage({
      type: 'hello',
      binding_id: BINDING_ID,
      session: sessionKeyOf(),
      ai: aiType(),
      url: location.href,
      title: document.title
    });
  } catch (e) {}
}

// ---------- session & generation (Layer 1 scheduling / graceful stop) ----------
// SESSION: logical session id for one page load; gen: generation, +1 on stop, old generations all expire.
var SESSION = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
var gen = 0;

// Warmup end conditions (either ends it):
//  1. DOM quiet for WARMUP_QUIET_MS (and at least WARMUP_MIN_MS since start);
//  2. Fallback: force-end on the first scan after WARMUP_MAX_MS since start.
// Note: quiet detection needs its own timer — scan only runs 300ms after a mutation,
// so "3s of quiet" can never be observed inside inWarmup.
function pokeWarmup() {
  if (warmupDone) return;
  if (warmupQuietTimer) clearTimeout(warmupQuietTimer);
  warmupQuietTimer = setTimeout(function () {
    if (!warmupDone && Date.now() - warmupStart >= WARMUP_MIN_MS) {
      warmupDone = true;
      warmupQuietTimer = null;
      console.log('[webai-claw] warmup ended (quiet); only blocks appearing after this will execute');
    }
  }, WARMUP_QUIET_MS);
}

function inWarmup() {
  if (warmupDone) return false;
  if (Date.now() - warmupStart >= WARMUP_MAX_MS) {
    warmupDone = true;
    if (warmupQuietTimer) { clearTimeout(warmupQuietTimer); warmupQuietTimer = null; }
    console.log('[webai-claw] warmup ended (timeout); only blocks appearing after this will execute');
    return false;
  }
  return true;
}

function abortChain(reason) {
  if (userAborted) return;
  userAborted = true;
  console.log('[webai-claw] chain aborted: ' + reason);
  var nTimers = Object.keys(stableTimers).length;
  var nFlight = Object.keys(inFlight).length;
  Object.keys(stableTimers).forEach(function (k) { clearTimeout(stableTimers[k]); delete stableTimers[k]; });
  Object.keys(inFlight).forEach(function (id) { delete inFlight[id]; });
  Object.keys(cmdById).forEach(function (id) { delete cmdById[id]; });
  Object.keys(attachMeta).forEach(function (id) { delete attachMeta[id]; });
  // Blocks seen before the abort (incl. ones waiting for stability or still without body)
  // are all swallowed: they won't resurrect when the chain re-arms; only truly new blocks execute.
  Object.keys(firstSeenAt).forEach(function (id) { markProcessed(id); });
  firstSeenAt = {};
  // Also swallow v3 blocks that appeared while the extension was paused but
  // were never scanned; otherwise Stop would let them execute afterwards.
  try {
    adapter.findBlocks().forEach(function (el) {
      var b = parseBlock(elementText(el));
      if (b) markProcessed(b.id);
    });
  } catch (e) {}
  Object.keys(incompleteAt).forEach(function (id) { delete incompleteAt[id]; });
  Object.keys(incompleteWarned).forEach(function (id) { delete incompleteWarned[id]; });
  pendingResults = [];
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushHardDeadline = 0;
  // generation +1: old-generation commands/results all expire; tell background to drop this session's queued items
  gen++;
  paused = false;
  resetAutoSendState();
  setPauseStorage(false);
  try {
    getPort().postMessage({
      type: 'stop',
      session: sessionKeyOf(),
      ai: aiType(),
      binding_id: BINDING_ID,
      gen: gen
    });
  } catch (e) {}
  // only relay a notice if something was actually voided: a plain-text stop (nothing running) doesn't disturb
  if (nTimers + nFlight > 0) sendCancelNotice(gen, nTimers, nFlight);
}

// After a stop, relay one user message (really sent): gives the user visible confirmation
// and tells the AI to stop sending new blocks. Bypasses the mh_auto_send switch —
// the user clicked stop by hand, so the notice must go out; on send failure, degrade to fill-only.
function sendCancelNotice(curGen, nTimers, nFlight) {
  var text = '⏹ [webai-claw] user clicked the stop button (auto-sent): all generation ' + curGen + ' commands are void' +
    ' (' + nTimers + ' pending cancelled, ' + nFlight + ' in-flight results will not be filled back).' +
    'Please pause the current task, wait for the next user instruction, and do not send new command blocks.';
  var ok = false;
  try { ok = adapter.fillResult(text); } catch (e) { ok = false; }
  if (ok) {
    console.log('[webai-claw] stop notice filled back, sending in 500ms');
    sendWithRetry({ tag: 'stop-notice', maxWaitMs: 8000, intervalMs: 400,
                    respectAuto: false, respectPause: false, countAuto: false });
  } else {
    console.log('[webai-claw] stop notice fill-back failed; logging only, not disturbing');
  }
}

// fill-only (for busy-rejection etc. notices; never triggers auto-send)
function fillOnly(text) {
  var ok = false;
  try { ok = adapter.fillResult(text); } catch (e) { ok = false; }
  if (!ok) console.log('[webai-claw] notice fill-back failed: ', String(text).slice(0, 200));
}

// ---------- sentinel parsing ----------
function parseBlock(text) {
  text = String(text || '').replace(/^\s+/, '');
  var nl = text.indexOf('\n');
  var first = nl === -1 ? text : text.slice(0, nl);
  var head;
  try { head = JSON.parse(first); } catch (e) { return null; }
  if (!head || (typeof head.id !== 'string' && typeof head.id !== 'number') || !head.id) return null;
  if (['exec', 'probe', 'attach', 'diag', 'summary'].indexOf(head.claw) === -1) return null;
  if (head.v !== 3) return null;
  var cmdFromHead = (typeof head.cmd === 'string') ? head.cmd : null;
  var cmdFromBody = (nl === -1 ? '' : text.slice(nl + 1)).trim();
  return {
    kind: head.claw,
    id: String(head.id),
    host: (typeof head.host === 'string') ? head.host : null,
    timeout: head.timeout || null,
    approved: head.approved === true,
    sel: (typeof head.sel === 'string') ? head.sel : null,
    path: (typeof head.path === 'string') ? head.path : null,
    text: (typeof head.text === 'string') ? head.text : null,
    cmd: cmdFromHead !== null ? cmdFromHead : cmdFromBody
  };
}

function fingerprint(text) {
  var h = 0;
  for (var i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0; }
  return text.length + ':' + h;
}

// ---------- dedup ----------
function loadProcessed(done) {
  try {
    chrome.storage.local.get([STORE_KEY, HOSTNAME_KEY, MACHINE_KEY, PLATFORM_KEY], function (res) {
      var ids = (res && res[STORE_KEY]) || [];
      ids.forEach(function (id) { processed[id] = true; });
      if (res && res[HOSTNAME_KEY]) {
        localHostname = res[HOSTNAME_KEY];
        console.log('[webai-claw] local hostname (cached): ' + localHostname);
      }
      if (res && res[MACHINE_KEY]) {
        localMachineId = res[MACHINE_KEY];
        console.log('[webai-claw] local machine_id (cached): ' + localMachineId);
      }
      if (res && res[PLATFORM_KEY]) localPlatform = res[PLATFORM_KEY];
      // Always open the page port, even when the machine UUID is already
      // cached. The background discovers supported tabs from this port's
      // hello; without it the popup reports "not a supported AI chat".
      try { getPort(); } catch (e) {
        setTimeout(function () { try { getPort(); } catch (e2) {} }, 1000);
      }
      if (!localMachineId) {
        // Cache the local UUID for the Connect attachment/display. getPort()
        // goes through background onConnect -> ensureNativePort -> ping -> pong.
        retryMachineIdentity(0);
      }
      ready = true;
      if (done) done();
    });
  } catch (e) {
    try { getPort(); } catch (e2) {}
    ready = true;
    if (done) done();
  }
}

// Retry a few times (2s / 5s / 10s) if machine_id is unavailable. It is not
// required to execute blocks (the extension stamps the binding), but it is
// needed for the Connect attachment and the UI.
function retryMachineIdentity(n) {
  var waits = [2000, 5000, 10000];
  if (n >= waits.length) {
    console.log('[webai-claw] local machine_id unavailable: host may not be installed or started; Connect may fail');
    return;
  }
  setTimeout(function () {
    if (localMachineId) return;
    try {
      chrome.storage.local.get([HOSTNAME_KEY, MACHINE_KEY, PLATFORM_KEY], function (res) {
        if (res && res[HOSTNAME_KEY] && !localHostname) {
          localHostname = res[HOSTNAME_KEY];
          console.log('[webai-claw] local hostname (obtained late): ' + localHostname);
        }
        if (res && res[MACHINE_KEY] && !localMachineId) {
          localMachineId = res[MACHINE_KEY];
          console.log('[webai-claw] local machine_id (obtained late): ' + localMachineId);
          scan();
        }
        if (res && res[PLATFORM_KEY] && !localPlatform) localPlatform = res[PLATFORM_KEY];
        if (!localMachineId) retryMachineIdentity(n + 1);
      });
    } catch (e) { retryMachineIdentity(n + 1); }
  }, waits[n]);
}

function processedKey(id) {
  return sessionKeyOf() + '|' + id;
}

function isProcessed(id) {
  return !!processed[processedKey(id)];
}

function persistProcessed() {
  try {
    var obj = {};
    obj[STORE_KEY] = Object.keys(processed).slice(-300);
    chrome.storage.local.set(obj);
  } catch (e) {}
}

function markProcessed(id) {
  processed[processedKey(id)] = true;
  persistProcessed();
}

// Muse /thread/new adoption changes the session key for the same page.
// Move already-processed ids to the new prefix so historical blocks stay dead.
function rekeyProcessed(oldSession, newSession) {
  if (!oldSession || !newSession || oldSession === newSession) return;
  var prefix = oldSession + '|';
  Object.keys(processed).forEach(function (k) {
    if (k.indexOf(prefix) === 0) {
      var id = k.slice(prefix.length);
      delete processed[k];
      processed[newSession + '|' + id] = true;
    }
  });
  persistProcessed();
}

// ---------- long-lived connection to background ----------
function flushResults() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushHardDeadline = 0;
  if (!pendingResults.length) return;
  var text = pendingResults.join('\n\n---\n\n');
  pendingResults = [];
  fillBack(text);
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  var pending = Object.keys(inFlight).length;
  var now = Date.now();
  if (!flushHardDeadline) flushHardDeadline = now + 8000;
  var wait;
  if (pending > 0) {
    wait = Math.max(200, flushHardDeadline - now);
  } else {
    wait = 500;
  }
  flushTimer = setTimeout(flushResults, wait);
}

// ---------- extension context invalidated ----------
// After the extension is reloaded/updated, content scripts in unrefreshed old tabs
// throw "Extension context invalidated" on chrome.runtime.* calls, with no self-healing;
// the page must be refreshed. Detect it early and give actionable guidance
// instead of the cryptic original error.
var contextDead = false;
function isInvalidatedError(e) {
  return !!e && /extension context invalid/i.test(e.message || '');
}
// show the context-dead guidance only once (no spam from multiple blocks/repeat timers on the same page); resets after refresh.
var deadWarned = false;
function warnContextDead() {
  if (deadWarned) return;
  deadWarned = true;
  fillBack('Extension reloaded — please refresh this page and retry');
}

function getPort() {
  if (pagePort) return pagePort;
  if (contextDead) throw new Error('Extension reloaded — please refresh this page and retry');
  try {
    pagePort = chrome.runtime.connect({ name: 'webai-claw' });
  } catch (e) {
    if (isInvalidatedError(e)) {
      contextDead = true;
      console.error('[webai-claw] extension context invalidated: extension was reloaded/updated; please refresh this page and retry');
      throw new Error('Extension reloaded — please refresh this page and retry');
    }
    throw e;
  }
  pagePort.onMessage.addListener(function (msg) {
    if (!msg) return;
    // generation gate: drop all expired-generation messages (late results/errors/files/busy-rejections); cures "fill-back piercing"
    if (msg.gen !== undefined && msg.gen !== gen) {
      console.log('[webai-claw] dropping expired-generation message: ' + msg.type + ' id=' + (msg.id || '-') +
                  ' gen=' + msg.gen + ' current=' + gen);
      return;
    }
    if (msg.type === 'bound') {
      if (msg.bound) {
        // Snapshot everything visible at bind time: a block that existed
        // before Connect must never run just because the page became bound.
        try {
          adapter.findBlocks().forEach(function (el) {
            var b = parseBlock(elementText(el));
            if (b) markProcessed(b.id);
          });
        } catch (e) {}
      }
      bound = !!msg.bound;
      boundSession = bound ? normalizeSession(msg.session || '') : null;
      boundAi = bound ? (msg.ai || null) : null;
      if (bound) { paused = false; resetAutoSendState(); setPauseStorage(false); }
      console.log('[webai-claw] binding ' + (bound ? 'active: ' + boundSession + ' / ' + boundAi : 'released'));
      if (bound) scan();
      return;
    }
    if (msg.type === 'do_connect') {
      sendConnectAttachment(msg.config || {});
      return;
    }
    if (msg.type === 'continue') {
      paused = false;
      resetAutoSendState();
      setPauseStorage(false);
      scan();
      return;
    }
    if (msg.type === 'popup_stop') {
      abortChain('user clicked stop in popup');
      return;
    }
    if (msg.type === 'file') {
      if (!bound || (boundSession && sessionKeyOf() !== boundSession)) return;
      onFileArrived(msg);
    } else if (msg.type === 'result') {
      delete inFlight[msg.id];
      delete cmdById[msg.id];
      if (!currentBindingMatches(msg)) {
        console.log('[webai-claw] dropping result for stale binding id=' + msg.id);
        return;
      }
      var text = formatResult(msg);
      pendingResults.push(text);
      scheduleFlush();
    } else if (msg.type === 'error' && msg.id) {
      delete inFlight[msg.id];
      delete cmdById[msg.id];
      if (!currentBindingMatches(msg)) {
        console.log('[webai-claw] dropping error for stale binding id=' + msg.id);
        return;
      }
      pendingResults.push('[claw:error] id=' + msg.id + ' error=' + (msg.error || 'unknown error'));
      scheduleFlush();
    }
    // progress heartbeat frames just keep the long-lived connection alive; don't disturb the page
  });
  pagePort.onDisconnect.addListener(function () {
    pagePort = null;
    bound = false;
    paused = false;
    setPauseStorage(false);
    Object.keys(inFlight).forEach(function (id) {
      fillBack('Connection to the extension background lost; result unknown.');
    });
    inFlight = {};
    // The MV3 worker may have been suspended/restarted; reconnect once so the
    // popup can still find this tab. Do not retry if the extension itself was
    // reloaded (contextDead).
    if (!contextDead) {
      setTimeout(function () {
        if (contextDead || pagePort) return;
        try { getPort(); } catch (e) {}
      }, 1000);
    }
  });
  notifyHello();
  return pagePort;
}

function currentBindingMatches(msg) {
  if (boundSession) {
    if (msg.session && normalizeSession(msg.session) !== boundSession) return false;
    if (sessionKeyOf() !== boundSession) return false;
  }
  if (boundAi && msg.ai && msg.ai !== boundAi) return false;
  return true;
}

// ---------- execute ----------
function execBlock(block) {
  // Only the bound page may execute. Other tabs/browsers (even with the
  // same URL) have no binding and must stay silent.
  if (!bound ||
      (boundSession && sessionKeyOf() !== boundSession) ||
      (boundAi && aiType() !== boundAi)) {
    console.log('[webai-claw] block ' + block.id + ' ignored: page is not the bound owner');
    return;
  }
  // key: incomplete blocks (in DeepSeek, <code> may hold only the first JSON line with empty cmd)
  // are NOT marked processed; wait for the complete element (<pre>) before executing.
  if (!block.cmd) {
    incompleteAt[block.id] = Date.now();
    if (!incompleteWarned[block.id]) {
      incompleteWarned[block.id] = true;
      console.log('[webai-claw] block ' + block.id + ' has no command body yet; waiting for the complete element');
    }
    return;
  }
  // Per-block command cap: over-limit blocks are rejected outright with guidance filled back;
  // never forwarded, never retried (otherwise it would blow up at the 1MB native-message hard cap with a vague error).
  // Must markProcessed, or the next scan of the same block would fill back repeatedly.
  if (block.cmd.length > MAX_CMD_BYTES) {
    console.log('[webai-claw] block ' + block.id + ' command too large (' + block.cmd.length + ' chars); rejected');
    markProcessed(block.id);
    fillBack('[exec ' + block.id + '] command too large (~' + Math.round(block.cmd.length / 1024) +
      'KB, per-block cap 512KB); rejected, not executed. ' +
      'Split into smaller blocks and run separately (e.g. chunked >> appends to a file), or ask the user to send the big file as an attachment and use the attach channel. Resend with a new id.');
    return;
  }
  inFlight[block.id] = true;
  cmdById[block.id] = block.cmd;
  console.log('[webai-claw] executing ' + block.id + ': ', block.cmd.slice(0, 120));
  try {
    getPort().postMessage({
      type: 'exec',
      id: block.id,
      host: block.host,
      session: sessionKeyOf(),
      ai: aiType(),
      binding_id: BINDING_ID,
      gen: gen,
      cmd: block.cmd,
      timeout: block.timeout,
      approved: !!block.approved
    });
    // Book the block only after postMessage succeeds. If sending throws, leave it
    // unprocessed so a refresh can resend it without losing the command.
    markProcessed(block.id);
  } catch (e) {
    delete inFlight[block.id];
    delete cmdById[block.id];
    if (contextDead) warnContextDead();
    else fillBack('failed to send to extension background: ' + e.message);
  }
}

// ---------- result formatting ----------
function clip(s) {
  if (s == null) return '';
  s = String(s);
  if (s.length <= MAX_RESULT) return s;
  return s.slice(0, KEEP_HEAD) + '\n\n…(omitted)…\n\n' + s.slice(s.length - KEEP_TAIL);
}

// ---------- attach: fetch file from host, hand to adapter for upload ----------
function b64ToBytes(b64) {
  var bin = atob(b64);
  var len = bin.length;
  var arr = new Uint8Array(len);
  for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function attachBlock(block) {
  if (!bound ||
      (boundSession && sessionKeyOf() !== boundSession) ||
      (boundAi && aiType() !== boundAi)) {
    console.log('[webai-claw] attach ' + block.id + ' ignored: page is not the bound owner');
    return;
  }
  if (!block.path) { fillBack('[claw:attach] id=' + block.id + ' error=missing path'); return; }
  if (!adapter || typeof adapter.uploadFile !== 'function') {
    fillBack('[claw:attach] id=' + block.id + ' error=adapter for current site does not support upload');
    return;
  }
  inFlight[block.id] = true;
  cmdById[block.id] = 'attach: ' + block.path;
  attachMeta[block.id] = { text: block.text || null };
  console.log('[webai-claw] attach ' + block.id + ' requesting file ' + block.path);
  try {
    getPort().postMessage({ type: 'read_file', id: block.id, path: block.path,
                            host: block.host, session: sessionKeyOf(), ai: aiType(),
                            binding_id: BINDING_ID, gen: gen });
    markProcessed(block.id);  // book only once sent (same as execBlock): don't mark on send failure; resendable after refresh
  } catch (e) {
    delete inFlight[block.id]; delete attachMeta[block.id];
    if (contextDead) warnContextDead();
    else fillBack('[claw:attach] id=' + block.id + ' error=file request failed: ' + e.message);
  }
}

function onFileArrived(msg) {
  var meta = attachMeta[msg.id] || {};
  delete attachMeta[msg.id];
  delete inFlight[msg.id];
  var bytes;
  try { bytes = b64ToBytes(msg.b64); }
  catch (e) { fillBack('[claw:attach] id=' + msg.id + ' error=base64 decode failed: ' + e.message); return; }
  console.log('[webai-claw] file arrived ' + msg.name + ' ' + bytes.length + ' bytes');
  var res;
  try {
    res = adapter.uploadFile({ name: msg.name, mime: msg.mime, bytes: bytes });
  } catch (e) {
    fillBack('[claw:attach] id=' + msg.id + ' error=adapter upload threw: ' + e.message);
    return;
  }
  // uploadFile may return {ok, why} synchronously or a Promise when an adapter
  // must open an upload menu and wait for the input to render.
  Promise.resolve(res).then(function (r) {
    if (!r || !r.ok) {
      fillBack('[claw:attach] id=' + msg.id + ' error=upload failed: ' + ((r && r.why) || 'unknown'));
      return;
    }
    fillBack('[claw:attach] id=' + msg.id + ' file=' + msg.name + ' size=' + bytes.length +
             ' status=injected', { autoSend: false });
    if (meta.text) {
      try { adapter.fillResult(meta.text); } catch (e) {}
    }
    sendWithRetry({
      tag: 'attach', maxWaitMs: 45000, intervalMs: 500,
      autoKey: ATTACH_AUTO_KEY, autoDefault: false,
      respectAuto: true, respectPause: true, countAuto: true,
      onSkip: function () { notifyWaiting('attachment-ready'); },
      failNote: '\n[webai-claw] attachment is ready but auto-send failed; press Send manually.'
    });
  }, function (e) {
    fillBack('[claw:attach] id=' + msg.id + ' error=adapter upload threw: ' + (e && e.message || e));
  });
}


function setPauseStorage(on, reason) {
  try {
    var obj = {};
    obj.mh_paused = !!on;
    obj.mh_pause_count = on ? autoSentCount : 0;
    obj.mh_pause_reason = on ? (reason || '') : '';
    chrome.storage.local.set(obj);
  } catch (e) {}
}

function sendConnectAttachment(config) {
  var finished = false;
  function finish(ok, error) {
    if (finished) return;
    finished = true;
    notifyConnectDone(ok, error);
  }
  if (!adapter || typeof adapter.uploadFile !== 'function') {
    fillOnly('[connect] this site does not support file upload; cannot send the guide');
    finish(false, 'this site does not support file upload');
    return;
  }
  var session = sessionKeyOf();
  var ai = aiType();
  var lines = [];
  lines.push('# webai-claw connection');
  lines.push('');
  lines.push('## Local machine');
  lines.push('- host: ' + (config.machine_id || localMachineId || ''));
  lines.push('- session: ' + session);
  lines.push('- ai: ' + ai);
  lines.push('- hostname: ' + (config.hostname || localHostname || ''));
  lines.push('- platform: ' + (config.platform || localPlatform || ''));
  lines.push('- shell: ' + (config.shell || ''));
  lines.push('- protocol: 3');
  lines.push('- host_version: ' + (config.host_version || ''));
  lines.push('');
  lines.push('## Protocol');
  lines.push(config.guide || '(AI-AGENT.md missing; re-run install.py)');
  if (config.handoff) {
    lines.push('');
    lines.push('## Previous handoff');
    lines.push(config.handoff);
  }
  var text = lines.join('\n');
  var bytes;
  try { bytes = new TextEncoder().encode(text); }
  catch (e) {
    fillOnly('[connect] failed to encode guide: ' + e.message);
    finish(false, 'failed to encode guide');
    return;
  }
  var res;
  try {
    res = adapter.uploadFile({ name: 'webai-claw-connect.txt', mime: 'text/plain', bytes: bytes });
  } catch (e) {
    fillOnly('[connect] adapter upload threw: ' + e.message);
    finish(false, 'adapter upload threw');
    return;
  }
  Promise.resolve(res).then(function (r) {
    if (!r || !r.ok) {
      fillOnly('[connect] guide upload failed: ' + ((r && r.why) || 'unknown'));
      finish(false, (r && r.why) || 'guide upload failed');
      return;
    }
    var targetHost = config.machine_id || localMachineId || '?';
    var note = 'Connected to ' + (config.hostname || 'this computer') +
      ' (' + (config.platform || '?') + ' / ' + (config.shell || '?') + ').\n' +
      'host: ' + targetHost + '\nsession: ' + session + '\nai: ' + ai + '\n' +
      'Read the attached protocol. Reply in normal text with:\n' +
      '"Connected to <hostname> (<platform>). I will run subsequent commands ' +
      'on this machine with host:' + targetHost + '."\n' +
      'Every claw block must include "host":"' + targetHost + '" and "v":3. ' +
      'Do not write session or ai; the extension adds them.\n' +
      'If a newer Connect attachment appears in this conversation, use its host. ' +
      'If the user names another UUID, follow the user.\n' +
      'Wait for the task.';
    var ok = false;
    try { ok = adapter.fillResult(note); } catch (e) { ok = false; }
    if (!ok) {
      fillOnly('[connect] connected, but could not fill the input box');
      finish(false, 'could not fill the input box');
      return;
    }
    // Connect is an explicit user action. Send the handshake regardless of the
    // Auto-send command results and Auto-send attachments preferences; those
    // settings apply to results and AI-requested files, not to the handshake.
    sendWithRetry({
      tag: 'connect', maxWaitMs: 45000, intervalMs: 500,
      respectAuto: false, respectPause: false, countAuto: false,
      onSent: function () { finish(true); },
      onSkip: function (reason) { finish(false, 'handshake send failed: ' + (reason || 'unknown')); },
      failNote: '\n[webai-claw] Connect note is ready but auto-send failed; press Send manually.'
    });
  }, function (e) {
    fillOnly('[connect] adapter upload threw: ' + (e && e.message || e));
    finish(false, 'adapter upload rejected');
  });
}

function diagBlock(block) {
  if (!bound) return;
  inFlight[block.id] = true;
  cmdById[block.id] = 'diag';
  try {
    getPort().postMessage({
      type: 'diag', id: block.id, host: block.host,
      session: sessionKeyOf(), ai: aiType(), binding_id: BINDING_ID, gen: gen
    });
    markProcessed(block.id);
  } catch (e) {
    delete inFlight[block.id];
    delete cmdById[block.id];
    fillBack('[claw:error] id=' + block.id + ' error=' + e.message);
  }
}

function summaryBlock(block) {
  if (!bound) return;
  var summaryText = block.cmd || block.text || '';
  if (!summaryText) {
    markProcessed(block.id);
    fillBack('[claw:error] id=' + block.id + ' error=summary body is empty');
    return;
  }
  if (summaryText.length > MAX_CMD_BYTES) {
    markProcessed(block.id);
    fillBack('[claw:error] id=' + block.id + ' error=summary too large (512KB cap)');
    return;
  }
  inFlight[block.id] = true;
  cmdById[block.id] = 'summary';
  try {
    getPort().postMessage({
      type: 'summary', id: block.id, text: summaryText, host: block.host,
      session: sessionKeyOf(), ai: aiType(), binding_id: BINDING_ID, gen: gen
    });
    markProcessed(block.id);
  } catch (e) {
    delete inFlight[block.id];
    delete cmdById[block.id];
    fillBack('[claw:error] id=' + block.id + ' error=' + e.message);
  }
}

// ---------- DOM probe (read-only, handled locally, never touches host) ----------
function probeBlock(block) {
  if (!bound) return;
  markProcessed(block.id);
  if (!block.sel) { fillBack('[claw:probe] id=' + block.id + ' error=missing sel field'); return; }
  var nodes;
  try { nodes = document.querySelectorAll(block.sel); }
  catch (e) { fillBack('[claw:probe] id=' + block.id + ' error=selector syntax error: ' + e.message); return; }
  var lines = ['[claw:probe] id=' + block.id + ' sel=' + block.sel + ' matched=' + nodes.length];
  nodes.forEach(function (n, i) {
    if (i >= 10) { return; }
    var rect = n.getBoundingClientRect();
    var cs = getComputedStyle(n);
    var vis = cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    var par = n.parentElement;
    lines.push('[' + i + '] <' + n.tagName.toLowerCase() + '>');
    lines.push('    type=' + (n.type || '-') + '  name=' + (n.name || '-') +
               '  accept=' + (n.accept || '-') + '  multiple=' + !!n.multiple);
    lines.push('    visible=' + vis + '  size=' + Math.round(rect.width) + 'x' + Math.round(rect.height) +
               '  class=' + (typeof n.className === 'string' ? n.className.slice(0, 80) : '-'));
    lines.push('    parent=<' + (par ? par.tagName.toLowerCase() : '-') + '> aria=' +
               (par && par.getAttribute ? (par.getAttribute('aria-label') || '-') : '-'));
    lines.push('    html=' + (n.outerHTML || '').slice(0, 200).replace(/\s+/g, ' '));
  });
  if (nodes.length > 10) lines.push('  …(showing first 10 only)');
  fillBack(lines.join('\n'));
}


function formatDiag(res) {
  var lines = [];
  lines.push('[claw:diag] id=' + res.id + ' host=' + (res.hostname || '?') +
             ' platform=' + (res.platform || '?') + ' pid=' + (res.pid || '?'));
  if (res.machine_id) lines.push('machine: ' + res.machine_id);
  if (res.session) lines.push('session: ' + res.session + '  ai: ' + (res.ai || '?'));
  if (res.lease) {
    lines.push('lease: state=' + (res.lease.state || '?') +
               ' binding=' + ((res.lease.owner || {}).binding_id || '-') +
               ' task=' + (res.lease.task_id || '-'));
  }
  lines.push('history: ' + res.history_size + '/' + res.history_limit);
  if (res.recent && res.recent.length) {
    lines.push('recent:');
    res.recent.forEach(function (r) {
      var t = r.ts ? new Date(r.ts * 1000).toTimeString().slice(0, 8) : '--:--:--';
      lines.push('  ' + (r.id || '?') + '  ' + (r.ok ? 'ok' : 'fail') + '  ' + t);
    });
  }
  if (res.log_tail) {
    lines.push('log_tail:');
    lines.push(res.log_tail.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}


function formatResult(res) {
  if (res.history_size !== undefined && res.log_tail !== undefined) {
    return formatDiag(res);
  }
  if (res.kind === 'summary') {
    var summaryLines = ['[claw:summary] id=' + res.id +
      ' ok=' + (res.ok ? 'true' : 'false')];
    if (res.handoff) summaryLines.push('handoff: ' + res.handoff);
    summaryLines.push('Next: open a new chat and click Connect; the attachment will include handoff.md.');
    return summaryLines.join('\n');
  }
  var secs = ((res.duration_ms || 0) / 1000).toFixed(1);
  var lines = [];
  var head = '[claw:result] id=' + res.id + ' ok=' + (res.ok ? 'true' : 'false') +
             ' exit=' + res.exit_code + ' duration=' + secs + 's';
  if (res.machine_id) head += ' machine=' + res.machine_id;
  if (res.session) head += ' session=' + res.session;
  if (res.ai) head += ' ai=' + res.ai;
  if (res.platform) head += ' platform=' + res.platform;
  if (res.hostname) head += ' host=' + res.hostname;
  if (res.timeout) head += ' timeout=' + res.timeout;
  if (res.approved) head += ' approved=true';
  if (res.killed) head += ' killed=true';
  lines.push(head);
  var cmd = cmdById[res.id];
  if (cmd) {
    var first = cmd.split('\n')[0];
    var n = cmd.split('\n').length;
    var extra = n > 1 ? ' (' + n + ' lines total)' : '';
    lines.push('cmd: ' + (first.length > 120 ? first.slice(0, 120) + '…' : first) + extra);
  }
  if (res.error) lines.push('error: ' + res.error);
  if (res.stdout) lines.push(res.stdout.replace(/\s+$/, ''));
  if (res.stderr) {
    lines.push('');
    lines.push('stderr:');
    lines.push(clip(res.stderr.replace(/\s+$/, '')));
  }
  return lines.join('\n');
}

// ---------- fill-back (handed to adapter) ----------
function fillBack(text, opts) {
  var ok = false;
  try { ok = adapter.fillResult(text); } catch (e) {
    console.error('[webai-claw] adapter.fillResult threw: ', e);
    ok = false;
  }
  if (ok) {
    console.log('[webai-claw] result filled back into input box');
    if (!opts || opts.autoSend !== false) maybeAutoSend();
  } else {
    console.log('[webai-claw] adapter found no input box; result goes to log only: ', text.slice(0, 200));
  }
}

function maybeAutoSend() {
  sendWithRetry({
    tag: 'exec-result',
    maxWaitMs: 10000,
    intervalMs: 400,
    respectAuto: true,
    respectPause: true,
    countAuto: true,
    onSkip: function () { notifyWaiting('result-ready'); }
  });
}

function doClickSend() {
  var ok = false;
  selfActing = true;
  try { ok = adapter.clickSend(); } catch (e) {
    console.error('[webai-claw] adapter.clickSend threw: ', e);
    ok = false;
  } finally { selfActing = false; }
  return !!ok;
}

function pauseAutoSend(kind) {
  if (paused) return;
  paused = true;
  setPauseStorage(true, kind);
  notifyWaiting('paused');
  var note;
  if (kind === 'rate') {
    note = '[claw:paused] Auto-send is rate-limited (' +
      MAX_AUTO_SENDS_PER_MINUTE + '/min); paused. Click Continue or Stop in the extension popup.';
  } else {
    note = '[claw:paused] Paused after ' + PAUSE_AFTER +
      ' consecutive automatic sends. Click Continue or Stop in the extension popup.';
  }
  var ok = false;
  try { ok = adapter.fillResult(note); }
  catch (e) { console.error('[webai-claw] pause note fill failed: ', e); }
  if (ok) {
    sendWithRetry({
      tag: kind === 'rate' ? 'rate-pause-note' : 'pause-note',
      maxWaitMs: 8000,
      intervalMs: 400,
      respectAuto: false,
      respectPause: false,
      countAuto: false
    });
  }
}

function sendWithRetry(opts) {
  opts = opts || {};
  var tag = opts.tag || 'auto-send';
  var maxWaitMs = opts.maxWaitMs || 10000;
  var intervalMs = opts.intervalMs || 400;
  var respectAuto = opts.respectAuto !== false;
  var respectPause = opts.respectPause !== false;
  var countAuto = opts.countAuto !== false;
  var autoKey = opts.autoKey || AUTO_KEY;
  var autoDefault = opts.autoDefault !== false;

  function skip(reason) {
    console.log('[webai-claw] ' + tag + ': ' + reason + '; staying fill-only');
    if (opts.onSkip) {
      try { opts.onSkip(reason); } catch (e) {}
    }
  }

  function begin() {
    if (contextDead) return;
    if (respectPause && paused) {
      skip('paused');
      return;
    }
    if (countAuto) {
      var now = Date.now();
      autoSendTimes = autoSendTimes.filter(function (t) { return now - t < 60000; });
      if (autoSendTimes.length >= MAX_AUTO_SENDS_PER_MINUTE) {
        pauseAutoSend('rate');
        return;
      }
    }
    var wait = MIN_AUTO_SEND_INTERVAL_MS - (Date.now() - lastAutoSendAt);
    if (wait > 0) {
      setTimeout(begin, wait);
      return;
    }
    var deadline = Date.now() + maxWaitMs;
    (function attempt() {
      if (contextDead) return;
      if (respectPause && paused) {
        skip('paused');
        return;
      }
      var busy = false;
      try {
        if (adapter.isGenerating && adapter.isGenerating()) busy = true;
        if (!busy && adapter.isUploading && adapter.isUploading()) busy = true;
      } catch (e) { busy = false; }
      if (!busy && doClickSend()) {
        lastAutoSendAt = Date.now();
        if (countAuto) {
          autoSendTimes.push(lastAutoSendAt);
          autoSentCount++;
          console.log('[webai-claw] auto-sent ' + tag + ' (' +
                      autoSentCount + '/' + PAUSE_AFTER + ')');
          if (autoSentCount >= PAUSE_AFTER && !paused) pauseAutoSend('count');
        } else {
          console.log('[webai-claw] auto-sent ' + tag);
        }
        if (opts.onSent) {
          try { opts.onSent(); } catch (e) {}
        }
        return;
      }
      if (Date.now() < deadline) {
        setTimeout(attempt, intervalMs);
        return;
      }
      console.log('[webai-claw] ' + tag +
                  ': send button never found after retries; staying fill-only');
      if (opts.failNote) {
        try { adapter.fillResult(opts.failNote); } catch (e) {}
      }
      skip('send-failed');
    })();
  }

  if (respectAuto) {
    try {
      chrome.storage.local.get([autoKey], function (res) {
        var enabled = (res && res[autoKey] !== undefined) ? !!res[autoKey] : autoDefault;
        if (!enabled) {
          skip('auto-send-off');
          return;
        }
        begin();
      });
    } catch (e) {
      if (autoDefault) begin();
      else skip('auto-send-error');
    }
  } else {
    begin();
  }
}

// ---------- scan ----------
function scan() {
  if (!ready) return;
  if (contextDead) return;  // extension reloaded: the old context can't do anything useful; wait for user refresh
  var els;
  try { els = adapter.findBlocks(); } catch (e) {
    console.error('[webai-claw] adapter.findBlocks threw: ', e);
    return;
  }
  if (!els || !els.length) return;
  // Before the popup binds this page, absorb any v3 blocks already in the
  // chat. Otherwise connecting later would execute historical commands.
  if (!bound) {
    els.forEach(function (el) {
      var b = parseBlock(elementText(el));
      if (b && !isProcessed(b.id) && !inFlight[b.id]) {
        baselineIds[b.id] = true;
        markProcessed(b.id);
        console.log('[webai-claw] absorbed pre-binding block ' + b.id);
      }
    });
    return;
  }
  if (boundSession && sessionKeyOf() !== boundSession) {
    var nowSession = sessionKeyOf();
    if (isProvisionalSession(boundSession) &&
        !isProvisionalSession(nowSession) &&
        sameOrigin(boundSession, nowSession)) {
      // Muse new chat: /thread/new (or the bare origin) becomes
      // /thread/<uuid> when the first message creates the thread. This is the
      // same page/binding, so adopt the real session instead of disconnecting.
      var oldSession = boundSession;
      rekeyProcessed(oldSession, nowSession);
      boundSession = nowSession;
      try {
        getPort().postMessage({
          type: 'session_adopted', binding_id: BINDING_ID,
          old_session: oldSession, session: nowSession, ai: aiType()
        });
      } catch (e) {}
      console.log('[webai-claw] adopted real session ' + nowSession +
                  ' from ' + oldSession);
      // continue scanning this pass; do not release the binding
    } else {
      bound = false;
      try {
        getPort().postMessage({
          type: 'session_changed', binding_id: BINDING_ID,
          session: nowSession, ai: aiType()
        });
      } catch (e) {}
      console.log('[webai-claw] page session changed; binding released locally');
      return;
    }
  }
  if (boundAi && aiType() !== boundAi) return;
  els.forEach(function (el) {
    var text = elementText(el);
    var block = parseBlock(text);
    if (!block || isProcessed(block.id) || inFlight[block.id]) return;
    // While paused, still allow a summary block to write the handoff file.
    if (paused && block.kind !== 'summary') return;
    if (inWarmup() || baselineIds[block.id] || isPlaceholderId(block.id)) {
      if (!baselineIds[block.id]) {
        baselineIds[block.id] = true;
        console.log('[webai-claw] warmup absorbed history block ' + block.id);
      }
      markProcessed(block.id);
      return;
    }
    if ((block.kind === 'exec' || block.kind === 'summary') &&
        !block.cmd && incompleteAt[block.id] && Date.now() - incompleteAt[block.id] < 5000) return;
    var target = targetGate(block);
    if (target === 'defer') return;  // machine UUID not cached yet; retry after pong
    if (target === 'missing') {
      warnMissingHost(block);
      markProcessed(block.id);
      return;
    }
    if (target === 'ignore') {
      console.log('[webai-claw] block ' + block.id + ' targets another host; ignoring');
      markProcessed(block.id);
      return;
    }
    if (userAborted) {
      // a new block after abort = user kept chatting: re-arm; later blocks execute normally.
      // blocks seen before the abort were marked processed in abortChain and won't resurrect.
      userAborted = false;
      console.log('[webai-claw] new block after abort ' + block.id + '; chain re-armed');
    }
    if (!firstSeenAt[block.id]) {
      firstSeenAt[block.id] = Date.now();
      console.log('[webai-claw] block ' + block.id + ' seen');
    }
    var fp = block.id + '|' + fingerprint(text);
    var genAtSchedule = gen;
    clearTimeout(stableTimers[fp]);
    stableTimers[fp] = setTimeout(function () {
      delete stableTimers[fp];
      if (genAtSchedule !== gen) return;  // voided by a newer generation; don't forward
      if (userAborted || isProcessed(block.id) || inFlight[block.id]) return;
      var again = parseBlock(elementText(el));
      if (!again) return;
      var fireTarget = targetGate(again);
      if (fireTarget === 'defer') return;
      if (fireTarget === 'missing') {
        warnMissingHost(again);
        markProcessed(again.id);
        return;
      }
      if (fireTarget === 'ignore') {
        markProcessed(again.id);
        return;
      }
      // Re-check the binding at fire time: the page may have navigated
      // between scheduling and execution.
      if (!bound ||
          (boundSession && sessionKeyOf() !== boundSession) ||
          (boundAi && aiType() !== boundAi)) return;
      console.log('[webai-claw] block ' + block.id + ' stable, executing');
      if (again.kind === 'probe') probeBlock(again);
      else if (again.kind === 'attach') attachBlock(again);
      else if (again.kind === 'diag') diagBlock(again);
      else if (again.kind === 'summary') summaryBlock(again);
      else execBlock(again);
    }, STABLE_MS);
  });
}

document.addEventListener('click', function (e) {
  if (selfActing) return;
  var t = e.target;
  var btn = t && t.closest ? t.closest('button, [role="button"]') : null;
  if (!btn) return;
  // a real user click (not our auto-send) resets the consecutive auto-run counter
  resetAutoSendState();
  if (!adapter.isStopButton || !adapter.isStopButton(btn)) return;
  abortChain('user clicked the stop/interrupt button');
}, true);

var scanTimer = null;
new MutationObserver(function () {
  pokeWarmup();
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 300);
}).observe(document.documentElement, {
  childList: true, subtree: true, characterData: true
});

loadProcessed(function () {
  pokeWarmup();
  scan();
  console.log('[webai-claw] content script started v' + VERSION + ': only exact v3 blocks execute; auto-send defaults on.');
});
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== "local" || !changes[MACHINE_KEY]) return;
  var nv = changes[MACHINE_KEY].newValue;
  if (!nv || nv === localMachineId) return;
  localMachineId = nv;
  console.log('[webai-claw] local machine_id updated: ' + localMachineId);
  try { scan(); } catch (e) {}
});
})();