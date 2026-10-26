import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const calls = readFileSync('src/components/VoiceCalls.jsx', 'utf8');
const electron = readFileSync('electron/main.cjs', 'utf8');
const styles = readFileSync('src/voice-calls.css', 'utf8');
const signaling = readFileSync('supabase/voice-calls-v0.5.6.sql', 'utf8');

test('voice calls stay audio-only until sharing is explicitly requested', () => {
  const attach = calls.slice(calls.indexOf('const attachPeer ='), calls.indexOf('const flushCandidates ='));
  const share = calls.slice(calls.indexOf('const startScreenShare ='), calls.indexOf('const toggleMute ='));
  assert.doesNotMatch(attach, /addTransceiver/);
  assert.match(share, /addTransceiver\('video', \{ direction: 'sendrecv' \}\)/);
  assert.match(share, /renegotiate: true/);
  assert.match(calls, /transceiver\.sender\.replaceTrack\(track\)/);
  assert.match(calls, /screenTransceiver\.sender\.replaceTrack\(null\)/);
  assert.match(calls, /track\.onunmute = show/);
  assert.match(calls, /track\.onmute = hide/);
});

test('share captures native display geometry and requests up to 60 fps', () => {
  assert.match(calls, /navigator\.mediaDevices\.getDisplayMedia\(/);
  assert.match(calls, /frameRate:\s*\{\s*ideal:\s*60,\s*max:\s*60\s*\}/);
  assert.match(calls, /track\.contentHint = 'detail'/);
  assert.match(calls, /setRemoteScreenStream\(new MediaStream\(\[track\]\)\)/);
  assert.match(calls, /getVideoTracks\(\)\[0\]/);
  assert.match(calls, /current\.screenStream\.getTracks\(\)/);
  assert.match(calls, /screenVideoRef|videoRef/);
  assert.match(calls, /Share screen/);
});

test('only an authorized Electron window sees a native screen picker', () => {
  assert.match(electron, /setDisplayMediaRequestHandler/);
  assert.match(electron, /desktopCapturer\.getSources/);
  assert.match(electron, /dialog\.showMessageBox\(win/);
  assert.match(electron, /Screen: /);
  assert.match(electron, /Window: /);
  assert.match(electron, /'Cancel'/);
  assert.match(electron, /permission === 'display-capture'/);
  assert.match(electron, /isOwnWindow\(webContents\)/);
  assert.match(electron, /types\.includes\('audio'\) && !types\.includes\('video'\)/);
});

test('screen sharing does not upload media to the Supabase signaling table', () => {
  assert.match(calls, /const ICE_SERVERS/);
  assert.match(calls, /RTCPeerConnection/);
  assert.match(signaling, /signal_type in \('offer','answer','candidate','hangup','decline'\)/);
  assert.ok(!/signal\(current, ['"]screen/.test(calls));
});

test('Android receiver shows video without prompting for unsupported capture', () => {
  assert.match(calls, /Capacitor\.isNativePlatform\(\) && Capacitor\.getPlatform\(\) === 'android'/);
  assert.match(calls, /voice\.remoteScreenStream/);
  assert.match(calls, /requestFullscreen/);
  assert.match(styles, /\.voice-screen-video/);
  assert.match(styles, /--mirlume-safe-top/);
});
