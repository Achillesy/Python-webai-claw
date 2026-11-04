/* webai-claw protocol v3 parser.
 *
 * Loaded as a content script before content.js and imported by the service
 * worker. Keep this file dependency-free so it works in both contexts.
 */
(function (root) {
  'use strict';

  var VERSION = 3;
  var KINDS = ['exec', 'probe', 'attach', 'diag', 'summary', 'write_file'];
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function parseBlock(text) {
    text = String(text || '').replace(/^\s+/, '');
    var nl = text.indexOf('\n');
    var first = nl === -1 ? text : text.slice(0, nl);
    var head;
    try { head = JSON.parse(first); } catch (e) { return null; }
    if (!head || (typeof head.id !== 'string' && typeof head.id !== 'number') || !head.id) return null;
    if (KINDS.indexOf(head.claw) === -1) return null;
    if (head.v !== VERSION) return null;
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
      content: (typeof head.content === 'string') ? head.content : null,
      encoding: head.encoding === 'base64' ? 'base64' : 'utf8',
      overwrite: head.overwrite === true,
      expected_sha256: (typeof head.expected_sha256 === 'string') ? head.expected_sha256 : null,
      backup: head.backup !== false,
      cmd: cmdFromHead !== null ? cmdFromHead : cmdFromBody
    };
  }

  root.WebAIClawProtocol = {
    VERSION: VERSION,
    KINDS: KINDS.slice(),
    UUID_RE: UUID_RE,
    parseBlock: parseBlock
  };
})(typeof self !== 'undefined' ? self : this);
