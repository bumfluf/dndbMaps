/*
 * File: content-drive-utils.js
 * Purpose: Contains reusable helpers for working with Google Drive image and folder data.
 * Contribution: These utilities help the content script turn Drive HTML and folder IDs into a consistent set of image URLs and file entries for the Maps UI.
 */

(function (root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    root.__dndBeyondContentDriveUtils = api;
    root.buildGoogleDriveImageUrls = api.buildGoogleDriveImageUrls;
    root.buildGoogleDriveFullResolutionUrl = api.buildGoogleDriveFullResolutionUrl;
    root.extractSubfolderIdsFromHtml = api.extractSubfolderIdsFromHtml;
    root.extractGoogleDriveFileEntries = api.extractGoogleDriveFileEntries;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    /**
     * Builds a prioritized list of Google Drive image URLs for a file ID.
     * @param {string} fileId The Google Drive file identifier.
     * @returns {string[]} A list of image URL candidates.
     */
    function buildGoogleDriveImageUrls(fileId) {
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
     * Chooses a high-quality Google Drive URL for a file when the full-resolution preview is needed.
     * @param {string} fileId The Google Drive file identifier.
     * @returns {string} The preferred full-resolution image URL.
     */
    function buildGoogleDriveFullResolutionUrl(fileId) {
        return [
            `https://lh3.googleusercontent.com/d/${fileId}`,
            `https://drive.google.com/uc?export=download&id=${fileId}&authuser=0`,
            `https://drive.google.com/uc?export=view&id=${fileId}&authuser=0`
        ][0];
    }

    /**
     * Extracts child folder IDs from Google Drive HTML so the crawler can traverse subfolders.
     * @param {string} html The HTML returned by the Drive folder page.
     * @param {string} parentFolderId The current folder identifier to avoid self-links.
     * @returns {string[]} A list of subfolder IDs discovered in the HTML.
     */
    function extractSubfolderIdsFromHtml(html, parentFolderId) {
        const ids = new Set();
        if (!html) return [];
        const regex = /(?:drive\.google\.com[\/]drive|\/drive)?\/folders\/([a-zA-Z0-9_-]{25,})/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const id = match[1];
            if (!id) continue;
            if (id === parentFolderId) continue;
            if (id.length < 25) continue;
            ids.add(id);
        }
        return Array.from(ids);
    }

    /**
     * Extracts image file entries from Google Drive HTML so they can be displayed in the Maps UI.
     * @param {string} html The Drive folder HTML to parse.
     * @param {string} folderId The folder currently being scanned.
     * @returns {Array<{id:string, name:string, originalName:string}>} A list of discovered image entries.
     */
    function extractGoogleDriveFileEntries(html, folderId) {
        const fileEntries = [];
        const seenIds = new Set();
        const normalizedFolderId = folderId ? folderId.toString().trim() : null;

        const isLikelyDriveId = (candidate) => {
            if (!candidate || candidate === normalizedFolderId) return false;
            if (candidate.startsWith('AIza')) return false;
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) return false;
            if (candidate.length < 25 || candidate.length > 80) return false;
            return true;
        };

        const decodeHtmlEntities = (value) => {
            return (value || '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&nbsp;/g, ' ');
        };

        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
        const hasImageExtension = (value) => {
            if (!value) return false;
            const cleaned = decodeHtmlEntities(value.toString().replace(/<[^>]+>/g, '').trim()).trim();
            const match = cleaned.match(/\.([a-z0-9]+)(?:[\?#].*)?$/i);
            return !!(match && imageExtensions.includes(match[1].toLowerCase()));
        };

        const sanitizeFileName = (value) => {
            const cleaned = decodeHtmlEntities((value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
            if (!cleaned) return null;
            const stripped = cleaned.replace(/\.[^.]+$/, '').trim();
            const lower = stripped.toLowerCase();
            if (!stripped || lower === 'share' || lower === 'shared' || lower === 'share link' || lower === 'download' || lower === 'open' || lower === 'preview' || lower === 'image') {
                return null;
            }
            return stripped;
        };

        const extractImageNameFromHtml = (htmlContent) => {
            if (!htmlContent) return null;
            const fallbackPattern = /([\w\-\s\.\(\)\[\]%]+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:[\?#][^\s"'<>]*)?/gi;
            let match;
            while ((match = fallbackPattern.exec(htmlContent)) !== null) {
                const candidate = match[1];
                if (hasImageExtension(candidate)) {
                    return candidate;
                }
            }
            return null;
        };

        const addEntry = (candidate, candidateName, rowHtml) => {
            if (!isLikelyDriveId(candidate) || seenIds.has(candidate)) {
                return;
            }

            let nameToUse = candidateName;
            if (!nameToUse && rowHtml) {
                nameToUse = extractImageNameFromHtml(rowHtml);
            }
            if (!nameToUse || !hasImageExtension(nameToUse)) {
                return;
            }

            const sanitized = sanitizeFileName(nameToUse);
            if (!sanitized) {
                return;
            }

            seenIds.add(candidate);
            fileEntries.push({
                id: candidate,
                name: sanitized,
                originalName: nameToUse
            });
        };

        const tryExtractNameFromRow = (rowHtml) => {
            const namePatterns = [
                /data-tooltip=["']([^"']+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:["']|$)/i,
                /title=["']([^"']+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:["']|$)/i,
                /aria-label=["']([^"']+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:["']|$)/i,
                />([^<]+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:<|$)/i
            ];

            for (const pattern of namePatterns) {
                const match = pattern.exec(rowHtml);
                if (match && match[1]) {
                    const name = sanitizeFileName(match[1]);
                    if (name) {
                        return name;
                    }
                }
            }

            return null;
        };

        const flipEntryRegex = /<div\s+class=["']flip-entry["'][^>]*id=["']entry-([a-zA-Z0-9_-]{25,})["'][^>]*>[\s\S]*?<div\s+class=["']flip-entry-title["']\s*>([^<]+)<\/div>/gi;
        let match;
        while ((match = flipEntryRegex.exec(html)) !== null) {
            const id = match[1];
            const title = match[2] ? match[2].trim() : null;
            addEntry(id, title, match[0]);
        }

        const rowDataIdRegex = /<tr[^>]+data-id=["']([a-zA-Z0-9_-]{25,})["'][^>]*>([\s\S]*?)<\/tr>/gi;
        while ((match = rowDataIdRegex.exec(html)) !== null) {
            addEntry(match[1], tryExtractNameFromRow(match[2]), match[2]);
        }

        if (fileEntries.length > 0) {
            return fileEntries;
        }

        const nameIdPatterns = [
            { pattern: /["']([^"']+\.(?:png|jpe?g|gif|webp|svg|bmp))["'][^"']{0,400}["']([a-zA-Z0-9_-]{25,})["']/gi, nameGroup: 1, idGroup: 2 },
            { pattern: /["']([a-zA-Z0-9_-]{25,})["'][^"']{0,400}["']([^"']+\.(?:png|jpe?g|gif|webp|svg|bmp))["']/gi, nameGroup: 2, idGroup: 1 }
        ];
        for (const entry of nameIdPatterns) {
            let fallbackMatch;
            while ((fallbackMatch = entry.pattern.exec(html)) !== null) {
                const nameCandidate = fallbackMatch[entry.nameGroup];
                const idCandidate = fallbackMatch[entry.idGroup];
                if (!isLikelyDriveId(idCandidate)) {
                    continue;
                }
                addEntry(idCandidate, nameCandidate, html);
            }
        }

        if (fileEntries.length > 0) {
            return fileEntries;
        }
        return [];
    }

    return {
        buildGoogleDriveImageUrls,
        buildGoogleDriveFullResolutionUrl,
        extractSubfolderIdsFromHtml,
        extractGoogleDriveFileEntries
    };
});
