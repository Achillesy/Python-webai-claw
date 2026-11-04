const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(path.dirname(__dirname), 'extension');
const ui = fs.readFileSync(path.join(root, 'background-ui.js'), 'utf8');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function listener() { return { addListener() {} }; }
const chrome = {
  runtime: {
    id: 'test',
    onConnect: listener(),
    onMessage: listener(),
    onInstalled: listener(),
    getURL: (p) => 'chrome-extension://test/' + p,
  },
  action: {
    onClicked: listener(),
    setBadgeText() {},
    setBadgeBackgroundColor() {},
    setTitle() {},
  },
  storage: { local: { get() {}, set() {} } },
  tabs: { query() {}, update() {}, create() {} },
  notifications: { onClicked: listener(), onClosed: listener(), create() {}, clear() {} },
};
const ctx = {
  chrome,
  navigator: { userAgent: 'Mozilla/5.0 Chrome/120' },
  console,
  URL,
  setTimeout,
  clearTimeout,
  Promise,
  Map,
  Set,
  Math,
  Date,
  JSON,
  String,
  Object,
  Array,
  RegExp,
  Error,
  parseInt,
  isNaN,
  encodeURIComponent,
};
ctx.self = ctx;
ctx.importScripts = () => vm.runInContext(ui, ctx);
vm.createContext(ctx);
vm.runInContext(bg, ctx);
if (vm.runInContext('typeof updateBadge', ctx) !== 'function') throw new Error('updateBadge missing');
if (vm.runInContext('typeof notifyDisconnected', ctx) !== 'function') throw new Error('notifyDisconnected missing');
if (vm.runInContext('typeof activeBinding', ctx) !== 'object') throw new Error('activeBinding missing');
console.log('background split load OK');
