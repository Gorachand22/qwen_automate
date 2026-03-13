/**
 * Qwen Automation Side Panel Bridge Script
 *
 * Manages communication between:
 * - Side panel UI
 * - Content script on chat.qwen.ai
 * - Bridge API on Clipchamp server
 */


let tasks = [];
let logs = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkBridgeStatus();
  checkQwenTab();
  loadTasks();
  setInterval(checkBridgeStatus, 5000);
  setInterval(loadTasks, 2000);
});

/**
 * Check bridge API status
 */
async function checkBridgeStatus() {
  const statusEl = document.getElementById('bridge-status');

  try {
    const response = await fetch(`${BRIDGE_URL}/api/qwen-bridge/status`);
    if (response.ok) {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status-value connected';
    } else {
      statusEl.textContent = 'Error';
      statusEl.className = 'status-value disconnected';
    }
  } catch (error) {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status-value disconnected';
  }
}

/**
 * Check if Qwen tab is open
 */
async function checkQwenTab() {
  const statusEl = document.getElementById('qwen-status');

  try {
    const tabs = await chrome.tabs.query({ url: '*://chat.qwen.ai/*' });
    if (tabs.length > 0) {
      statusEl.textContent = 'Ready';
      statusEl.className = 'status-value connected';
    } else {
      statusEl.textContent = 'Not detected';
      statusEl.className = 'status-value disconnected';
    }
  } catch (error) {
    statusEl.textContent = 'Unknown';
    statusEl.className = 'status-value';
  }
}

/**
 * Open Qwen tab
 */
async function openQwenTab() {
  const tabs = await chrome.tabs.query({ url: '*://chat.qwen.ai/*' });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: 'https://chat.qwen.ai/' });
  }
}

/**
 * Load tasks from bridge
 */
async function loadTasks() {
  try {
    const response = await fetch(`${BRIDGE_URL}/api/qwen-bridge/queue`);
    if (response.ok) {
      const data = await response.json();
      tasks = data.tasks || [];
      renderTasks();

      const queueCount = tasks.filter(t => t.status === 'pending').length;
      document.getElementById('queue-count').textContent = `${queueCount} tasks`;
    }
  } catch (error) {
    console.error('Failed to load tasks:', error);
  }
}

/**
 * Render tasks list
 */
function renderTasks() {
  const container = document.getElementById('tasks-container');

  if (tasks.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks in queue</div>';
    return;
  }

  container.innerHTML = tasks.map(task => `
    <div class="task-item">
      <div class="task-id">Task: ${task.id.substring(0, 8)}...</div>
      <div class="task-prompt">${task.prompt}</div>
      <div class="task-meta">
        <span>${task.mode}</span>
        <span>${task.aspectRatio}</span>
        <span class="task-status ${task.status}">${task.status}</span>
      </div>
    </div>
  `).join('');
}

/**
 * Add task to queue
 */
async function addTask() {
  const promptInput = document.getElementById('prompt-input');
  const modeSelect = document.getElementById('mode-select');
  const ratioSelect = document.getElementById('ratio-select');

  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert('Please enter a prompt');
    return;
  }

  const task = {
    id: crypto.randomUUID(),
    prompt: prompt,
    mode: modeSelect.value,
    aspectRatio: ratioSelect.value,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  try {
    const response = await fetch(`${BRIDGE_URL}/api/qwen-bridge/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });

    if (response.ok) {
      addLog(`Task added: ${task.id.substring(0, 8)}`, 'success');
      promptInput.value = '';
      loadTasks();

      // Open Qwen tab if not already open
      openQwenTab();
    } else {
      addLog('Failed to add task', 'error');
    }
  } catch (error) {
    addLog('Bridge connection failed', 'error');
  }
}

/**
 * Add log entry
 */
function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  logs.unshift({ message, type, timestamp });

  // Keep only last 50 logs
  if (logs.length > 50) {
    logs = logs.slice(0, 50);
  }

  renderLogs();
}

/**
 * Render logs
 */
function renderLogs() {
  const container = document.getElementById('log-container');
  container.innerHTML = logs.map(log => `
    <div class="log-entry ${log.type}">[${log.timestamp}] ${log.message}</div>
  `).join('');
}

// Event listeners
document.getElementById('submit-btn').addEventListener('click', addTask);

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TASK_COMPLETE') {
    addLog(`Task completed: ${message.taskId}`, 'success');
    loadTasks();
  }

  if (message.type === 'TASK_ERROR') {
    addLog(`Task failed: ${message.error}`, 'error');
    loadTasks();
  }
});
