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
    const DRIVE_PARSER_DEBUG = false;
function parserDebugLog(...args) {
        if (DRIVE_PARSER_DEBUG) {
            console.log('[Drive Parser Debug]', ...args);
        }
    }

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
        // Regex: capture Drive folder URLs of the form '/drive/folders/<id>' or 'drive.google.com/drive/folders/<id>'.
        // The id is expected to be 25+ chars (common Drive folder id length); using a permissive charset.
        const regex = /(?:drive\.google\.com[\/]drive|\/drive)?\/folders\/([a-zA-Z0-9_-]{25,})/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const id = match[1];
            if (!id) continue;
            // Ignore any folder IDs that point back to the parent or are unexpectedly short.
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
            // Quick heuristics to filter out values that are not Drive file IDs:
            // - empty or same as folder id
            // - API keys (start with 'AIza')
            // - UUIDs (common false positives from other markup)
            // - unrealistic length
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
            // Match file extension at end of string (allowing query/hash) and verify it's a known image type.
            return !!(match && imageExtensions.includes(match[1].toLowerCase()));
        };

        const countRegexMatches = (pattern, text) => {
            if (!text) return 0;
            const matches = text.match(pattern);
            return matches ? matches.length : 0;
        };

        const sanitizeFileName = (value) => {
            const cleaned = decodeHtmlEntities((value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
            if (!cleaned) return null;
            const stripped = cleaned.replace(/\.[^.]+$/, '').trim();
            const lower = stripped.toLowerCase();
            // Ignore generic UI labels that can appear in Drive markup instead of real filenames.
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
            const failReasons = [];
            if (!isLikelyDriveId(candidate)) {
                failReasons.push('invalid-id');
            }
            if (seenIds.has(candidate)) {
                failReasons.push('duplicate-id');
            }
            if (failReasons.length > 0) {
                parserDebugLog('addEntry skipped', { candidate, candidateName, failReasons });
                return;
            }

            /*
                Decide on a name to use for this file entry:
                - Prefer an extracted candidateName (from title/tooltip/aria-label)
                - Otherwise try to pull a filename-like token out of the row HTML
                After a name is chosen, validate it looks like an image and sanitize it.
            */
            let nameToUse = candidateName;
            if (!nameToUse && rowHtml) {
                nameToUse = extractImageNameFromHtml(rowHtml);
            }
            if (!nameToUse || !hasImageExtension(nameToUse)) {
                parserDebugLog('addEntry skipped name invalid', { candidate, candidateName, extracted: nameToUse });
                return;
            }

            const sanitized = sanitizeFileName(nameToUse);
            if (!sanitized) {
                parserDebugLog('addEntry skipped sanitized invalid', { candidate, nameToUse });
                return;
            }

            seenIds.add(candidate);
            fileEntries.push({
                id: candidate,
                name: sanitized,
                originalName: nameToUse
            });
            parserDebugLog('addEntry added', { candidate, name: sanitized, originalName: nameToUse });
        };

        const tryExtractNameFromRow = (rowHtml) => {
            /*
                Look for common attributes D rive uses to label files (data-tooltip, title, aria-label)
                or a visible filename inside the cell. Patterns are intentionally permissive because
                Drive's rendered markup can vary between list/grid/embed views.
            */
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

        // Matches custom "flip-entry" card markup Drive can emit in some views: capture id and title.
        const flipEntryRegex = /<div\s+class=["']flip-entry["'][^>]*id=["']entry-([a-zA-Z0-9_-]{25,})["'][^>]*>[\s\S]*?<div\s+class=["']flip-entry-title["']\s*>([^<]+)<\/div>/gi;
        let match;
        while ((match = flipEntryRegex.exec(html)) !== null) {
            const id = match[1];
            const title = match[2] ? match[2].trim() : null;
            addEntry(id, title, match[0]);
        }

        // Matches table row entries that include a data-id attribute (common in list views).
        const rowDataIdRegex = /<tr[^>]+data-id=["']([a-zA-Z0-9_-]{25,})["'][^>]*>([\s\S]*?)<\/tr>/gi;
        while ((match = rowDataIdRegex.exec(html)) !== null) {
            addEntry(match[1], tryExtractNameFromRow(match[2]), match[2]);
        }

        // Use a generic data-id matcher to capture Drive markup outside of table rows.
        const genericDataIdRegex = /<[^>]+data-id=["']([a-zA-Z0-9_-]{25,})["'][^>]*>([\s\S]*?)<\/[a-zA-Z0-9]+>/gi;
        while ((match = genericDataIdRegex.exec(html)) !== null) {
            addEntry(match[1], tryExtractNameFromRow(match[2]), match[2]);
        }

        // Extract file entries from direct Drive file links in embedded pages or scripts.
        const fileLinkRegex = /["'](?:https?:\/\/drive\.google\.com\/file\/d\/|\/file\/d\/)([a-zA-Z0-9_-]{25,})[^"']*["']/gi;
        while ((match = fileLinkRegex.exec(html)) !== null) {
            const idCandidate = match[1];
            const context = html.slice(Math.max(0, match.index - 300), Math.min(html.length, match.index + 300));
            addEntry(idCandidate, tryExtractNameFromRow(context) || extractImageNameFromHtml(context), context);
        }

        if (fileEntries.length > 0) {
            parserDebugLog('extractGoogleDriveFileEntries returning', { folderId, count: fileEntries.length });
            return fileEntries;
        }

        parserDebugLog('extractGoogleDriveFileEntries root html summary', {
            folderId,
            htmlSnippet: html ? html.slice(0, 400) : '',
            normalizedFolderId,
            flipEntryCount: countRegexMatches(/<div\s+class=["']flip-entry["'][^>]*id=["']entry-[a-zA-Z0-9_-]{25,}["'][^>]*>/gi, html),
            dataIdRowCount: countRegexMatches(/<tr[^>]+data-id=["']([a-zA-Z0-9_-]{25,})["'][^>]*>/gi, html),
            genericDataIdCount: countRegexMatches(/<[^>]+data-id=["']([a-zA-Z0-9_-]{25,})["'][^>]*>/gi, html),
            fileLinkCount: countRegexMatches(/["'](?:https?:\/\/drive\.google\.com\/file\/d\/|\/file\/d\/)([a-zA-Z0-9_-]{25,})[^"']*["']/gi, html),
            fallbackNameMatches: countRegexMatches(/(?:[\w\-\s\.\(\)\[\]%]+\.(?:png|jpe?g|gif|webp|svg|bmp))(?:[\?#][^\s"'<>]*)?/gi, html)
        });

        // Fallback patterns: names and ids can appear near each other in attributes; capture either order.
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
