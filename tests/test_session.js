const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.dirname(__dirname);
const src = fs.readFileSync(path.join(root, 'extension', 'session.js'), 'utf8');
const ctx = { self: {}, URL, Date, Math, String, crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000000' } };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const s = ctx.self.WebAIClawSession;

if (s.normalizeSession('https://muse.ai/thread/a/?x=1') !== 'https://muse.ai/thread/a') {
  throw new Error('normalizeSession failed');
}
if (!s.isProvisionalSession('https://muse.ai/thread/new')) throw new Error('muse provisional');
if (!s.isProvisionalSession('https://chat.deepseek.com/a/chat')) throw new Error('deepseek provisional');
if (s.isProvisionalSession('https://chat.deepseek.com/a/chat/s/1234')) throw new Error('real session');
const uuid = '12345678-1234-1234-1234-123456789abc';
if (s.targetGate({ host: uuid }, uuid, /^[0-9a-f-]{36}$/i) !== 'pass') throw new Error('target pass');
if (s.targetGate({ host: uuid }, '00000000-0000-0000-0000-000000000000', /^[0-9a-f-]{36}$/i) !== 'ignore') throw new Error('target ignore');
console.log('session helpers OK');
