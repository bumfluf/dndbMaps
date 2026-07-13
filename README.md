# D&D Beyond Maps Explorer

Adds a Maps tab to D&D Beyond character pages and loads your Google Drive map images directly inside the site for fast access.

## Project Structure

```
├── manifest.json          # Extension configuration
├── src/
│   ├── popup.html        # Popup UI
│   ├── popup.css         # Popup styles
│   ├── popup.js          # Popup logic
│   ├── settings.html     # Settings page
│   ├── settings.css      # Settings styles
│   ├── settings.js       # Settings logic
│   ├── background.js     # Background service worker
│   └── content.js        # Content script for D&D Beyond pages
├── icons/                # Extension icons
└── README.md
```

## Features

- **Popup Interface**: Quick access UI with 400px width
- **Content Script**: Runs on dndbeyond.com pages
- **Background Service Worker**: Handles background tasks and storage
- **Message Passing**: Communication between popup, content script, and background
- **Maps Tab**: New "Maps" tab for managing campaign maps
  - Upload maps in PNG, JPEG, or BMP format
  - Drag & drop file upload
  - Gallery view with thumbnails
  - Fullscreen map viewer
  - Delete and organize maps
  - Persistent storage across sessions
- **Character-Specific Settings**: Link different characters to different Google Drive folders
  - Manage character mappings in extension settings
  - Automatically load maps when viewing a character's sheet
  - Support for multiple campaigns

## Getting Started

### Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this project folder

### Configuration

1. Click the extension icon in your toolbar
2. Right-click and select "Settings" to open Settings
3. Add your character name and Google Drive folder link
4. Test the connection
5. Maps will automatically load when viewing that character's sheet

### Usage

1. Navigate to your D&D Beyond character sheet
2. Find the new **Maps** tab after "Extras"
3. **Upload maps:**
  - Click "Upload Maps" button
  - Select PNG/JPEG/BMP files
  - Or drag & drop into the content area
4. **View maps:**
   - Click any thumbnail to view fullscreen
   - Use arrow keys to navigate (if implemented)
5. **Manage maps:**
   - Delete maps using the delete button
   - Search for maps using the search bar

## Settings

Access extension settings by:
1. Right-clicking the extension icon
2. Selecting "Settings"
3. Or go to `chrome://extensions/` → Find extension → "Settings"

### Configure Character Mappings

1. Enter your character name (must match D&D Beyond name exactly)
2. Enter Google Drive folder link or ID
3. Click "Test Connection" to verify access
4. Click "Add Character" to save

Your maps will automatically load based on which character sheet you're viewing.

## Permissions

- `storage`: Save and retrieve data (local and sync)
- `activeTab`: Access current tab information
- `scripting`: Inject scripts into pages
- `dndbeyond.com/*`: Host permission for D&D Beyond
- `drive.google.com/*`: Google Drive access

## File Descriptions

- **manifest.json**: Defines extension metadata, permissions, and entry points
- **popup.html/css/js**: Creates the extension popup UI
- **settings.html/css/js**: Settings page for character mappings
- **background.js**: Service worker that runs in the background
- **content.js**: Script injected into D&D Beyond pages
- **icons/**: Extension icon SVGs

## Tips

- Check console logs in different contexts:
  - Popup: `Right-click popup → Inspect`
  - Content script: `DevTools on D&D Beyond page`
  - Background: `chrome://extensions → Details → Inspect views: service worker`
- Settings are synced across devices using Chrome's sync storage
- Maps are cached locally for faster loading
- Test your Google Drive folder connection before adding a character

## Next Steps

- Add annotations/drawing tools to maps
- Add map categories/folders within characters
- Export/share maps functionality
- PDF support for campaign handouts
- Multi-user collaboration features

## Resources

- [Chrome Extension API Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Guide](https://developer.chrome.com/docs/extensions/mv3/)
- [Content Scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)
- [Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
- [Google Drive API](https://developers.google.com/drive/api)

## Resources

- [Chrome Extension API Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Guide](https://developer.chrome.com/docs/extensions/mv3/)
- [Content Scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)
