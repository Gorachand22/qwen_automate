/**
 * Qwen Automation Content Script
 *
 * This script runs on chat.qwen.ai and handles:
 * - Mode selection (Create Image, Create Video)
 * - Aspect ratio selection
 * - Prompt input and generation
 * - Download monitoring
 *
 * Based on grok_automate pattern - polls /api/qwen-bridge/tasks
 */

const OM_BASE = "http://localhost:3000";
const POLL_MS = 3000;

let busy = false;

// ── Utilities ──────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Find a button whose trimmed innerText contains `text` (case-insensitive). */
function btn(text) {
    const lower = text.toLowerCase();
    return [...document.querySelectorAll("button")].find(
        b => b.innerText.trim().toLowerCase().includes(lower)
    ) ?? null;
}

/** Fill a React textarea/input with a value (fires React's onChange). */
function fillReact(el, value) {
    const proto = (el.tagName === "TEXTAREA") ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Click a custom React dropdown and pick an option by visible text.
 * Same logic as grok_automate.
 */
async function pickDropdownOption(label, optionText) {
    // 1. Find section containing the label text
    const allText = [...document.querySelectorAll("div, span, p, label, button")];

    // Find the most specific text element containing the label (case insensitive)
    const labelLower = label.toLowerCase();
    const labelEls = allText.filter(el =>
        el.innerText &&
        el.innerText.toLowerCase().includes(labelLower) &&
        el.children.length < 3 // Ignore giant wrapper divs
    );

    if (labelEls.length === 0) {
        console.warn("[QwenAutomate] Could not find any label matching:", label);
        return false;
    }

    // Sort by smallest string length to get the most exact match
    labelEls.sort((a, b) => a.innerText.length - b.innerText.length);
    const bestLabel = labelEls[0];

    // 2. Find the trigger button near this label
    let trigger = null;
    let container = bestLabel;

    for (let i = 0; i < 5; i++) {
        if (!container) break;
        // Look for typical Ant Design select triggers
        const possibleTriggers = container.querySelectorAll("button, [role='combobox'], [class*='select'], div, svg");
        for (const pt of possibleTriggers) {
            if (pt !== bestLabel && pt.innerText) {
                if (pt.tagName === "BUTTON" || pt.getAttribute("role") === "combobox" || pt.innerHTML.includes("<svg")) {
                    trigger = pt;
                    break;
                }
            }
        }
        if (trigger) break;

        // Alternative: if the label is adjacent to the trigger div
        if (container.nextElementSibling) {
            const nextNode = container.nextElementSibling;
            if (nextNode.innerHTML && nextNode.innerHTML.includes("<svg") && nextNode.innerText) {
                trigger = nextNode;
                break;
            }
        }
        container = container.parentElement;
    }

    if (!trigger) {
        console.warn("[QwenAutomate] Found label, but no dropdown trigger for:", label);
        return false;
    }

    trigger.click();
    await sleep(400);

    // 3. Find the option in the now-open list
    const optionLower = optionText.toLowerCase();
    const allOptions = [...document.querySelectorAll("li, [role='option'], span, div")];

    let optionEl = allOptions.find(el =>
        el.innerText &&
        el.innerText.toLowerCase().includes(optionLower) &&
        el.children.length === 0
    );

    if (optionEl) {
        const clickableWrapper = optionEl.closest("li, [role='option']") || optionEl;
        clickableWrapper.click();
        await sleep(300);
        return true;
    }

    // Close the dropdown if we failed
    trigger.click();
    await sleep(200);
    console.warn("[QwenAutomate] Option not found in dropdown:", optionText);
    return false;
}

// ── Automation Steps ────────────────────────────────────────────────────────

/** Maps task.mode to the UI element */
const MODE_LABELS = {
    textToImage: "Image",
    textToVideo: "Video",
    imageToVideo: "Video",
    imageToImage: "Image",
};

/** Maps task.aspectRatio to the option text */
const AR_OPTION_TEXT = {
    "16:9": "16:9",
    "9:16": "9:16",
    "1:1": "1:1",
    "3:4": "3:4",
    "4:3": "4:3",
    "1:1 (Square)": "1:1",
    "9:16 (TikTok)": "9:16",
    "16:9 (YouTube)": "16:9",
};

/**
 * Click the + icon to create new generation
 * In Qwen's UI, there should be a plus button to add new content
 */
async function clickNewChatOrPlus() {
    console.log("[QwenAutomate] Looking for new chat/+ button");

    // Try various patterns for Qwen's UI
    // 1. Look for + button with SVG
    const buttons = document.querySelectorAll("button");
    for (const button of buttons) {
        const svg = button.querySelector("svg");
        if (svg) {
            // Check for plus icon path
            const paths = svg.querySelectorAll("path");
            for (const path of paths) {
                const d = path.getAttribute("d") || "";
                // Common plus icon patterns
                if (d.includes("M12 4v16m8-8H4") || d.includes("M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z") ||
                    d.includes("M11 19v-6H5v-2h6V5h2v6h6v2h-6v6h-2z")) {
                    button.click();
                    await sleep(500);
                    return true;
                }
            }
        }
        // Check for text
        const text = button.textContent?.trim();
        if (text === "+" || text === "Add" || text === "New" || text?.includes("Create")) {
            button.click();
            await sleep(500);
            return true;
        }
    }

    // 2. Look for specific class patterns
    const addBtn = document.querySelector("[class*='add'], [class*='plus'], [class*='new']");
    if (addBtn) {
        addBtn.click();
        await sleep(500);
        return true;
    }

    // 3. Try new chat button in sidebar
    const newChatBtn = btn("New Chat") || btn("New chat") || btn("New");
    if (newChatBtn) {
        newChatBtn.click();
        await sleep(500);
        return true;
    }

    return false;
}

/**
 * Select mode (Image or Video generation)
 * Qwen may have tabs or buttons for this
 */
async function selectMode(mode) {
    const modeLabel = MODE_LABELS[mode] || "Image";
    console.log("[QwenAutomate] Selecting mode:", modeLabel);

    // Try dropdown selection
    const found = await pickDropdownOption("Mode", modeLabel)
        || await pickDropdownOption("Type", modeLabel)
        || await pickDropdownOption("Create", modeLabel);

    if (found) return true;

    // Try direct button click
    const modeBtn = btn(modeLabel) || btn("Create " + modeLabel);
    if (modeBtn) {
        modeBtn.click();
        await sleep(400);
        return true;
    }

    // Try finding by image/video icon
    const buttons = document.querySelectorAll("button");
    for (const button of buttons) {
        const text = button.textContent?.toLowerCase() || "";
        if ((mode === "textToImage" || mode === "imageToImage" || mode === "image") &&
            (text.includes("image") || text.includes("photo") || text.includes("picture"))) {
            button.click();
            await sleep(400);
            return true;
        }
        if ((mode === "textToVideo" || mode === "video") &&
            (text.includes("video") || text.includes("film") || text.includes("movie"))) {
            button.click();
            await sleep(400);
            return true;
        }
    }

    console.warn("[QwenAutomate] Could not select mode:", modeLabel);
    return false;
}

/**
 * Select aspect ratio using dropdown
 */
async function selectAspectRatio(aspectRatio) {
    console.log("[QwenAutomate] Selecting aspect ratio:", aspectRatio);

    const arText = AR_OPTION_TEXT[aspectRatio] || aspectRatio;

    // Try various label patterns
    const found = await pickDropdownOption("Ratio", arText)
        || await pickDropdownOption("Size", arText)
        || await pickDropdownOption("Aspect", arText)
        || await pickDropdownOption("Resolution", arText)
        || await pickDropdownOption("Dimensions", arText);

    if (!found) {
        // Try direct button click for aspect ratio
        const buttons = document.querySelectorAll("button");
        for (const button of buttons) {
            if (button.textContent?.includes(aspectRatio)) {
                button.click();
                await sleep(300);
                return true;
            }
        }
        console.warn("[QwenAutomate] Aspect ratio not set:", aspectRatio);
    }

    return found;
}

/**
 * Fill prompt and submit
 */
async function fillAndRun(taskId, prompt) {
    // Route the next download to the qwen folder
    chrome.runtime.sendMessage({ type: "SETUP_DOWNLOAD", folder: "qwen", prefix: taskId + "_" });

    // Find the textarea
    const ta = document.querySelector("textarea");
    if (!ta) {
        console.warn("[QwenAutomate] No textarea for prompt");
        return postFailure(taskId, "No textarea found");
    }

    // Fill prompt
    fillReact(ta, prompt);
    await sleep(400);

    // Find and click send/submit button
    let sendBtn = btn("Send") || btn("Submit") || btn("Generate") || btn("Create");

    // Alternative: look for send icon button
    if (!sendBtn) {
        const buttons = document.querySelectorAll("button");
        for (const button of buttons) {
            const svg = button.querySelector("svg");
            if (svg) {
                // Check for send icon (arrow right or paper plane)
                const paths = svg.querySelectorAll("path");
                for (const path of paths) {
                    const d = path.getAttribute("d") || "";
                    if (d.includes("M2.01 21L23 12") || d.includes("M2.01 21 23 12") ||
                        d.includes("paper-plane") || d.includes("send")) {
                        sendBtn = button;
                        break;
                    }
                }
            }
            if (sendBtn) break;
        }
    }

    // Check for primary button
    if (!sendBtn) {
        sendBtn = document.querySelector("button.ant-btn-primary, button.primary, [type='submit']");
    }

    if (!sendBtn) {
        console.warn("[QwenAutomate] No send button found");
        return postFailure(taskId, "Send button not found");
    }

    // Check if button is disabled
    if (sendBtn.disabled || sendBtn.classList.contains("ant-btn-disabled")) {
        console.warn("[QwenAutomate] Send button is disabled");
        return postFailure(taskId, "Send button is disabled");
    }

    // Record start time for download matching
    const startTimeStamp = new Date().toISOString();
    sendBtn.click();
    console.log("[QwenAutomate] Clicked send at", startTimeStamp);

    // Wait for completion
    await waitForCompletion(taskId, startTimeStamp);
}

/**
 * Wait for generation to complete
 */
async function waitForCompletion(taskId, startTimeStamp, maxMs = 300_000) {
    const deadline = Date.now() + maxMs;

    while (Date.now() < deadline) {
        await sleep(2000);

        // Check for generated content
        // 1. Look for images
        const images = document.querySelectorAll("img[src^='blob:'], img[src*='qwen'], img[class*='generated']");
        if (images.length > 0) {
            console.log("[QwenAutomate] Generated images found");
            await sleep(3000); // Wait for download to start
            const matched = await findOurDownload(startTimeStamp);
            if (matched) {
                await waitForDownloadFinish(matched.id, deadline, taskId);
                return;
            }
        }

        // 2. Look for videos
        const videos = document.querySelectorAll("video");
        if (videos.length > 0) {
            console.log("[QwenAutomate] Generated video found");
            await sleep(3000);
            const matched = await findOurDownload(startTimeStamp);
            if (matched) {
                await waitForDownloadFinish(matched.id, deadline, taskId);
                return;
            }
        }

        // 3. Check for completion text
        const bodyText = document.body.innerText;
        if (bodyText.includes("Download") || bodyText.includes("Complete") || bodyText.includes("Done")) {
            // Check for download buttons
            const downloadBtns = document.querySelectorAll("[class*='download'], button[download], a[download]");
            if (downloadBtns.length > 0) {
                // Try to click download
                downloadBtns[0].click();
                await sleep(2000);
                const matched = await findOurDownload(startTimeStamp);
                if (matched) {
                    await waitForDownloadFinish(matched.id, deadline, taskId);
                    return;
                }
            }
        }

        // 4. Check for error
        const errorEl = document.querySelector(".ant-message-error, [class*='error']");
        if (errorEl && errorEl.textContent) {
            console.error("[QwenAutomate] Generation error:", errorEl.textContent);
            return postFailure(taskId, errorEl.textContent);
        }
    }

    busy = false;
}

/**
 * Find our download from chrome.downloads
 */
function findOurDownload(startTimeISO) {
    return new Promise(resolve => {
        const queryTime = new Date(startTimeISO).getTime();

        chrome.downloads.search({
            orderBy: ["-startTime"],
            limit: 20
        }, items => {
            const recentItems = items.filter(it => {
                if (!it.filename) return false;
                return new Date(it.startTime).getTime() >= queryTime;
            });

            // Video first
            const video = recentItems.find(it => /\.(mp4|webm)$/i.test(it.filename));
            if (video) return resolve(video);

            // Then image
            const images = recentItems.filter(it => /\.(png|jpg|jpeg|webp|gif)$/i.test(it.filename));
            if (images.length > 0) {
                resolve(images[0]);
            } else {
                resolve(null);
            }
        });
    });
}

/**
 * Wait for download to finish
 */
function waitForDownloadFinish(dlId, deadline, taskId) {
    return new Promise(resolve => {
        function check() {
            if (Date.now() > deadline) { resolve(); return; }
            chrome.downloads.search({ id: dlId }, ([item]) => {
                if (!item) { resolve(); return; }

                if (item.state === "complete") {
                    notifyComplete(item, taskId);
                    resolve();
                } else if (item.state === "interrupted") {
                    console.error("[QwenAutomate] Download interrupted!", item.filename);
                    postFailure(taskId, "Download interrupted: " + item.filename);
                    resolve();
                } else {
                    setTimeout(check, 1500);
                }
            });
        }
        check();
    });
}

/**
 * POST completed download to /api/qwen-bridge/complete
 */
async function notifyComplete(dlItem, originalTaskId) {
    const type = dlItem.filename.endsWith(".mp4") || dlItem.filename.endsWith(".webm") ? "video" : "image";
    console.log("[QwenAutomate] Download done →", dlItem.filename, "task:", originalTaskId);
    try {
        await fetch(`${OM_BASE}/api/qwen-bridge/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: originalTaskId, type, dataBase64: dlItem.filename }),
        });
    } catch (e) { console.error("[QwenAutomate] /complete failed:", e); }
}

async function postFailure(taskId, message) {
    try {
        await fetch(`${OM_BASE}/api/qwen-bridge/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId, error: message }),
        });
    } catch (_) { }
    busy = false;
}

// ── Main Handler ────────────────────────────────────────────────────────────

async function handleTask(task) {
    busy = true;
    console.log("[QwenAutomate] ▶ Handling task", task.id, task.mode, task.aspectRatio);
    try {
        // 1. Click new chat/+ button
        await clickNewChatOrPlus();
        await sleep(500);

        // 2. Select mode
        await selectMode(task.mode);
        await sleep(400);

        // 3. Select aspect ratio if specified
        if (task.aspectRatio) {
            await selectAspectRatio(task.aspectRatio);
            await sleep(300);
        }

        // 4. Fill prompt and run
        await fillAndRun(task.id, task.prompt);
    } catch (err) {
        console.error("[QwenAutomate] Task error:", err);
        await postFailure(task.id, String(err));
    }
}

// ── Polling Loop ────────────────────────────────────────────────────────────

async function poll() {
    if (!busy) {
        try {
            const res = await fetch(`${OM_BASE}/api/qwen-bridge/tasks`, { cache: "no-store" });
            if (res.ok) {
                const { tasks } = await res.json();
                if (tasks?.length) await handleTask(tasks[0]);
            }
        } catch (_) { /* server not ready yet */ }
    }
    setTimeout(poll, POLL_MS);
}

// Start after page loads
setTimeout(poll, 2500);

console.log("[QwenAutomate] Content script initialized");
