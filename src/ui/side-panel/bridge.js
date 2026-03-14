/**
 * Qwen Automation Side Panel Bridge Script
 *
 * Manages communication between:
 * - Side panel UI
 * - Content script on chat.qwen.ai
 * - Bridge API on Clipchamp server
 *
 * Based on grok_automate pattern.
 */

const BRIDGE_URL = 'http://localhost:3000';
const QWEN_URL = 'https://chat.qwen.ai/';

let tasks = [];
let logs = [];
let qwenTabId = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    addLog('Side panel initialized', 'info');
    checkBridgeStatus();
    checkQwenTab();
    loadTasks();

    setInterval(checkBridgeStatus, 5000);
    setInterval(loadTasks, 2000);
    setInterval(checkQwenTab, 5000);

    // Event listeners
    document.getElementById('submit-btn').addEventListener('click', addTask);
    document.getElementById('open-qwen-btn').addEventListener('click', openQwenTab);
});

// ── Logging ──────────────────────────────────────────────────────────────────

function addLog(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    logs.unshift({ message, type, timestamp });

    if (logs.length > 50) {
        logs = logs.slice(0, 50);
    }

    renderLogs();
}

function renderLogs() {
    const container = document.getElementById('log-container');
    if (logs.length === 0) {
        container.innerHTML = '<div class="log-entry">No activity yet</div>';
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="log-entry ${log.type}">[${log.timestamp}] ${log.message}</div>
    `).join('');
}

// ── Status Checks ─────────────────────────────────────────────────────────────

async function checkBridgeStatus() {
    const statusEl = document.getElementById('bridge-status');

    try {
        const response = await fetch(`${BRIDGE_URL}/api/qwen-bridge/status`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });

        if (response.ok) {
            const data = await response.json();
            statusEl.textContent = data.status || 'Connected';
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

async function checkQwenTab() {
    const statusEl = document.getElementById('qwen-status');
    const submitBtn = document.getElementById('submit-btn');

    try {
        const tabs = await chrome.tabs.query({ url: '*://chat.qwen.ai/*' });

        if (tabs.length > 0) {
            const tab = tabs[0];
            qwenTabId = tab.id;

            if (tab.active) {
                statusEl.textContent = 'Active ✓';
                statusEl.className = 'status-value connected';
            } else {
                statusEl.textContent = 'Ready';
                statusEl.className = 'status-value connected';
            }

            // Enable submit button
            submitBtn.disabled = false;
        } else {
            qwenTabId = null;
            statusEl.textContent = 'Not detected';
            statusEl.className = 'status-value disconnected';
            statusEl.title = 'Click "Open Qwen Tab" to start';

            // Show warning in UI
            showQwenWarning();
        }
    } catch (error) {
        statusEl.textContent = 'Unknown';
        statusEl.className = 'status-value';
    }
}

function showQwenWarning() {
    const container = document.getElementById('tasks-container');
    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="color: #fbbf24;">
                ⚠️ Qwen tab not detected<br>
                <small style="color: #888;">Click "Open Qwen Tab" to start</small>
            </div>
        `;
    }
}

// ── Tab Management ────────────────────────────────────────────────────────────

async function openQwenTab() {
    try {
        const tabs = await chrome.tabs.query({ url: '*://chat.qwen.ai/*' });

        if (tabs.length > 0) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            await chrome.windows.update(tabs[0].windowId, { focused: true });
            addLog('Switched to Qwen tab', 'success');
        } else {
            const newTab = await chrome.tabs.create({ url: QWEN_URL });
            qwenTabId = newTab.id;
            addLog('Opened new Qwen tab', 'success');
        }
    } catch (error) {
        addLog('Failed to open Qwen tab: ' + error.message, 'error');
    }
}

// ── Task Management ───────────────────────────────────────────────────────────

async function loadTasks() {
    try {
        const response = await fetch(`${BRIDGE_URL}/api/qwen-bridge/queue`, {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });

        if (response.ok) {
            const data = await response.json();
            tasks = data.tasks || data.queue || [];
            renderTasks();

            const pendingCount = tasks.filter(t => t.status === 'pending').length;
            document.getElementById('queue-count').textContent = `${pendingCount} pending`;
            document.getElementById('task-count').textContent = tasks.length;
        }
    } catch (error) {
        // Silently fail - bridge might not be running
    }
}

function renderTasks() {
    const container = document.getElementById('tasks-container');

    if (tasks.length === 0) {
        // Check if Qwen tab is missing
        chrome.tabs.query({ url: '*://chat.qwen.ai/*' }, (tabs) => {
            if (tabs.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="color: #fbbf24;">
                        ⚠️ Qwen tab not detected<br>
                        <small style="color: #888;">Click "Open Qwen Tab" to start</small>
                    </div>
                `;
            } else {
                container.innerHTML = '<div class="empty-state">No tasks in queue</div>';
            }
        });
        return;
    }

    container.innerHTML = tasks.map(task => `
        <div class="task-item">
            <div class="task-id">${task.id?.substring(0, 8) || 'unknown'}...</div>
            <div class="task-prompt">${escapeHtml(task.prompt || 'No prompt')}</div>
            <div class="task-meta">
                <span>${task.mode || 'image'}</span>
                <span>${task.aspectRatio || '1:1'}</span>
                <span class="task-status ${task.status || 'pending'}">${task.status || 'pending'}</span>
            </div>
        </div>
    `).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function addTask() {
    const promptInput = document.getElementById('prompt-input');
    const modeSelect = document.getElementById('mode-select');
    const ratioSelect = document.getElementById('ratio-select');
    const submitBtn = document.getElementById('submit-btn');

    const prompt = promptInput.value.trim();
    if (!prompt) {
        addLog('Please enter a prompt', 'error');
        return;
    }

    // Check if Qwen tab exists
    const tabs = await chrome.tabs.query({ url: '*://chat.qwen.ai/*' });
    if (tabs.length === 0) {
        addLog('Please open Qwen tab first', 'error');
        await openQwenTab();
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

    // Disable button while submitting
    submitBtn.disabled = true;
    submitBtn.textContent = 'Adding...';

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

            // Focus Qwen tab
            await openQwenTab();
        } else {
            const error = await response.text();
            addLog('Failed to add task: ' + error, 'error');
        }
    } catch (error) {
        addLog('Bridge connection failed: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add to Queue';
    }
}

// ── Message Listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[SidePanel] Received message:', message);

    switch (message.type) {
        case 'TASK_COMPLETE': {
            addLog(`Task completed: ${message.taskId?.substring(0, 8)}`, 'success');
            loadTasks();
            break;
        }

        case 'TASK_ERROR': {
            addLog(`Task failed: ${message.error}`, 'error');
            loadTasks();
            break;
        }

        case 'DOWNLOAD_COMPLETE': {
            addLog(`Download complete: ${message.filename}`, 'success');
            break;
        }
    }

    sendResponse({ received: true });
});

// ── Port Connection to Background ────────────────────────────────────────────

try {
    const port = chrome.runtime.connect({ name: 'side-panel' });

    port.onDisconnect.addListener(() => {
        addLog('Disconnected from background', 'error');
    });
} catch (e) {
    console.error('Failed to connect to background:', e);
}
