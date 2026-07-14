function initializePopup() {
    const actionBtn = document.getElementById('actionBtn');
    const statusEl = document.getElementById('status');
    const contentEl = document.getElementById('content');

    if (!actionBtn || !statusEl || !contentEl) {
        return;
    }

    actionBtn.addEventListener('click', async () => {
        try {
            if (chrome.runtime.openOptionsPage) {
                await chrome.runtime.openOptionsPage();
            } else {
                window.open(chrome.runtime.getURL('settings.html'), '_blank');
            }
            statusEl.textContent = 'Settings opened';
        } catch (error) {
            statusEl.textContent = 'Could not open Settings';
            contentEl.innerHTML = '<p>Please open the extension Settings from the browser toolbar menu.</p>';
            console.error('Unable to open extension settings:', error);
        }
    });

    statusEl.textContent = '';
}

const shared = window.__dndBeyondShared || {};
if (shared.whenDomReady) {
    shared.whenDomReady(initializePopup);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup, { once: true });
} else {
    initializePopup();
}
