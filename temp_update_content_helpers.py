from pathlib import Path
p = Path(r'c:\Users\mctra\OneDrive\Documents\dndbeyondextension\src\content.js')
text = p.read_text(encoding='utf-8')
start = text.index('function extractSubfolderIdsFromHtml')
end = text.index('function showMapsSettingsPrompt')
replacement = """function extractSubfolderIdsFromHtml(html, parentFolderId) {
    const utilities = window.__dndBeyondContentDriveUtils || (typeof globalThis !== 'undefined' ? globalThis.__dndBeyondContentDriveUtils : null);
    if (utilities && typeof utilities.extractSubfolderIdsFromHtml === 'function') {
        return utilities.extractSubfolderIdsFromHtml(html, parentFolderId);
    }

    return [];
}

function extractGoogleDriveFileEntries(html, folderId) {
    const utilities = window.__dndBeyondContentDriveUtils || (typeof globalThis !== 'undefined' ? globalThis.__dndBeyondContentDriveUtils : null);
    if (utilities && typeof utilities.extractGoogleDriveFileEntries === 'function') {
        return utilities.extractGoogleDriveFileEntries(html, folderId);
    }

    return [];
}

"""
p.write_text(text[:start] + replacement + text[end:], encoding='utf-8')
print('updated', p)
