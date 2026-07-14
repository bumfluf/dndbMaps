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
        `https://drive.google.com/drive/folders/${folderId}?usp=sharing`,
        `https://drive.google.com/drive/folders/${folderId}?authuser=0&usp=sharing`
    ];

    const DEBUG_DRIVE_FETCH = false;
    const attempts = [];
    const isDriveRedirectPage = (html) => {
        if (!html) return false;
        const snippet = html.toString().slice(0, 400).toLowerCase();
        return /\bredirecting\b/.test(snippet)
            || snippet.includes('followup=')
            || snippet.includes('accounts.google.com')
            || snippet.includes('/signin')
            || snippet.includes('service login')
            || snippet.includes('window.location')
            || snippet.includes('meta http-equiv="refresh"')
            || snippet.includes('sign in to continue');
    };

    const fetchWithTimeout = async (folderUrl, timeoutMs = 3000, useCredentials = false) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const options = {
                credentials: useCredentials ? 'include' : 'omit',
                redirect: 'follow',
                signal: controller.signal
            };
            const response = await fetch(folderUrl, options);
            const finalUrl = response.url || '';
            const attempt = {
                url: folderUrl,
                used: useCredentials ? 'include' : 'omit',
                status: response.status,
                ok: response.ok,
                finalUrl
            };
            if (!response.ok) {
                attempt.error = `HTTP ${response.status}`;
                attempts.push(attempt);
                if (DEBUG_DRIVE_FETCH) console.log('[Background Drive Fetch] failed response', attempt);
                return null;
            }
            if (/accounts\.google\.com|\/signin|\/ServiceLogin|service_login/.test(finalUrl.toLowerCase())) {
                attempt.ok = false;
                attempt.error = `redirected-to-login:${finalUrl}`;
                attempts.push(attempt);
                if (DEBUG_DRIVE_FETCH) console.log('[Background Drive Fetch] login redirect', attempt);
                return null;
            }
            const html = await response.text();
            if (isDriveRedirectPage(html)) {
                attempt.ok = false;
                attempt.error = 'redirect-page';
                attempts.push(attempt);
                if (DEBUG_DRIVE_FETCH) console.log('[Background Drive Fetch] redirect page HTML', attempt, html.slice(0, 300));
                return null;
            }
            attempts.push(attempt);
            if (DEBUG_DRIVE_FETCH) console.log('[Background Drive Fetch] success', attempt, { htmlLength: html.length });
            return html;
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
        const htmlNoCred = await fetchWithTimeout(folderUrl, 3000, false);
        if (htmlNoCred) {
            if (DEBUG_DRIVE_FETCH) console.log('[Background Drive Fetch] selected htmlNoCred', { folderUrl, attemptsCount: attempts.length });
            return { html: htmlNoCred, attempts };
        }

        const htmlWithCreds = await fetchWithTimeout(folderUrl, 3000, true);
        if (htmlWithCreds) {
            if (DEBUG_DRIVE_FETCH) console.log('[Background Drive Fetch] selected htmlWithCreds', { folderUrl, attemptsCount: attempts.length });
            return { html: htmlWithCreds, attempts };
        }
    }

    if (DEBUG_DRIVE_FETCH) {
        console.warn('[Background Drive Fetch] all attempts failed', { folderId, attempts });
    }
    const error = new Error('Unable to fetch Google Drive folder HTML from any supported URL.');
    error.attempts = attempts;
    throw error;
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    // No-op installation handler for future cleanup or telemetry hooks.
});
