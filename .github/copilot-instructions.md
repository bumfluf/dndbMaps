# D&D Beyond Chrome Extension - Copilot Instructions

This project is a Chrome extension for enhancing the D&D Beyond experience.

## Project Overview

- **Type**: Chrome Extension (Manifest V3)
- **Structure**: Popup UI, Content Scripts, Background Service Worker
- **Target Site**: dndbeyond.com

## Key Files

- `manifest.json` - Extension configuration and permissions
- `src/popup.html/css/js` - Popup interface
- `src/background.js` - Background service worker
- `src/content.js` - Content script for D&D Beyond pages

## Development Guidelines

- Changes to popup files require closing/reopening the popup
- Changes to background or content scripts require disabling/re-enabling the extension
- Debug popup: Right-click popup → Inspect
- Debug background: chrome://extensions → Inspect views → service worker
- Debug content: DevTools on D&D Beyond page

## Installation & Testing

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this project folder

## Next Steps for Development

- Add icon files to the `icons/` folder (16x16, 48x48, 128x128)
- Expand content script functionality
- Implement specific D&D Beyond page interactions
- Add error handling and user feedback
