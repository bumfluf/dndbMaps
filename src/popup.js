// Get DOM elements
const actionBtn = document.getElementById('actionBtn');
const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');

// Open the extension Settings page when the button is clicked
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

// Clear the popup status on open
document.addEventListener('DOMContentLoaded', () => {
    statusEl.textContent = '';
});
