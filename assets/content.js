/**
 * Qwen Automation Content Script
 *
 * This script runs on chat.qwen.ai and handles:
 * - Mode selection (Create Image, Create Video)
 * - Aspect ratio selection (9:16, 16:9, 1:1, 3:4, 4:3)
 * - Prompt input
 * - Generation triggering
 * - Result downloading
 *
 * Communication via chrome.runtime messages with side panel.
 */

console.log('[QwenAutomate] Content script loaded');


// Aspect ratio mapping
const ASPECT_RATIOS = {
  '1:1': '1:1',
  '9:16': '9:16',
  '16:9': '16:9',
  '3:4': '3:4',
  '4:3': '4:3',
};

// Mode mapping
const MODES = {
  'image': 'Create Image',
  'video': 'Create Video',
};

// Sleep utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Find an element by text content
 */
function findByText(selector, text) {
  const elements = document.querySelectorAll(selector);
  for (const el of elements) {
    if (el.textContent?.toLowerCase().includes(text.toLowerCase())) {
      return el;
    }
  }
  return null;
}

/**
 * Find button by text
 */
function findButton(text) {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    if (btn.textContent?.toLowerCase().includes(text.toLowerCase())) {
      return btn;
    }
  }
  return null;
}

/**
 * Click element with retry
 */
async function clickWithRetry(selectorFn, maxRetries = 5, delay = 500) {
  for (let i = 0; i < maxRetries; i++) {
    const element = selectorFn();
    if (element) {
      element.click();
      await sleep(delay);
      return true;
    }
    await sleep(delay);
  }
  return false;
}

/**
 * Fill React textarea
 */
function fillReactTextarea(textarea, value) {
  // Get native setter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set;

  // Set value
  nativeInputValueSetter.call(textarea, value);

  // Trigger React events
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Check if we're on the correct page (chat/generate)
 */
function isOnGeneratePage() {
  return window.location.href.includes('chat.qwen.ai');
}

/**
 * Open mode selector dropdown
 */
async function openModeSelector() {
  // Find the mode-select-current-mode element and click it
  const modeSelect = document.querySelector('.mode-select');
  if (!modeSelect) {
    console.error('[QwenAutomate] Mode select not found');
    return false;
  }

  const trigger = modeSelect.querySelector('.ant-dropdown-trigger');
  if (trigger) {
    trigger.click();
    await sleep(300);
    return true;
  }

  // Try clicking the current mode display
  const currentMode = modeSelect.querySelector('.mode-select-current-mode');
  if (currentMode) {
    currentMode.click();
    await sleep(300);
    return true;
  }

  return false;
}

/**
 * Select mode (Create Image or Create Video)
 */
async function selectMode(mode) {
  const modeText = MODES[mode] || mode;
  console.log('[QwenAutomate] Selecting mode:', modeText);

  // First, check if already selected
  const currentModeEl = document.querySelector('.mode-select-current-mode span:last-child');
  if (currentModeEl && currentModeEl.textContent?.toLowerCase().includes(modeText.toLowerCase().replace('create ', ''))) {
    console.log('[QwenAutomate] Mode already selected');
    return true;
  }

  // Open the mode dropdown - click the + button
  const plusButton = document.querySelector('.mode-select-open');
  if (plusButton) {
    plusButton.click();
    await sleep(400);
  }

  // Find and click the mode option
  const options = document.querySelectorAll('[role="menuitem"], .ant-dropdown-menu-item, li');
  for (const option of options) {
    const text = option.textContent?.toLowerCase();
    if (text?.includes('image') && mode === 'image') {
      option.click();
      await sleep(300);
      return true;
    }
    if (text?.includes('video') && mode === 'video') {
      option.click();
      await sleep(300);
      return true;
    }
  }

  // Alternative: try the mode buttons directly
  const modeButtons = document.querySelectorAll('button');
  for (const btn of modeButtons) {
    const text = btn.textContent?.toLowerCase();
    if (text?.includes('create image') && mode === 'image') {
      btn.click();
      await sleep(300);
      return true;
    }
    if (text?.includes('create video') && mode === 'video') {
      btn.click();
      await sleep(300);
      return true;
    }
  }

  console.error('[QwenAutomate] Could not select mode:', modeText);
  return false;
}

/**
 * Open size selector dropdown
 */
async function openSizeSelector() {
  const sizeSelector = document.querySelector('.size-selector');
  if (!sizeSelector) {
    console.error('[QwenAutomate] Size selector not found');
    return false;
  }

  const trigger = sizeSelector.querySelector('.ant-dropdown-trigger');
  if (trigger) {
    trigger.click();
    await sleep(300);
    return true;
  }

  // Click directly on the selector text
  const selectorText = sizeSelector.querySelector('.selector-text');
  if (selectorText) {
    selectorText.click();
    await sleep(300);
    return true;
  }

  return false;
}

/**
 * Select aspect ratio
 */
async function selectAspectRatio(ratio) {
  console.log('[QwenAutomate] Selecting aspect ratio:', ratio);

  // Check if already selected
  const currentRatioEl = document.querySelector('.size-selector .ant-space-item');
  if (currentRatioEl && currentRatioEl.textContent?.trim() === ratio) {
    console.log('[QwenAutomate] Aspect ratio already selected');
    return true;
  }

  // Open size selector
  await openSizeSelector();

  // Find and click the ratio option
  await sleep(200);
  const options = document.querySelectorAll('[role="menuitem"], .ant-dropdown-menu-item, li');
  for (const option of options) {
    const text = option.textContent?.trim();
    if (text === ratio || text?.includes(ratio)) {
      option.click();
      await sleep(300);
      return true;
    }
  }

  // Alternative: try clicking by data attribute or other selectors
  const ratioButtons = document.querySelectorAll('button, [role="option"]');
  for (const btn of ratioButtons) {
    const text = btn.textContent?.trim();
    if (text === ratio) {
      btn.click();
      await sleep(300);
      return true;
    }
  }

  console.error('[QwenAutomate] Could not select aspect ratio:', ratio);
  return false;
}

/**
 * Enter prompt in textarea
 */
async function enterPrompt(prompt) {
  console.log('[QwenAutomate] Entering prompt');

  // Find the textarea
  const textarea = document.querySelector('.message-input-textarea');
  if (!textarea) {
    console.error('[QwenAutomate] Textarea not found');
    return false;
  }

  // Clear existing content
  textarea.focus();
  textarea.select();

  // Fill with new prompt
  fillReactTextarea(textarea, prompt);
  await sleep(300);

  return true;
}

/**
 * Click send button to start generation
 */
async function clickSendButton() {
  console.log('[QwenAutomate] Clicking send button');

  const sendButton = document.querySelector('.send-button');
  if (!sendButton) {
    console.error('[QwenAutomate] Send button not found');
    return false;
  }

  // Check if button is disabled
  if (sendButton.classList.contains('disabled') || sendButton.hasAttribute('disabled')) {
    console.error('[QwenAutomate] Send button is disabled');
    return false;
  }

  sendButton.click();
  await sleep(1000);

  return true;
}

/**
 * Wait for generation to complete
 */
async function waitForGeneration(timeout = 300000) {
  console.log('[QwenAutomate] Waiting for generation to complete');

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check for completion indicators
    // 1. Look for generated image/video in the response
    const responseContainer = document.querySelector('.response-message, [data-role="assistant"]');
    if (responseContainer) {
      // Check for images
      const images = responseContainer.querySelectorAll('img[src^="blob:"], img[src*="qwen"]');
      if (images.length > 0) {
        console.log('[QwenAutomate] Generated images found');
        return { success: true, type: 'image', count: images.length };
      }

      // Check for video
      const videos = responseContainer.querySelectorAll('video');
      if (videos.length > 0) {
        console.log('[QwenAutomate] Generated video found');
        return { success: true, type: 'video', count: videos.length };
      }

      // Check for download links
      const downloadLinks = responseContainer.querySelectorAll('a[download], button[download]');
      if (downloadLinks.length > 0) {
        console.log('[QwenAutomate] Download links found');
        return { success: true, type: 'download', count: downloadLinks.length };
      }
    }

    // Check for "Generating" or loading state
    const loadingIndicators = document.querySelectorAll('.loading, .generating, [class*="loading"], [class*="generating"]');
    const isLoading = loadingIndicators.length > 0;

    // Check for error messages
    const errorEl = document.querySelector('.error, [class*="error"]');
    if (errorEl && errorEl.textContent) {
      console.error('[QwenAutomate] Generation error:', errorEl.textContent);
      return { success: false, error: errorEl.textContent };
    }

    await sleep(2000);
  }

  return { success: false, error: 'Generation timeout' };
}

/**
 * Download generated content
 */
async function downloadGeneratedContent(taskId) {
  console.log('[QwenAutomate] Attempting to download generated content');

  // Find generated content
  const responseContainer = document.querySelector('.response-message:last-of-type, [data-role="assistant"]:last-of-type');
  if (!responseContainer) {
    return { success: false, error: 'No response container found' };
  }

  // Try to find and click download button
  const downloadButtons = responseContainer.querySelectorAll('button[download], a[download], [class*="download"]');
  for (const btn of downloadButtons) {
    btn.click();
    await sleep(500);
  }

  // Monitor downloads
  return new Promise((resolve) => {
    let downloadStarted = false;

    chrome.downloads.onCreated.addListener(function onCreated(downloadItem) {
      if (downloadItem.url.includes('qwen') || downloadItem.filename.includes('qwen')) {
        downloadStarted = true;
        chrome.downloads.onCreated.removeListener(onCreated);
      }
    });

    chrome.downloads.onChanged.addListener(function onChanged(delta) {
      if (delta.state && delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(onChanged);

        // Get the download item
        chrome.downloads.search({ id: delta.id }, (items) => {
          if (items.length > 0) {
            const item = items[0];
            resolve({
              success: true,
              filename: item.filename,
              url: item.url,
            });
          }
        });
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!downloadStarted) {
        resolve({ success: false, error: 'Download timeout' });
      }
    }, 30000);
  });
}

/**
 * Get generated content URLs
 */
async function getGeneratedContentUrls() {
  const urls = [];
  const responseContainer = document.querySelector('.response-message:last-of-type, [data-role="assistant"]:last-of-type');

  if (!responseContainer) {
    return urls;
  }

  // Find images
  const images = responseContainer.querySelectorAll('img');
  for (const img of images) {
    if (img.src && (img.src.startsWith('blob:') || img.src.includes('qwen'))) {
      urls.push({ type: 'image', url: img.src });
    }
  }

  // Find videos
  const videos = responseContainer.querySelectorAll('video');
  for (const video of videos) {
    if (video.src) {
      urls.push({ type: 'video', url: video.src });
    }
    // Check source elements
    const sources = video.querySelectorAll('source');
    for (const source of sources) {
      if (source.src) {
        urls.push({ type: 'video', url: source.src });
      }
    }
  }

  return urls;
}

/**
 * Create new chat for fresh generation
 */
async function createNewChat() {
  console.log('[QwenAutomate] Creating new chat');

  // Look for new chat button
  const newChatButton = findButton('new chat') || findButton('new conversation');
  if (newChatButton) {
    newChatButton.click();
    await sleep(1000);
    return true;
  }

  // Alternative: navigate to home/create new chat
  const homeLink = document.querySelector('a[href="/"], a[href="/create"]');
  if (homeLink) {
    homeLink.click();
    await sleep(1000);
    return true;
  }

  return false;
}

/**
 * Execute a generation task
 */
async function executeTask(task) {
  console.log('[QwenAutomate] Executing task:', task.id, task.mode);

  try {
    // 1. Create new chat for fresh generation
    await createNewChat();
    await sleep(500);

    // 2. Select mode
    const modeSelected = await selectMode(task.mode);
    if (!modeSelected) {
      return { success: false, error: 'Failed to select mode' };
    }

    // 3. Select aspect ratio if specified
    if (task.aspectRatio) {
      await selectAspectRatio(task.aspectRatio);
    }

    // 4. Enter prompt
    const promptEntered = await enterPrompt(task.prompt);
    if (!promptEntered) {
      return { success: false, error: 'Failed to enter prompt' };
    }

    // 5. Click send button
    const sent = await clickSendButton();
    if (!sent) {
      return { success: false, error: 'Failed to send prompt' };
    }

    // 6. Wait for generation
    const result = await waitForGeneration(task.timeout || 300000);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // 7. Get generated content URLs
    const urls = await getGeneratedContentUrls();

    // 8. Notify bridge of completion
    await fetch(`${BRIDGE_URL}/api/qwen-bridge/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.id,
        success: true,
        type: result.type,
        count: result.count,
        urls: urls,
      }),
    });

    return { success: true, urls };

  } catch (error) {
    console.error('[QwenAutomate] Task execution error:', error);

    // Notify bridge of failure
    await fetch(`${BRIDGE_URL}/api/qwen-bridge/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.id,
        success: false,
        error: error.message,
      }),
    });

    return { success: false, error: error.message };
  }
}

// Listen for messages from side panel/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[QwenAutomate] Received message:', message);

  if (message.type === 'EXECUTE_TASK') {
    executeTask(message.task).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_STATE') {
    const state = {
      url: window.location.href,
      isOnGeneratePage: isOnGeneratePage(),
      currentMode: document.querySelector('.mode-select-current-mode span:last-child')?.textContent,
      currentRatio: document.querySelector('.size-selector .ant-space-item')?.textContent?.trim(),
    };
    sendResponse(state);
    return true;
  }

  if (message.type === 'SELECT_MODE') {
    selectMode(message.mode).then(sendResponse);
    return true;
  }

  if (message.type === 'SELECT_RATIO') {
    selectAspectRatio(message.ratio).then(sendResponse);
    return true;
  }

  if (message.type === 'ENTER_PROMPT') {
    enterPrompt(message.prompt).then(sendResponse);
    return true;
  }

  if (message.type === 'SEND_PROMPT') {
    clickSendButton().then(sendResponse);
    return true;
  }

  if (message.type === 'CREATE_NEW_CHAT') {
    createNewChat().then(sendResponse);
    return true;
  }
});

// Poll for tasks from bridge
let busy = false;
const POLL_INTERVAL = 3000;

async function pollForTasks() {
  if (busy) return;

  try {
    const response = await fetch(`${BRIDGE_URL}/api/qwen-bridge/tasks`, {
      cache: 'no-store',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.tasks && data.tasks.length > 0) {
        busy = true;
        await executeTask(data.tasks[0]);
        busy = false;
      }
    }
  } catch (error) {
    // Bridge not available, will retry
  }
}

// Start polling after page load
setTimeout(() => {
  console.log('[QwenAutomate] Starting task polling');
  setInterval(pollForTasks, POLL_INTERVAL);
}, 2000);

console.log('[QwenAutomate] Content script initialized');
