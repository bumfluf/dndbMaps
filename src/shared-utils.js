(function () {
    const root = window;
    const shared = root.__dndBeyondShared || (root.__dndBeyondShared = {});

    function normalizeText(value) {
        return (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    }

    function normalizeCharacterName(value) {
        return normalizeText(value).toLowerCase();
    }

    function escapeHtml(text) {
        return (text == null ? '' : String(text))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function setImportantStyles(element, styles) {
        if (!element || !styles) {
            return;
        }

        Object.entries(styles).forEach(([name, value]) => {
            element.style.setProperty(name, value, 'important');
        });
    }

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
