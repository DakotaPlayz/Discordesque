import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/safe-zones.css', 'utf8');
const app = readFileSync('src/main.jsx', 'utf8');
const activity = readFileSync('native/android/MainActivity.java', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const index = readFileSync('index.html', 'utf8');

test('Capacitor 7 native safe area support is configured', () => {
  assert.equal(pkg.dependencies['@capacitor-community/safe-area'], '^7.0.0');
  assert.match(activity, /EdgeToEdge\.enable\(this\)/);
  assert.match(index, /viewport-fit=cover/);
});

test('safe zones are imported last and use real device insets', () => {
  const imports = [...app.matchAll(/import\s+['"](.+\.css)['"]/g)].map(m => m[1]);
  assert.equal(imports.at(-1), './safe-zones.css');
  for (const side of ['top', 'bottom', 'left', 'right']) {
    assert.match(css, new RegExp('env\\(safe-area-inset-' + side + ', 0px\\)'));
  }
});

test('mobile chat, composer and floating overlays respect safe bounds', () => {
  assert.match(css, /\.app-shell\s*>\s*\.chat/);
  assert.match(css, /top:\s*var\(--mirlume-safe-top\)/);
  assert.match(css, /bottom:\s*var\(--mirlume-safe-bottom\)/);
  assert.match(css, /\.voice-call-panel/);
  assert.match(css, /\.android-update-banner/);
  assert.match(css, /\.dialog-backdrop/);
  assert.match(css, /\.dm-transfer-state/);
});
