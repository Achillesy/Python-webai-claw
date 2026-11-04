/* Page binding/session helpers shared by the content script.
 *
 * Kept dependency-free so the rules are testable outside the full content
 * script. The adapter is passed explicitly; this module does not own DOM state.
 */
(function (root) {
  'use strict';

  function normalizeSession(value, base) {
    try {
      var u = new URL(value, base || (root.location && root.location.href));
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch (e) {
      return String(value || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
  }

  function sessionKeyOf(adapter, loc) {
    try {
      if (adapter && typeof adapter.sessionKey === 'function') {
        return normalizeSession(adapter.sessionKey(), loc && loc.href);
      }
    } catch (e) {}
    if (loc) return normalizeSession(loc.origin + loc.pathname);
    return '';
  }

  function aiType(adapter) {
    return (adapter && (adapter.ai || adapter.name)) || 'unknown';
  }

  function sameOrigin(a, b) {
    try { return new URL(a).origin === new URL(b).origin; }
    catch (e) { return false; }
  }

  function isProvisionalSession(value, adapter) {
    // A new site declares its own provisional pattern on its adapter, so
    // adding a site never needs a change to this shared module. Adapters
    // without the hook fall back to the built-in muse/deepseek rules.
    try {
      if (adapter && typeof adapter.isProvisionalSession === 'function') {
        return !!adapter.isProvisionalSession(value);
      }
    } catch (e) {}
    try {
      var u = new URL(value);
      var p = u.pathname.replace(/\/+$/, '');
      if (u.hostname === 'muse.ai') {
        return p === '' || p === '/thread/new' || p === '/new';
      }
      if (u.hostname === 'chat.deepseek.com') {
        var m = /^(\/a)?\/chat\/s\/([^/]+)$/.exec(p);
        return !m || m[2] === 'new';
      }
    } catch (e) {}
    return false;
  }

  function makeBindingId() {
    try { return 'p-' + crypto.randomUUID(); }
    catch (e) { return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  }

  function targetGate(block, localMachineId, uuidRe) {
    if (!localMachineId) return 'defer';
    var got = String(block.host || '').trim().toLowerCase();
    if (!uuidRe.test(got)) return 'missing';
    if (got !== String(localMachineId).trim().toLowerCase()) return 'ignore';
    return 'pass';
  }

  root.WebAIClawSession = {
    normalizeSession: normalizeSession,
    sessionKeyOf: sessionKeyOf,
    aiType: aiType,
    sameOrigin: sameOrigin,
    isProvisionalSession: isProvisionalSession,
    makeBindingId: makeBindingId,
    targetGate: targetGate
  };
})(typeof self !== 'undefined' ? self : this);
