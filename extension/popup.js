// webai-claw extension popup
// Compact status panel: current state, relevant actions, and an optional
// Advanced section for the machine UUID and bridge diagnostics.

try {
  document.getElementById('ver').textContent =
    'v' + chrome.runtime.getManifest().version;
} catch (e) {}

var els = {
  host: document.getElementById('host'),
  state: document.getElementById('state'),
  detail: document.getElementById('detail'),
  connect: document.getElementById('connect'),
  disconnect: document.getElementById('disconnect'),
  interrupt: document.getElementById('interrupt'),
  cont: document.getElementById('continue'),
  stop: document.getElementById('stop'),
  auto: document.getElementById('autosend'),
  attachAuto: document.getElementById('attachauto'),
  mid: document.getElementById('mid'),
  copymid: document.getElementById('copymid'),
  ping: document.getElementById('ping')
};

var paused = false;
var pauseReason = '';
var machineId = null;
var notice = '';
var noticeUntil = 0;

function send(type, payload, cb) {
  var msg = Object.assign({ type: type }, payload || {});
  try {
    chrome.runtime.sendMessage(msg, function (res) {
      if (chrome.runtime.lastError) {
        cb({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      cb(res || { ok: false, error: 'no response from background' });
    });
  } catch (e) {
    cb({ ok: false, error: e.message });
  }
}

function setNotice(text, ms) {
  notice = text || '';
  noticeUntil = notice ? Date.now() + (ms || 5000) : 0;
}

function siteOfSession(session) {
  try { return new URL(session).hostname; } catch (e) { return ''; }
}

function fmtOwner(owner) {
  if (!owner) return 'another page';
  var site = siteOfSession(owner.session);
  var parts = [];
  if (owner.browser) parts.push(owner.browser);
  if (site) parts.push(site);
  if (owner.ai) parts.push(owner.ai);
  return parts.join(' / ') || 'another page';
}

chrome.storage.local.get(
  ['mh_auto_send', 'mh_auto_send_attachments', 'mh_paused', 'mh_pause_reason'],
  function (res) {
    els.auto.checked = !(res && res.mh_auto_send === false);
    els.attachAuto.checked = !!(res && res.mh_auto_send_attachments === true);
    paused = !!(res && res.mh_paused);
    pauseReason = (res && res.mh_pause_reason) || '';
    refresh();
  }
);

els.auto.addEventListener('change', function () {
  chrome.storage.local.set({ mh_auto_send: els.auto.checked });
});
els.attachAuto.addEventListener('change', function () {
  chrome.storage.local.set({ mh_auto_send_attachments: els.attachAuto.checked });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.mh_paused) paused = !!changes.mh_paused.newValue;
  if (changes.mh_pause_reason) {
    pauseReason = changes.mh_pause_reason.newValue || '';
  }
  if (changes.mh_paused || changes.mh_pause_reason) refresh();
});

function setState(text, cls) {
  els.state.textContent = text;
  els.state.className = cls || '';
}

function setMachineId(value, hostname) {
  machineId = value || null;
  if (machineId) {
    els.mid.textContent = (hostname || 'this machine') + ' / ' +
      machineId.slice(0, 8) + '…';
    els.mid.title = machineId;
    els.copymid.disabled = false;
    return;
  }
  els.mid.textContent = 'unavailable';
  els.mid.title = '';
  els.copymid.disabled = true;
}

function render(st) {
  st = st || { ok: false, error: 'no response' };
  var host = st.host || {};
  var lease = st.lease || null;
  var tab = st.tab || null;
  var active = st.active || null;
  var owner = lease && lease.owner ? lease.owner : null;
  var leaseState = lease ? (lease.state || 'idle') : 'idle';
  var stale = !!(lease && leaseState !== 'idle' && lease.stale);
  var hostOk = !!st.ok && !!host.machine_id;
  var ownActive = !!(active && tab && active.binding_id === tab.binding_id);
  var elsewhere = !!(hostOk && lease && leaseState !== 'idle' && owner && !ownActive);

  if (hostOk) {
    els.host.textContent = (host.hostname || '?') + ' / ' +
      (host.platform || '?') + ' / ' + (host.shell || '?') +
      ' / host v' + (host.host_version || '?');
    els.host.className = 'ok';
  } else {
    els.host.textContent = 'unavailable';
    els.host.className = 'err';
  }

  if (!hostOk) {
    setState('host unavailable', 'err');
  } else if (st.connecting) {
    setState('connecting', 'warn');
  } else if (paused) {
    setState('paused', 'warn');
  } else if (elsewhere) {
    setState('connected elsewhere', 'warn');
  } else if (leaseState === 'running') {
    setState('running', 'warn');
  } else if (leaseState === 'idle') {
    setState('idle', 'ok');
  } else {
    setState('connected', 'ok');
  }

  var lines = [];
  if (notice && Date.now() < noticeUntil) lines.push(notice);
  if (!hostOk) {
    lines.push(st.error
      ? 'Host unavailable: ' + st.error
      : 'Host unavailable. Open Advanced and run Test Bridge.');
  } else if (st.connecting) {
    lines.push('Sending the connection handshake…');
  }
  if (paused) {
    if (pauseReason === 'count') {
      lines.push('Paused after 10 consecutive automatic sends.');
    } else if (pauseReason === 'rate') {
      lines.push('Paused by the 20-per-minute auto-send limit.');
    } else {
      lines.push('Paused. Choose Continue or Stop.');
    }
  }
  if (elsewhere && !stale) {
    lines.push('Connected in another browser or tab: ' + fmtOwner(owner));
    lines.push('Open that page to disconnect, or wait for it to finish.');
  }
  if (stale) lines.push('Stale lease. Connect will clean it up.');
  if (ownActive && leaseState === 'running') {
    var runningCmd = (st.running && st.running.cmd) || lease.cmd || '';
    if (runningCmd) lines.push('Running: ' + String(runningCmd).slice(0, 120));
    else if (lease.task_id) lines.push('Running: ' + lease.task_id);
  }
  if (hostOk && !tab) lines.push('Open a supported AI chat tab.');
  if (hostOk && tab && !tab.supported) {
    lines.push('This tab is not a supported AI chat. Open DeepSeek or Muse.');
  }
  els.detail.textContent = lines.join('\n');

  var canConnect = hostOk && !st.connecting && tab && tab.supported &&
    !!tab.binding_id && !!tab.session && !!tab.ai &&
    (!lease || leaseState === 'idle' || stale || !owner);
  var hideConnect = ownActive || (elsewhere && !stale);
  els.connect.hidden = hideConnect;
  els.connect.disabled = !canConnect;
  els.connect.textContent = st.connecting
    ? 'Connecting…'
    : (stale ? 'Clean up & Connect' : 'Connect');
  els.disconnect.hidden = !ownActive;
  els.interrupt.hidden = !(ownActive && leaseState === 'running');
  els.cont.hidden = !paused;
  els.stop.hidden = !paused;

  var mid = host.machine_id || st.machine_id || null;
  if (mid) {
    setMachineId(mid, host.hostname);
  } else {
    chrome.storage.local.get(['mh_machine_id', 'mh_local_hostname'], function (res) {
      var cached = res && res.mh_machine_id;
      setMachineId(cached || null, res && res.mh_local_hostname);
    });
  }
}

function refresh() {
  send('get_state', {}, function (st) {
    render(st);
  });
}

els.connect.addEventListener('click', function () {
  els.connect.disabled = true;
  els.connect.textContent = 'Connecting…';
  send('connect', {}, function (res) {
    if (!res || !res.ok) {
      var msg = 'Connect failed: ' + ((res && res.error) || 'unknown');
      if (res && res.busy && res.host && res.host.owner) {
        msg += ' Owner: ' + fmtOwner(res.host.owner) + '.';
      }
      setNotice(msg, 10000);
      refresh();
      return;
    }
    setNotice('Connected. Guide and configuration sent.', 5000);
    refresh();
  });
});

els.disconnect.addEventListener('click', function () {
  send('disconnect', {}, function (res) {
    setNotice(res && res.ok ? 'Disconnected.' : 'Disconnect failed.', 4000);
    refresh();
  });
});

els.interrupt.addEventListener('click', function () {
  if (!window.confirm('Interrupt the running command?')) return;
  send('interrupt', {}, function () { refresh(); });
});

els.cont.addEventListener('click', function () {
  send('continue', {}, function () {
    paused = false;
    pauseReason = '';
    setNotice('Continuing.', 3000);
    refresh();
  });
});

els.stop.addEventListener('click', function () {
  if (!window.confirm('Stop the current chain? Queued commands will be discarded.')) return;
  send('stop', {}, function () {
    paused = false;
    pauseReason = '';
    setNotice('Stopped.', 3000);
    refresh();
  });
});

// ---------- advanced: bridge test ----------
els.ping.addEventListener('click', function () {
  els.ping.disabled = true;
  els.ping.textContent = 'Testing…';
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    els.ping.disabled = false;
    els.ping.textContent = 'Test Bridge';
    setNotice('Bridge test timed out.', 8000);
    refresh();
  }, 15000);
  function finish(text, ok) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    els.ping.disabled = false;
    els.ping.textContent = 'Test Bridge';
    setNotice(text, ok ? 4000 : 8000);
    refresh();
  }
  send('ping_test', {}, function (res) {
    if (res && res.ok) finish('Bridge OK: ' + (res.hostname || 'host'), true);
    else finish('Bridge test failed: ' + ((res && res.error) || 'unknown'), false);
  });
});

// ---------- advanced: machine identity ----------
els.copymid.addEventListener('click', function () {
  var value = machineId;
  if (!value) {
    chrome.storage.local.get(['mh_machine_id'], function (res) {
      value = res && res.mh_machine_id;
      if (value) copyMachineId(value);
    });
    return;
  }
  copyMachineId(value);
});

function copyMachineId(value) {
  function done(ok) {
    var old = els.copymid.textContent;
    els.copymid.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(function () { els.copymid.textContent = old; }, 1500);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
    return;
  }
  try {
    var ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    done(document.execCommand('copy'));
    document.body.removeChild(ta);
  } catch (e) {
    done(false);
  }
}

// Keep the running/paused state fresh while the popup is open.
setInterval(refresh, 2500);
