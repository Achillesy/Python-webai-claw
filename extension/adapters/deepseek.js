// webai-claw adapter: chat.deepseek.com
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

  function acceptAllows(input, name, mime) {
    var accept = (input.getAttribute('accept') || '').trim();
    if (!accept) return true;
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    var ext = m ? m[1].toLowerCase() : '';
    var parts = accept.split(',');
    for (var i = 0; i < parts.length; i++) {
      var tok = parts[i].trim().toLowerCase();
      if (!tok) continue;
      if (tok === '*' || tok === '*/*') return true;
      if (tok.charAt(0) === '.') {
        if (ext && tok === '.' + ext) return true;
      } else if (tok.indexOf('/') !== -1) {
        var mt = (mime || '').toLowerCase();
        if (tok.slice(-2) === '/*' && mt.indexOf(tok.slice(0, -1)) === 0) return true;
        if (mt && tok === mt) return true;
      } else if (ext && tok === ext) {
        return true;
      }
    }
    return false;
  }

  reg['chat.deepseek.com'] = {
    name: 'deepseek',
    ai: 'deepseek',

    // Only block-level code. Do NOT scan inline <code>: a JSON fragment in
    // prose must never be mistaken for a command block. Prefer the inner
    // <code> (it excludes any language label/copy button in the <pre>).
    findBlocks: function () {
      var els = document.querySelectorAll('pre code');
      if (els.length) return Array.prototype.slice.call(els);
      return Array.prototype.slice.call(document.querySelectorAll('pre'));
    },

    // Conversation key = origin + pathname, no query/hash/trailing slash.
    sessionKey: function () {
      var p = location.pathname.replace(/\/+$/, '');
      return location.origin + p;
    },

    // A provisional session has no real chat id yet: the bare origin or
    // /a/chat, or a /chat/s/new placeholder. The core adopts the first
    // real session for the same binding instead of disconnecting.
    isProvisionalSession: function (value) {
      try {
        var u = new URL(value);
        if (u.hostname !== 'chat.deepseek.com') return false;
        var p = u.pathname.replace(/\/+$/, '');
        var m = /^(\/a)?\/chat\/s\/([^/]+)$/.exec(p);
        return !m || m[2] === 'new';
      } catch (e) {
        return false;
      }
    },


    // DeepSeek attachment limits (verified 2026-10-02, enforced by the web frontend):
    // - No archives: zip / rar / 7z / tar / gz / bz2 / xz / tgz etc. —
    //   the frontend rejects them outright. Block here and tell the user to
    //   extract first, so the file isn't rejected after landing in the input
    //   while the bridge wrongly reports success.
    // - Other types follow input[type=file]'s accept (txt verified to upload).
    uploadFile: function (file) {
      // file: {name, mime, bytes(Uint8Array)}
      var name = file.name || '';
      var m = /\.([a-z0-9]+)$/i.exec(name);
      var ext = m ? m[1].toLowerCase() : '';
      var ARCHIVE_EXTS = {
        'zip': 1, 'rar': 1, '7z': 1, 'tar': 1, 'gz': 1,
        'bz2': 1, 'xz': 1, 'tgz': 1, 'tbz2': 1, 'txz': 1, 'cab': 1
      };
      if (ARCHIVE_EXTS[ext]) {
        return { ok: false, why: 'DeepSeek rejects archives (' + name + '); please extract and send the inner files' };
      }
      var inputs = document.querySelectorAll('input[type=file]');
      if (!inputs.length) return { ok: false, why: 'page has no input[type=file]' };
      var input = inputs[0];
      if (!acceptAllows(input, name, file.mime)) {
        return { ok: false, why: 'DeepSeek input does not accept this file type (accept=' +
          (input.getAttribute('accept') || '') + ')' };
      }
      var blob, f;
      try {
        blob = new Blob([file.bytes], { type: file.mime || 'application/octet-stream' });
        f = new File([blob], file.name, { type: file.mime || 'application/octet-stream' });
      } catch (e) {
        return { ok: false, why: 'failed to construct File: ' + e.message };
      }
      var dt = new DataTransfer();
      dt.items.add(f);
      try {
        input.files = dt.files;
      } catch (e) {
        return { ok: false, why: 'failed to write input.files: ' + e.message };
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    },

    fillResult: function (text) {
      var ta = document.querySelector('textarea');
      if (!ta) return false;
      var cur = ta.value || '';
      var next = cur ? cur.replace(/\s+$/, '') + '\n' + text : text;
      var setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, next);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },

    isStopButton: function (el) {
      if (!el) return false;
      var label = (el.getAttribute && el.getAttribute('aria-label')) || '';
      var txt = (el.textContent || '').trim();
      return /stop|abort|\u505c\u6b62|\u4e2d\u65ad|\u4e2d\u6b62/i.test(label + ' ' + txt);
    },

    isGenerating: function () {
      var btns = document.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b && isVisible(b) && this.isStopButton(b)) return true;
      }
      return false;
    },

    isInputEmpty: function () {
      var ta = document.querySelector('textarea');
      if (!ta) return true;
      return !String(ta.value || '').trim();
    },

    clickSend: function () {
      // Localized DOM labels are included as Unicode escapes. They are site
      // selectors, not user-facing copy.
      var sels = [
        'button[aria-label*="Send"]',
        'button[aria-label*="\u53d1\u9001"]',
        'button[type="submit"]'
      ];
      var sawSend = false;
      for (var i = 0; i < sels.length; i++) {
        var btns = document.querySelectorAll(sels[i]);
        for (var j = btns.length - 1; j >= 0; j--) {
          var b = btns[j];
          if (!b || !isVisible(b)) continue;
          sawSend = true;
          if (!b.disabled) {
            b.click();
            return true;
          }
        }
      }
      // Some localized layouts expose the send control only through its
      // accessible label or visible text. Use the last visible send-like
      // button, but never report success for a disabled control.
      var all = document.querySelectorAll('button, [role="button"]');
      for (var k = all.length - 1; k >= 0; k--) {
        var candidate = all[k];
        if (!candidate || !isVisible(candidate)) continue;
        var label = ((candidate.getAttribute('aria-label') || '') + ' ' +
          (candidate.getAttribute('title') || '') + ' ' +
          (candidate.textContent || '')).toLowerCase();
        if (label.indexOf('send') === -1 && label.indexOf('\u53d1\u9001') === -1) continue;
        sawSend = true;
        if (!candidate.disabled) {
          candidate.click();
          return true;
        }
      }
      if (sawSend) return false;
      // Enter is a last resort only when the page exposes no send control at
      // all. If a send control exists but is disabled (for example while an
      // attachment is uploading), return false so the caller retries.
      var ta = document.querySelector('textarea');
      if (!ta) return false;
      try {
        ta.focus();
        var ev = function (t) {
          return new KeyboardEvent(t, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true, composed: true
          });
        };
        ta.dispatchEvent(ev('keydown'));
        ta.dispatchEvent(ev('keypress'));
        ta.dispatchEvent(ev('keyup'));
        return true;
      } catch (e) {
        return false;
      }
    }
  };
})();
