const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.dirname(__dirname);
const ext = path.join(root, 'extension');
const ctx = {
  self: null, window: {}, document: {}, location: { hostname: 'muse.ai', href: 'https://muse.ai/', pathname: '/' },
  URL, Date, Math, String, console,
};
ctx.self = ctx;
vm.createContext(ctx);
for (const file of ['adapter-check.js', 'session.js', 'adapters/muse.js', 'adapters/deepseek.js']) {
  vm.runInContext(fs.readFileSync(path.join(ext, file), 'utf8'), ctx);
}
const check = ctx.self.WebAIClawAdapterCheck;
const session = ctx.self.WebAIClawSession;
const adapters = ctx.window.__webaiClawAdapters;
const muse = adapters['muse.ai'];
const deepseek = adapters['chat.deepseek.com'];

if (!muse || !deepseek) throw new Error('adapters did not register');
for (const [name, adapter] of [['muse', muse], ['deepseek', deepseek]]) {
  const result = check.validate(adapter);
  if (!result.ok) throw new Error(name + ' adapter incomplete: ' + result.missing.join(','));
}
const fake = { findBlocks() {}, sessionKey() { return ''; }, fillResult() { return true; }, clickSend() { return true; } };
const fakeResult = check.validate(fake);
if (fakeResult.ok || fakeResult.missing.join(',') !== 'uploadFile') {
  throw new Error('incomplete adapter must report missing uploadFile, got: ' + JSON.stringify(fakeResult));
}
if (check.validate(null).ok) throw new Error('null adapter must fail validation');

// Provisional sessions are now declared by the adapter, not by session.js
// hardcoding the site. The no-adapter fallback keeps the old behaviour.
if (!session.isProvisionalSession('https://muse.ai/thread/new', muse)) throw new Error('muse provisional via adapter');
if (session.isProvisionalSession('https://muse.ai/thread/1234', muse)) throw new Error('muse real session via adapter');
if (!session.isProvisionalSession('https://chat.deepseek.com/a/chat', deepseek)) throw new Error('deepseek provisional via adapter');
if (!session.isProvisionalSession('https://chat.deepseek.com/a/chat/s/new', deepseek)) throw new Error('deepseek new placeholder via adapter');
if (session.isProvisionalSession('https://chat.deepseek.com/a/chat/s/1234', deepseek)) throw new Error('deepseek real session via adapter');
if (!session.isProvisionalSession('https://muse.ai/thread/new')) throw new Error('muse provisional fallback without adapter');
if (!session.isProvisionalSession('https://chat.deepseek.com/a/chat')) throw new Error('deepseek provisional fallback without adapter');
console.log('adapter interface OK');
