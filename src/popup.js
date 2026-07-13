// Get DOM elements
const actionBtn = document.getElementById('actionBtn');
const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');

// Open the extension options page when the button is clicked
actionBtn.addEventListener('click', async () => {
    try {
        if (chrome.runtime.openOptionsPage) {
            await chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'), '_blank');
        }
        statusEl.textContent = 'Options opened';
    } catch (error) {
        statusEl.textContent = 'Could not open Options';
        contentEl.innerHTML = '<p>Please open the extension Options from the browser toolbar menu.</p>';
        console.error('Unable to open extension options:', error);
    }
});

// Clear the popup status on open
document.addEventListener('DOMContentLoaded', () => {
    statusEl.textContent = '';
});
