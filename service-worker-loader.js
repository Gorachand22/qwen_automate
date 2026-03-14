// Service Worker Loader for Qwen Automation Extension
// This loads the background script using importScripts

try {
    importScripts('./assets/service-worker.js');
} catch (e) {
    console.error('[QwenAutomate] Failed to load service worker:', e);
}
