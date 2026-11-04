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
var MAX_CMD_BYTES = 512 * 1024;
var MAX_WRITE_BYTES = 512 * 1024; // write_file payload cap; host enforces the same raw-byte limit
var STORE_KEY = 'mh_processed_ids_v2';  // session-scoped keys: <session>|<id>
var AUTO_KEY = 'mh_auto_send';
var ATTACH_AUTO_KEY = 'mh_auto_send_attachments';
var HOSTNAME_KEY = 'mh_local_hostname';
var MACHINE_KEY = 'mh_machine_id';
var PLATFORM_KEY = 'mh_platform';
var GUIDE_STATE_KEY = 'mh_guide_state';

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
var BINDING_ID = WebAIClawSession.makeBindingId();
var bound = false;
var boundSession = null;
var boundAi = null;
var MIN_AUTO_SEND_INTERVAL_MS = 500;
var lastAutoSendAt = 0;

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

var UUID_RE = WebAIClawProtocol.UUID_RE;

function normalizeSession(v) {
  return WebAIClawSession.normalizeSession(v, location.href);
}

function sessionKeyOf() {
  return WebAIClawSession.sessionKeyOf(adapter, location);
}

function aiType() {
  return WebAIClawSession.aiType(adapter);
}

function sameOrigin(a, b) {
  return WebAIClawSession.sameOrigin(a, b);
}

function isProvisionalSession(s) {
  return WebAIClawSession.isProvisionalSession(s);
}

function targetGate(block) {
  return WebAIClawSession.targetGate(block, localMachineId, UUID_RE);
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
                      respectAuto: false });
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
  // Also swallow v3 blocks that appeared before the interrupt but were never
  // scanned; otherwise they could execute afterwards.
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
  var text = '⏹ [webai-claw] user interrupted the current chain (auto-sent): all generation ' + curGen + ' commands are void' +
    ' (' + nTimers + ' pending cancelled, ' + nFlight + ' in-flight results will not be filled back).' +
    'Please stop the current task, wait for the next user instruction, and do not send new command blocks.';
  var ok = false;
  try { ok = adapter.fillResult(text); } catch (e) { ok = false; }
  if (ok) {
    console.log('[webai-claw] stop notice filled back, sending in 500ms');
    sendWithRetry({ tag: 'interrupt-notice', maxWaitMs: 8000, intervalMs: 400,
                    respectAuto: false });
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
var parseBlock = WebAIClawProtocol.parseBlock;

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
      if (bound) scan();
      console.log('[webai-claw] binding ' + (bound ? 'active: ' + boundSession + ' / ' + boundAi : 'released'));
      if (bound) scan();
      return;
    }
    if (msg.type === 'do_connect') {
      sendConnectAttachment(msg.config || {});
      return;
    }
    if (msg.type === 'popup_interrupt') {
      abortChain('user clicked interrupt in popup');
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

function writeFileBlock(block) {
  if (!bound ||
      (boundSession && sessionKeyOf() !== boundSession) ||
      (boundAi && aiType() !== boundAi)) {
    console.log('[webai-claw] write_file ' + block.id + ' ignored: page is not the bound owner');
    return;
  }
  if (!block.path) {
    fillBack('[claw:write_file] id=' + block.id + ' error=missing path');
    return;
  }
  if (block.content === null) {
    fillBack('[claw:write_file] id=' + block.id + ' error=missing content');
    return;
  }
  if (block.content.length > MAX_WRITE_BYTES) {
    markProcessed(block.id);
    fillBack('[claw:write_file] id=' + block.id + ' error=content too large (~' +
      Math.round(block.content.length / 1024) + 'KB, cap 512KB); rejected. ' +
      'Do not append in chunks; create a small local generator/transformer ' +
      'script with write_file and run it with exec, or use a dedicated editor.');
    return;
  }
  inFlight[block.id] = true;
  cmdById[block.id] = 'write_file: ' + block.path;
  console.log('[webai-claw] writing ' + block.id + ': ' + block.path);
  try {
    getPort().postMessage({
      type: 'write_file',
      id: block.id,
      host: block.host,
      session: sessionKeyOf(),
      ai: aiType(),
      binding_id: BINDING_ID,
      gen: gen,
      path: block.path,
      content: block.content,
      encoding: block.encoding,
      overwrite: !!block.overwrite,
      expected_sha256: block.expected_sha256 || undefined,
      backup: !!block.backup
    });
    markProcessed(block.id);
  } catch (e) {
    delete inFlight[block.id];
    delete cmdById[block.id];
    if (contextDead) warnContextDead();
    else fillBack('[claw:write_file] id=' + block.id + ' error=failed to send: ' + e.message);
  }
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
      respectAuto: true,
      onSkip: function () { notifyWaiting('attachment-ready'); },
      failNote: '\n[webai-claw] attachment is ready but auto-send failed; press Send manually.'
    });
  }, function (e) {
    fillBack('[claw:attach] id=' + msg.id + ' error=adapter upload threw: ' + (e && e.message || e));
  });
}


function shouldSendGuide(ai, hostVersion, cb) {
  if (ai !== 'muse') {
    cb(true);
    return;
  }
  try {
    chrome.storage.local.get([GUIDE_STATE_KEY], function (res) {
      var state = (res && res[GUIDE_STATE_KEY]) || {};
      cb(!state.muse || state.muse !== hostVersion);
    });
  } catch (e) {
    cb(true);
  }
}

function markGuideSent(ai, hostVersion) {
  if (ai !== 'muse' || !hostVersion) return;
  try {
    chrome.storage.local.get([GUIDE_STATE_KEY], function (res) {
      var state = (res && res[GUIDE_STATE_KEY]) || {};
      state.muse = hostVersion;
      var obj = {};
      obj[GUIDE_STATE_KEY] = state;
      chrome.storage.local.set(obj);
    });
  } catch (e) {}
}

function skillIndexText(config) {
  var skills = Array.isArray(config.skills) ? config.skills : [];
  var lines = ['## Skill index'];
  if (!skills.length) {
    lines.push('No skills are installed in ~/webai-claw-skills/.');
    return lines.join('\n');
  }
  for (var i = 0; i < skills.length; i++) {
    var s = skills[i] || {};
    lines.push('- ' + (s.name || 'unnamed') + ' (' + (s.source || 'preset') + '): ' +
      (s.description || ''));
    if (s.path) lines.push('  path: ' + s.path);
    if (s.platforms && s.platforms.length) {
      lines.push('  platforms: ' + s.platforms.join(', '));
    }
    if (s.triggers && s.triggers.length) {
      lines.push('  triggers: ' + s.triggers.join(', '));
    }
  }
  lines.push('Read a skill only when it matches the task; full skill text is in its file.');
  return lines.join('\n');
}

function connectAttachmentText(config, session, ai, includeGuide) {
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
  lines.push(skillIndexText(config));
  lines.push('');
  lines.push('## Protocol');
  if (includeGuide) {
    lines.push(config.guide || '(AI-AGENT.md missing; re-run install.py)');
  } else {
    lines.push('The AI-AGENT.md protocol was already provided for this AI type.');
    lines.push('Use the same host and v3 rules.');
  }
  if (config.handoff) {
    lines.push('');
    lines.push('## Previous handoff');
    lines.push(config.handoff);
  }
  return lines.join('\n');
}

function sendConnectAttachment(config) {
  var finished = false;
  var session = sessionKeyOf();
  var ai = aiType();
  var hostVersion = config.host_version || '';
  function finish(ok, error) {
    if (finished) return;
    finished = true;
    if (ok) markGuideSent(ai, hostVersion);
    notifyConnectDone(ok, error);
  }

  shouldSendGuide(ai, hostVersion, function (includeGuide) {
    var text = connectAttachmentText(config, session, ai, includeGuide);
    var targetHost = config.machine_id || localMachineId || '?';
    var note = 'Connected to ' + (config.hostname || 'this computer') +
      ' (' + (config.platform || '?') + ' / ' + (config.shell || '?') + ').\n' +
      'host: ' + targetHost + '\nsession: ' + session + '\nai: ' + ai + '\n' +
      (includeGuide
        ? 'Read the attached protocol. '
        : 'Use the AI-AGENT.md protocol already provided for this AI type. ') +
      'Reply in normal text with:\n' +
      '"Connected to <hostname> (<platform>). I will run subsequent commands ' +
      'on this machine with host:' + targetHost + '."\n' +
      'Every claw block must include "host":"' + targetHost + '" and "v":3. ' +
      'Do not write session or ai; the extension adds them.\n' +
      'If a newer Connect attachment appears in this conversation, use its host. ' +
      'If the user names another UUID, follow the user.\n' +
      'Wait for the task.';
    var hasAttachment = includeGuide || !!(config.handoff || '').trim();
    if (!hasAttachment) note += '\n\n' + skillIndexText(config);

    function sendNote() {
      var ok = false;
      try { ok = adapter.fillResult(note); } catch (e) { ok = false; }
      if (!ok) {
        fillOnly('[connect] connected, but could not fill the input box');
        finish(false, 'could not fill the input box');
        return;
      }
      sendWithRetry({
        tag: 'connect', maxWaitMs: 45000, intervalMs: 500,
        respectAuto: false,
        verifyDelayMs: 800,
        verify: function () {
          if (!adapter.isInputEmpty) return true;
          try { return adapter.isInputEmpty(); } catch (e) { return true; }
        },
        onSent: function () { finish(true); },
        onSkip: function (reason) { finish(false, 'handshake send failed: ' + (reason || 'unknown')); },
        failNote: '\n[webai-claw] Connect note is ready but auto-send failed; press Send manually.'
      });
    }

    if (!hasAttachment) {
      sendNote();
      return;
    }
    if (!adapter || typeof adapter.uploadFile !== 'function') {
      fillOnly('[connect] this site does not support file upload; cannot send the guide');
      finish(false, 'this site does not support file upload');
      return;
    }
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
      sendNote();
    }, function (e) {
      fillOnly('[connect] adapter upload threw: ' + (e && e.message || e));
      finish(false, 'adapter upload rejected');
    });
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
  return WebAIClawFormat.formatDiag(res);
}

function formatResult(res) {
  return WebAIClawFormat.formatResult(res, cmdById);
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

function sendWithRetry(opts) {
  opts = opts || {};
  var tag = opts.tag || 'auto-send';
  var maxWaitMs = opts.maxWaitMs || 10000;
  var intervalMs = opts.intervalMs || 400;
  var respectAuto = opts.respectAuto !== false;
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
    var wait = MIN_AUTO_SEND_INTERVAL_MS - (Date.now() - lastAutoSendAt);
    if (wait > 0) {
      setTimeout(begin, wait);
      return;
    }
    var deadline = Date.now() + maxWaitMs;

    function succeed() {
      lastAutoSendAt = Date.now();
      console.log('[webai-claw] auto-sent ' + tag);
      if (opts.onSent) {
        try { opts.onSent(); } catch (e) {}
      }
    }

    function fail() {
      console.log('[webai-claw] ' + tag +
                  ': send button never found after retries; staying fill-only');
      if (opts.failNote) {
        try { adapter.fillResult(opts.failNote); } catch (e) {}
      }
      skip('send-failed');
    }

    (function attempt() {
      if (contextDead) return;
      var busy = false;
      try {
        if (adapter.isGenerating && adapter.isGenerating()) busy = true;
        if (!busy && adapter.isUploading && adapter.isUploading()) busy = true;
      } catch (e) { busy = false; }
      if (!busy && doClickSend()) {
        if (opts.verify) {
          // A click can be a no-op while the site is still processing an
          // attachment. Confirm that the composer was actually committed
          // before reporting success.
          setTimeout(function () {
            if (contextDead) return;
            var confirmed = false;
            try { confirmed = !!opts.verify(); } catch (e) {}
            if (confirmed) {
              succeed();
            } else if (Date.now() < deadline) {
              attempt();
            } else {
              fail();
            }
          }, opts.verifyDelayMs || 700);
          return;
        }
        succeed();
        return;
      }
      if (Date.now() < deadline) {
        setTimeout(attempt, intervalMs);
        return;
      }
      fail();
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
      else if (again.kind === 'write_file') writeFileBlock(again);
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