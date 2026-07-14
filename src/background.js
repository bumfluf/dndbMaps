/*
 * File: background.js
 * Purpose: Implements the background service worker for the extension.
 * Contribution: This file helps the Maps feature communicate with Google Drive safely from the extension's background context, so page scripts can request folder HTML without directly touching Drive from the D&D Beyond page.
 */

// Background service worker for D&D Beyond Extension

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchDriveFolderHtml') {
        (async () => {
            const folderId = message.folderId;
            try {
                const html = await fetchDriveFolderHtml(folderId);
                sendResponse({ success: true, html, attempts: null });
            } catch (error) {
                console.error('Background fetchDriveFolderHtml failed, error:', error);
                sendResponse({ success: false, error: error.message || String(error) });
            }
        })();
        return true;
    }
});

/**
 * Requests Google Drive folder HTML from the background worker so the content script can parse it safely.
 * @param {string} folderId The Google Drive folder identifier to fetch.
 * @returns {Promise<string>} The HTML content returned by the Drive fetch attempt.
 */
async function fetchDriveFolderHtml(folderId) {
    const folderUrls = [
        `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
        `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    ];

    const fetchWithTimeout = async (folderUrl, timeoutMs = 3000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            // First try with credentials (works when the user is signed-in in the browser).
            // If this fails (e.g. CORS or auth), fall back to a no-credentials fetch for shared/public folders.
            try {
                const response = await fetch(folderUrl, {
                    credentials: 'include',
                    redirect: 'follow',
                    signal: controller.signal
                });
                if (response && response.ok) {
                    return await response.text();
                }
            } catch (e) {
                // swallow and try fallback below
            }

            // Fallback: try without credentials (public/shared folders)
            const responseNoCred = await fetch(folderUrl, {
                redirect: 'follow',
                signal: controller.signal
            });
            if (!responseNoCred.ok) {
                throw new Error(`Fetch failed (no-credentials) ${folderUrl} ${responseNoCred.status}`);
            }
            return await responseNoCred.text();
        } finally {
            clearTimeout(timer);
        }
    };

    for (const folderUrl of folderUrls) {
        try {
            const html = await fetchWithTimeout(folderUrl);
            if (html) {
                return html;
            }
        } catch (error) {
        }
    }

    throw new Error('Unable to fetch Google Drive folder HTML from any supported URL.');
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    // No-op installation handler for future cleanup or telemetry hooks.
});
