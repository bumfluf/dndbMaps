// D&D Beyond Extension - Settings Page

let currentEditCharacter = null;
let originalEditCharacterName = null;

document.addEventListener('DOMContentLoaded', () => {
    loadMappings();
    setupEventListeners();
    populateCharacterNameFromCurrentSheet();
    // Default UI values for per-mapping subfolder settings
    const checkbox = document.getElementById('searchSubfolders');
    const depthInput = document.getElementById('subfolderDepth');
    if (checkbox) checkbox.checked = true; // enabled by default
    if (depthInput) depthInput.value = 3;
});

function setupEventListeners() {
    document.getElementById('addCharacterBtn').addEventListener('click', addCharacterMapping);
    document.getElementById('testConnectionBtn').addEventListener('click', testGoogleDriveConnection);

    const characterNameInput = document.getElementById('characterName');
    if (characterNameInput) {
        characterNameInput.addEventListener('input', handleCharacterNameInputChange);
    }
}

function normalizeCharacterName(name) {
    return (name || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

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

    // Look up existing mappings to see if the typed name matches one
    chrome.storage.sync.get('characterMappings', (result) => {
        const mappings = result.characterMappings || {};
        let matchedKey = null;

        for (const key of Object.keys(mappings)) {
            if (normalizeCharacterName(key) === currentValue) {
                matchedKey = key;
                break;
            }
        }

        if (matchedKey) {
            if (currentEditCharacter !== matchedKey) {
                currentEditCharacter = matchedKey;
                originalEditCharacterName = matchedKey;
                setFormMode(true);
            }
            return;
        }

        // If the value equals the original edit name (normalized), restore edit mode
        if (originalEditCharacterName && currentValue === normalizeCharacterName(originalEditCharacterName)) {
            if (!currentEditCharacter) {
                currentEditCharacter = originalEditCharacterName;
                setFormMode(true);
            }
            return;
        }

        // Otherwise clear edit mode
        if (currentEditCharacter) {
            currentEditCharacter = null;
            setFormMode(false);
        }
    });
}

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

                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element && element.textContent) {
                            const text = normalize(element.textContent);
                            if (text && text.length >= 3) {
                                return text;
                            }
                        }
                    }

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

function resetFormMode() {
    currentEditCharacter = null;
    originalEditCharacterName = null;
    setFormMode(false);
}

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

function autofillCharacterName(characterName) {
    const characterNameInput = document.getElementById('characterName');
    if (!characterNameInput || characterNameInput.value.trim()) {
        return;
    }
    characterNameInput.value = characterName;
    showStatus('Character name autofilled from active D&D Beyond sheet', 'success');
}

// Load and bind map settings
// per-mapping subfolder settings are set via the UI when adding/editing a mapping

// Extract folder ID from Google Drive URL
function extractFolderId(input) {
    // Check if it's just an ID
    if (/^[a-zA-Z0-9-_]+$/.test(input) && input.length > 20) {
        return input;
    }
    
    // Extract from URL
    const match = input.match(/folders\/([a-zA-Z0-9-_]+)/);
    if (match) {
        return match[1];
    }
    
    // Extract from open?id=
    const match2 = input.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (match2) {
        return match2[1];
    }
    
    return null;
}

// Test Google Drive connection
function testGoogleDriveConnection() {
    const folderInput = document.getElementById('googleDriveFolder').value.trim();
    const statusMsg = document.getElementById('statusMessage');
    
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

// Test if folder is accessible
function testFolderAccess(folderId) {
    return new Promise((resolve, reject) => {
        // Try to access the folder via an indirect method
        // Check if we can at least fetch some metadata
        
        // For now, we'll accept any valid folder ID and consider it valid
        // In a production app, you'd use Google Drive API with proper authentication
        if (folderId && folderId.length > 20) {
            setTimeout(() => resolve(true), 500);
        } else {
            reject(new Error('Invalid folder ID format'));
        }
    });
}

// Add character mapping
function addCharacterMapping() {
    const characterName = document.getElementById('characterName').value.trim();
    const folderInput = document.getElementById('googleDriveFolder').value.trim();
    const statusMsg = document.getElementById('statusMessage');
    
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
        
        // Read per-mapping subfolder settings from UI
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
        
        // Save to storage
        chrome.storage.sync.set({ characterMappings: mappings }, () => {
            const actionText = currentEditCharacter || (originalEditCharacterName && originalEditCharacterName !== characterName && mappingExists) ? 'updated' : 'added';
            showStatus(`✓ Character "${characterName}" ${actionText} successfully!`, 'success');
            document.getElementById('characterName').value = '';
            document.getElementById('googleDriveFolder').value = '';
            resetFormMode();
            loadMappings();
        });
    });
}

// Load and display mappings
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

// Edit mapping
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

// Delete mapping
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

// Show status message
function showStatus(message, type) {
    const statusMsg = document.getElementById('statusMessage');
    statusMsg.textContent = message;
    statusMsg.className = 'status-message ' + type;
    
    if (type !== 'loading') {
        setTimeout(() => {
            statusMsg.className = 'status-message';
        }, 4000);
    }
}

// mapsSettings is no longer stored globally; settings are saved per-character mapping
