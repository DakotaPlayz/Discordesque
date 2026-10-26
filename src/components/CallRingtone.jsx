import { useEffect, useState } from 'react';

// Web Audio ringback for callers and a distinct two-burst ringtone for receivers.
// Audio is never streamed to the other user; this is only local UI feedback.
let soundContext;
function getSoundContext() {
  const AudioContextType = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextType) return null;
  if (!soundContext || soundContext.state === 'closed') soundContext = new AudioContextType();
  return soundContext;
}

function ringNote(context, frequencies, at, duration, volume = 0.055) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.025);
  gain.gain.setValueAtTime(volume, at + Math.max(0.04, duration - 0.06));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  gain.connect(context.destination);
  const oscillators = frequencies.map(frequency => {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.015);
    return oscillator;
  });
  return () => {
    try { gain.gain.cancelScheduledValues(context.currentTime); gain.gain.setValueAtTime(0, context.currentTime); }
    catch { /* Context may have been interrupted. */ }
    for (const oscillator of oscillators) { try { oscillator.stop(); } catch { /* already stopped */ } }
  };
}

export function CallRingtone({ call }) {
  const [audioBlocked, setAudioBlocked] = useState(false);
  const mode = call?.phase === 'incoming' ? 'incoming'
    : call?.direction === 'outgoing' && (call.phase === 'calling' || call.phase === 'connecting')
      ? 'outgoing' : null;

  // Unlock the audio context on an actual user gesture (needed by Android
  // WebView and browsers that restrict autoplay). Ringing can otherwise be muted
  // by the OS until the user touches the application.
  useEffect(() => {
    const unlock = () => {
      try { void getSoundContext()?.resume().catch(() => {}); } catch { /* no audio output */ }
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  useEffect(() => {
    if (!mode) { setAudioBlocked(false); return; }
    let active = true;
    let timer;
    let cancelCurrent = () => {};
    const context = getSoundContext();
    if (!context) { setAudioBlocked(true); return; }
    const cadence = mode === 'incoming' ? 2400 : 3000;
    const tick = () => {
      cancelCurrent();
      if (!active || context.state !== 'running') return;
      const now = context.currentTime + 0.02;
      const stops = mode === 'incoming'
        ? [
            ringNote(context, [740, 920], now, 0.36),
            ringNote(context, [740, 920], now + 0.47, 0.36)
          ]
        : [ringNote(context, [425, 480], now, 1.15, 0.035)];
      cancelCurrent = () => stops.forEach(stop => stop());
    };
    void context.resume().then(() => {
      if (!active) return;
      setAudioBlocked(context.state !== 'running');
      if (context.state !== 'running') return;
      tick();
      timer = window.setInterval(tick, cadence);
    }).catch(() => { if (active) setAudioBlocked(true); });
    return () => {
      active = false;
      clearInterval(timer);
      cancelCurrent();
    };
  }, [call?.id, mode, audioBlocked]);

  if (!mode || !audioBlocked) return null;
  return <button className="voice-enable-ring" type="button" onClick={async () => {
    try {
      const ctx = getSoundContext();
      await ctx?.resume();
      setAudioBlocked(ctx?.state !== 'running');
    } catch { setAudioBlocked(true); }
  }}>Enable call ringtone</button>;
}
