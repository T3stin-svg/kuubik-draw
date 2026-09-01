'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('desktop shell keeps the CAD renderer isolated and offline', () => {
  assert.match(mainSource, /nodeIntegration:\s*false/u);
  assert.match(mainSource, /contextIsolation:\s*true/u);
  assert.match(mainSource, /sandbox:\s*true/u);
  assert.match(mainSource, /http:\/\/\*\/\*/u);
  assert.match(mainSource, /https:\/\/\*\/\*/u);
  assert.match(mainSource, /callback\(\{ cancel: true \}\)/u);
  assert.match(mainSource, /connect-src 'none'/u);
  assert.doesNotMatch(preloadSource, /fs|child_process|shell/u);
});

test('desktop shell serves the built Lite v1 application from a stable origin', () => {
  const indexPath = path.join(root, 'apps', 'web', 'dist', 'index.html');
  assert.equal(fs.existsSync(indexPath), true, 'Build apps/web before running desktop tests.');
  const html = fs.readFileSync(indexPath, 'utf8');
  assert.match(mainSource, /kuubik:\/\/app\/d\/local/u);
  assert.match(mainSource, /indexedDbNames\.includes\('kuubik-draw'\)/u);
  assert.match(mainSource, /scopeSize === 20/u);
  assert.match(mainSource, /runLinePointerSmoke/u);
  assert.match(mainSource, /linePointer\.afterLines === linePointer\.beforeLines \+ 1/u);
  assert.match(mainSource, /!state\.orientationIndicatorPresent/u);
  assert.match(html, /<title>Kuubik Draw<\/title>/u);
});

test('portable package contains only the desktop shell, built app and license material', () => {
  assert.equal(packageJson.main, 'desktop/main.cjs');
  assert.equal(packageJson.build.asar, true);
  assert.equal(packageJson.build.win.requestedExecutionLevel, 'asInvoker');
  assert.deepEqual(packageJson.build.files, [
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'apps/web/dist/**/*',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'LICENSES/**/*',
  ]);
});
