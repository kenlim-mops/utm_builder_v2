const PAGE_MENU = "runpod-utm-page";
const LINK_MENU = "runpod-utm-link";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: PAGE_MENU, title: "Create governed UTM for this page", contexts: ["page"] });
    chrome.contextMenus.create({ id: LINK_MENU, title: "Create governed UTM for this link", contexts: ["link"] });
  });
});

async function rememberTarget(tab, url) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  await chrome.storage.session.set({
    pendingTarget: { url, title: tab?.title || "", capturedAt: new Date().toISOString() },
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  await rememberTarget(tab, tab.url);
  if (tab.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === LINK_MENU ? info.linkUrl : info.pageUrl || tab?.url;
  await rememberTarget(tab, url);
  if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "capture-active-tab") return false;
  chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
    await rememberTarget(tab, tab?.url);
    sendResponse({ url: tab?.url || "", title: tab?.title || "" });
  });
  return true;
});
