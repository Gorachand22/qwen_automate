/**
 * Qwen Automation Background Service Worker
 *
 * Handles:
 * - Extension icon click to open side panel
 * - Message passing for download routing
 * - Download monitoring and completion notification
 *
 * Based on grok_automate pattern.
 */

console.log('[QwenAutomate] Background service worker started');

let downloadFolder = "";
let downloadPrefix = "";

// ── Side Panel Setup ────────────────────────────────────────────────────────

async function setupSidePanel() {
    if (chrome.sidePanel) {
        try {
            await chrome.sidePanel.setOptions({
                path: "src/ui/side-panel/index.html",
                enabled: true
            });
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        } catch (e) {
            console.error('[QwenAutomate] Side panel setup failed:', e);
        }
    }
}

setupSidePanel();

// ── Extension Install/Update ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
    await setupSidePanel();

    if (details.reason === "install") {
        // Open Qwen tab on first install
        await openQwenTab();
        console.log('[QwenAutomate] Extension installed');
    } else if (details.reason === "update") {
        console.log('[QwenAutomate] Extension updated');
    }
});

// ── Action Click Handler ────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
    if (chrome.sidePanel && tab.id !== undefined) {
        try {
            await chrome.sidePanel.open({ tabId: tab.id });
        } catch (e) {
            console.error('[QwenAutomate] Failed to open side panel:', e);
        }
    }
});

// ── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[QwenAutomate] Background received message:', message.type);

    switch (message.type) {
        case "SETUP_DOWNLOAD": {
            const { folder, prefix } = message;
            if (typeof folder === "string") {
                downloadFolder = folder.trim() ? `${folder.trim()}/` : "";
            }
            if (typeof prefix === "string") {
                downloadPrefix = prefix.trim();
            }
            console.log('[QwenAutomate] Download setup:', { folder: downloadFolder, prefix: downloadPrefix });
            sendResponse({ success: true });
            break;
        }

        case "GET_QWEN_TAB": {
            chrome.tabs.query({ url: "*://chat.qwen.ai/*" }, (tabs) => {
                sendResponse({ tabs: tabs.map(t => ({ id: t.id, url: t.url, active: t.active })) });
            });
            return true; // Keep channel open for async response
        }

        case "OPEN_QWEN_TAB": {
            openQwenTab().then(() => sendResponse({ success: true }));
            return true;
        }

        case "DOWNLOAD_IMAGE": {
            const { url, filename } = message;
            const fullFilename = `${downloadFolder}${downloadPrefix}${filename}`;

            chrome.downloads.download({
                url: url,
                filename: fullFilename,
                saveAs: false
            }, (downloadId) => {
                const error = chrome.runtime?.lastError;
                sendResponse(!error && downloadId ? { success: true, downloadId } : { success: false, error: error?.message });
            });
            return true;
        }
    }

    return false;
});

// ── Helper Functions ─────────────────────────────────────────────────────────

async function openQwenTab() {
    try {
        const tabs = await chrome.tabs.query({ url: "*://chat.qwen.ai/*" });
        if (tabs.length > 0 && tabs[0].id) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            if (tabs[0].windowId) {
                await chrome.windows.update(tabs[0].windowId, { focused: true });
            }
        } else {
            await chrome.tabs.create({ url: "https://chat.qwen.ai/" });
        }
    } catch (e) {
        console.error('[QwenAutomate] Failed to open Qwen tab:', e);
    }
}

// ── Download Filename Determination ──────────────────────────────────────────

const downloadUrls = new Map();

function determineDownloadFilename(downloadItem, suggest) {
    // Only handle our downloads
    if (downloadItem.byExtensionId && downloadItem.byExtensionId !== chrome.runtime.id) {
        return;
    }

    const isVideo = /\.(mp4|webm)$/i.test(downloadItem.filename || downloadItem.url);
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(downloadItem.filename || downloadItem.url);

    if (!isVideo && !isImage) {
        return;
    }

    // Check if we have a mapped URL
    if (downloadUrls.has(downloadItem.url)) {
        suggest({ filename: downloadUrls.get(downloadItem.url) });
        downloadUrls.delete(downloadItem.url);
        return;
    }

    // Apply folder and prefix
    const originalFilename = downloadItem.filename;
    const basename = originalFilename.split("/").pop() || originalFilename;

    suggest({ filename: `${downloadFolder}${downloadPrefix}${basename}` });
}

// ── Side Panel Connection Handler ────────────────────────────────────────────

const sidePanelConnections = new Set();

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "side-panel") {
        sidePanelConnections.add(port);

        // Register download filename handler when side panel is open
        if (sidePanelConnections.size === 1) {
            if (!chrome.downloads.onDeterminingFilename.hasListener(determineDownloadFilename)) {
                chrome.downloads.onDeterminingFilename.addListener(determineDownloadFilename);
            }
        }

        port.onDisconnect.addListener(() => {
            sidePanelConnections.delete(port);

            // Remove listener when no side panels are connected
            if (sidePanelConnections.size === 0) {
                if (chrome.downloads.onDeterminingFilename.hasListener(determineDownloadFilename)) {
                    chrome.downloads.onDeterminingFilename.removeListener(determineDownloadFilename);
                }
            }
        });
    }
});

// ── Download Completion Handler ─────────────────────────────────────────────

chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === "complete") {
        chrome.downloads.search({ id: delta.id }, (results) => {
            if (results && results.length > 0) {
                const item = results[0];
                const filename = item.filename;

                // Check if this is a Qwen download (in our folder or has our prefix)
                if (filename.includes("qwen") || downloadPrefix) {
                    // Extract task ID from filename if present
                    const match = filename.match(/([a-f0-9\-]{36})_/);
                    if (match) {
                        const taskId = match[1];
                        const type = filename.endsWith(".mp4") || filename.endsWith(".webm") ? "video" : "image";

                        console.log("[QwenAutomate] Download complete:", filename, "Task:", taskId);

                        fetch("http://localhost:3000/api/qwen-bridge/complete", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ taskId, type, dataBase64: filename })
                        }).catch(() => { });
                    }
                }
            }
        });
    }
});

console.log("[QwenAutomate] Background service worker ready");
