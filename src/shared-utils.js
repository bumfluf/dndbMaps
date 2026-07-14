/*
 * File: shared-utils.js
 * Purpose: Provides shared browser-side utilities used across the extension pages.
 * Contribution: This file supplies helpers that keep popup, settings, and content scripts consistent when they need to normalize text, escape HTML, or wait for the page to finish loading.
 */

(function () {
    const root = window;
    const shared = root.__dndBeyondShared || (root.__dndBeyondShared = {});

    /**
     * Normalizes whitespace in a value so text is easier to compare.
     * @param {*} value The raw text value to clean up.
     * @returns {string} A trimmed string with repeated whitespace collapsed.
     */
    function normalizeText(value) {
        return (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    }

    /**
     * Converts a character name into a lowercase, normalized form for matching.
     * @param {*} value The character name to normalize.
     * @returns {string} A lowercase, whitespace-normalized version of the name.
     */
    function normalizeCharacterName(value) {
        return normalizeText(value).toLowerCase();
    }

    /**
     * Escapes basic HTML characters so user-provided text can be safely inserted into the page.
     * @param {*} text The text that may contain HTML characters.
     * @returns {string} A safe string for display in the DOM.
     */
    function escapeHtml(text) {
        return (text == null ? '' : String(text))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Applies CSS styles with the important flag so they override existing D&D Beyond styles.
     * @param {HTMLElement|null} element The DOM element to style.
     * @param {Object<string, string>} styles A map of CSS property names to values.
     * @returns {void}
     */
    function setImportantStyles(element, styles) {
        if (!element || !styles) {
            return;
        }

        Object.entries(styles).forEach(([name, value]) => {
            element.style.setProperty(name, value, 'important');
        });
    }

    /**
     * Runs a callback once the document is ready, or immediately if it already is.
     * @param {Function} callback The function to run when the DOM is available.
     * @returns {void}
     */
    function whenDomReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
            return;
        }

        callback();
    }

    shared.normalizeText = normalizeText;
    shared.normalizeCharacterName = normalizeCharacterName;
    shared.escapeHtml = escapeHtml;
    shared.setImportantStyles = setImportantStyles;
    shared.whenDomReady = whenDomReady;
})();
