/*
 * File: content.js
 * Purpose: Runs inside D&D Beyond pages and builds the in-page Maps experience.
 * Contribution: This file detects the active character, injects a Maps tab into the character sheet UI, loads Google Drive map data, and renders searchable thumbnail cards directly inside D&D Beyond.
 */


/**
 * Responds to requests from the settings page for the currently detected character name.
 * @param {Object} message The runtime message sent from another extension context.
 * @param {Object} sender The sender information for the message.
 * @param {Function} sendResponse The callback used to reply to the message.
 * @returns {void}
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getCharacterName') {
        if (currentCharacterName || findCharacterName()) {
            sendResponse({ characterName: currentCharacterName });
        } else {
            sendResponse({ characterName: null });
        }
    }
});

/**
 * Adds a small style block to keep the injected Maps tab buttons readable inside D&D Beyond.
 * @returns {void}
 */
function injectTabButtonStyles() {
    if (document.querySelector('#ddb-maps-tab-style')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'ddb-maps-tab-style';
    style.textContent = `
        menu.styles_tabs__aTttL button.styles_tabButton__wvSLf {
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            min-width: 0 !important;
            max-width: 100% !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
        }
        menu.styles_tabs__aTttL button.styles_tabButton__wvSLf span,
        menu.styles_tabs__aTttL button.styles_tabButton__wvSLf {
            white-space: nowrap !important;
        }
        menu.styles_tabs__aTttL li {
            min-width: 0 !important;
        }
    `;
    document.head.appendChild(style);
}

// Initialize extension and inject Maps tab
/**
 * Initializes the Maps experience for the current character sheet.
 * @returns {Promise<void>} Resolves after the tab, settings, and warmup logic have been prepared.
 */
async function initializeExtension() {
    
    injectTabButtonStyles();
    
    // Detect the current character before trying to build the Maps UI.
    await getCharacterName();
    await loadCharacterSettings();

    // Warm up the mapped folder in the background so later loads feel faster.
    if (currentCharacterSettings && currentCharacterSettings.folderId) {
        setTimeout(() => {
            void preloadMapsCacheIfNeeded();
        }, 250);
    }
    
    injectMapsTab();
}

// Get the character name from the page
let currentCharacterName = null;
let lastCharacterUrl = null;
let currentCharacterSettings = null;
/**
 * Detects the current character name from the page, retrying briefly if the DOM is still loading.
 * @returns {Promise<void>} Resolves once the character name has been found or retries have finished.
 */
async function getCharacterName() {
    // The page can change between character sheets, so clear the cached name when the URL changes.
    try {
        const href = window.location.href;
        if (lastCharacterUrl !== href) {
            currentCharacterName = null;
            lastCharacterUrl = href;
        }
    } catch (e) {
        // ignore
    }

    if (currentCharacterName) {
        return;
    }

    // Try once immediately and then keep retrying while the page finishes rendering.
    if (findCharacterName()) {
        return;
    }

    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Wait briefly between retries. The character header may not be present until
        // D&D Beyond finishes client-side rendering, so retry a few times instead of failing.
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (findCharacterName()) {
            return;
        }
    }
}

/**
 * Looks for a valid character name in the current D&D Beyond page markup.
 * @returns {boolean} True when a likely character name was found.
 */
function findCharacterName() {
    const invalidCharacterNames = new Set(['', 'profile', 'settings', 'home', 'extras']);

    const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

    const tryCandidate = (candidate, source) => {
        if (!candidate) return false;
        const cand = candidate.toString().replace(/\s+/g, ' ').trim();
        if (cand.length < 3 || cand.length > 80) return false;
        const low = cand.toLowerCase();
        if (invalidCharacterNames.has(low)) return false;
        if (/d\s*&?\s*d beyond/i.test(low) || /https?:\/\//i.test(cand)) return false;
        // Normalize to an alphanumeric-only form for stricter length checks (removes punctuation/whitespace).
        const normalized = normalize(cand);
        if (normalized.length < 3) return false;
        currentCharacterName = cand;
        return true;
    };
    // Prefer the D&D Beyond character header selectors because they are the most reliable signals on the sheet.
    try {
        const hdr = document.querySelector('.ddbc-character-tidbits__heading h1, h1.styles_characterName__2x8wQ');
        if (hdr && hdr.textContent && tryCandidate(hdr.textContent, 'character header (preferred)')) return true;
    } catch (e) {
        // ignore
    }
    return false;
}
let currentMapsSearchQuery = '';
let currentMapsList = [];
let currentMapsRenderedCharacter = null;
let currentMapsRenderedState = null;
let currentMapsSortDirection = 'none';
let mapsCachePreloadStarted = false;
let mapsCachePreloadPromise = null;
let mapsCachePreloadFolderId = null;
const MAPS_CACHE_WARMUP_TTL_MS = 30 * 60 * 1000;

/**
 * Applies CSS rules to an element while forcing them to override site styles.
 * @param {HTMLElement|null} element The element to style.
 * @param {Object<string, string>} styles A map of CSS property names to values.
 * @returns {void}
 */
function setImportantStyles(element, styles) {
    const helpers = window.__dndBeyondContentHelpers || {};
    if (helpers.setImportantStyles) {
        helpers.setImportantStyles(element, styles);
        return;
    }

    if (!element || !styles) return;
    Object.entries(styles).forEach(([name, value]) => {
        element.style.setProperty(name, value, 'important');
    });
}

/**
 * Checks whether a folder warmup cache entry is still fresh.
 * @param {string} folderId The Google Drive folder identifier to inspect.
 * @returns {Promise<Object|null>} The cached warmup entry when it is still valid, otherwise null.
 */
function getMapsWarmupState(folderId) {
    return new Promise((resolve) => {
        chrome.storage.local.get('dndMapsWarmup', (result) => {
            const state = result.dndMapsWarmup || {};
            const entry = state[folderId];
            if (!entry || !entry.completed || !entry.ts) {
                resolve(null);
                return;
            }
            const isFresh = (Date.now() - entry.ts) < MAPS_CACHE_WARMUP_TTL_MS;
            resolve(isFresh ? entry : null);
        });
    });
}

/**
 * Persists the warmup state for a folder so future loads can reuse the cache quickly.
 * @param {string} folderId The Google Drive folder identifier to update.
 * @param {boolean} completed Whether the preload completed successfully.
 * @param {number} entryCount The number of map entries discovered during preload.
 * @returns {Promise<void>} Resolves after the warmup state is stored.
 */
function setMapsWarmupState(folderId, completed, entryCount) {
    return new Promise((resolve) => {
        chrome.storage.local.get('dndMapsWarmup', (result) => {
            const state = result.dndMapsWarmup || {};
            state[folderId] = { ts: Date.now(), completed, entryCount };
            chrome.storage.local.set({ dndMapsWarmup: state }, () => resolve());
        });
    });
}

/**
 * Preloads the folder data for the mapped character so later map views can load faster.
 * @returns {Promise<Array|Object|null>} The preload promise when started, otherwise null or an empty result.
 */
async function preloadMapsCacheIfNeeded() {
    if (!currentCharacterSettings || !currentCharacterSettings.folderId) {
        return null;
    }

    const folderId = currentCharacterSettings.folderId;

    if (mapsCachePreloadStarted) {
        if (mapsCachePreloadFolderId === folderId) {
            return mapsCachePreloadPromise;
        }
        return null;
    }

    const warmupState = await getMapsWarmupState(folderId);
    if (warmupState) {
        return null;
    }

    mapsCachePreloadStarted = true;
    mapsCachePreloadFolderId = folderId;
    mapsCachePreloadPromise = fetchGoogleDriveMaps(folderId, () => {})
        .then((maps) => {
            return setMapsWarmupState(folderId, true, maps.length)
                .then(() => maps);
        })
        .catch((error) => {
            return setMapsWarmupState(folderId, false, 0)
                .then(() => {
                    return [];
                });
        });

    return mapsCachePreloadPromise;
}

/**
 * Loads the saved character mapping for the detected character name.
 * @returns {Promise<Object|null>} The saved mapping data for the current character, if found.
 */
function loadCharacterSettings() {
    return new Promise((resolve) => {
        if (!currentCharacterName) {
            currentCharacterSettings = null;
            resolve(null);
            return;
        }
        
        chrome.storage.sync.get('characterMappings', (result) => {
            const mappings = result.characterMappings || {};
            
            // Use an exact stored name match so a similar name does not accidentally load the wrong folder.
            if (mappings[currentCharacterName]) {
                currentCharacterSettings = mappings[currentCharacterName];
                resolve(currentCharacterSettings);
                return;
            }

            currentCharacterSettings = null;
            resolve(currentCharacterSettings);
        });
    });
}

// The Maps experience is attached to the same tab system used by the character sheet.
let mapsTabActive = false;
let mapsUiObserver = null;
let mapsResizeTimer = null;

/**
 * Adds a Maps tab button to the character sheet tab menu when it is available.
 * @returns {void}
 */
function injectMapsTab() {
    const tabsMenu = document.querySelector('menu.styles_tabs__aTttL');
    
    if (!tabsMenu) {
        setTimeout(injectMapsTab, 2000);
        return;
    }
    
    const existingMapsTab = tabsMenu.querySelector('[data-testid="MAPS"]');
    if (existingMapsTab) {
        setupMapsTabHandler();
        return;
    }
    
    try {
        const mapsTabButton = document.createElement('button');
        mapsTabButton.className = 'styles_tabButton__wvSLf';
        mapsTabButton.setAttribute('role', 'radio');
        mapsTabButton.setAttribute('aria-checked', 'false');
        mapsTabButton.setAttribute('data-testid', 'MAPS');
        mapsTabButton.textContent = 'Maps';
        
        const mapsTabLi = document.createElement('li');
        mapsTabLi.appendChild(mapsTabButton);
        
        tabsMenu.appendChild(mapsTabLi);
        setupMapsTabHandler();
    } catch (error) {
        console.error('Error injecting Maps tab:', error);
    }
}

// Setup Maps tab handler
/**
 * Attaches click behavior to the Maps tab button once the tab exists in the DOM.
 * @returns {void}
 */
function setupMapsTabHandler() {
    const mapsTabButton = document.querySelector('[data-testid="MAPS"]');
    
    if (!mapsTabButton) {
        setTimeout(setupMapsTabHandler, 500);
        return;
    }
    
    if (mapsTabButton.dataset.mapsHandlerBound === 'true') {
        setupGlobalTabHandlers();
        setupMapsReactivity();
        return;
    }
    
    try {
        mapsTabButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            updateTabSelection(mapsTabButton);
            handleMapsTabClick();
        });
        mapsTabButton.dataset.mapsHandlerBound = 'true';
        setupGlobalTabHandlers();
        setupMapsReactivity();
    } catch (error) {
        console.error('Error setting up tab handler:', error);
    }
}

/**
 * Ensures other tab buttons hide the Maps panel when the user switches away from Maps.
 * @returns {void}
 */
function setupGlobalTabHandlers() {
    if (window.__ddbMapsGlobalTabsHandlerBound) {
        return;
    }

    document.body.addEventListener('click', (event) => {
        const button = event.target.closest('button.styles_tabButton__wvSLf');
        if (!button) {
            return;
        }

        const dataTestId = button.getAttribute('data-testid');

        if (dataTestId === 'MAPS') {
            return;
        }

        mapsTabActive = false;

        const root = findTabPanelsRoot();
        const mapsContainers = root ? root.querySelectorAll('.ct-primary-box__tab-maps') : document.querySelectorAll('.ct-primary-box__tab-maps');
        mapsContainers.forEach((mapsContainer) => {
            mapsContainer.style.setProperty('display', 'none', 'important');
        });

        const allTabContainers = root ? root.querySelectorAll('[class*="ct-primary-box__tab"]:not(.ct-primary-box__tab-maps)') : document.querySelectorAll('[class*="ct-primary-box__tab"]:not(.ct-primary-box__tab-maps)');
        allTabContainers.forEach(container => {
            container.style.display = '';
        });

        updateTabSelection(button);
        clearMapsActiveFromTabs();
    }, true);

    window.__ddbMapsGlobalTabsHandlerBound = true;
}

/**
 * Watches the page for DOM changes so the injected Maps tab stays connected to D&D Beyond's UI.
 * @returns {void}
 */
function setupMapsReactivity() {
    if (mapsUiObserver) {
        return;
    }

    mapsUiObserver = new MutationObserver(() => {
        if (document.querySelector('menu.styles_tabs__aTttL') && !document.querySelector('[data-testid="MAPS"]')) {
            injectMapsTab();
        }

        if (mapsTabActive) {
            // If Maps is currently active, DOM mutations may change layout or detach elements.
            // Schedule a recovery to re-apply selection and restore visibility after mutations settle.
            scheduleMapsRecovery();
        }
    });

    const observerTarget = document.body;
    if (observerTarget) {
        mapsUiObserver.observe(observerTarget, { childList: true, subtree: true });
    }

    window.addEventListener('resize', scheduleMapsRecovery);
}

/**
 * Re-applies the Maps UI state after layout or tab changes.
 * @returns {void}
 */
function scheduleMapsRecovery() {
    if (mapsResizeTimer) {
        clearTimeout(mapsResizeTimer);
    }

    mapsResizeTimer = setTimeout(() => {
        const tabsMenu = document.querySelector('menu.styles_tabs__aTttL');
        if (!tabsMenu) {
            return;
        }

        if (!document.querySelector('[data-testid="MAPS"]')) {
            injectMapsTab();
            return;
        }

        if (mapsTabActive) {
            const mapsTab = document.querySelector('[data-testid="MAPS"]');
            if (mapsTab) {
                updateTabSelection(mapsTab);
                const mapsContainer = ensureMapsPanelVisible();
                if (mapsContainer) {
                    mapsContainer.style.display = 'block';
                }
            }
        }
    }, 150);
}

/**
 * Makes the Maps tab panel visible and populated when the Maps tab is active.
 * @returns {HTMLElement|null} The Maps panel container if it exists.
 */
function ensureMapsPanelVisible() {
    // Keep the Maps content as a sibling panel instead of nesting it inside another tab panel.
    // That helps the UI stay visible and behave like the rest of the character sheet.
    const root = findTabPanelsRoot();
    if (!root) return null;
    const mapsTabContainerSelector = '.ct-primary-box__tab-maps';
    let mapsTabContainer = root.querySelector(mapsTabContainerSelector);

    if (mapsTabActive) {
        hideNonMapsTabContainers(root);
        populateMapsContent(root);

        mapsTabContainer = root.querySelector(mapsTabContainerSelector);
        if (mapsTabContainer) {
            setImportantStyles(mapsTabContainer, {
                display: 'block',
                visibility: 'visible',
                opacity: '1',
                position: 'relative',
                'z-index': '10000',
                'min-height': '0',
                background: 'transparent',
                width: '100%'
            });
        }

        return mapsTabContainer || root.querySelector('.ct-maps-section') || null;
    } else {
        if (mapsTabContainer) {
            mapsTabContainer.style.setProperty('display', 'none', 'important');
        }
        return mapsTabContainer || null;
    }
}

/**
 * Finds the shared tab panel container that should hold the Maps content.
 * @returns {HTMLElement|Element|Node} The relevant parent container for tab panels.
 */
function findTabPanelsRoot() {
    const tabsMenu = document.querySelector('menu.styles_tabs__aTttL');
    if (tabsMenu) {
        const tabSection = tabsMenu.closest('section, div, main');
        if (tabSection) {
            const contentPanel = tabSection.querySelector('div[class*="ct-primary-box__tab-"]');
            if (contentPanel && contentPanel.parentElement) {
                return contentPanel.parentElement;
            }
            const fallbackPanelRoot = tabSection.querySelector('div[class*="ct-primary-box"]');
            if (fallbackPanelRoot) {
                return fallbackPanelRoot;
            }
            return tabSection;
        }
    }
    return document.querySelector('.ct-primary-box__content, .ct-primary-box, main') || document.body;
}

/**
 * Updates the active styling for the tab buttons to reflect the selected tab.
 * @param {HTMLElement} selectedButton The tab button that should appear selected.
 * @returns {void}
 */
function updateTabSelection(selectedButton) {
    const tabsMenu = document.querySelector('menu.styles_tabs__aTttL');
    if (!tabsMenu) {
        return;
    }

    const tabButtons = tabsMenu.querySelectorAll('button.styles_tabButton__wvSLf');
    tabButtons.forEach((tabButton) => {
        const isSelected = tabButton === selectedButton;
        tabButton.setAttribute('role', 'radio');
        tabButton.setAttribute('aria-checked', isSelected ? 'true' : 'false');

        if (tabButton.getAttribute('data-testid') === 'MAPS') {
            tabButton.classList.toggle('maps-active', isSelected);
        } else {
            tabButton.classList.remove('maps-active');
        }
    });
}

/**
 * Removes the active styling marker from any tab buttons that are not currently selected.
 * @returns {void}
 */
function clearMapsActiveFromTabs() {
    const activeMapButtons = document.querySelectorAll('button.styles_tabButton__wvSLf.maps-active');
    activeMapButtons.forEach((button) => button.classList.remove('maps-active'));
}


/**
 * Hides the non-Maps tab panels so only the Maps content remains visible when the Maps tab is active.
 * @param {HTMLElement|null} root The container that owns the tab panels.
 * @returns {void}
 */
function hideNonMapsTabContainers(root) {
    // Only hide sibling tab panels inside the provided root (tab panels container).
    // If no root is provided, fall back to global behavior but warn.
    const selector = '[class*="ct-primary-box__tab-"]:not(.ct-primary-box__tab-maps)';
    let containers = [];
    if (root) {
        containers = Array.from(root.querySelectorAll(selector));
        if (!containers.length) {
            containers = Array.from(root.children).filter(c => c.className && c.className.indexOf('ct-primary-box__tab-') !== -1 && c.className.indexOf('ct-primary-box__tab-maps') === -1);
        }
    } else {
        containers = Array.from(document.querySelectorAll(selector));
    }
    containers.forEach(container => {
        container.style.display = 'none';
    });
}

/**
 * Handles activation of the Maps tab by showing the Maps panel and hiding the other tab content.
 * @returns {void}
 */
function handleMapsTabClick() {
    try {
        mapsTabActive = true;

        const mapsTab = document.querySelector('[data-testid="MAPS"]');
        if (mapsTab) {
            updateTabSelection(mapsTab);
        }

        const root = findTabPanelsRoot();
        hideNonMapsTabContainers(root);

        const mapsContainer = ensureMapsPanelVisible();
        if (mapsContainer) {
            mapsContainer.style.display = 'block';
        }
    } catch (error) {
        console.error('Error in handleMapsTabClick:', error);
    }
}

// Populate maps content matching Extras structure
/**
 * Creates the Maps UI container inside the character sheet tab area and loads content into it.
 * @param {HTMLElement} container The parent container that should own the Maps panel.
 * @returns {HTMLElement} The Maps panel element that was created or reused.
 */
function populateMapsContent(container) {
    
    // The parent container holds the tab panels, so create a dedicated child panel for Maps.
    // This keeps the new UI separate from the existing tab content instead of overwriting it.
    const parent = container;
    const mapsTabSelector = '.ct-primary-box__tab-maps';
    let mapsTab = parent.querySelector(mapsTabSelector);

    if (!mapsTab) {
        mapsTab = document.createElement('div');
        mapsTab.className = 'ct-primary-box__tab-maps';
        parent.appendChild(mapsTab);
    }

    // Reuse the existing Maps section if it was already created, otherwise build it from scratch.
    const existingContent = mapsTab.querySelector('.ct-maps-section');
    if (existingContent) {
        setImportantStyles(mapsTab, {
            display: 'block',
            visibility: 'visible',
            opacity: '1',
            position: 'relative',
            'z-index': '1000',
            background: '#fff'
        });
        existingContent.style.display = '';
        ensureMapsContentLoaded(mapsTab);
        return mapsTab;
    }

    setImportantStyles(mapsTab, {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'relative',
        'z-index': '1000',
        background: '#fff'
    });

    mapsTab.innerHTML = `
            <section class="ct-extras ct-maps-section" style="padding: 0 0px 20px; display: flex; flex-direction: column; min-height: 100%; height: 100%; width: 100%; box-sizing: border-box;">
                <h2 class="accessibility_screenreaderOnly__OEzRB">Maps</h2>

                <div class="ct-equipment__filter" style="margin-bottom: 0px; width: 100%; display: flex; align-items: center; gap: 8px;">
                    <div class="ct-inventory-filter" style="width: 100%; flex: 1 1 auto;">
                        <div class="ct-inventory-filter__interactions" style="width: 100%;">
                            <div class="ct-inventory-filter__box" style="width: 100%;">
                                <div class="ct-inventory-filter__primary" style="width: 100%; display: flex; align-items: center; gap: 0px;">
                                    <div class="ct-inventory-filter__primary-group ct-inventory-filter__primary-group--first" style="display: flex; align-items: center; justify-content: center;">
                                        <div class="ct-inventory-filter__icon"></div>
                                    </div>
                                    <div class="ct-inventory-filter__field" style="flex: 1 1 auto;">
                                        <input class="ct-inventory-filter__input" placeholder="Search Maps" type="search" value="" aria-label="Search maps by name">
                                    </div>
                                    <div class="ct-inventory-filter__clear" style="display: none;">Clear X</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button class="ct-maps-sort-button" type="button" aria-label="Sort maps" title="Sort maps alphabetically" style="background: transparent; border: none; box-shadow: none; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; transform: translateY(-6px); cursor: pointer; font-size: 26px; font-weight: 1000; color: #000; padding: 0; line-height: 1; flex-shrink: 0;">⇅</button>
                </div>

                <div class="ct-extras__content" id="maps-content-area" style="
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
                    gap: 15px;
                    min-height: 0;
                    flex: 1 1 auto;
                    width: 100%;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 0 0 18px 0;
                    box-sizing: border-box;
                ">
                </div>

                <div class="ct-extras__empty" id="maps-empty-state" style="margin-top: 20px; display:none;"></div>
            </section>
    `;
    setupMapsSearch(mapsTab);
    loadCharacterSettings().then(() => {
        loadStoredMaps(mapsTab);
    });

    return mapsTab;
}

/**
 * Connects search, clear, and sort controls to the Maps UI inside a tab container.
 * @param {HTMLElement} mapsTab The Maps tab container element.
 * @returns {void}
 */
function setupMapsSearch(mapsTab) {
    const searchInput = mapsTab.querySelector('.ct-inventory-filter__input');
    const clearButton = mapsTab.querySelector('.ct-inventory-filter__clear');
    const filterWrapper = mapsTab.querySelector('.ct-inventory-filter');
    const sortButton = mapsTab.querySelector('.ct-maps-sort-button');
    if (!searchInput || searchInput.dataset.mapsSearchBound === 'true' || !clearButton || !filterWrapper) {
        return;
    }

    const contentArea = mapsTab.querySelector('#maps-content-area');
    const emptyState = mapsTab.querySelector('#maps-empty-state');
    if (!contentArea || !emptyState) {
        return;
    }

    searchInput.dataset.mapsSearchBound = 'true';
    clearButton.dataset.mapsClearBound = 'true';
    clearButton.style.display = 'none';
    filterWrapper.classList.remove('ct-inventory-filter--has-filter');

    const updateSearch = (value) => {
        currentMapsSearchQuery = (value || '').toLowerCase().trim();
        const hasFilter = currentMapsSearchQuery.length > 0;
        clearButton.style.display = hasFilter ? 'inline-block' : 'none';
        filterWrapper.classList.toggle('ct-inventory-filter--has-filter', hasFilter);
        displayMaps(currentMapsList, contentArea, emptyState);
    };

    searchInput.addEventListener('input', (event) => {
        updateSearch(event.target.value);
    });

    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        updateSearch('');
        searchInput.focus();
    });

    // Detect the sheet theme from the character sheet colors so the sort button can match it.
    function isUnderdarkActive() {
        const characterSheet = document.querySelector('.ct-character-sheet');
        if (!characterSheet) return false;
        const textColor = window.getComputedStyle(characterSheet).color;
        return textColor === 'rgb(162, 172, 178)';
    }

    // Update the sort arrow color instead of injecting a new icon, keeping the UI simple and theme-aware.
    function updateSortButtonColor() {
        if (!sortButton) return;
        const dark = isUnderdarkActive();
        let arrowSpan = sortButton.querySelector('.ct-maps-sort-arrow');
        if (!arrowSpan) {
            arrowSpan = document.createElement('span');
            arrowSpan.className = 'ct-maps-sort-arrow';
            arrowSpan.style.cssText = 'margin-left:-6px;font-size:20px;line-height:1;display:inline-block;';
            arrowSpan.textContent = '⇅';
            // reset button content and append arrow span
            sortButton.innerHTML = '';
            sortButton.appendChild(arrowSpan);
        }
        const color = dark ? '#ffffff' : '#242528';
        arrowSpan.style.color = color;
        sortButton.style.color = color;
    }

    // Initialize the sort button color and watch the character sheet for theme changes.
    updateSortButtonColor();
    try {
        const sheetNode = document.querySelector('.ct-character-sheet');
        if (sheetNode) {
            const sheetObserver = new MutationObserver((mutations) => {
                for (const m of mutations) {
                    if (m.type === 'attributes') {
                        updateSortButtonColor();
                        break;
                    }
                }
            });
            sheetObserver.observe(sheetNode, { attributes: true, attributeFilter: ['class', 'style'] });
        } else {
            const bodyObserver = new MutationObserver((mutations, obs) => {
                if (document.querySelector('.ct-character-sheet')) {
                    updateSortButtonColor();
                    obs.disconnect();
                }
            });
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        }
    } catch (e) {
        // ignore
    }

    if (sortButton) {
        sortButton.addEventListener('click', () => {
            const nextDirection = currentMapsSortDirection === 'asc' ? 'desc' : (currentMapsSortDirection === 'desc' ? 'none' : 'asc');
            currentMapsSortDirection = nextDirection;
            const arrowSpan = sortButton.querySelector('.ct-maps-sort-arrow');
            if (arrowSpan) arrowSpan.textContent = nextDirection === 'asc' ? '↑' : (nextDirection === 'desc' ? '↓' : '⇅');
            sortButton.title = nextDirection === 'asc' ? 'Sort Z-A' : (nextDirection === 'desc' ? 'Reset sort order' : 'Sort A-Z');
            if (currentMapsList.length > 0) {
                displayMaps(currentMapsList, contentArea, emptyState);
            }
        });
    }
}

/**
 * Reloads Maps content when the tab is first shown and no content has been rendered yet.
 * @param {HTMLElement} mapsTab The Maps tab container element.
 * @returns {void}
 */
function ensureMapsContentLoaded(mapsTab) {
    const contentArea = mapsTab.querySelector('#maps-content-area');
    const emptyState = mapsTab.querySelector('#maps-empty-state');
    if (!contentArea || !emptyState) {
        return;
    }

    const isEmpty = contentArea.children.length === 0 || contentArea.style.display === 'none';
    const hasActiveSearch = (currentMapsSearchQuery || '').trim().length > 0;
    const currentState = currentCharacterSettings ? 'mapped' : 'no-mapping';

    if (isEmpty && !hasActiveSearch && (currentMapsRenderedCharacter !== currentCharacterName || currentMapsRenderedState !== currentState)) {
        loadStoredMaps(mapsTab);
    }
}

// Maps are shown directly from the configured Google Drive folder, so this step decides which source to use.
/**
 * Loads map cards either from a saved Google Drive mapping or from the current character's configuration.
 * @param {HTMLElement} container The Maps tab container element.
 * @returns {void}
 */
function loadStoredMaps(container) {
    if (!container) return;
    
    const contentArea = container.querySelector('#maps-content-area');
    const emptyState = container.querySelector('#maps-empty-state');
    if (!contentArea || !emptyState) return;

    const contentState = currentCharacterSettings ? 'mapped' : 'no-mapping';
    if (currentCharacterName === currentMapsRenderedCharacter && contentState === currentMapsRenderedState) {
        return;
    }

    currentMapsRenderedCharacter = currentCharacterName;
    currentMapsRenderedState = contentState;

    // Use the configured Google Drive folder when a mapping exists for this character.
    if (currentCharacterSettings && currentCharacterSettings.folderId) {
        loadMapsFromGoogleDrive(container, contentArea, emptyState);
        return;
    }

    if (!currentCharacterName) {
        showMapsSettingsPrompt(contentArea, emptyState, 'Character name not detected.', 'The extension could not find the character name on this page. Open extension Settings and add a mapping linking your character\'s D&D Beyond name to a Google Drive folder.');
        return;
    }

    if (!currentCharacterSettings) {
        showMapsSettingsPrompt(contentArea, emptyState, 'No mapping found for this character.', `The character name <strong>${escapeHtml(currentCharacterName)}</strong> does not match any configured mapping. Open extension Settings to add or update the character-to-folder mapping.`);
        return;
    }

    // Fall back to the browser cache when no mapping is available for the current character.
    chrome.storage.local.get('dndMaps', (result) => {
        const maps = result.dndMaps || [];
        displayMaps(maps, contentArea, emptyState);
    });
}

// Load maps from Google Drive
/**
 * Fetches map entries from Google Drive and progressively renders them as thumbnails.
 * @param {HTMLElement} container The Maps tab container element.
 * @param {HTMLElement} contentArea The area that should receive map cards.
 * @param {HTMLElement} emptyState The area used for empty/error messages.
 * @returns {void}
 */
function loadMapsFromGoogleDrive(container, contentArea, emptyState) {
    contentArea.innerHTML = '';
    contentArea.style.display = 'grid';
    // Show a lightweight loading message until the first thumbnails start arriving.
    let loadingDiv = document.createElement('div');
    loadingDiv.id = 'maps-loading';
    loadingDiv.className = 'ct-maps-loading';
    loadingDiv.textContent = 'Retrieving maps from Google Drive…';
    // Use a parchment-like style so the loading notice feels consistent with the rest of the extension.
    loadingDiv.style.cssText = [
        'width:100%',
        'box-sizing:border-box',
        'padding:10px 14px',
        'margin:10px 0',
        'background:#fff8e1',
        'border:1px solid #d6c089',
        'border-radius:8px',
        'color:#3b2a0a',
        'font-size:14px',
        'font-weight:600',
        'line-height:1.2',
        'box-shadow: 0 1px 0 rgba(0,0,0,0.02) inset'
    ].join(';');
    try {
        if (contentArea && contentArea.parentElement) contentArea.parentElement.insertBefore(loadingDiv, contentArea);
    } catch (e) { /* ignore */ }
    
    // Keep the UI minimal while thumbnails appear progressively instead of waiting for the full fetch.
    currentMapsList = [];
    const accumulated = { maps: [], seen: new Set() };
    let appendedAny = false;

    const onProgress = (info) => {
        try {
            const newEntries = info && info.newEntries ? info.newEntries : [];
            const added = [];
            for (const e of newEntries) {
                if (!accumulated.seen.has(e.id)) {
                    accumulated.seen.add(e.id);
                    const imageUrls = buildGoogleDriveImageUrls(e.id);
                    const fullResolutionUrl = buildGoogleDriveFullResolutionUrl(e.id);
                    const mapObj = {
                        id: e.id,
                        name: e.name || `Google Drive Map ${accumulated.maps.length + 1}`,
                        url: imageUrls[0],
                        imageUrls,
                        fullResolutionUrl,
                        type: 'image/*',
                        source: 'google-drive'
                    };
                    accumulated.maps.push(mapObj);
                    currentMapsList.push(mapObj);
                    added.push(mapObj);
                }
            }
            if (added.length > 0) {
                appendedAny = true;
                // Remove the loading notice as soon as the first thumbnails are ready to show.
                try { if (loadingDiv && loadingDiv.parentElement) loadingDiv.remove(); } catch (er) { /* ignore */ }
                appendMapCards(added, contentArea);
            }
        } catch (e) {
        }
    };

    fetchGoogleDriveMaps(currentCharacterSettings.folderId, onProgress)
        .then(maps => {
            // Remove the loading notice when the fetch completes, whether it was ever shown or not.
            try { if (typeof loadingDiv !== 'undefined' && loadingDiv && loadingDiv.parentElement) loadingDiv.remove(); } catch (e) { /* ignore */ }

            if (!maps || maps.length === 0) {
                contentArea.style.display = 'none';
                if (emptyState) {
                    emptyState.innerHTML = 'No maps found in your Google Drive folder.<br><small>Make sure it contains PNG, JPEG, or BMP images.</small>';
                    emptyState.style.display = 'block';
                }
                return;
            }

            contentArea.style.display = 'grid';
            if (emptyState) emptyState.style.display = 'none';

            if (!appendedAny) {
                displayMaps(maps, contentArea, emptyState);
            }
        })
        .catch(error => {
            console.error('Error loading Google Drive maps:', error);
            try { if (typeof loadingDiv !== 'undefined' && loadingDiv && loadingDiv.parentElement) loadingDiv.remove(); } catch (e) { /* ignore */ }
            contentArea.innerHTML = '';
            contentArea.style.display = 'grid';
            if (emptyState) {
                const errMsg = (error && (error.error || error.message)) ? (error.error || error.message) : (typeof error === 'string' ? error : JSON.stringify(error));
                let diagnosticHtml = '';
                if (error && Array.isArray(error.attempts) && error.attempts.length > 0) {
                    diagnosticHtml = '<div style="margin-top:8px;font-size:13px;color:#4a412f;">Fetch attempts:<ul style="margin:6px 0;padding-left:18px;">';
                    for (const a of error.attempts) {
                        const statusText = a.ok ? `OK (${a.status || ''})` : (a.status ? `Failed (${a.status})` : 'Failed');
                        const errText = a.error ? ` - ${escapeHtml(a.error)}` : '';
                        diagnosticHtml += `<li><strong>${escapeHtml(a.url)}</strong> [${escapeHtml(a.used || '')}] ${escapeHtml(statusText)}${errText}</li>`;
                    }
                    diagnosticHtml += '</ul></div>';
                }

                emptyState.innerHTML = `⚠️ Could not load maps from Google Drive: ${escapeHtml(errMsg)}<br><small>Please check your settings and make sure the folder is accessible.</small><br><a href="https://drive.google.com/drive/folders/${currentCharacterSettings.folderId}" target="_blank" style="color:#4f8ef7;">Open folder in Google Drive</a>${diagnosticHtml}`;
                emptyState.style.display = 'block';
            }
        });
}

/**
 * Builds a list of possible Google Drive image URLs for a single file ID.
 * @param {string} fileId The Google Drive file identifier.
 * @returns {string[]} A list of image URL candidates.
 */
function buildGoogleDriveImageUrls(fileId) {
    const utils = window.__dndBeyondContentDriveUtils || null;
    if (utils && typeof utils.buildGoogleDriveImageUrls === 'function') {
        return utils.buildGoogleDriveImageUrls(fileId);
    }
    const helpers = window.__dndBeyondContentHelpers || {};
    if (helpers.buildGoogleDriveImageUrls) {
        return helpers.buildGoogleDriveImageUrls(fileId);
    }

    return [
        `https://drive.google.com/thumbnail?authuser=0&sz=w800&id=${fileId}`,
        `https://drive.google.com/thumbnail?authuser=0&sz=w1600&id=${fileId}`,
        `https://drive.google.com/thumbnail?authuser=0&sz=w2048&id=${fileId}`,
        `https://drive.google.com/uc?export=view&id=${fileId}&authuser=0`,
        `https://drive.google.com/uc?export=download&id=${fileId}&authuser=0`,
        `https://lh3.googleusercontent.com/d/${fileId}`
    ];
}

/**
 * Returns the preferred full-resolution URL for a Google Drive image.
 * @param {string} fileId The Google Drive file identifier.
 * @returns {string} A full-resolution image URL.
 */
function buildGoogleDriveFullResolutionUrl(fileId) {
    const utils = window.__dndBeyondContentDriveUtils || null;
    if (utils && typeof utils.buildGoogleDriveFullResolutionUrl === 'function') {
        return utils.buildGoogleDriveFullResolutionUrl(fileId);
    }
    const helpers = window.__dndBeyondContentHelpers || {};
    if (helpers.buildGoogleDriveFullResolutionUrl) {
        return helpers.buildGoogleDriveFullResolutionUrl(fileId);
    }
    return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/**
 * Fetches and normalizes map entries from Google Drive for the current character mapping.
 * @param {string} folderId The folder identifier to inspect.
 * @param {Function} onProgress Optional callback invoked as new entries are discovered.
 * @returns {Promise<Array>} The discovered map entries formatted for display.
 */
async function fetchGoogleDriveMaps(folderId, onProgress) {
    // If subfolder crawling is enabled for the mapping, walk the folder tree recursively.
    const seenIds = new Set();
    const maps = [];
    let fileEntries = [];
    try {
        const searchSubfolders = (currentCharacterSettings && typeof currentCharacterSettings.searchSubfolders !== 'undefined') ? !!currentCharacterSettings.searchSubfolders : true;
        const subfolderDepth = (currentCharacterSettings && currentCharacterSettings.subfolderDepth) ? Math.max(1, Math.min(6, parseInt(currentCharacterSettings.subfolderDepth, 10) || 3)) : 3;
        if (searchSubfolders) {
            const entries = await crawlDriveFolder(folderId, subfolderDepth, new Set(), onProgress);
            fileEntries = entries || [];
        } else {
            const html = await requestDriveFolderHtmlWithTimeout(folderId, 6000);
            if (!html) {
                return [];
            }
            fileEntries = extractGoogleDriveFileEntries(html, folderId);
        }
    } catch (err) {
        console.error('Error during fetchGoogleDriveMaps crawl:', err);
        return [];
    }
    fileEntries.forEach((entry) => {
        const fileId = entry.id;
        if (seenIds.has(fileId)) {
            return;
        }
        seenIds.add(fileId);

        const imageUrls = buildGoogleDriveImageUrls(fileId);
        const fullResolutionUrl = buildGoogleDriveFullResolutionUrl(fileId);
        maps.push({
            id: fileId,
            name: entry.name || `Google Drive Map ${maps.length + 1}`,
            url: imageUrls[0],
            imageUrls,
            fullResolutionUrl,
            type: 'image/*',
            source: 'google-drive'
        });
    });

    return maps;
}

// Cache parsed folder results so repeated visits can reuse the same Drive data.
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Reads the cached folder store from browser storage.
 * @returns {Promise<Object>} The cached folder data object.
 */
function getCachedFolderStore() {
    return new Promise((resolve) => {
        chrome.storage.local.get('dndMaps', (res) => {
            resolve(res.dndMaps || {});
        });
    });
}

/**
 * Stores folder parsing results in browser storage for later reuse.
 * @param {string} folderId The folder identifier to cache.
 * @param {Object} data The parsed folder metadata to save.
 * @returns {Promise<void>} Resolves after the cache update finishes.
 */
function setCachedFolderData(folderId, data) {
    return new Promise((resolve) => {
        chrome.storage.local.get('dndMaps', (res) => {
            const store = res.dndMaps || {};
            store[folderId] = data;
            chrome.storage.local.set({ dndMaps: store }, () => resolve());
        });
    });
}

/**
 * Requests Drive folder HTML with a timeout so slow requests do not hang the UI.
 * @param {string} folderId The folder identifier to fetch.
 * @param {number} [timeoutMs=5000] The maximum time to wait before failing.
 * @returns {Promise<string>} The fetched folder HTML.
 */
function requestDriveFolderHtmlWithTimeout(folderId, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('fetch-timeout'));
        }, timeoutMs);

        requestDriveFolderHtml(folderId)
            .then((html) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(html);
            })
            .catch((err) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(err);
            });
    });
}

// Crawl the folder tree in breadth-first order so the top-level content appears first.
/**
 * Recursively crawls Google Drive subfolders to collect image entries up to a chosen depth.
 * @param {string} rootFolderId The starting folder identifier.
 * @param {number} maxDepth The maximum subfolder depth to traverse.
 * @param {Set<string>} visitedSet A set of folders already visited to avoid loops.
 * @param {Function} onProgress Optional callback for incremental progress updates.
 * @returns {Promise<Array>} A flattened list of discovered image entries.
 */
async function crawlDriveFolder(rootFolderId, maxDepth, visitedSet, onProgress) {
    const results = [];
    if (!rootFolderId) return results;
    const visitedFolders = visitedSet || new Set();
    const seenFileIds = new Set();
    const queue = [{ id: rootFolderId, depth: 0 }];
    const cachedStore = await getCachedFolderStore();
    let scanned = 0;

    const processFolder = async (folderId, depthLeft) => {
        if (!folderId || visitedFolders.has(folderId)) return;
        visitedFolders.add(folderId);
        try {
            const cached = cachedStore[folderId];
            if (cached && (Date.now() - (cached.ts || 0) < CACHE_TTL_MS)) {
                const entries = cached.entries || [];
                const subfolders = cached.subfolders || [];
                for (const e of entries) {
                    if (!seenFileIds.has(e.id)) {
                        seenFileIds.add(e.id);
                        results.push(e);
                    }
                }
                scanned += 1;
                // When cached data exists and is fresh, use it to avoid network requests.
                // Still notify progress consumers so incremental UI updates can occur.
                if (entries.length > 0 || subfolders.length > 0) {
                }
                onProgress && onProgress({ newEntries: entries, folderId, scanned });
                if (depthLeft < maxDepth) {
                    for (const sf of subfolders) {
                        if (!visitedFolders.has(sf)) queue.push({ id: sf, depth: depthLeft + 1 });
                    }
                }
                return;
            }
        } catch (cerr) {
        }

        try {
            const html = await requestDriveFolderHtmlWithTimeout(folderId, 6000);
            const entries = extractGoogleDriveFileEntries(html, folderId) || [];
            const subfolders = (depthLeft < maxDepth) ? extractSubfolderIdsFromHtml(html, folderId) : [];

            const cacheData = { ts: Date.now(), entries, subfolders };
            cachedStore[folderId] = cacheData;
            setCachedFolderData(folderId, cacheData).catch(() => {});

            const newEntries = [];
            for (const e of entries) {
                if (!seenFileIds.has(e.id)) {
                    seenFileIds.add(e.id);
                    results.push(e);
                    newEntries.push(e);
                }
            }

            scanned += 1;
            onProgress && onProgress({ newEntries, folderId, scanned });

            if (depthLeft < maxDepth) {
                for (const sf of subfolders) {
                    if (!visitedFolders.has(sf)) queue.push({ id: sf, depth: depthLeft + 1 });
                }
            }
        } catch (err) {
            scanned += 1;
            onProgress && onProgress({ newEntries: [], folderId, scanned });
        }
    };

    let currentDepth = 0;
    while (queue.length > 0 && currentDepth <= maxDepth) {
        const currentBatch = [];
        while (queue.length > 0 && queue[0].depth === currentDepth) {
            currentBatch.push(queue.shift());
        }

        if (currentBatch.length === 0) {
            currentDepth += 1;
            continue;
        }

        await Promise.all(currentBatch.map((item) => processFolder(item.id, item.depth)));
        currentDepth += 1;
    }

    return results;
}

/**
 * Sends a message to the background service worker to fetch folder HTML from Google Drive.
 * @param {string} folderId The Google Drive folder identifier to request.
 * @returns {Promise<string>} The folder HTML returned by the background worker.
 */
function requestDriveFolderHtml(folderId) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { action: 'fetchDriveFolderHtml', folderId },
            (response) => {

                // If the background worker reported an internal runtime error, surface it to the caller.
                if (chrome.runtime.lastError) {
                        reject({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }

                    // The background worker returns a { success, html, attempts } object. If it indicates failure,
                    // reject with the entire response so the caller can render helpful diagnostics.
                    if (!response || !response.success) {
                        // Return the full response object so callers can show useful diagnostics if the fetch fails.
                        reject(response || { success: false, error: 'Background fetch failed' });
                        return;
                    }

                    resolve(response.html || '');
            }
        );
    });
}



/**
 * Extracts subfolder identifiers from Drive HTML using the shared helper layer.
 * @param {string} html The HTML content from the Drive folder page.
 * @param {string} parentFolderId The current folder identifier.
 * @returns {string[]} The found subfolder IDs.
 */
function extractSubfolderIdsFromHtml(html, parentFolderId) {
    const utils = window.__dndBeyondContentDriveUtils || null;
    if (utils && typeof utils.extractSubfolderIdsFromHtml === 'function') {
        return utils.extractSubfolderIdsFromHtml(html, parentFolderId);
    }
    const helpers = window.__dndBeyondContentHelpers || {};
    if (helpers.extractSubfolderIdsFromHtml) {
        return helpers.extractSubfolderIdsFromHtml(html, parentFolderId);
    }
    return [];
}

/**
 * Extracts image entries from Drive HTML using the shared helper layer.
 * @param {string} html The HTML content from the Drive folder page.
 * @param {string} folderId The current folder identifier.
 * @returns {Array} The parsed file entries.
 */
function extractGoogleDriveFileEntries(html, folderId) {
    const utils = window.__dndBeyondContentDriveUtils || null;
    if (utils && typeof utils.extractGoogleDriveFileEntries === 'function') {
        return utils.extractGoogleDriveFileEntries(html, folderId);
    }
    const helpers = window.__dndBeyondContentHelpers || {};
    if (helpers.extractGoogleDriveFileEntries) {
        return helpers.extractGoogleDriveFileEntries(html, folderId);
    }
    return [];
}

/**
 * Shows a friendly message when the user has not configured a mapping or the content could not be loaded.
 * @param {HTMLElement} contentArea The main content area for the Maps section.
 * @param {HTMLElement} emptyState The empty-state container used for messages.
 * @param {string} title A short heading for the message.
 * @param {string} messageHtml The message body, rendered as HTML.
 * @returns {void}
 */
function showMapsSettingsPrompt(contentArea, emptyState, title, messageHtml) {
    if (!contentArea || !emptyState) return;

    contentArea.innerHTML = '';
    contentArea.style.display = 'none';
    emptyState.innerHTML = `
        <div style="color:#322b1d; background:#fff8e1; border:1px solid #d6c089; border-radius:8px; padding:16px;">
            <div style="font-size:16px; font-weight:700; color:#3b2a0a;">${escapeHtml(title)}</div>
            <div style="margin-top:8px; color:#4a412f; line-height:1.5;">${messageHtml}</div>
        </div>
    `;
    emptyState.style.display = 'block';
}

/**
 * Escapes text before inserting it into the page as HTML.
 * @param {*} text The raw text to escape.
 * @returns {string} Safe HTML-ready text.
 */
function escapeHtml(text) {
    const helpers = window.__dndBeyondContentHelpers || {};
    if (helpers.escapeHtml) {
        return helpers.escapeHtml(text);
    }

    const shared = window.__dndBeyondShared || {};
    if (shared.escapeHtml) {
        return shared.escapeHtml(text);
    }

    return (text || '').toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sorts the current map list based on the selected sort direction.
 * @param {Array} maps The map objects to sort.
 * @returns {Array} The sorted map objects.
 */
function getSortedMapsForDisplay(maps) {
    if (!maps || maps.length === 0) return [];
    if (currentMapsSortDirection === 'asc' || currentMapsSortDirection === 'desc') {
        const sorted = [...maps].sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            const comparison = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            return currentMapsSortDirection === 'asc' ? comparison : -comparison;
        });
        return sorted;
    }
    return maps;
}

/**
 * Filters the current map list with the active search query and renders the matching cards.
 * @param {HTMLElement} contentArea The area where map cards should be appended.
 * @param {HTMLElement} emptyState The empty-state container used when no results match.
 * @returns {void}
 */
function filterAndDisplayMaps(contentArea, emptyState) {
    const query = (currentMapsSearchQuery || '').toLowerCase().trim();
    const filteredMaps = currentMapsList.filter((map) => {
        const name = (map.name || '').toLowerCase();
        return !query || name.includes(query);
    });
    const displayedMaps = getSortedMapsForDisplay(filteredMaps);

    contentArea.innerHTML = '';

    if (filteredMaps.length === 0) {
        contentArea.style.display = 'none';
        if (emptyState) {
            emptyState.textContent = query ? 'No maps match your search.' : '';
            emptyState.style.display = query ? 'block' : 'none';
        }
        return;
    }

    styleMapsGrid(contentArea);
    if (emptyState) emptyState.style.display = 'none';

    displayedMaps.forEach((map, index) => {
        const mapCard = createMapCard(map, index);
        contentArea.appendChild(mapCard);
    });
}

// Build one thumbnail card at a time so each image can be styled and clicked independently.
/**
 * Creates a thumbnail card for a single map so it can be displayed inside the Maps tab.
 * @param {Object} map The map metadata for the card.
 * @param {number} index The card index used for testing hooks.
 * @returns {HTMLElement} The DOM element representing the card.
 */
function createMapCard(map, index) {
    const mapCard = document.createElement('div');
    mapCard.className = 'map-card';
    mapCard.style.cssText = `
        position: relative;
        width: calc(100% - 4px);
        min-height: 100%;
        height: 100%;
        border-radius: 4px;
        overflow: hidden;
        background: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        cursor: pointer;
        transition: all 0.2s ease;
        border: 1px solid #ddd;
        display: flex;
        flex-direction: column;
        margin: 0 2px;
    `;

    const img = document.createElement('img');
    img.src = map.url || map.data || '';
    img.decoding = 'async';
    img.loading = 'eager';

    if (map.fullResolutionUrl) {
        requestIdleCallback(() => {
            const preloadImg = new Image();
            preloadImg.decoding = 'async';
            preloadImg.src = map.fullResolutionUrl;
        }, { timeout: 2000 });
    }
    img.style.cssText = `
        width: 100%;
        height: 150px;
        object-fit: cover;
        display: block;
        background: #f5f7fb;
    `;
    img.setAttribute('data-testid', `map-image-${index}`);

    const mapInfo = document.createElement('div');
    mapInfo.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        /* Use relative vertical padding so spacing scales with font-size */
        padding: 0.50em 8px;
        width: 100%;
        min-height: 0;
        box-sizing: border-box;
        background: white;
        border-top: 1px solid #ddd;
        flex-shrink: 0;
        flex-grow: 0;
    `;

    const mapName = document.createElement('div');
    mapName.textContent = (map.name || '').substring(0, 50) + ((map.name || '').length > 50 ? '...' : '');
    mapName.style.cssText = `
        color: var(--theme-contrast, #333);
        font-family: var(--font-condensed, inherit);
        font-weight: 700;
        font-size: .725rem;
        text-align: center;
        white-space: normal;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.2;
        margin: 0;
    `;
    mapName.title = map.name || '';

    mapInfo.appendChild(mapName);

    const applyWhiteFooter = () => {
        mapInfo.style.backgroundImage = 'none';
        mapInfo.style.backgroundRepeat = 'no-repeat';
        mapInfo.style.backgroundSize = 'auto';
        mapInfo.style.backgroundColor = '#ffffff';
        mapInfo.style.background = '#ffffff';
        try { mapInfo.dataset.colorApplied = 'white'; } catch (e) { /* ignore */ }
        mapName.style.color = '#111';
        mapInfo.style.borderTop = '1px solid rgba(0,0,0,0.08)';
    };

    img.addEventListener('load', () => applyWhiteFooter());
    if (img.complete && img.naturalWidth) setTimeout(applyWhiteFooter, 0);
    img.addEventListener('error', () => {
        // If loading the first candidate image fails, try the next candidate URL from the list.
        // This lets the UI recover from permission redirects or thumbnail generation failures.
        if (map.imageUrls && map.imageUrls.length > 1) {
            const currentIndex = map.imageUrls.indexOf(img.src);
            const nextIndex = currentIndex + 1;
            if (map.imageUrls[nextIndex]) {
                img.src = map.imageUrls[nextIndex];
                return;
            }
        }
        // If no further candidates remain, show a neutral placeholder and remove the broken src.
        img.style.background = '#eee';
        img.alt = 'Unable to load map preview';
        img.removeAttribute('src');
    });

    mapCard.appendChild(img);
    mapCard.appendChild(mapInfo);

    mapCard.addEventListener('click', () => viewMapFullscreen(map));
    img.addEventListener('click', (e) => { e.stopPropagation(); viewMapFullscreen(map); });
    mapCard.addEventListener('mouseenter', () => mapCard.style.transform = 'scale(1.01)');
    mapCard.addEventListener('mouseleave', () => mapCard.style.transform = 'scale(1)');

    return mapCard;
}

// Append new cards incrementally so the grid does not flash or reset while content is loading.
/**
 * Appends new map cards without clearing the whole grid so the UI feels smoother while loading.
 * @param {Array} newMaps The map objects to add.
 * @param {HTMLElement} contentArea The container that should receive the cards.
 * @returns {void}
 */
function appendMapCards(newMaps, contentArea) {
    if (!newMaps || newMaps.length === 0) return;
    styleMapsGrid(contentArea);

    const fragment = document.createDocumentFragment();
    let idx = contentArea.querySelectorAll('.map-card').length;
    for (let i = 0; i < newMaps.length; i++) {
        const map = newMaps[i];
        const card = createMapCard(map, idx++);
        fragment.appendChild(card);
    }
    contentArea.appendChild(fragment);
}

// Replace the current grid contents with the latest filtered map list.
/**
 * Displays a list of maps in the content area and applies the current search and sort filters.
 * @param {Array} maps The map objects to display.
 * @param {HTMLElement} contentArea The container for the map cards.
 * @param {HTMLElement} emptyState The empty-state container.
 * @returns {void}
 */
function displayMaps(maps, contentArea, emptyState) {
    contentArea.innerHTML = '';

    if (maps.length === 0) {
        contentArea.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    styleMapsGrid(contentArea);
    if (emptyState) emptyState.style.display = 'none';

    currentMapsList = maps;
    filterAndDisplayMaps(contentArea, emptyState);
}

/**
 * Applies the layout styles that create the responsive thumbnail grid for map cards.
 * @param {HTMLElement} contentArea The container that should behave like a grid.
 * @returns {void}
 */
function styleMapsGrid(contentArea) {
    contentArea.style.display = 'grid';
    contentArea.style.gridTemplateColumns = 'repeat(2, minmax(0, calc(50% - 12px)))';
    contentArea.style.gridAutoRows = 'minmax(180px, 1fr)';
    contentArea.style.alignItems = 'stretch';
    contentArea.style.alignContent = 'start';
    contentArea.style.gap = '10px';
    contentArea.style.minHeight = '0';
    contentArea.style.overflowY = 'auto';
    contentArea.style.overflowX = 'hidden';
    contentArea.style.padding = '5px 0 18px 0';
}

// Open a full-screen preview when the user clicks a map card.
/**
 * Opens a full-screen modal so a selected map can be viewed at a larger size.
 * @param {Object} map The map object whose image should be displayed.
 * @returns {void}
 */
function viewMapFullscreen(map) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: zoom-out;
    `;

    const img = document.createElement('img');
    img.style.cssText = `
        max-width: 90vw;
        max-height: 90vh;
        border-radius: 4px;
        box-shadow: 0 0 30px rgba(0,0,0,0.5);
        cursor: default;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        position: absolute;
        top: 20px;
        right: 20px;
        background: white;
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 24px;
        cursor: pointer;
        z-index: 10001;
    `;

    // Build a prioritized list of URLs to try for the full-screen preview.
    // Priority: use the `fullResolutionUrl` first (best quality), then the primary preview URL,
    // and finally any additional candidates. This ordering helps present the best image while
    // still recovering from access/thumbnail failures by trying fallbacks.
    const urls = [];
    if (map.fullResolutionUrl || map.url || map.data) {
        urls.push(map.fullResolutionUrl || map.url || map.data || '');
    }
    if (map.imageUrls && map.imageUrls.length) {
        map.imageUrls.forEach((candidate) => {
            if (candidate && !urls.includes(candidate)) {
                urls.push(candidate);
            }
        });
    }
    if (!urls.length) {
        urls.push('');
    }
    let idx = 0;
    let errorPlaceholder = null;

    function tryLoadNext() {
        if (idx >= urls.length) {
            // show error
            if (errorPlaceholder) return;
            errorPlaceholder = document.createElement('div');
            errorPlaceholder.textContent = '⚠️ Unable to load image preview';
            errorPlaceholder.style.cssText = 'color:#fff;padding:20px;background:transparent;border-radius:4px;';
            modal.appendChild(errorPlaceholder);
            return;
        }
        img.src = urls[idx];
    }

    img.addEventListener('error', () => {
        idx += 1;
        tryLoadNext();
    });

    img.addEventListener('load', () => {
        // remove any error placeholder if present
        if (errorPlaceholder && errorPlaceholder.parentElement) errorPlaceholder.remove();
    });

    modal.addEventListener('click', () => modal.remove());
    img.addEventListener('click', (e) => e.stopPropagation());
    closeBtn.addEventListener('click', () => modal.remove());

    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);

    tryLoadNext();
}

// Initialize when DOM is ready
const shared = window.__dndBeyondShared || {};
if (shared.whenDomReady) {
    shared.whenDomReady(initializeExtension);
} else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension, { once: true });
} else {
    initializeExtension();
}
