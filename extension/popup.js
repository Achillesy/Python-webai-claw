// webai-claw extension popup
// Connection state, lease status, auto-send, pause controls, and the bridge test.

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

chrome.storage.local.get(['mh_auto_send', 'mh_auto_send_attachments', 'mh_paused'], function (res) {
  els.auto.checked = !(res && res.mh_auto_send === false);
  els.attachAuto.checked = !!(res && res.mh_auto_send_attachments === true);
  paused = !!(res && res.mh_paused);
  refresh();
});

els.auto.addEventListener('change', function () {
  chrome.storage.local.set({ mh_auto_send: els.auto.checked });
});
els.attachAuto.addEventListener('change', function () {
  chrome.storage.local.set({ mh_auto_send_attachments: els.attachAuto.checked });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.mh_paused) {
    paused = !!changes.mh_paused.newValue;
    refresh();
  }
});

function fmtOwner(o) {
  if (!o) return '?';
  return (o.browser ? o.browser + ' / ' : '') +
    (o.session || '?') + ' / ' + (o.ai || '?');
}

function render(st) {
  st = st || { ok: false, error: 'no response' };
  var host = st.host || {};
  var lease = st.lease || null;
  var tab = st.tab || null;
  var active = st.active || null;
  var owner = lease && lease.owner ? lease.owner : null;
  var state = lease ? (lease.state || 'idle') : 'idle';
  var stale = !!(lease && state !== 'idle' && lease.stale);
  var hostOk = !!st.ok && !!host.machine_id;

  if (hostOk) {
    els.host.textContent = (host.hostname || '?') + ' / ' +
      (host.platform || '?') + ' / ' + (host.shell || '?') +
      ' / host v' + (host.host_version || '?');
    els.host.className = 'ok';
  } else {
    els.host.textContent = 'not connected (' + (st.error || 'unknown') + ')';
    els.host.className = 'err';
  }

  if (!hostOk) {
    els.state.textContent = 'host unavailable';
    els.state.className = 'err';
  } else if (state === 'idle') {
    els.state.textContent = 'idle (this machine is free)';
    els.state.className = 'ok';
  } else if (state === 'running') {
    els.state.textContent = 'running';
    els.state.className = 'warn';
  } else {
    els.state.textContent = 'connected';
    els.state.className = 'ok';
  }

  var lines = [];
  if (lease && state !== 'idle') {
    lines.push('owner: ' + fmtOwner(owner));
    if (lease.task_id) {
      lines.push('task: ' + lease.task_id +
        (lease.cmd ? ' — ' + String(lease.cmd).slice(0, 100) : ''));
    }
    if (st.running) lines.push('running: ' + String(st.running.cmd || '').slice(0, 120));
    if (stale) lines.push('lease is stale/orphaned; Connect will clean it up.');
  }
  if (tab) {
    lines.push('this tab: ' + (tab.supported
      ? ((tab.ai || '?') + ' / ' + (tab.session || '?'))
      : 'not a supported AI chat (open DeepSeek or Muse)'));
  } else {
    lines.push('this tab: unavailable');
  }
  if (paused) lines.push('PAUSED. Choose Continue or Stop.');
  els.detail.textContent = lines.join('\n');

  var ownActive = !!(active && tab && active.binding_id === tab.binding_id);
  var canConnect = hostOk && tab && tab.supported && !!tab.binding_id && !!tab.session && !!tab.ai &&
    (!lease || state === 'idle' || stale || !owner);
  els.connect.hidden = false;
  els.connect.disabled = !canConnect;
  els.connect.textContent = stale ? 'Clean up & Connect' : 'Connect';
  els.disconnect.hidden = !ownActive;
  els.interrupt.hidden = !(ownActive && state === 'running');
  els.cont.hidden = !paused;
  els.stop.hidden = !paused;

  var mid = host.machine_id || null;
  if (mid) {
    els.mid.textContent = (host.hostname || '?') + ' / ' + mid.slice(0, 8) + '…';
    els.mid.title = mid;
  } else {
    chrome.storage.local.get(['mh_machine_id', 'mh_local_hostname'], function (res) {
      var m = res && res.mh_machine_id;
      if (m) {
        els.mid.textContent = ((res.mh_local_hostname || '?') + ' / ' + m.slice(0, 8) + '…');
        els.mid.title = m;
      } else {
        els.mid.textContent = 'unknown (click Test Bridge)';
        els.mid.title = '';
      }
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
        msg += '\nOwner: ' + fmtOwner(res.host.owner) +
          '\nGo to that browser/page to disconnect, or wait for it to finish.';
      }
      els.detail.textContent = msg;
      refresh();
      return;
    }
    els.detail.textContent = 'Connected. The guide and local config were attached to the chat; ' +
      'the message was sent if auto-send is on.';
    refresh();
  });
});

els.disconnect.addEventListener('click', function () {
  send('disconnect', {}, function () { refresh(); });
});

els.interrupt.addEventListener('click', function () {
  if (!window.confirm('Interrupt the running command?')) return;
  send('interrupt', {}, function () { refresh(); });
});

els.cont.addEventListener('click', function () {
  send('continue', {}, function () {
    paused = false;
    refresh();
  });
});

els.stop.addEventListener('click', function () {
  if (!window.confirm('Stop the current chain? Queued commands will be discarded.')) return;
  send('stop', {}, function () {
    paused = false;
    refresh();
  });
});

// ---------- bridge test ----------
els.ping.addEventListener('click', function () {
  els.host.textContent = 'testing…';
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    els.host.textContent = 'no reply (background silent for 15s)';
    els.host.className = 'err';
  }, 15000);
  function finish(text, cls) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    els.host.textContent = text;
    els.host.className = cls || '';
  }
  send('ping_test', {}, function (res) {
    if (res && res.ok) finish('connected ' + (res.hostname || ''), 'ok');
    else finish('failed: ' + ((res && res.error) || 'unknown'), 'err');
  });
});

// ---------- machine identity ----------
els.copymid.addEventListener('click', function () {
  try {
    chrome.storage.local.get(['mh_machine_id'], function (res) {
      var mid = res && res.mh_machine_id;
      if (!mid) { els.mid.textContent = 'unknown (click Test Bridge)'; return; }
      function done(ok) { els.mid.textContent = ok ? 'Copied' : 'Copy failed'; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(mid).then(function () { done(true); }, function () { done(false); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = mid;
        document.body.appendChild(ta);
        ta.select();
        try { done(document.execCommand('copy')); } catch (e) { done(false); }
        document.body.removeChild(ta);
      }
    });
  } catch (e) {}
});

// keep the running/paused state fresh while the popup is open
setInterval(refresh, 2500);
