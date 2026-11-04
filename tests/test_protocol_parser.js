const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.dirname(__dirname);
const src = fs.readFileSync(path.join(root, 'extension', 'protocol.js'), 'utf8');
const ctx = { self: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const parse = ctx.self.WebAIClawProtocol.parseBlock;

const block = parse('{"claw":"write_file","id":"w1","host":"12345678-1234-1234-1234-123456789abc","path":"/tmp/a.txt","content":"hello","overwrite":true,"v":3}');
if (!block || block.kind !== 'write_file' || block.content !== 'hello' || block.overwrite !== true) {
  throw new Error('write_file parse failed: ' + JSON.stringify(block));
}
const empty = parse('{"claw":"write_file","id":"w2","host":"12345678-1234-1234-1234-123456789abc","path":"/tmp/a.txt","content":"","v":3}');
if (!empty || empty.content !== '') throw new Error('empty content must be valid');
if (parse('{"claw":"exec","id":"e1","host":"h","cmd":"pwd","v":2}') !== null) {
  throw new Error('v2 must be rejected');
}
console.log('protocol parser OK');
