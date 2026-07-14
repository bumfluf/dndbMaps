/*
 * File: background.js
 * Purpose: Implements the background service worker for the extension.
 * Contribution: This file helps the Maps feature communicate with Google Drive safely from the extension's background context, so page scripts can request folder HTML without directly touching Drive from the D&D Beyond page.
 */

// Background service worker for D&D Beyond Extension

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'fetchDriveFolderHtml' || message.action === 'testDriveFolderAccess') {
        (async () => {
            const folderId = message.folderId;
            try {
                const { html, attempts } = await fetchDriveFolderHtml(folderId);
                if (message.action === 'testDriveFolderAccess') {
                    sendResponse({ success: true, accessible: !!html, attempts });
                } else {
                    sendResponse({ success: true, html, attempts });
                }
            } catch (error) {
                console.error('Background fetch failed for', folderId, error);
                sendResponse({ success: false, error: error.message || String(error), attempts: error.attempts || null });
            }
        })();
        return true;
    }
});

/**
 * Requests Google Drive folder HTML from the background worker so the content script can parse it safely.
 * @param {string} folderId The Google Drive folder identifier to fetch.
 * @returns {Promise<{html:string, attempts:Array}>} The HTML content and fetch attempt details.
 */
async function fetchDriveFolderHtml(folderId) {
    const folderUrls = [
        `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
        `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    ];

    const attempts = [];
    const fetchWithTimeout = async (folderUrl, timeoutMs = 3000, useCredentials = true) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const options = {
                credentials: useCredentials ? 'include' : 'omit',
                redirect: 'follow',
                signal: controller.signal
            };
            const response = await fetch(folderUrl, options);
            const attempt = {
                url: folderUrl,
                used: useCredentials ? 'include' : 'omit',
                status: response.status,
                ok: response.ok
            };
            if (!response.ok) {
                attempt.error = `HTTP ${response.status}`;
                attempts.push(attempt);
                return null;
            }
            attempts.push(attempt);
            return await response.text();
        } catch (e) {
            const errorAttempt = {
                url: folderUrl,
                used: useCredentials ? 'include' : 'omit',
                ok: false,
                error: e.message
            };
            attempts.push(errorAttempt);
            return null;
        } finally {
            clearTimeout(timer);
        }
    };

    for (const folderUrl of folderUrls) {
        const htmlWithCreds = await fetchWithTimeout(folderUrl, 3000, true);
        if (htmlWithCreds) {
            return { html: htmlWithCreds, attempts };
        }

        const htmlNoCred = await fetchWithTimeout(folderUrl, 3000, false);
        if (htmlNoCred) {
            return { html: htmlNoCred, attempts };
        }
    }

    const error = new Error('Unable to fetch Google Drive folder HTML from any supported URL.');
    error.attempts = attempts;
    throw error;
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    // No-op installation handler for future cleanup or telemetry hooks.
});
