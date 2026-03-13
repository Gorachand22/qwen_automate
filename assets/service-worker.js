/**
 * Qwen Automation Background Service Worker
 *
 * Handles:
 * - Extension icon click to open side panel
 * - Message passing between content script and side panel
 * - Download monitoring
 */

console.log('[QwenAutomate] Background service worker started');

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[QwenAutomate] Background received message:', message.type);

  // Forward messages to appropriate targets
  if (message.type === 'TASK_COMPLETE' || message.type === 'TASK_ERROR') {
    // Notify side panel
    chrome.runtime.sendMessage(message);
  }

  if (message.type === 'GET_QWEN_TAB') {
    chrome.tabs.query({ url: '*://chat.qwen.ai/*' }, (tabs) => {
      sendResponse({ tabs: tabs.map(t => ({ id: t.id, url: t.url })) });
    });
    return true;
  }

  if (message.type === 'OPEN_QWEN_TAB') {
    chrome.tabs.query({ url: '*://chat.qwen.ai/*' }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: 'https://chat.qwen.ai/' });
      }
    });
    return true;
  }

  return false;
});

// Monitor downloads for Qwen content
chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log('[QwenAutomate] Download started:', downloadItem.filename);

  // Check if it's from Qwen
  if (downloadItem.url?.includes('qwen') || downloadItem.referrer?.includes('qwen.ai')) {
    // Store download ID for tracking
    chrome.storage.local.get(['qwen_downloads'], (result) => {
      const downloads = result.qwen_downloads || [];
      downloads.push({
        id: downloadItem.id,
        filename: downloadItem.filename,
        url: downloadItem.url,
        startTime: downloadItem.startTime,
      });
      chrome.storage.local.set({ qwen_downloads: downloads.slice(-50) });
    });
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    console.log('[QwenAutomate] Download complete:', delta.id);

    chrome.storage.local.get(['qwen_downloads'], (result) => {
      const downloads = result.qwen_downloads || [];
      const download = downloads.find(d => d.id === delta.id);

      if (download) {
        // Notify content script or side panel
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_COMPLETE',
          downloadId: delta.id,
          filename: download.filename,
        });
      }
    });
  }
});

// Set up side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

console.log('[QwenAutomate] Background service worker ready');
