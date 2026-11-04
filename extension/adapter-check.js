/* webai-claw adapter interface check.
 *
 * Loaded as a content script after protocol/session/format and before the
 * site adapters and content.js, and importable in Node tests. Keep this
 * file dependency-free so it works in both contexts.
 *
 * A site adapter is the only per-site code in the extension. The core
 * (content.js) must not change when a site is added; it only calls the
 * interface below. Validating the interface at load time turns a silent
 * runtime failure (a missing findBlocks that makes scan() return early,
 * a missing uploadFile that makes attach fail) into one clear console
 * error naming the missing methods.
 */
(function (root) {
  'use strict';

  var REQUIRED = ['findBlocks', 'sessionKey', 'fillResult', 'clickSend', 'uploadFile'];
  var OPTIONAL = ['isStopButton', 'isGenerating', 'isUploading', 'isInputEmpty', 'isProvisionalSession'];

  function validate(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      return { ok: false, missing: REQUIRED.slice(), warnings: [] };
    }
    var missing = [];
    for (var i = 0; i < REQUIRED.length; i++) {
      if (typeof adapter[REQUIRED[i]] !== 'function') missing.push(REQUIRED[i]);
    }
    var warnings = [];
    for (var j = 0; j < OPTIONAL.length; j++) {
      if (adapter[OPTIONAL[j]] !== undefined && typeof adapter[OPTIONAL[j]] !== 'function') {
        warnings.push(OPTIONAL[j] + ' is present but not a function; it will be ignored');
      }
    }
    if (typeof adapter.isInputEmpty !== 'function') {
      warnings.push('isInputEmpty is missing; Connect handshake verification falls back to assuming the composer was cleared');
    }
    if (typeof adapter.isProvisionalSession !== 'function') {
      warnings.push('isProvisionalSession is missing; session adoption falls back to the built-in muse/deepseek rules in session.js');
    }
    return { ok: missing.length === 0, missing: missing, warnings: warnings };
  }

  root.WebAIClawAdapterCheck = {
    REQUIRED: REQUIRED.slice(),
    OPTIONAL: OPTIONAL.slice(),
    validate: validate
  };
})(typeof self !== 'undefined' ? self : this);
