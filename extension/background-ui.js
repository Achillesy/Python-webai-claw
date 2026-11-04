/* Global toolbar badge and site-level notifications.
 *
 * Loaded by background.js with importScripts(). It intentionally has no
 * networking or command-execution logic.
 */
const LONG_TASK_BADGE_MS = 5000;
let badgeTimer = null;
const notificationTabs = new Map();
const notificationCooldowns = new Map();

function clearBadgeTimer() {
  if (badgeTimer) {
    clearTimeout(badgeTimer);
    badgeTimer = null;
  }
}

function setActionTitle(title) {
  try { chrome.action.setTitle({ title }); } catch (e) {}
}

function updateBadge() {
  clearBadgeTimer();
  if (!activeBinding) {
    try { chrome.action.setBadgeText({ text: "" }); } catch (e) {}
    setActionTitle("webai-claw: not connected");
    return;
  }
  if (running) {
    const elapsed = Date.now() - (running.startTime || 0);
    if (elapsed >= LONG_TASK_BADGE_MS) {
      try { chrome.action.setBadgeText({ text: "..." }); } catch (e) {}
      try { chrome.action.setBadgeBackgroundColor({ color: "#b26a00" }); } catch (e) {}
      setActionTitle("webai-claw: waiting for native host");
      return;
    }
    badgeTimer = setTimeout(updateBadge, Math.max(0, LONG_TASK_BADGE_MS - elapsed));
  }
  try { chrome.action.setBadgeText({ text: "✓" }); } catch (e) {}
  try { chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" }); } catch (e) {}
  setActionTitle(running ? "webai-claw: connected (command running)" : "webai-claw: connected");
}

function siteOfUrl(url) {
  try { return new URL(url).hostname || "AI chat"; }
  catch (e) { return "AI chat"; }
}

function siteOfInfo(info) {
  return siteOfUrl((info && info.url) || "");
}

function isTabActive(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        resolve(!!(tabs && tabs[0] && tabs[0].id === tabId));
      });
    } catch (e) { resolve(false); }
  });
}

function createNotification(kind, site, tabId, message, force) {
  if (!chrome.notifications || !chrome.notifications.create) return;
  const key = kind + "|" + tabId + "|" + site;
  const now = Date.now();
  const cooldown = kind === "disconnected" ? 5000 : 10000;
  if (!force && now - (notificationCooldowns.get(key) || 0) < cooldown) return;
  notificationCooldowns.set(key, now);
  const id = "wc-" + kind + "-" + now + "-" + Math.random().toString(36).slice(2, 7);
  notificationTabs.set(id, tabId);
  try {
    chrome.notifications.create(id, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "webai-claw",
      message: message,
      priority: 2
    }, function () {});
  } catch (e) {}
}

function notifyDisconnected(site, tabId) {
  createNotification("disconnected", site, tabId, "Disconnected from " + site);
}

function notifyWaitingIfBackground(site, tabId) {
  isTabActive(tabId).then((active) => {
    if (!active) createNotification("waiting", site, tabId, "Waiting for your next command");
  });
}
