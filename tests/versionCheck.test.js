import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion } from '../src/lib/versionCheck.js';

test('only newer published Android versions trigger a notice', () => {
  assert.equal(newerVersion('v0.5.8', '0.5.7'), true);
  assert.equal(newerVersion('v0.5.7', '0.5.7'), false);
  assert.equal(newerVersion('v0.5.6', '0.5.7'), false);
  assert.equal(newerVersion('v0.6.0', '0.5.99'), true);
  assert.equal(newerVersion('v1.0.0', '0.99.99'), true);
  assert.equal(newerVersion('invalid', '0.5.7'), false);
  assert.equal(newerVersion('v0.5.8-beta', '0.5.7'), false);
});
