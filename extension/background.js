// webai-claw extension service worker
// M1: click icon → ping local host → pong returns, badge flips to ✓ (bridge acceptance).
// M2: content script delivers exec via long-lived Port → forwarded to host via Native Messaging →
//     host's result / progress return to the content script the same way. Icon badge = status:
//     … running, ✓ ready/done, ✕ disconnected.
// M4: machine_id (UUID) from pong is cached into chrome.storage.local,
//     for the content script to read for strict-addressing routing. hostname kept only as a human-readable label.
const MACHINE_KEY = "mh_machine_id";

const HOST = "com.webai.claw";
const HOSTNAME_KEY = "mh_local_hostname";
const PLATFORM_KEY = "mh_platform";
let nativePort = null;
const pending = new Map(); // exec id -> {port, session, gen}
const fileBuf = new Map(); // read_file id -> accumulated file_chunks
let fileBufTimer = null; // P1-1: single-shot timeout guard for incomplete fileBuf
const pingTests = new Map(); // ping_test id -> {timer, sendResponse} (approach 2: popup bridge test)
const pagePorts = new Set();       // every live content-script port
const pageInfo = new Map();        // pagePort -> {binding_id, session, ai, url, title, tabId}
const hostRequests = new Map();    // one-shot host request id -> {cb, timer}
let activeBinding = null;          // {binding_id, session, ai, port, tabId} for this browser
const hostInfo = { machine_id: null, hostname: null, platform: null, shell: null, host_version: null };

function browserName() {
  try { return (navigator.userAgent || "").indexOf("Edg/") !== -1 ? "edge" : "chrome"; }
  catch (e) { return "chrome"; }
}

function normalizeSession(v) {
  try {
    const u = new URL(v);
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch (e) {
    return String(v || "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

// ---------- Layer 1 scheduler ----------
// host executes globally in order; background keeps an in-memory FIFO, one at a time to host.
// session: generated per page load by the content script; gen: generation, +1 on stop, old generations all expire.
// cross-session when busy gets a 5s grace; still busy → reject (never enters host queue); same-session bursts queue unbounded.
const portGen = new Map();  // pagePort -> current generation (default 0)
const schedQueue = [];      // [{port, kind, msg, session, gen, graceTimer}]
let hostBusy = false;
let running = null;         // {id, port, session, gen, cmd, startTime}
const GRACE_MS = 5000;

function curGenOf(port) {
  const g = portGen.get(port);
  return (typeof g === "number") ? g : 0;
}

function dropSchedItem(item) {
  if (item.graceTimer) { clearTimeout(item.graceTimer); item.graceTimer = null; }
}

// take the next sendable item from the head: skip expired generations; one at a time
function pump() {
  if (hostBusy) return;
  while (schedQueue.length) {
    const item = schedQueue[0];
    if (item.gen < curGenOf(item.port)) {
      schedQueue.shift();
      dropSchedItem(item);
      continue;
    }
    schedQueue.shift();
    dropSchedItem(item);  // cancel grace timer before forwarding
    forwardToHost(item);
    return;
  }
}

function forwardToHost(item) {
  hostBusy = true;
  const desc = item.kind === "exec" ? String(item.msg.cmd || "")
    : item.kind === "read_file" ? ("read_file:" + item.msg.path)
    : item.kind;
  running = { id: item.msg.id, port: item.port, session: item.session,
              ai: item.ai, binding_id: item.binding_id, gen: item.gen,
              cmd: desc, startTime: Date.now() };
  pending.set(item.msg.id, { port: item.port, session: item.session,
                             ai: item.ai, binding_id: item.binding_id, gen: item.gen });
  setBadge("…", "#616161");
  try {
    if (item.kind === "exec") {
      ensureNativePort().postMessage({
        type: "exec",
        id: item.msg.id,
        cmd: item.msg.cmd,
        shell: item.msg.shell || undefined,
        timeout: item.msg.timeout || undefined,
        approved: item.msg.approved || undefined,
        host: item.host,
        binding_id: item.binding_id,
        session: item.session,
        ai: item.ai,
        gen: item.gen,
      });
    } else if (item.kind === "read_file") {
      ensureNativePort().postMessage({
        type: "read_file", id: item.msg.id, path: item.msg.path,
        host: item.host, binding_id: item.binding_id,
        session: item.session, ai: item.ai,
        gen: item.gen,
      });
    } else if (item.kind === "diag") {
      ensureNativePort().postMessage({
        type: "diag", id: item.msg.id, host: item.host,
        binding_id: item.binding_id, session: item.session, ai: item.ai,
        gen: item.gen,
      });
    } else if (item.kind === "summary") {
      ensureNativePort().postMessage({
        type: "summary", id: item.msg.id, text: item.msg.text,
        host: item.host, binding_id: item.binding_id,
        session: item.session, ai: item.ai,
        gen: item.gen,
      });
    }
  } catch (e) {
    hostBusy = false;
    running = null;
    pending.delete(item.msg.id);
    try {
      item.port.postMessage({ type: "error", id: item.msg.id, gen: item.gen,
        error: "failed to send to local host: " + e.message });
    } catch (err) {}
    setBadge("✕", "#c62828");
    pump();
  }
}

function enqueue(port, kind, msg) {
  const g = (typeof msg.gen === "number") ? msg.gen : curGenOf(port);
  if (g < curGenOf(port)) return;  // expired generation, ignore
  if (msg.binding_id) {
    if (!activeBinding) {
      try {
        port.postMessage({ type: "error", id: msg.id, gen: g,
                           error: "not connected; click Connect in the popup" });
      } catch (e) {}
      return;
    }
    if (msg.binding_id !== activeBinding.binding_id ||
        (msg.session && msg.session !== activeBinding.session) ||
        (msg.ai && msg.ai !== activeBinding.ai)) {
      try {
        port.postMessage({ type: "error", id: msg.id, gen: g,
                           error: "binding or session no longer matches the bound page" });
      } catch (e) {}
      return;
    }
  }
  const item = { port, kind, msg,
                 host: msg.host || "",
                 binding_id: msg.binding_id || "",
                 session: msg.session || "",
                 ai: msg.ai || "",
                 gen: g };
  // The native host serializes execution; commands from any other tab/browser
  // are rejected by the host lease before they reach the shell. Do not invent
  // an extra 5s "busy" rejection here.
  schedQueue.push(item);
  pump();
}

function dropQueueForBinding(port, bindingId, reason) {
  for (let i = schedQueue.length - 1; i >= 0; i--) {
    const it = schedQueue[i];
    if ((port && it.port === port) || (bindingId && it.binding_id === bindingId)) {
      schedQueue.splice(i, 1);
      dropSchedItem(it);
      try {
        it.port.postMessage({ type: "error", id: it.msg.id, gen: it.gen, error: reason });
      } catch (e) {}
    }
  }
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function requestHost(msg, cb, timeoutMs) {
  const id = msg.id || ("h-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
  msg.id = id;
  const timer = setTimeout(() => {
    if (!hostRequests.has(id)) return;
    hostRequests.delete(id);
    try { cb({ ok: false, error: "host timeout" }); } catch (e) {}
  }, timeoutMs || 10000);
  hostRequests.set(id, { cb, timer });
  try {
    ensureNativePort().postMessage(msg);
  } catch (e) {
    clearTimeout(timer);
    hostRequests.delete(id);
    try { cb({ ok: false, error: "failed to reach host: " + e.message }); } catch (ee) {}
  }
}

function ensureNativePort() {
  if (nativePort) return nativePort;
  nativePort = chrome.runtime.connectNative(HOST);
  nativePort.onMessage.addListener((msg) => {
    if (!msg) return;
    if (hostRequests.has(msg.id) &&
        (msg.type === "connected" || msg.type === "busy" ||
         msg.type === "state" || msg.type === "bundle" ||
         msg.type === "error" || msg.type === "result")) {
      const req = hostRequests.get(msg.id);
      hostRequests.delete(msg.id);
      clearTimeout(req.timer);
      try { req.cb(msg); } catch (e) {}
      return;
    }
    if (msg.type === "pong") {
      setBadge("✓", "#2e7d32");
      if (msg.machine_id) hostInfo.machine_id = msg.machine_id;
      if (msg.hostname) hostInfo.hostname = msg.hostname;
      if (msg.platform) hostInfo.platform = msg.platform;
      if (msg.shell) hostInfo.shell = msg.shell;
      if (msg.host_version) hostInfo.host_version = msg.host_version;
      // M4 strict addressing: cache local machine_id (UUID) for the content script's routing decisions;
      // hostname kept only as a human-readable label.
      try {
        const obj = {};
        if (msg.hostname) obj[HOSTNAME_KEY] = msg.hostname;
        if (msg.machine_id) {
          obj[MACHINE_KEY] = msg.machine_id;
          console.log("[webai-claw] pong cached machine_id=" + msg.machine_id);
        }
        if (msg.platform) obj[PLATFORM_KEY] = msg.platform;
        if (Object.keys(obj).length) chrome.storage.local.set(obj);
      } catch (e) {}
      // approach 2: popup "test bridge" pongs are claimed here by id (pingtest- prefix).
      // this tests the link commands really travel — previously popup connected its own port, so "connected" could be a false green
      // (2026-10-04 live-site lesson: popup showed connected while background never built a port).
      var pt = pingTests.get(msg.id);
      if (pt) {
        pingTests.delete(msg.id);
        clearTimeout(pt.timer);
        try { pt.sendResponse({ ok: true, hostname: msg.hostname,
          machine_id: msg.machine_id, platform: msg.platform }); } catch (e) {}
      }
      return;
    }
    if (msg.type === "file_chunk") {
      var buf = fileBuf.get(msg.id);
      if (!buf) {
        buf = { name: msg.name, mime: msg.mime, size: msg.size,
                total: msg.total, chunks: [] };
        fileBuf.set(msg.id, buf); if (fileBufTimer) clearTimeout(fileBufTimer); fileBufTimer = setTimeout(function(){ for (var fid of fileBuf.keys()) { var e3 = pending.get(fid); if (e3 && e3.port) { try { e3.port.postMessage({type:"error",id:fid,gen:e3.gen,error:"file timeout 30s"}); } catch (ee) {} } pending.delete(fid); if (running && running.id === fid) { hostBusy = false; running = null; } } fileBuf.clear(); setBadge("X","#c62828"); pump(); }, 30000);
      }
      buf.chunks[msg.index] = msg.data;
      var got = 0;
      for (var k = 0; k < buf.chunks.length; k++) if (buf.chunks[k] != null) got++;
      if (got === buf.total) {
        const entry = pending.get(msg.id);
        const pg = entry && entry.port;
        fileBuf.delete(msg.id);
        pending.delete(msg.id);
        if (running && running.id === msg.id) { hostBusy = false; running = null; }
        if (pg && entry.gen === curGenOf(pg)) {
          try {
            pg.postMessage({ type: "file", id: msg.id, gen: entry.gen, name: buf.name,
                             mime: buf.mime, size: buf.size,
                             b64: buf.chunks.join("") });
          } catch (e) {}
        } else if (pg) {
          console.log("[webai-claw] dropping expired-generation file id=" + msg.id);
        }
        pump();
      }
      return;
    }
    if (msg.type === "result" || msg.type === "error" || msg.type === "progress") {
      const entry = pending.get(msg.id);
      const page = entry && entry.port;
      if (msg.type !== "progress") {
        pending.delete(msg.id);
        // Only the terminal message for the *current* task may clear the
        // scheduler. A late/stale result must not free the next command.
        if (running && running.id === msg.id) {
          hostBusy = false;
          running = null;
        }
      }
      if (page) {
        if (entry.gen === curGenOf(page)) {
          try {
            page.postMessage(Object.assign({}, msg, { gen: entry.gen }));
          } catch (e) {
            /* page closed, just drop it */
          }
        } else {
          console.log("[webai-claw] dropping expired generation " + msg.type + " id=" + msg.id +
                      " gen=" + entry.gen + " current=" + curGenOf(page));
        }
      }
      if (msg.type === "result") setBadge("✓", "#2e7d32");
      if (msg.type === "error") setBadge("✕", "#c62828");
      if (msg.type !== "progress") pump();
    }
  });
  nativePort.onDisconnect.addListener(() => {
    console.log("[webai-claw] native port disconnected:", chrome.runtime.lastError);
    nativePort = null;
    hostBusy = false;
    running = null;
    setBadge("✕", "#c62828");
    for (const [id, entry] of pending) {
      try {
        entry.port.postMessage({ type: "error", id, gen: entry.gen,
                                 error: "local host disconnected" });
      } catch (e) {}
    }
    pending.clear();
    fileBuf.clear();
    for (const [id, req] of hostRequests) {
      clearTimeout(req.timer);
      try { req.cb({ ok: false, error: "local host disconnected" }); } catch (e) {}
    }
    hostRequests.clear();
    activeBinding = null;
    for (const p of pagePorts) {
      try { p.postMessage({ type: "bound", bound: false }); } catch (e) {}
    }
    // approach 2: when host disconnects, pending bridge tests error out immediately instead of waiting for the 10s timeout
    for (const [pid, pt] of pingTests) {
      clearTimeout(pt.timer);
      try { pt.sendResponse({ ok: false, error: "local host disconnected" }); } catch (e) {}
    }
    pingTests.clear();
    // queued-but-unsent items error out too; never silently swallowed
    while (schedQueue.length) {
      const it = schedQueue.shift();
      dropSchedItem(it);
      try {
        it.port.postMessage({ type: "error", id: it.msg.id, gen: it.gen,
          error: "local host disconnected (queued)" });
      } catch (e) {}
    }
  });
  // §6.7 precondition: ping on connect; pong returns hostname, cached to storage.
  // can't rely on the user clicking the icon — manifest sets default_popup, so onClicked never fires.
  // approach 2: popup "test bridge" no longer connects directly; everything goes through this port (tests the real link).
  try { nativePort.postMessage({ type: "ping", id: "__init__" + Date.now() }); } catch (e) {}
  return nativePort;
}

chrome.action.onClicked.addListener(() => {
  setBadge("…", "#616161");
  try {
    ensureNativePort().postMessage({ type: "ping", id: "m1-" + Date.now() });
  } catch (e) {
    console.error("[webai-claw] connectNative failed:", e);
    setBadge("✕", "#c62828");
  }
});

chrome.runtime.onConnect.addListener((pagePort) => {
  if (pagePort.name !== "webai-claw") return;
  pagePorts.add(pagePort);
  pageInfo.set(pagePort, {
    binding_id: null,
    session: "",
    ai: "",
    url: (pagePort.sender && pagePort.sender.tab && pagePort.sender.tab.url) || "",
    title: (pagePort.sender && pagePort.sender.tab && pagePort.sender.tab.title) || "",
    tabId: pagePort.sender && pagePort.sender.tab ? pagePort.sender.tab.id : null
  });
  try { ensureNativePort(); } catch (e) {}
  pagePort.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === "hello") {
      const info = pageInfo.get(pagePort) || {};
      info.binding_id = msg.binding_id || info.binding_id;
      info.session = normalizeSession(msg.session || info.session);
      info.ai = msg.ai || info.ai;
      info.url = msg.url || info.url;
      info.title = msg.title || info.title;
      pageInfo.set(pagePort, info);
      return;
    }
    if (msg.type === "session_adopted") {
      const info = pageInfo.get(pagePort) || {};
      info.session = normalizeSession(msg.session || info.session);
      info.ai = msg.ai || info.ai;
      pageInfo.set(pagePort, info);
      if (activeBinding && activeBinding.port === pagePort &&
          activeBinding.binding_id === msg.binding_id) {
        const old = activeBinding;
        activeBinding.session = info.session;
        activeBinding.ai = info.ai;
        dropQueueForBinding(pagePort, old.binding_id,
                            "session changed; queued command discarded");
        requestHost({
          type: "connect", binding_id: old.binding_id,
          session: info.session, ai: info.ai,
          page_url: info.url || "", page_title: info.title || "",
          browser: browserName(), extension_id: chrome.runtime.id
        }, (res) => {
          if (!res || res.type !== "connected") {
            activeBinding = null;
            try { pagePort.postMessage({ type: "bound", bound: false }); } catch (e) {}
          }
        }, 10000);
      } else {
        try { pagePort.postMessage({ type: "bound", bound: false }); } catch (e) {}
      }
      return;
    }
    if (msg.type === "session_changed") {
      const info = pageInfo.get(pagePort) || {};
      info.session = normalizeSession(msg.session || "");
      info.ai = msg.ai || info.ai;
      pageInfo.set(pagePort, info);
      if (activeBinding && activeBinding.port === pagePort) {
        const old = activeBinding;
        activeBinding = null;
        dropQueueForBinding(old.port, old.binding_id, "session changed; queued command discarded");
        requestHost({ type: "disconnect", binding_id: old.binding_id }, () => {});
        try { pagePort.postMessage({ type: "bound", bound: false }); } catch (e) {}
      }
      return;
    }
    if (msg.type === "exec" && msg.id && msg.cmd) {
      enqueue(pagePort, "exec", msg);
    } else if (msg.type === "read_file" && msg.id && msg.path) {
      enqueue(pagePort, "read_file", msg);
    } else if (msg.type === "diag" && msg.id) {
      enqueue(pagePort, "diag", msg);
    } else if (msg.type === "summary" && msg.id) {
      enqueue(pagePort, "summary", msg);
    } else if (msg.type === "stop") {
      // user hit stop: generation advances, all queued items of old generations in this session are voided
      const g = (typeof msg.gen === "number") ? msg.gen : curGenOf(pagePort) + 1;
      portGen.set(pagePort, g);
      for (let i = schedQueue.length - 1; i >= 0; i--) {
        const it = schedQueue[i];
        if (it.port === pagePort && it.gen < g) {
          schedQueue.splice(i, 1);
          dropSchedItem(it);
        }
      }
      if (running && running.port === pagePort) {
        const bid = msg.binding_id || (activeBinding && activeBinding.binding_id) || "";
        try {
          ensureNativePort().postMessage({ type: "kill", id: running.id, binding_id: bid });
        } catch (e) {}
      }
      console.log("[webai-claw] received stop: session=" + (msg.session || "") + " gen=" + g);
    }
  });
  pagePort.onDisconnect.addListener(() => {
    for (const [id, entry] of pending) { if (entry.port === pagePort && (!running || running.id !== id)) pending.delete(id); }
    dropQueueForBinding(pagePort, null, "page closed; queued command discarded");
    if (activeBinding && activeBinding.port === pagePort) {
      const old = activeBinding;
      activeBinding = null;
      requestHost({ type: "disconnect", binding_id: old.binding_id }, () => {});
    }
    pagePorts.delete(pagePort);
    pageInfo.delete(pagePort);
    portGen.delete(pagePort);
  });
});
function queryActiveTab() {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (tabs && tabs[0]) { resolve(tabs[0]); return; }
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
          resolve(tabs2 && tabs2[0] ? tabs2[0] : null);
        });
      });
    } catch (e) { resolve(null); }
  });
}

function findPageForTab(tabId) {
  if (tabId === null || tabId === undefined) return null;
  for (const [port, info] of pageInfo) {
    if (info.tabId === tabId) return { port, info };
  }
  return null;
}

// ---------- popup bridge / connection control ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  // approach 2: popup "test bridge" goes through background's native port
  if (msg.type === "ping_test") {
    var pid = "pingtest-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    var timer = setTimeout(function () {
      pingTests.delete(pid);
      try { sendResponse({ ok: false, error: "host silent (10s timeout)" }); } catch (e) {}
    }, 10000);
    try {
      pingTests.set(pid, { timer: timer, sendResponse: sendResponse });
      ensureNativePort().postMessage({ type: "ping", id: pid });
    } catch (e) {
      pingTests.delete(pid);
      clearTimeout(timer);
      try { sendResponse({ ok: false, error: "failed to reach host: " + e.message }); } catch (ee) {}
    }
    return true;
  }

  if (msg.type === "get_state") {
    queryActiveTab().then((tab) => {
      const found = tab ? findPageForTab(tab.id) : null;
      requestHost({ type: "status" }, (st) => {
        if (st) {
          if (st.machine_id) hostInfo.machine_id = st.machine_id;
          if (st.hostname) hostInfo.hostname = st.hostname;
          if (st.platform) hostInfo.platform = st.platform;
          if (st.shell) hostInfo.shell = st.shell;
          if (st.host_version) hostInfo.host_version = st.host_version;
          try {
            const obj = {};
            if (st.machine_id) obj[MACHINE_KEY] = st.machine_id;
            if (st.hostname) obj[HOSTNAME_KEY] = st.hostname;
            if (st.platform) obj[PLATFORM_KEY] = st.platform;
            if (Object.keys(obj).length) chrome.storage.local.set(obj);
          } catch (e) {}
        }
        const lease = st && st.lease;
        // After an MV3 worker restart, activeBinding is lost. If the lease
        // owner is the page in this tab, adopt it again (same binding id).
        if (lease && lease.owner && !lease.stale && found && found.info.binding_id &&
            lease.owner.binding_id === found.info.binding_id) {
          if (!activeBinding) {
            activeBinding = {
              binding_id: found.info.binding_id,
              session: lease.owner.session || found.info.session,
              ai: lease.owner.ai || found.info.ai,
              port: found.port,
              tabId: tab.id
            };
            try {
              found.port.postMessage({
                type: "bound", bound: true,
                session: activeBinding.session, ai: activeBinding.ai
              });
            } catch (e) {}
          } else if (activeBinding.binding_id === found.info.binding_id) {
            activeBinding.session = lease.owner.session || activeBinding.session;
            activeBinding.ai = lease.owner.ai || activeBinding.ai;
          }
        }
        sendResponse({
          ok: !!(st && !st.error),
          error: st && st.error,
          host: Object.assign({}, hostInfo),
          lease: (st && st.lease) || null,
          tab: tab ? {
            id: tab.id,
            url: (found && found.info.url) || tab.url || "",
            title: (found && found.info.title) || tab.title || "",
            binding_id: found ? found.info.binding_id : null,
            session: found ? found.info.session : null,
            ai: found ? found.info.ai : null,
            supported: !!found
          } : null,
          active: activeBinding ? {
            binding_id: activeBinding.binding_id,
            session: activeBinding.session,
            ai: activeBinding.ai,
            tabId: activeBinding.tabId
          } : null,
          running: running ? {
            id: running.id, cmd: running.cmd,
            session: running.session, startTime: running.startTime
          } : null
        });
      }, 5000);
    });
    return true;
  }

  if (msg.type === "connect") {
    queryActiveTab().then((tab) => {
      const found = tab ? findPageForTab(tab.id) : null;
      if (!found || !found.info.binding_id || !found.info.session || !found.info.ai) {
        sendResponse({ ok: false, error: "this tab is not ready; refresh the AI chat and try again" });
        return;
      }
      const info = found.info;
      requestHost({
        type: "connect",
        binding_id: info.binding_id,
        session: info.session,
        ai: info.ai,
        page_url: info.url || (tab && tab.url) || "",
        page_title: info.title || (tab && tab.title) || "",
        browser: browserName(),
        extension_id: chrome.runtime.id
      }, (res) => {
        if (!res || res.type !== "connected") {
          sendResponse({ ok: false, busy: !!(res && res.type === "busy"), host: res });
          return;
        }
        if (res.machine_id) hostInfo.machine_id = res.machine_id;
        if (res.hostname) hostInfo.hostname = res.hostname;
        if (res.platform) hostInfo.platform = res.platform;
        if (res.shell) hostInfo.shell = res.shell;
        if (res.host_version) hostInfo.host_version = res.host_version;
        if (activeBinding && activeBinding.port !== found.port) {
          dropQueueForBinding(activeBinding.port, activeBinding.binding_id,
                              "lease taken over; queued command discarded");
          try { activeBinding.port.postMessage({ type: "bound", bound: false }); } catch (e) {}
        }
        activeBinding = { binding_id: info.binding_id, session: info.session,
                          ai: info.ai, port: found.port, tabId: tab.id };
        try {
          found.port.postMessage({ type: "bound", bound: true,
            session: info.session, ai: info.ai });
        } catch (e) {}
        requestHost({
          type: "bundle", binding_id: info.binding_id,
          session: info.session, ai: info.ai
        }, (bundle) => {
          if (!bundle || bundle.type !== "bundle") {
            sendResponse({ ok: false, error: (bundle && bundle.error) || "failed to read guide" });
            return;
          }
          try {
            found.port.postMessage({
              type: "do_connect",
              config: Object.assign({}, bundle, { session: info.session, ai: info.ai })
            });
          } catch (e) {}
          sendResponse({ ok: true, host: res });
        }, 10000);
      }, 10000);
    });
    return true;
  }

  if (msg.type === "disconnect") {
    if (!activeBinding) {
      sendResponse({ ok: false, error: "this browser is not connected" });
      return true;
    }
    const old = activeBinding;
    activeBinding = null;
    dropQueueForBinding(old.port, old.binding_id, "disconnected; queued command discarded");
    // Unbind the page immediately; do not wait for the host round-trip.
    try { old.port.postMessage({ type: "bound", bound: false }); } catch (e) {}
    requestHost({ type: "disconnect", binding_id: old.binding_id }, (res) => {
      sendResponse({ ok: !!(res && res.ok), host: res });
    }, 5000);
    return true;
  }

  if (msg.type === "interrupt") {
    const bid = (activeBinding && activeBinding.binding_id) || msg.binding_id || "";
    if (running) {
      try {
        ensureNativePort().postMessage({ type: "kill", id: running.id, binding_id: bid });
      } catch (e) {}
      sendResponse({ ok: true, killed: running.id });
    } else if (bid) {
      requestHost({ type: "cancel", binding_id: bid }, (res) => {
        sendResponse({ ok: !!(res && res.ok), host: res });
      }, 5000);
    } else {
      sendResponse({ ok: false, error: "no running task" });
    }
    return true;
  }

  if (msg.type === "continue") {
    if (!activeBinding) {
      sendResponse({ ok: false, error: "this browser is not connected" });
      return true;
    }
    try { activeBinding.port.postMessage({ type: "continue" }); } catch (e) {}
    try { chrome.storage.local.set({ mh_paused: false, mh_pause_count: 0 }); } catch (e) {}
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "stop") {
    if (!activeBinding) {
      sendResponse({ ok: false, error: "this browser is not connected" });
      return true;
    }
    try { activeBinding.port.postMessage({ type: "popup_stop" }); } catch (e) {}
    try { chrome.storage.local.set({ mh_paused: false, mh_pause_count: 0 }); } catch (e) {}
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

// ---------- Onboarding: open setup page after install ----------
// The extension is useless without the local host; the setup page stays
// in setup state until the host answers (no one-time dismiss).
chrome.runtime.onInstalled.addListener(function (details) {
  if (details && details.reason === "install") {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
    } catch (e) {}
  }
});
