import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.jsx', 'utf8');
const css = readFileSync('src/server-delete.css', 'utf8');
const entry = readFileSync('src/main.jsx', 'utf8');
const sql = readFileSync('supabase/delete-server-v0.5.5.sql', 'utf8');

test('server delete uses a cross-platform confirmation dialog, not a browser prompt', () => {
  const section = app.slice(app.indexOf('function requestDeleteServer'), app.indexOf('const sortedServers='));
  assert.ok(section.startsWith('function requestDeleteServer'));
  assert.doesNotMatch(section, /\bwindow\.prompt\s*\(/);
  assert.match(section, /setDeleteTarget\(/);
  assert.match(section, /deletingServerRef\.current/);
  assert.match(section, /mirlume_delete_server/);
  assert.match(section, /data !== true/);
  assert.match(section, /\.maybeSingle\(\)/);
});

test('owners can delete by mouse context menu or sidebar button on touchscreens', () => {
  assert.match(app, /label:'Delete Server'.*onClick:\(\)=>requestDeleteServer\(item\)/);
  assert.match(app, /aria-label="Delete server"/);
  assert.match(app, /requestDeleteServer\(server\)/);
  assert.match(app, /Are you sure you want to delete/);
  assert.match(app, /Yes, delete server/);
  assert.match(app, /This cannot be undone/);
  assert.match(app, /disabled=\{deletingServer\}/);
  assert.match(app, /role="alert">\{deleteError\}/);
  assert.match(css, /\.delete-server-confirm-button/);
  assert.match(entry, /server-delete\.css/);
});

test('Supabase deletion RPC still authorizes owners independently of UI', () => {
  assert.match(sql, /owner_id=current_user_id/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.mirlume_delete_server\(uuid\) TO authenticated/);
});
