// webai-claw onboarding page logic.
// Stays in setup state until the host answers; no dismiss button.

var statusEl = document.getElementById('status');
var hintEl = document.getElementById('status-hint');
var successEl = document.getElementById('success');

// Expected host build, from the bundled host-build.json (see popup.js).
// A host reporting a smaller build (or none, for pre-stamp installs) is
// outdated: the version alone cannot tell, it stays 1.2.6 across
// host-only fixes.
var expectedHostBuild = null;
fetch(chrome.runtime.getURL('host-build.json')).then(function (r) {
  return r.json();
}).then(function (j) {
  if (j && typeof j.build === 'number') expectedHostBuild = j.build;
}).catch(function () {});

document.querySelectorAll('[data-copy]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var text = document.getElementById(btn.getAttribute('data-copy')).textContent;
    function done(ok) { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    } else { done(false); }
  });
});

function setStatus(state, text, hint) {
  statusEl.textContent = text;
  statusEl.className = state;
  hintEl.textContent = hint || '';
}

function testConnection() {
  setStatus('', 'Checking…', '');
  successEl.style.display = 'none';
  try {
    chrome.runtime.sendMessage({ type: 'ping_test' }, function (res) {
      if (chrome.runtime.lastError) {
        setStatus('bad', 'Not connected', 'Could not reach the extension background: ' + chrome.runtime.lastError.message);
        return;
      }
      if (res && res.ok) {
        var mid = res.machine_id || '';
        var installedBuild = (typeof res.host_build === 'number') ? res.host_build : 0;
        if (typeof expectedHostBuild === 'number' && installedBuild < expectedHostBuild) {
          setStatus('warn', 'Connected — ' + (res.hostname || 'this computer'),
            'Host is out of date (build ' + installedBuild + ', this extension expects ' +
            expectedHostBuild + '). Reinstall the host program with the command above, ' +
            'then click Test Connection again.');
          successEl.style.display = 'none';
          return;
        }
        setStatus('ok', 'Connected — ' + (res.hostname || 'this computer'), '');
        document.getElementById('uuid').textContent = mid;
        document.getElementById('example').textContent =
          '{"claw":"exec","id":"ls-001","host":"<UUID>","cmd":"ls ~","v":3}';
        successEl.style.display = 'block';
      } else {
        setStatus('bad', 'Helper not detected', 'Install it with the command above, then click Test Connection again. (' + ((res && res.error) || 'unknown error') + ')');
      }
    });
  } catch (e) {
    setStatus('bad', 'Not connected', String(e && e.message || e));
  }
}

document.getElementById('test').addEventListener('click', testConnection);
document.getElementById('copy-uuid').addEventListener('click', function () {
  var btn = this;
  var text = document.getElementById('uuid').textContent;
  function done(ok) { btn.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(function () { btn.textContent = 'Copy UUID'; }, 1500); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
  } else { done(false); }
});

// Auto-check on open: reinstalls or already-set-up machines skip the setup state.
testConnection();
