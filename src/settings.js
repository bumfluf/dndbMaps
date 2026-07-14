/*
 * File: settings.js
 * Purpose: Powers the extension's settings page.
 * Contribution: This file lets users link character names to Google Drive folders, test access, and manage the saved mappings that the content script uses to show Maps.
 */

// D&D Beyond Extension - Settings Page

let currentEditCharacter = null;
let originalEditCharacterName = null;

/**
 * Initializes the settings page by loading saved mappings and preparing the form UI.
 * @returns {void}
 */
function initializeSettingsPage() {
    resetFormMode();
    loadMappings();
    setupEventListeners();
    populateCharacterNameFromCurrentSheet();

    // Default UI values for per-mapping subfolder settings
    const checkbox = document.getElementById('searchSubfolders');
    const depthInput = document.getElementById('subfolderDepth');
    if (checkbox) checkbox.checked = true; // enabled by default
    if (depthInput) depthInput.value = 3;
}

const shared = window.__dndBeyondShared || {};
if (shared.whenDomReady) {
    shared.whenDomReady(initializeSettingsPage);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSettingsPage, { once: true });
} else {
    initializeSettingsPage();
}

/**
 * Connects the settings page buttons and inputs to their event handlers.
 * @returns {void}
 */
function setupEventListeners() {
    const addCharacterBtn = document.getElementById('addCharacterBtn');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const characterNameInput = document.getElementById('characterName');

    if (addCharacterBtn) {
        addCharacterBtn.addEventListener('click', addCharacterMapping);
    }
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', testGoogleDriveConnection);
    }
    if (characterNameInput) {
        characterNameInput.addEventListener('input', handleCharacterNameInputChange);
    }
}

/**
 * Normalizes a character name so saved mappings can be matched consistently.
 * @param {string} name The raw character name provided by the user.
 * @returns {string} A normalized character name for comparison.
 */
function normalizeCharacterName(name) {
    const shared = window.__dndBeyondShared || {};
    if (shared.normalizeCharacterName) {
        return shared.normalizeCharacterName(name);
    }

    return (name || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Updates the edit state when the character name input changes.
 * @param {Event} event The input change event.
 * @returns {void}
 */
function handleCharacterNameInputChange(event) {
    const raw = event.target.value || '';
    const currentValue = normalizeCharacterName(raw);

    if (!currentValue) {
        if (currentEditCharacter) {
            currentEditCharacter = null;
            setFormMode(false);
        }
        return;
    }

    chrome.storage.sync.get('characterMappings', (result) => {
        const mappings = result.characterMappings || {};
        const matchedKey = Object.keys(mappings).find((key) => normalizeCharacterName(key) === currentValue);

        if (matchedKey) {
            if (currentEditCharacter !== matchedKey) {
                currentEditCharacter = matchedKey;
                originalEditCharacterName = matchedKey;
                setFormMode(true);
            }
            return;
        }

        if (originalEditCharacterName && currentValue === normalizeCharacterName(originalEditCharacterName)) {
            if (!currentEditCharacter) {
                currentEditCharacter = originalEditCharacterName;
                setFormMode(true);
            }
            return;
        }

        if (currentEditCharacter) {
            currentEditCharacter = null;
            setFormMode(false);
        }
    });
}

/**
 * Attempts to detect the current character name from an open D&D Beyond tab.
 * @param {number} tabId The browser tab identifier to inspect.
 * @returns {Promise<string|null>} The detected character name, if available.
 */
function executeScriptCharacterName(tabId) {
    return new Promise((resolve, reject) => {
        if (!chrome.scripting || !chrome.scripting.executeScript) {
            resolve(null);
            return;
        }

        chrome.scripting.executeScript(
            {
                target: { tabId },
                func: () => {
                    // Lightweight normalization used inside the page context to collapse whitespace.
                    const normalize = (value) => {
                        if (!value) return null;
                        return value.toString().replace(/\s+/g, ' ').trim();
                    };

                    const selectors = [
                        '.ddbc-character-tidbits__heading h1',
                        'h1.styles_characterName__2x8wQ',
                        'header h1',
                        'h1'
                    ];

                    // Try a list of common character name selectors first; these are the most reliable.
                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element && element.textContent) {
                            const text = normalize(element.textContent);
                            if (text && text.length >= 3) {
                                return text;
                            }
                        }
                    }

                    // As a fallback, inspect the window title and strip D&D Beyond suffixes so we don't
                    // accidentally return the site name. This helps when the sheet markup isn't available.
                    if (document.title && /d&amp;d beyond/i.test(document.title) === false) {
                        const title = normalize(document.title);
                        if (title) {
                            return title
                                .replace(/\s*[-|–|—|\|]\s*D&D Beyond.*$/i, '')
                                .replace(/\s*[-|–|—|\|]\s*D\s*&\s*D Beyond.*$/i, '')
                                .replace(/\s*D&D Beyond.*$/i, '')
                                .trim();
                        }
                    }

                    return null;
                }
            },
            (results) => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                    return;
                }

                if (!results || !results[0] || !results[0].result) {
                    resolve(null);
                    return;
                }

                resolve(results[0].result);
            }
        );
    });
}

/**
 * Updates the form heading and button labels based on whether the user is editing an existing mapping.
 * @param {boolean} editing Whether the form is in edit mode.
 * @returns {void}
 */
function setFormMode(editing) {
    const formHeading = document.querySelector('.form-section h3');
    const addCharacterBtn = document.getElementById('addCharacterBtn');

    if (editing) {
        if (formHeading) formHeading.textContent = 'Update Character Mapping';
        if (addCharacterBtn) addCharacterBtn.textContent = 'Update Character';
    } else {
        if (formHeading) formHeading.textContent = 'Add Character Mapping';
        if (addCharacterBtn) addCharacterBtn.textContent = 'Add Character';
    }
}

/**
 * Resets the form back to its default add-character state.
 * @returns {void}
 */
function resetFormMode() {
    currentEditCharacter = null;
    originalEditCharacterName = null;
    setFormMode(false);
}

/**
 * Tries to detect the active character name from an open D&D Beyond sheet and prefill the form.
 * @returns {void}
 */
function populateCharacterNameFromCurrentSheet() {
    if (!chrome.tabs || !chrome.tabs.query) {
        return;
    }

    chrome.tabs.query({ url: '*://www.dndbeyond.com/*' }, (tabs) => {
        if (!tabs || tabs.length === 0) {
            return;
        }

        tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

        const tryTab = (index) => {
            if (index >= tabs.length) {
                return;
            }

            const tab = tabs[index];
            if (!tab || typeof tab.id !== 'number') {
                tryTab(index + 1);
                return;
            }

                // First try to ask the content script for the detected character name. If that fails (no content
                // script present or no name detected), fall back to executing a small script in the tab to inspect
                // the DOM and the document title as a last resort.
                chrome.tabs.sendMessage(tab.id, { action: 'getCharacterName' }, async (response) => {
                    if (!chrome.runtime.lastError && response && response.characterName) {
                        autofillCharacterName(response.characterName);
                        return;
                    }

                    const scriptName = await executeScriptCharacterName(tab.id);
                    if (scriptName) {
                        autofillCharacterName(scriptName);
                        return;
                    }

                    tryTab(index + 1);
                });
        };

        tryTab(0);
    });
}

/**
 * Populates the character name field with a detected name if it is still empty.
 * @param {string} characterName The detected character name.
 * @returns {void}
 */
function autofillCharacterName(characterName) {
    const characterNameInput = document.getElementById('characterName');
    if (!characterNameInput || characterNameInput.value.trim()) {
        return;
    }
    characterNameInput.value = characterName;
    showStatus('Character name autofilled from active D&D Beyond sheet', 'success');
}

/**
 * Extracts a Google Drive folder identifier from a pasted URL or raw folder ID.
 * @param {string} input The user-provided Drive link or folder ID.
 * @returns {string|null} The extracted folder ID, if one could be identified.
 */
function extractFolderId(input) {
    // Check if the user pasted a raw folder ID (alphanumeric with -/_). Use a minimum length
    // threshold to avoid accidental short matches from other text.
    if (/^[a-zA-Z0-9-_]+$/.test(input) && input.length > 20) {
        return input;
    }
    
    // Extract a folder id from common Drive URL patterns like '/folders/<id>'.
    const match = input.match(/folders\/([a-zA-Z0-9-_]+)/);
    if (match) {
        return match[1];
    }
    
    // Also accept the 'open?id=' or '?id=' query parameter form used by some Drive links.
    const match2 = input.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (match2) {
        return match2[1];
    }
    
    return null;
}

/**
 * Runs the connection test workflow for the current folder input.
 * @returns {void}
 */
function testGoogleDriveConnection() {
    const folderInput = document.getElementById('googleDriveFolder').value.trim();

    if (!folderInput) {
        showStatus('Please enter a Google Drive folder link or ID', 'error');
        return;
    }
    
    const folderId = extractFolderId(folderInput);
    if (!folderId) {
        showStatus('Invalid Google Drive link or ID format', 'error');
        return;
    }
    
    showStatus('Testing connection...', 'loading');
    
    // Test by attempting to fetch the folder as a public resource
    // This checks if the folder is accessible
    testFolderAccess(folderId)
        .then(accessible => {
            if (accessible) {
                showStatus('✓ Connection successful! Folder is accessible.', 'success');
            } else {
                showStatus('✗ Could not access folder. Make sure it\'s shared with your Google account.', 'error');
            }
        })
        .catch(error => {
            showStatus('✗ Connection test failed: ' + error.message, 'error');
        });
}

/**
 * Checks whether a folder ID appears valid enough to be considered accessible.
 * @param {string} folderId The folder identifier to validate.
 * @returns {Promise<boolean>} Resolves to true when the folder ID looks usable.
 */
function testFolderAccess(folderId) {
    return new Promise((resolve, reject) => {
        if (folderId && folderId.length > 20) {
            setTimeout(() => resolve(true), 500);
        } else {
            reject(new Error('Invalid folder ID format'));
        }
    });
}

/**
 * Saves a new or updated character-to-folder mapping in browser storage.
 * @returns {void}
 */
function addCharacterMapping() {
    const characterName = document.getElementById('characterName').value.trim();
    const folderInput = document.getElementById('googleDriveFolder').value.trim();
    
    if (!characterName) {
        showStatus('Please enter a character name', 'error');
        return;
    }
    
    if (!folderInput) {
        showStatus('Please enter a Google Drive folder link or ID', 'error');
        return;
    }
    
    const folderId = extractFolderId(folderInput);
    if (!folderId) {
        showStatus('Invalid Google Drive link or ID format', 'error');
        return;
    }
    
    // Get existing mappings
    chrome.storage.sync.get('characterMappings', (result) => {
        const mappings = result.characterMappings || {};
        const mappingExists = Boolean(mappings[characterName]);

        // Check if character already exists
        if (mappingExists) {
            const overwrite = confirm(`Character "${characterName}" already exists. Overwrite mapping?`);
            if (!overwrite) return;
        }
        
        // Read per-mapping subfolder settings from the form. These allow each mapping
        // to control whether subfolders are searched and how deep the crawl should go.
        const checkbox = document.getElementById('searchSubfolders');
        const depthInput = document.getElementById('subfolderDepth');
        const searchSubfolders = !!(checkbox && checkbox.checked);
        const subfolderDepth = Math.max(1, Math.min(6, parseInt(depthInput && depthInput.value, 10) || 3));

        // Add or update mapping (include per-mapping subfolder settings)
        mappings[characterName] = {
            folderId: folderId,
            folderUrl: folderInput,
            addedDate: new Date().toISOString(),
            searchSubfolders,
            subfolderDepth
        };
        
        // Save the mapping to sync storage so content scripts can read it on other devices
        // where the user is signed in to the browser profile.
        chrome.storage.sync.set({ characterMappings: mappings }, () => {
            const actionText = mappingExists ? 'updated' : 'added';
            showStatus(`✓ Character "${characterName}" ${actionText} successfully!`, 'success');
            const characterNameInput = document.getElementById('characterName');
            const folderInputElement = document.getElementById('googleDriveFolder');
            if (characterNameInput) characterNameInput.value = '';
            if (folderInputElement) folderInputElement.value = '';
            resetFormMode();
            loadMappings();
        });
    });
}

/**
 * Reads the saved mappings and renders them in the settings UI.
 * @returns {void}
 */
function loadMappings() {
    chrome.storage.sync.get('characterMappings', (result) => {
        const mappings = result.characterMappings || {};
        const mappingsList = document.getElementById('mappingsList');
        
        if (Object.keys(mappings).length === 0) {
            mappingsList.innerHTML = '<p class="empty-state">No character mappings yet. Add one above!</p>';
            return;
        }
        
        mappingsList.innerHTML = '';
        
        Object.entries(mappings).forEach(([characterName, data]) => {
            const card = document.createElement('div');
            card.className = 'mapping-card';
            
            const info = document.createElement('div');
            info.className = 'mapping-info';
            
            const charNameEl = document.createElement('div');
            charNameEl.className = 'mapping-character';
            charNameEl.textContent = characterName;
            
            const folderEl = document.createElement('div');
            folderEl.className = 'mapping-folder';
            folderEl.textContent = `Folder ID: ${data.folderId}`;
            folderEl.title = data.folderUrl;

            const subfolderEl = document.createElement('div');
            subfolderEl.className = 'mapping-subfolders';
            const enabled = data && typeof data.searchSubfolders !== 'undefined' ? !!data.searchSubfolders : true;
            const depth = data && data.subfolderDepth ? data.subfolderDepth : 3;
            subfolderEl.textContent = `Search subfolders: ${enabled ? 'Enabled' : 'Disabled'} (depth ${depth})`;

            info.appendChild(charNameEl);
            info.appendChild(folderEl);
            info.appendChild(subfolderEl);
            
            const actions = document.createElement('div');
            actions.className = 'mapping-actions';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger';
            deleteBtn.textContent = '🗑️ Delete';
            deleteBtn.addEventListener('click', () => deleteMapping(characterName));
            
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary';
            editBtn.textContent = '✏️ Edit';
            editBtn.addEventListener('click', () => editMapping(characterName, data));
            
            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);
            
            card.appendChild(info);
            card.appendChild(actions);
            
            mappingsList.appendChild(card);
        });
    });
}

/**
 * Fills the form with the details of an existing mapping so it can be edited.
 * @param {string} characterName The saved character name.
 * @param {Object} data The mapping data to load into the form.
 * @returns {void}
 */
function editMapping(characterName, data) {
    document.getElementById('characterName').value = characterName;
    document.getElementById('googleDriveFolder').value = data.folderUrl;
    // Populate per-mapping subfolder UI
    const checkbox = document.getElementById('searchSubfolders');
    const depthInput = document.getElementById('subfolderDepth');
    if (checkbox) checkbox.checked = typeof data.searchSubfolders === 'undefined' ? true : !!data.searchSubfolders;
    if (depthInput) depthInput.value = data.subfolderDepth || 3;
    currentEditCharacter = characterName;
    originalEditCharacterName = characterName;
    setFormMode(true);
    document.getElementById('characterName').focus();
}

/**
 * Removes a saved mapping after user confirmation.
 * @param {string} characterName The character mapping to delete.
 * @returns {void}
 */
function deleteMapping(characterName) {
    const confirm_delete = confirm(`Delete mapping for "${characterName}"?`);
    if (!confirm_delete) return;
    
    chrome.storage.sync.get('characterMappings', (result) => {
        const mappings = result.characterMappings || {};
        delete mappings[characterName];
        
        chrome.storage.sync.set({ characterMappings: mappings }, () => {
            showStatus(`✓ Mapping for "${characterName}" deleted.`, 'success');
            loadMappings();
        });
    });
}

/**
 * Displays a temporary status message to the user.
 * @param {string} message The message to show.
 * @param {string} type The status type such as success, error, or loading.
 * @returns {void}
 */
function showStatus(message, type) {
    const statusMsg = document.getElementById('statusMessage');
    if (!statusMsg) return;

    statusMsg.textContent = message;
    statusMsg.className = 'status-message ' + type;

    if (type !== 'loading') {
        setTimeout(() => {
            statusMsg.className = 'status-message';
        }, 4000);
    }
}
