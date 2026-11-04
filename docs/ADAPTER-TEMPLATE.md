# Site adapter template

Copy this skeleton into `extension/adapters/<site>.js` when adding a
supported web AI. Do not copy selectors from another adapter blindly:
verify every selector live with a `probe` block (AI-AGENT.md §2.2) first,
then write the adapter, then verify the full round-trip (see
`CONTRIBUTING.md`). The core (`content.js`) does not change for a new
site; `extension/adapter-check.js` validates this interface at load time
and disables the content script with a named error if a required method
is missing.

Manifest edits for the new site (all in `extension/manifest.json`):

1. Add the adapter file to `content_scripts[].js`, after `adapter-check.js`
   and before `content.js`.
2. Add the site origin to `content_scripts[].matches`.
3. Add the same origin to `host_permissions`.

```js
// webai-claw adapter: <site hostname>
(function () {
  'use strict';
  var reg = (window.__webaiClawAdapters = window.__webaiClawAdapters || {});

  function isVisible(el) {
    if (!el) return false;
    try {
      if (el.getClientRects) return el.getClientRects().length > 0;
      return el.offsetParent !== null;
    } catch (e) {
      return false;
    }
  }

  reg['<site hostname>'] = {
    name: '<ai type>',
    ai: '<ai type>',

    // Required. Only block-level code elements; never inline <code>.
    findBlocks: function () {
      return Array.prototype.slice.call(document.querySelectorAll('pre code'));
    },

    // Required. Conversation key: origin + pathname, no query/hash/trailing slash.
    sessionKey: function () {
      var p = location.pathname.replace(/\/+$/, '');
      return location.origin + p;
    },

    // Optional, but a new site should implement it: report whether a URL
    // has no real conversation id yet (new-chat page). Without it, session
    // adoption falls back to the built-in muse/deepseek rules in session.js.
    isProvisionalSession: function (value) {
      try {
        var u = new URL(value);
        if (u.hostname !== '<site hostname>') return false;
        var p = u.pathname.replace(/\/+$/, '');
        return p === '' || p === '/new';
      } catch (e) {
        return false;
      }
    },

    // Required. Write text into the chat input; return true on success.
    fillResult: function (text) {
      var ta = document.querySelector('textarea');
      if (!ta) return false;
      var setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, (ta.value ? ta.value.replace(/\s+$/, '') + '\n' : '') + text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },

    // Required. Click the send button; return true only if a click happened.
    clickSend: function () {
      var btns = document.querySelectorAll('button[aria-label*="Send"]');
      for (var i = btns.length - 1; i >= 0; i--) {
        if (btns[i] && !btns[i].disabled && isVisible(btns[i])) {
          btns[i].click();
          return true;
        }
      }
      return false;
    },

    // Required. Inject a file as a chat attachment; return {ok, why?}.
    // Reject here, with a reason, any type the site frontend rejects, so
    // the bridge does not wrongly report success after injection.
    uploadFile: function (file) {
      var inputs = document.querySelectorAll('input[type=file]');
      if (!inputs.length) return { ok: false, why: 'page has no input[type=file]' };
      var blob = new Blob([file.bytes], { type: file.mime || 'application/octet-stream' });
      var f = new File([blob], file.name, { type: file.mime || 'application/octet-stream' });
      var dt = new DataTransfer();
      dt.items.add(f);
      try {
        inputs[0].files = dt.files;
      } catch (e) {
        return { ok: false, why: 'failed to write input.files: ' + e.message };
      }
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    },

    // Optional. Detect the site stop/interrupt button.
    isStopButton: function (el) {
      if (!el) return false;
      var label = (el.getAttribute && el.getAttribute('aria-label')) || '';
      return /stop|abort/i.test(label + ' ' + (el.textContent || ''));
    },

    // Optional. True while the AI is still producing output.
    isGenerating: function () {
      var btns = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i] && isVisible(btns[i]) && this.isStopButton(btns[i])) return true;
      }
      return false;
    },

    // Optional. True while an upload is in progress.
    isUploading: function () { return false; },

    // Optional. True when the composer is empty; used to verify the
    // Connect handshake was actually sent.
    isInputEmpty: function () {
      var ta = document.querySelector('textarea');
      return ta ? !String(ta.value || '').trim() : true;
    }
  };
})();
```

After adding the adapter, run `sh tests/run_all.sh` and add the adapter to
`tests/test_adapters.js` (register + required-method + provisional checks)
before claiming the site works. A live round-trip on the real site is still
required: code-identical to another adapter is not verification.
