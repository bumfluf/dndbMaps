(function (root) {
    const shared = root.__dndBeyondShared || (root.__dndBeyondShared = {});

    function getContentDriveUtils() {
        return root.__dndBeyondContentDriveUtils || null;
    }

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

    function buildGoogleDriveFullResolutionUrl(fileId) {
        const utils = getContentDriveUtils();
        if (utils && typeof utils.buildGoogleDriveFullResolutionUrl === 'function') {
            return utils.buildGoogleDriveFullResolutionUrl(fileId);
        }

        return `https://lh3.googleusercontent.com/d/${fileId}`;
    }

    function extractSubfolderIdsFromHtml(html, parentFolderId) {
        const utils = getContentDriveUtils();
        if (utils && typeof utils.extractSubfolderIdsFromHtml === 'function') {
            return utils.extractSubfolderIdsFromHtml(html, parentFolderId);
        }

        return [];
    }

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
