/* Plain-text result formatting for the chat input.
 *
 * Kept separate from DOM and transport code so it can be tested with ordinary
 * objects. Commands are looked up by id through the caller-provided map.
 */
(function (root) {
  'use strict';

  var MAX_RESULT = 6000;
  var KEEP_HEAD = 2000;
  var KEEP_TAIL = 3500;

  function clip(value) {
    if (value == null) return '';
    value = String(value);
    if (value.length <= MAX_RESULT) return value;
    return value.slice(0, KEEP_HEAD) + '\n\n…(omitted)…\n\n' + value.slice(value.length - KEEP_TAIL);
  }

  function formatDiag(res) {
    var lines = [];
    lines.push('[claw:diag] id=' + res.id + ' host=' + (res.hostname || '?') +
               ' platform=' + (res.platform || '?') + ' pid=' + (res.pid || '?'));
    if (res.machine_id) lines.push('machine: ' + res.machine_id);
    if (res.session) lines.push('session: ' + res.session + '  ai: ' + (res.ai || '?'));
    if (res.lease) {
      lines.push('lease: state=' + (res.lease.state || '?') +
                 ' binding=' + ((res.lease.owner || {}).binding_id || '-') +
                 ' task=' + (res.lease.task_id || '-'));
    }
    lines.push('history: ' + res.history_size + '/' + res.history_limit);
    if (res.recent && res.recent.length) {
      lines.push('recent:');
      res.recent.forEach(function (r) {
        var t = r.ts ? new Date(r.ts * 1000).toTimeString().slice(0, 8) : '--:--:--';
        lines.push('  ' + (r.id || '?') + '  ' + (r.ok ? 'ok' : 'fail') + '  ' + t);
      });
    }
    if (res.log_tail) {
      lines.push('log_tail:');
      lines.push(res.log_tail.replace(/\s+$/, ''));
    }
    return lines.join('\n');
  }

  function formatResult(res, cmdById) {
    if (res.history_size !== undefined && res.log_tail !== undefined) {
      return formatDiag(res);
    }
    if (res.kind === 'summary') {
      var summaryLines = ['[claw:summary] id=' + res.id +
        ' ok=' + (res.ok ? 'true' : 'false')];
      if (res.handoff) summaryLines.push('handoff: ' + res.handoff);
      summaryLines.push('Next: open a new chat and click Connect; the attachment will include handoff.md.');
      return summaryLines.join('\n');
    }
    var secs = ((res.duration_ms || 0) / 1000).toFixed(1);
    var lines = [];
    var head = '[claw:result] id=' + res.id + ' ok=' + (res.ok ? 'true' : 'false') +
               ' exit=' + res.exit_code + ' duration=' + secs + 's';
    if (res.machine_id) head += ' machine=' + res.machine_id;
    if (res.session) head += ' session=' + res.session;
    if (res.ai) head += ' ai=' + res.ai;
    if (res.platform) head += ' platform=' + res.platform;
    if (res.hostname) head += ' host=' + res.hostname;
    if (res.timeout) head += ' timeout=' + res.timeout;
    if (res.approved) head += ' approved=true';
    if (res.killed) head += ' killed=true';
    lines.push(head);
    var cmd = cmdById && cmdById[res.id];
    if (cmd) {
      var first = cmd.split('\n')[0];
      var count = cmd.split('\n').length;
      var extra = count > 1 ? ' (' + count + ' lines total)' : '';
      lines.push('cmd: ' + (first.length > 120 ? first.slice(0, 120) + '…' : first) + extra);
    }
    if (res.error) lines.push('error: ' + res.error);
    if (res.stdout) lines.push(res.stdout.replace(/\s+$/, ''));
    if (res.stderr) {
      lines.push('');
      lines.push('stderr:');
      lines.push(clip(res.stderr.replace(/\s+$/, '')));
    }
    return lines.join('\n');
  }

  root.WebAIClawFormat = {
    clip: clip,
    formatDiag: formatDiag,
    formatResult: formatResult
  };
})(typeof self !== 'undefined' ? self : this);
