import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2 } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const RING_TIMEOUT_MS = 60000;

// Signaling only: audio goes directly between peers over WebRTC, not through Supabase.
// Public STUN works on many home networks; restrictive NATs still require a TURN relay.
export function useVoiceCalls(uid) {
  const [call, setCall] = useState(null);
  const [muted, setMuted] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [error, setError] = useState('');
  const currentRef = useRef(null);
  const timeoutRef = useRef(null);

  const signal = useCallback(async (current, type, payload = {}) => {
    const { error: dbError } = await supabase.from('mirlume_call_signals').insert({
      call_id: current.id, conversation_id: current.conversationId,
      sender_id: uid, recipient_id: current.peerId,
      signal_type: type, payload
    });
    if (dbError) throw new Error(dbError.message + ' (run supabase/voice-calls-v0.5.6.sql if not installed)');
  }, [uid]);

  const finish = useCallback((message = '') => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const current = currentRef.current;
    currentRef.current = null;
    if (current?.localStream) current.localStream.getTracks().forEach(track => track.stop());
    if (current?.pc) {
      current.pc.onicecandidate = null;
      current.pc.ontrack = null;
      current.pc.onconnectionstatechange = null;
      current.pc.close();
    }
    setCall(null);
    setMuted(false);
    setRemoteStream(null);
    if (message) setError(message);
  }, []);

  const endCall = useCallback(async (reason = 'hangup') => {
    const current = currentRef.current;
    finish();
    if (current) {
      try { await signal(current, reason); }
      catch (e) { console.warn('Could not signal ended call:', e); }
    }
  }, [finish, signal]);

  const scheduleTimeout = useCallback((current) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (currentRef.current?.id === current.id &&
          !['connected', 'reconnecting'].includes(currentRef.current.phase)) {
        void endCall('hangup');
        setError('Call unanswered or timed out.');
      }
    }, RING_TIMEOUT_MS);
  }, [endCall]);

  const attachPeer = useCallback(async (current) => {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error('Voice calling requires microphone access and WebRTC on this device.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
    });
    if (currentRef.current !== current) {
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    current.localStream = stream;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    current.pc = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      if (currentRef.current === current) {
        setRemoteStream(event.streams[0] || new MediaStream([event.track]));
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && currentRef.current === current) {
        const candidate = event.candidate.toJSON();
        // Never publish ICE candidates before the offer; the recipient might
        // receive and discard them before it knows the call ID.
        if (current.phase === 'calling' && !current.offerSent) {
          current.pendingOutgoingCandidates.push(candidate);
        } else {
          void signal(current, 'candidate', { candidate })
            .catch(e => console.warn('Could not send ICE candidate:', e));
        }
      }
    };
    pc.onconnectionstatechange = () => {
      if (currentRef.current !== current) return;
      if (pc.connectionState === 'connected') {
        clearTimeout(timeoutRef.current);
        current.phase = 'connected';
        setCall(old => old?.id === current.id ? { ...old, phase: 'connected' } : old);
      } else if (pc.connectionState === 'disconnected') {
        current.phase = 'reconnecting';
        setCall(old => old?.id === current.id ? { ...old, phase: 'reconnecting' } : old);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        void endCall('hangup');
        setError('Voice connection ended. A TURN server may be needed on this network.');
      }
    };
    return pc;
  }, [signal, endCall]);

  const flushCandidates = useCallback(async (current) => {
    if (!current.pc || !current.remoteDescriptionSet) return;
    const candidates = current.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try { await current.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.warn('ICE candidate rejected:', e); }
    }
  }, []);

  const startCall = useCallback(async (conversationId, peerId, peerName) => {
    if (!conversationId || !peerId || currentRef.current) return;
    setError('');
    const current = {
      id: crypto.randomUUID(), conversationId, peerId, peerName,
      phase: 'calling', pc: null, localStream: null, pendingCandidates: [], pendingOutgoingCandidates: [], offerSent: false,
      remoteDescriptionSet: false
    };
    currentRef.current = current;
    setCall({ id: current.id, phase: 'calling', peerName });
    try {
      const pc = await attachPeer(current);
      if (!pc) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (currentRef.current !== current) return;
      await signal(current, 'offer', { description: pc.localDescription.toJSON() });
      current.offerSent = true;
      for (const candidate of current.pendingOutgoingCandidates.splice(0)) {
        void signal(current, 'candidate', { candidate }).catch(e => console.warn('Could not send ICE candidate:', e));
      }
      scheduleTimeout(current);
    } catch (e) {
      if (currentRef.current === current) finish(e.message || 'Unable to start voice call.');
    }
  }, [attachPeer, finish, scheduleTimeout, signal]);

  const acceptCall = useCallback(async () => {
    const current = currentRef.current;
    if (!current || current.phase !== 'incoming') return;
    setError('');
    current.phase = 'connecting';
    setCall(old => old?.id === current.id ? { ...old, phase: 'connecting' } : old);
    try {
      const pc = await attachPeer(current);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(current.offer));
      current.remoteDescriptionSet = true;
      await flushCandidates(current);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (currentRef.current !== current) return;
      await signal(current, 'answer', { description: pc.localDescription.toJSON() });
    } catch (e) {
      if (currentRef.current === current) {
        await endCall('decline');
        setError(e.message || 'Could not answer the call.');
      }
    }
  }, [attachPeer, endCall, flushCandidates, signal]);

  const toggleMute = useCallback(() => {
    const stream = currentRef.current?.localStream;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const handleSignal = useCallback(async (row) => {
    if (!row || row.recipient_id !== uid || row.sender_id === uid) return;
    let current = currentRef.current;
    if (row.signal_type === 'offer') {
      if (Date.now() - Date.parse(row.created_at) > RING_TIMEOUT_MS) return;
      if (current) {
        if (current.id !== row.call_id) {
          const busy = { id: row.call_id, conversationId: row.conversation_id, peerId: row.sender_id };
          void signal(busy, 'decline', { reason: 'busy' }).catch(console.warn);
        }
        return;
      }
      current = {
        id: row.call_id, conversationId: row.conversation_id, peerId: row.sender_id,
        peerName: 'Incoming call', phase: 'incoming', offer: row.payload?.description,
        pc: null, localStream: null, pendingCandidates: [], remoteDescriptionSet: false
      };
      if (!current.offer?.sdp || current.offer.type !== 'offer') return;
      currentRef.current = current;
      setError('');
      setCall({ id: current.id, phase: 'incoming', peerName: current.peerName });
      scheduleTimeout(current);
      const { data } = await supabase.from('profiles').select('display_name').eq('id', current.peerId).maybeSingle();
      if (currentRef.current === current && data?.display_name) {
        current.peerName = data.display_name;
        setCall(old => old?.id === current.id ? { ...old, peerName: data.display_name } : old);
      }
      return;
    }
    if (!current || current.id !== row.call_id || current.peerId !== row.sender_id) return;
    if (row.signal_type === 'candidate') {
      const candidate = row.payload?.candidate;
      if (!candidate?.candidate) return;
      if (!current.pc || !current.remoteDescriptionSet) current.pendingCandidates.push(candidate);
      else {
        try { await current.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
        catch (e) { console.warn('Failed to add ICE candidate:', e); }
      }
    } else if (row.signal_type === 'answer' && current.phase === 'calling' && current.pc) {
      try {
        const description = row.payload?.description;
        if (!description || description.type !== 'answer') return;
        await current.pc.setRemoteDescription(new RTCSessionDescription(description));
        current.remoteDescriptionSet = true;
        current.phase = 'connecting';
        setCall(old => old?.id === current.id ? { ...old, phase: 'connecting' } : old);
        await flushCandidates(current);
      } catch (e) {
        await endCall('hangup');
        setError('Could not establish voice connection: ' + e.message);
      }
    } else if (row.signal_type === 'hangup' || row.signal_type === 'decline') {
      finish(row.signal_type === 'decline' ? 'Call declined or recipient is busy.' : 'Call ended.');
    }
  }, [uid, signal, scheduleTimeout, endCall, finish, flushCandidates]);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    const channel = supabase.channel('voice-signals-' + uid)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'mirlume_call_signals',
        filter: 'recipient_id=eq.' + uid
      }, ({ new: row }) => { if (active) void handleSignal(row); })
      .subscribe(status => {
        // Recover offers received during a short disconnect or while switching pages.
        if (status === 'SUBSCRIBED' && active) {
          void (async () => {
            const since = new Date(Date.now() - RING_TIMEOUT_MS).toISOString();
            const { data } = await supabase.from('mirlume_call_signals')
              .select('*').eq('recipient_id', uid).eq('signal_type', 'offer')
              .gte('created_at', since).order('created_at', { ascending: false }).limit(3);
            for (const offer of data || []) {
              if (!active || currentRef.current) break;
              const { data: updates } = await supabase.from('mirlume_call_signals')
                .select('signal_type').eq('call_id', offer.call_id)
                .in('signal_type', ['hangup', 'decline']).limit(1);
              if (!updates?.length) await handleSignal(offer);
            }
          })();
        }
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
      clearTimeout(timeoutRef.current);
      const c = currentRef.current;
      currentRef.current = null;
      c?.localStream?.getTracks().forEach(track => track.stop());
      c?.pc?.close();
    };
  }, [uid, handleSignal]);

  return { call, muted, remoteStream, error, dismissError: () => setError(''),
    startCall, acceptCall, endCall, toggleMute };
}

export function VoiceCallPanel({ voice }) {
  const audioRef = useRef(null);
  const [needsAudio, setNeedsAudio] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = voice.remoteStream;
    setNeedsAudio(false);
    if (voice.remoteStream) audio.play().catch(() => setNeedsAudio(true));
  }, [voice.remoteStream]);

  return <>
    <audio ref={audioRef} autoPlay playsInline />
    {voice.error && <div className="voice-call-notice" role="alert">
      <span>{voice.error}</span>
      <button type="button" aria-label="Dismiss voice call message" onClick={voice.dismissError}>×</button>
    </div>}
    {voice.call && <section className="voice-call-panel" role="dialog" aria-label="Voice call" aria-live="polite">
      <div className="voice-call-info">
        <Phone size={19} />
        <span><strong>{voice.call.peerName}</strong>
          <small>{{
            incoming: 'Incoming voice call',
            calling: 'Calling…',
            connecting: 'Connecting…',
            connected: 'Voice call connected',
            reconnecting: 'Reconnecting…'
          }[voice.call.phase] || 'Voice call'}</small>
        </span>
      </div>
      <div className="voice-call-actions">
        {voice.call.phase === 'incoming'
          ? <button type="button" className="voice-call-accept" onClick={voice.acceptCall}><Phone size={17}/> Answer</button>
          : <button type="button" className="icon-button" onClick={voice.toggleMute}
              disabled={voice.call.phase === 'calling'}
              title={voice.muted ? 'Unmute microphone' : 'Mute microphone'}>
              {voice.muted ? <MicOff size={20}/> : <Mic size={20}/>}
            </button>}
        {needsAudio && <button type="button" className="icon-button"
          title="Enable incoming audio" onClick={() => audioRef.current?.play().then(() => setNeedsAudio(false)).catch(() => {})}>
          <Volume2 size={20}/>
        </button>}
        <button type="button" className="voice-call-end" onClick={() => voice.endCall(voice.call.phase === 'incoming' ? 'decline' : 'hangup')}>
          <PhoneOff size={17}/> {voice.call.phase === 'incoming' ? 'Decline' : 'End'}
        </button>
      </div>
    </section>}
  </>;
}
