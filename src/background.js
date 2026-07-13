// Background service worker for D&D Beyond Extension
const originalConsoleLog = console.log.bind(console);
console.log = (...args) => {
    if (false) originalConsoleLog(...args);
};

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Message received from content script:', message);
    
    if (message.action === 'saveData') {
        // Save data to storage
        chrome.storage.local.set({ lastData: message.data });
        sendResponse({ success: true });
        return;
    }

    if (message.action === 'fetchDriveFolderHtml') {
        (async () => {
            const folderId = message.folderId;
            const folderUrls = [
                `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
                `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
            ];
            const attempts = [];

            for (const folderUrl of folderUrls) {
                // try with credentials
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 3000);
                    try {
                        const response = await fetch(folderUrl, { credentials: 'include', redirect: 'follow', signal: controller.signal });
                        attempts.push({ url: folderUrl, used: 'include', status: response.status, ok: response.ok });
                        if (response.ok) {
                            const html = await response.text();
                            clearTimeout(timer);
                            sendResponse({ success: true, html, attempts });
                            return;
                        }
                    } finally { clearTimeout(timer); }
                } catch (err) {
                    attempts.push({ url: folderUrl, used: 'include', error: err && err.message ? err.message : String(err) });
                }

                // try without credentials (public/shared)
                try {
                    const controller2 = new AbortController();
                    const timer2 = setTimeout(() => controller2.abort(), 3000);
                    try {
                        const response2 = await fetch(folderUrl, { redirect: 'follow', signal: controller2.signal });
                        attempts.push({ url: folderUrl, used: 'omit', status: response2.status, ok: response2.ok });
                        if (response2.ok) {
                            const html = await response2.text();
                            clearTimeout(timer2);
                            sendResponse({ success: true, html, attempts });
                            return;
                        }
                    } finally { clearTimeout(timer2); }
                } catch (err2) {
                    attempts.push({ url: folderUrl, used: 'omit', error: err2 && err2.message ? err2.message : String(err2) });
                }
            }

            // If we reach here, all attempts failed
            console.error('Background fetchDriveFolderHtml failed, attempts:', attempts);
            sendResponse({ success: false, error: 'Unable to fetch Google Drive folder HTML', attempts });
        })();
        return true;
    }

    if (message.action === 'fetchImageAsDataUrl') {
        const url = message.url;
        const doFetch = async (fetchUrl, fetchOpts = {}) => {
            const res = await fetch(fetchUrl, fetchOpts);
            return { ok: res.ok, status: res.status, type: res.type, blob: await res.blob() };
        };

        (async () => {
            const attempts = [];
            try {
                // 1) Try with credentials
                try {
                    const r = await doFetch(url, { credentials: 'include', redirect: 'follow' });
                    attempts.push({ url, status: r.status, type: r.type, used: 'include' });
                    if (r.ok) {
                        const blob = r.blob;
                        const arrayBuffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        const chunk = 0x8000;
                        for (let i = 0; i < bytes.length; i += chunk) {
                            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                        }
                        const base64 = btoa(binary);
                        const dataUrl = `data:${blob.type};base64,${base64}`;
                        sendResponse({ success: true, dataUrl, attempts });
                        return;
                    }
                } catch (e1) {
                    attempts.push({ url, error: e1 && e1.message ? e1.message : String(e1), used: 'include' });
                    console.warn('fetchImageAsDataUrl attempt include failed', e1 && e1.message ? e1.message : e1);
                }

                // 2) Try without credentials
                try {
                    const r2 = await doFetch(url, { redirect: 'follow' });
                    attempts.push({ url, status: r2.status, type: r2.type, used: 'no-credentials' });
                    if (r2.ok) {
                        const blob = r2.blob;
                        const arrayBuffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        let binary = '';
                        const chunk = 0x8000;
                        for (let i = 0; i < bytes.length; i += chunk) {
                            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                        }
                        const base64 = btoa(binary);
                        const dataUrl = `data:${blob.type};base64,${base64}`;
                        sendResponse({ success: true, dataUrl, attempts });
                        return;
                    }
                } catch (e2) {
                    attempts.push({ url, error: e2 && e2.message ? e2.message : String(e2), used: 'no-credentials' });
                    console.warn('fetchImageAsDataUrl attempt no-credentials failed', e2 && e2.message ? e2.message : e2);
                }

                // 3) Try fallback uc download endpoint if id present
                try {
                    const m = url.match(/[?&]id=([^&]+)/);
                    const id = m ? m[1] : null;
                    if (id) {
                        const alt = `https://drive.google.com/uc?export=download&id=${id}`;
                        try {
                            const r3 = await doFetch(alt, { credentials: 'include', redirect: 'follow' });
                            attempts.push({ url: alt, status: r3.status, type: r3.type, used: 'include-fallback' });
                            if (r3.ok) {
                                const blob = r3.blob;
                                const arrayBuffer = await blob.arrayBuffer();
                                const bytes = new Uint8Array(arrayBuffer);
                                let binary = '';
                                const chunk = 0x8000;
                                for (let i = 0; i < bytes.length; i += chunk) {
                                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                                }
                                const base64 = btoa(binary);
                                const dataUrl = `data:${blob.type};base64,${base64}`;
                                sendResponse({ success: true, dataUrl, attempts, fallback: alt });
                                return;
                            }
                        } catch (ef) {
                            attempts.push({ url: alt, error: ef && ef.message ? ef.message : String(ef), used: 'include-fallback' });
                            console.warn('fetchImageAsDataUrl fallback include failed', ef && ef.message ? ef.message : ef);
                        }
                    }
                } catch (fallbackOuterErr) {
                    attempts.push({ error: fallbackOuterErr && fallbackOuterErr.message ? fallbackOuterErr.message : String(fallbackOuterErr) });
                }

                // if we get here, all attempts failed
                console.error('fetchImageAsDataUrl: all attempts failed for', url, attempts);
                sendResponse({ success: false, error: 'All fetch attempts failed', attempts });
            } catch (err) {
                console.error('fetchImageAsDataUrl unexpected error for', url, err && err.message ? err.message : err);
                sendResponse({ success: false, error: err && err.message ? err.message : String(err), attempts });
            }
        })();
        return true;
    }

    
});

async function fetchDriveFolderHtml(folderId) {
    const fetchStartedAt = performance.now();
    const folderUrls = [
        `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
        `https://drive.google.com/drive/folders/${folderId}?usp=sharing`
    ];

    const fetchWithTimeout = async (folderUrl, timeoutMs = 3000) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            // First try with credentials (works when user is signed-in in the browser)
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
                console.debug('[maps] fetch with credentials failed for', folderUrl, e && e.message ? e.message : e);
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
                const elapsed = Math.round(performance.now() - fetchStartedAt);
                if (elapsed >= 1500) {
                    console.info(`[maps] background folder fetch slow: ${elapsed}ms for ${folderId}`);
                }
                return html;
            }
        } catch (error) {
            console.debug(`[maps] background fallback for ${folderId}: ${error && error.message ? error.message : error}`);
        }
    }

    throw new Error('Unable to fetch Google Drive folder HTML from any supported URL.');
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('dndbeyond.com')) {
        console.log('D&D Beyond page loaded:', tab.url);
    }
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('D&D Beyond Extension installed');
});
