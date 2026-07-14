const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildGoogleDriveImageUrls, buildGoogleDriveFullResolutionUrl, extractSubfolderIdsFromHtml, extractGoogleDriveFileEntries } = require('../src/content-drive-utils');

function runTests() {
  const imageUrls = buildGoogleDriveImageUrls('abc123');
  assert.ok(imageUrls.includes('https://drive.google.com/thumbnail?authuser=0&sz=w800&id=abc123'));
  assert.ok(imageUrls[0].includes('thumbnail'));

  const fullResolutionUrl = buildGoogleDriveFullResolutionUrl('abc123');
  assert.strictEqual(fullResolutionUrl, 'https://lh3.googleusercontent.com/d/abc123');

  const htmlWithFolders = '<a href="https://drive.google.com/drive/folders/AAAA1111111111111111111111">Folder A</a><a href="/folders/BBBB2222222222222222222222">Folder B</a>';
  assert.deepStrictEqual(extractSubfolderIdsFromHtml(htmlWithFolders, 'AAAA1111111111111111111111'), ['BBBB2222222222222222222222']);

  const htmlWithEntries = '<div class="flip-entry" id="entry-CCCC3333333333333333333333"><div class="flip-entry-title">Map One.png</div></div>';
  const entries = extractGoogleDriveFileEntries(htmlWithEntries, 'rootFolder');
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].name, 'Map One');
  assert.strictEqual(entries[0].id, 'CCCC3333333333333333333333');

  const helperSource = fs.readFileSync(path.join(__dirname, '../src/content-helpers.js'), 'utf8');
  const helperContext = vm.createContext({ console, setTimeout, clearTimeout, window: null });
  helperContext.window = helperContext;
  vm.runInContext(helperSource, helperContext, { filename: 'content-helpers.js' });
  const helpers = helperContext.window.__dndBeyondContentHelpers;
  assert.strictEqual(helpers.buildGoogleDriveFullResolutionUrl('abc123'), 'https://lh3.googleusercontent.com/d/abc123');
  assert.strictEqual(helpers.escapeHtml('<b>A&B</b>'), '&lt;b&gt;A&amp;B&lt;/b&gt;');
}

runTests();
