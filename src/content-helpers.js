/*
 * File: content-helpers.js
 * Purpose: Provides shared helper functions for the content script.
 * Contribution: This file centralizes small utilities such as safe HTML escaping and shared styling behavior so the Maps UI can reuse them consistently.
 */

(function (root) {
    const shared = root.__dndBeyondShared || (root.__dndBeyondShared = {});

    /**
     * Retrieves the Drive helper API if it has already been loaded.
     * @returns {Object|null} The shared Drive utility interface, if available.
     */
    function getContentDriveUtils() {
        return root.__dndBeyondContentDriveUtils || null;
    }

    /**
     * Applies CSS rules with the important flag for D&D Beyond UI elements.
     * @param {HTMLElement|null} element The element to style.
     * @param {Object<string, string>} styles The styles to apply.
     * @returns {void}
     */
    function setImportantStyles(element, styles) {
        if (shared.setImportantStyles) {
            shared.setImportantStyles(element, styles);
            return;
        }

        if (!element || !styles) {
            return;
        }

        Object.entries(styles).forEach(([name, value]) => {
            element.style.setProperty(name, value, 'important');
        });
    }

    /**
     * Escapes HTML so text can be displayed safely inside the injected UI.
     * @param {*} text The text to escape.
     * @returns {string} The escaped text.
     */
    function escapeHtml(text) {
        if (shared.escapeHtml) {
            return shared.escapeHtml(text);
        }

        return (text == null ? '' : String(text))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Builds a set of Google Drive image URL candidates for a given file.
     * @param {string} fileId The Google Drive file identifier.
     * @returns {string[]} Image URL options for the file.
     */
    function buildGoogleDriveImageUrls(fileId) {
        const utils = getContentDriveUtils();
        if (utils && typeof utils.buildGoogleDriveImageUrls === 'function') {
            return utils.buildGoogleDriveImageUrls(fileId);
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
     * Returns a preferred full-resolution image URL for a Google Drive file.
     * @param {string} fileId The Google Drive file identifier.
     * @returns {string} A full-resolution image URL.
     */
    function buildGoogleDriveFullResolutionUrl(fileId) {
        const utils = getContentDriveUtils();
        if (utils && typeof utils.buildGoogleDriveFullResolutionUrl === 'function') {
            return utils.buildGoogleDriveFullResolutionUrl(fileId);
        }

        return `https://lh3.googleusercontent.com/d/${fileId}`;
    }

    /**
     * Extracts subfolder IDs from HTML when the content script needs to crawl deeper.
     * @param {string} html The Drive folder HTML to inspect.
     * @param {string} parentFolderId The current folder identifier.
     * @returns {string[]} Matching subfolder IDs.
     */
    function extractSubfolderIdsFromHtml(html, parentFolderId) {
        const utils = getContentDriveUtils();
        if (utils && typeof utils.extractSubfolderIdsFromHtml === 'function') {
            return utils.extractSubfolderIdsFromHtml(html, parentFolderId);
        }

        return [];
    }

    /**
     * Extracts image entries from HTML so the Maps UI has a structured list of files.
     * @param {string} html The Drive folder HTML to inspect.
     * @param {string} folderId The current folder identifier.
     * @returns {Array<*>} The extracted file entries.
     */
    function extractGoogleDriveFileEntries(html, folderId) {
        const utils = getContentDriveUtils();
        if (utils && typeof utils.extractGoogleDriveFileEntries === 'function') {
            return utils.extractGoogleDriveFileEntries(html, folderId);
        }

        return [];
    }

    root.__dndBeyondContentHelpers = {
        setImportantStyles,
        escapeHtml,
        buildGoogleDriveImageUrls,
        buildGoogleDriveFullResolutionUrl,
        extractSubfolderIdsFromHtml,
        extractGoogleDriveFileEntries
    };
})(typeof window !== 'undefined' ? window : globalThis);
