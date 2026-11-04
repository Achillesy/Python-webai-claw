const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.dirname(__dirname);
const src = fs.readFileSync(path.join(root, 'extension', 'format.js'), 'utf8');
const ctx = { self: {}, JSON, String, Date, Math };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const f = ctx.self.WebAIClawFormat;

const write = f.formatResult({
  id: 'w1', ok: true, exit_code: 0, duration_ms: 12,
  stdout: 'wrote /tmp/a\nsize: 5 bytes\nsha256: abc',
}, { w1: 'write_file: /tmp/a' });
if (!write.includes('[claw:result] id=w1 ok=true exit=0') || !write.includes('cmd: write_file: /tmp/a')) {
  throw new Error('write result format failed: ' + write);
}
const diag = f.formatDiag({
  id: 'd1', hostname: 'h', platform: 'darwin', pid: 1,
  history_size: 2, history_limit: 500, lease: { state: 'idle' },
  recent: [{ id: 'x', ok: true, ts: 1 }],
});
if (!diag.includes('lease: state=idle') || !diag.includes('recent:')) {
  throw new Error('diag format failed: ' + diag);
}
console.log('format helpers OK');
