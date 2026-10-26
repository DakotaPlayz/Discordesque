'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeUpdateReadyDialog } = require('../electron/update-prompt.cjs');

test('offers restart or deferral only after an update is ready', () => {
  const prompt = makeUpdateReadyDialog('0.5.7');
  assert.equal(prompt.title, 'Mirlume Update Available');
  assert.match(prompt.message, /v0\.5\.7/);
  assert.deepEqual(prompt.buttons, ['Restart & Update', 'Later']);
  assert.equal(prompt.defaultId, 1);
  assert.equal(prompt.cancelId, 1);
  assert.equal(prompt.type, 'info');
  assert.match(prompt.detail, /voice calls or file transfers/i);
  assert.match(prompt.detail, /install automatically when you close/i);
  assert.match(prompt.detail, /do not need to visit GitHub/i);
});

test('untrusted release metadata cannot inject multiline dialog text', () => {
  const prompt = makeUpdateReadyDialog('0.5.7\nmalicious instructions');
  assert.equal(prompt.message, 'Mirlume new version is ready to install.');
});
