// Discordesque v0.2: direct peer-to-peer file transfers.
// No file bytes are stored in Supabase. Supabase stores only offers and WebRTC setup messages.
// 20 GiB on Windows (Electron native streaming) and browsers with a streaming save picker.
// Mobile fallback is strictly capped to 32 MiB until a native stream writer is available.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, FileUp, Paperclip, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

const MAX_BYTES = 20 * 1024 ** 3;
const MEMORY_LIMIT = 32 * 1024 ** 2;
const FRAME_BYTES = 16 * 1024;
const BATCH_BYTES = 512 * 1024;
const BUFFER_HIGH = 256 * 1024;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const pretty = (n) => n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GiB'
  : n >= 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MiB'
  : (n / 1024).toFixed(1) + ' KiB';

function pauseForBuffer(dc) {
  if (dc.readyState !== 'open') return Promise.reject(new Error('Connection was closed.'));
  if (dc.bufferedAmount < BUFFER_HIGH) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Connection stalled.')); }, 90000);
    const cleanup = () => { clearTimeout(timer); dc.removeEventListener('bufferedamountlow', check); dc.removeEventListener('close', closed); };
    const check = () => { if (dc.bufferedAmount < BUFFER_HIGH) { cleanup(); resolve(); } };
    const closed = () => { cleanup(); reject(new Error('Connection closed.')); };
    dc.bufferedAmountLowThreshold = BUFFER_HIGH / 2;
    dc.addEventListener('bufferedamountlow', check);
    dc.addEventListener('close', closed);
    check();
  });
}

async function makeWriter(offer) {
  const cleanName = String(offer.filename).split(/[\\/]/).pop() || 'download.bin';

  // Windows Electron's explicit native streaming bridge; memory use stays bounded.
  if (window.discordesqueFiles?.start) {
    const started = await window.discordesqueFiles.start(cleanName);
    if (!started?.id) throw new Error(started?.error || 'Save cancelled.');
    return {
      write: (arrayBuffer) => window.discordesqueFiles.write(started.id, arrayBuffer),
      close: () => window.discordesqueFiles.finish(started.id),
      abort: () => window.discordesqueFiles.cancel(started.id),
    };
  }

  // File System Access API: streams directly to disk in supporting browsers.
  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({ suggestedName: cleanName });
    const sink = await handle.createWritable();
    return {
      write: (arrayBuffer) => sink.write(arrayBuffer),
      close: () => sink.close(),
      abort: () => sink.abort(),
    };
  }

  // File downloads via Blob are not safe for gigantic files (mobile Safari/WebViews).
  if (offer.size_bytes > MEMORY_LIMIT) {
    throw new Error('Large-file receiving needs Windows or a browser with streaming file save. Android/iOS large-file saving requires the upcoming native writer. Files up to 32 MiB can be received here.');
  }
  const chunks = [];
  return {
    write: async (arrayBuffer) => { chunks.push(arrayBuffer); },
    close: async () => {
      const href = URL.createObjectURL(new Blob(chunks));
      const a = document.createElement('a');
      a.href = href;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 120000);
    },
    abort: async () => { chunks.length = 0; },
  };
}

export default function FileTransfers({ session, server, channel }) {
  const userId = session.user.id;
  const [open, setOpen] = useState(false);
  const [offers, setOffers] = useState([]);
  const [members, setMembers] = useState([]);
  const [recipient, setRecipient] = useState('');
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const fileInput = useRef(null);
  const active = useRef(null);
  const receivedSignals = useRef(new Set());
  const mounted = useRef(true);

  const showError = useCallback((err) => {
    if (mounted.current) {
      setError(err?.message || String(err));
      setStatus('error');
      setWorking(false);
    }
  }, []);

  const recordSignal = useCallback(async (transferId, toUser, kind, payload = {}) => {
    const { error: insertError } = await supabase.from('transfer_signals').insert({
      transfer_id: transferId,
      from_user: userId,
      to_user: toUser,
      kind,
      payload,
    });
    if (insertError) throw insertError;
  }, [userId]);

  const getOffers = useCallback(async () => {
    if (!channel?.id) return;
    const recent = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data, error: dbError } = await supabase.from('file_transfers')
      .select('id, sender_id, recipient_id, server_id, channel_id, filename, size_bytes, created_at')
      .eq('channel_id', channel.id).eq('recipient_id', userId)
      .gte('created_at', recent).order('created_at', { ascending: false }).limit(15);
    if (dbError) throw dbError;
    if (mounted.current) setOffers(data || []);
  }, [channel?.id, userId]);

  useEffect(() => {
    let live = true;
    async function getMembers() {
      if (!server?.id) return;
      const { data: rows, error: membershipError } = await supabase.from('server_members')
        .select('user_id').eq('server_id', server.id);
      if (membershipError) { showError(membershipError); return; }
      const ids = (rows || []).map(m => m.user_id).filter(id => id !== userId);
      if (!ids.length) { if (live) setMembers([]); return; }
      const { data: people } = await supabase.from('profiles').select('id,display_name').in('id', ids);
      if (live) {
        const names = ids.map(id => ({ id, display_name: people?.find(p => p.id === id)?.display_name || 'Member' }));
        setMembers(names);
        setRecipient(old => ids.includes(old) ? old : ids[0]);
      }
    }
    getMembers();
    return () => { live = false; };
  }, [server?.id, userId, showError]);

  const acceptIce = useCallback(async (ctx, candidate) => {
    if (!ctx || !candidate) return;
    if (ctx.pc.remoteDescription) {
      try { await ctx.pc.addIceCandidate(candidate); } catch (err) { console.warn('ICE candidate rejected', err); }
    } else ctx.iceQueue.push(candidate);
  }, []);

  const drainIce = useCallback(async (ctx) => {
    const candidates = ctx.iceQueue.splice(0);
    for (const candidate of candidates) await acceptIce(ctx, candidate);
  }, [acceptIce]);

  const handleSignal = useCallback(async (signal) => {
    if (receivedSignals.current.has(signal.id)) return;
    receivedSignals.current.add(signal.id);
    if (receivedSignals.current.size > 500) receivedSignals.current.clear();
    const ctx = active.current;
    if (!ctx || signal.transfer_id !== ctx.offer.id) return;
    if (signal.kind === 'ice') {
      await acceptIce(ctx, signal.payload.candidate);
    } else if (signal.kind === 'answer' && ctx.role === 'send') {
      if (!ctx.pc.remoteDescription) {
        await ctx.pc.setRemoteDescription(signal.payload.sdp);
        await drainIce(ctx);
      }
    } else if (signal.kind === 'reject' || signal.kind === 'cancel') {
      setStatus('cancelled');
      setWorking(false);
      ctx.pc.close();
      if (ctx.writer) await ctx.writer.abort();
      active.current = null;
    }
  }, [acceptIce, drainIce]);

  useEffect(() => {
    mounted.current = true;
    getOffers().catch(showError);
    const realtime = supabase.channel('files-' + userId + '-' + channel.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'file_transfers',
        filter: 'recipient_id=eq.' + userId,
      }, () => getOffers().catch(showError))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'transfer_signals',
        filter: 'to_user=eq.' + userId,
      }, ({ new: signal }) => handleSignal(signal).catch(showError))
      .subscribe();

    // Reconnect safety: recover any missed signaling rows while an offer is active.
    const poll = setInterval(async () => {
      const ctx = active.current;
      if (ctx) {
        const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data } = await supabase.from('transfer_signals').select('*')
          .eq('transfer_id', ctx.offer.id).eq('to_user', userId)
          .gte('created_at', cutoff).order('id', { ascending: true }).limit(300);
        for (const signal of data || []) handleSignal(signal).catch(showError);
      }
    }, 3500);

    return () => {
      mounted.current = false;
      clearInterval(poll);
      supabase.removeChannel(realtime);
      const ctx = active.current;
      if (ctx) {
        ctx.pc.close();
        if (ctx.writer) ctx.writer.abort().catch(() => {});
        active.current = null;
      }
    };
  }, [channel.id, userId, getOffers, handleSignal, showError]);

  const wireConnection = useCallback((ctx) => {
    const { pc, offer } = ctx;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) recordSignal(offer.id, ctx.peerId, 'ice', { candidate: ev.candidate.toJSON() }).catch(showError);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        showError(new Error('Peer connection failed. A restrictive router/firewall may require a TURN relay.'));
      }
    };
  }, [recordSignal, showError]);

  const sendFile = useCallback(async (ctx, dc) => {
    const sending = ctx.file;
    dc.send(JSON.stringify({ type: 'meta', name: sending.name, size: sending.size }));
    let sent = 0;
    while (sent < sending.size) {
      if (active.current !== ctx) throw new Error('Transfer interrupted.');
      const end = Math.min(sent + BATCH_BYTES, sending.size);
      const bytes = await sending.slice(sent, end).arrayBuffer();
      let resolveAck;
      let rejectAck;
      const ack = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
      const timer = setTimeout(() => rejectAck(new Error('Receiver stopped acknowledging data.')), 120000);
      ctx.acknowledge = () => { clearTimeout(timer); resolveAck(); };
      try {
        for (let p = 0; p < bytes.byteLength; p += FRAME_BYTES) {
          await pauseForBuffer(dc);
          dc.send(bytes.slice(p, p + FRAME_BYTES));
        }
        await ack;
      } finally {
        clearTimeout(timer);
        ctx.acknowledge = null;
      }
      sent = end;
      if (mounted.current) setProgress(Math.round(sent / sending.size * 100));
    }
    dc.send(JSON.stringify({ type: 'finished' }));
    if (mounted.current) setStatus('Awaiting receiver confirmation...');
  }, []);

  const receiveChannel = useCallback((ctx, dc) => {
    dc.binaryType = 'arraybuffer';
    ctx.writeChain = Promise.resolve();
    ctx.received = 0;
    ctx.ackBytes = 0;
    dc.onopen = () => setStatus('Receiving file...');
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        let packet;
        try { packet = JSON.parse(event.data); } catch { return; }
        if (packet.type === 'meta') {
          if (packet.size !== ctx.offer.size_bytes) showError(new Error('File size mismatch.'));
        }
        if (packet.type === 'finished') {
          ctx.writeChain = ctx.writeChain.then(async () => {
            if (ctx.received !== ctx.offer.size_bytes) throw new Error('Incomplete transfer.');
            await ctx.writer.close();
            dc.send(JSON.stringify({ type: 'complete' }));
            if (mounted.current) { setStatus('Received and saved successfully'); setProgress(100); setWorking(false); }
            ctx.writer = null;
            active.current = null;
          }).catch(showError);
        }
        return;
      }
      const bytes = event.data;
      ctx.writeChain = ctx.writeChain.then(async () => {
        const length = bytes.byteLength;
        if (ctx.received + length > ctx.offer.size_bytes) throw new Error('Transfer is larger than announced.');
        await ctx.writer.write(bytes);
        ctx.received += length;
        ctx.ackBytes += length;
        setProgress(Math.round(ctx.received / ctx.offer.size_bytes * 100));
        if (ctx.ackBytes >= BATCH_BYTES || ctx.received === ctx.offer.size_bytes) {
          ctx.ackBytes = 0;
          dc.send(JSON.stringify({ type: 'ack' }));
        }
      }).catch(showError);
    };
    dc.onclose = () => {
      if (active.current === ctx && ctx.received !== ctx.offer.size_bytes) showError(new Error('Connection closed before all bytes arrived.'));
    };
  }, [showError]);

  const sendChannel = useCallback((ctx, dc) => {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFER_HIGH / 2;
    dc.onopen = () => {
      if (mounted.current) setStatus('Sending file...');
      sendFile(ctx, dc).catch(showError);
    };
    dc.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === 'ack') ctx.acknowledge?.();
        if (packet.type === 'complete') {
          setStatus('Transfer complete'); setProgress(100); setWorking(false);
          active.current = null;
        }
      } catch { /* ignore malformed control packets */ }
    };
    dc.onclose = () => {
      if (active.current === ctx) showError(new Error('Transfer connection closed.'));
    };
  }, [sendFile, showError]);

  async function startSending() {
    if (!file || !recipient || !server?.id || !channel?.id) return;
    if (active.current) { setError('Only one transfer can be active at a time.'); return; }
    if (file.size < 1 || file.size > MAX_BYTES) { setError('Choose a nonempty file no larger than 20 GiB.'); return; }
    setWorking(true); setProgress(0); setError(''); setStatus('Creating secure file invitation...');
    let pc;
    try {
      const { data: offer, error: createError } = await supabase.from('file_transfers').insert({
        server_id: server.id, channel_id: channel.id, sender_id: userId,
        recipient_id: recipient, filename: file.name, size_bytes: file.size,
      }).select().single();
      if (createError) throw createError;
      pc = new RTCPeerConnection(rtcConfig);
      const ctx = { offer, pc, file, peerId: recipient, role: 'send', iceQueue: [], acknowledge: null };
      active.current = ctx;
      wireConnection(ctx);
      const dc = pc.createDataChannel('discordesque-file', { ordered: true });
      sendChannel(ctx, dc);
      const sdp = await pc.createOffer();
      await pc.setLocalDescription(sdp);
      await recordSignal(offer.id, recipient, 'offer', { sdp: pc.localDescription.toJSON() });
      setStatus('Invitation sent. Your friend must accept while you keep this chat open.');
      setOpen(true);
      await getOffers();
    } catch (err) {
      pc?.close(); active.current = null; showError(err);
    }
  }

  async function acceptOffer(offer) {
    if (active.current) { setError('Finish the current transfer first.'); return; }
    setProgress(0); setError(''); setStatus('Choose where to save ' + offer.filename);
    let writer;
    try {
      // Called directly from the Accept button so browser file picker has user activation.
      writer = await makeWriter(offer);
    } catch (err) { if (err?.name !== 'AbortError') showError(err); return; }
    setWorking(true);
    let pc;
    try {
      pc = new RTCPeerConnection(rtcConfig);
      const ctx = { offer, pc, writer, role: 'receive', peerId: offer.sender_id, iceQueue: [] };
      active.current = ctx;
      wireConnection(ctx);
      pc.ondatachannel = ({ channel: dc }) => receiveChannel(ctx, dc);
      setStatus('Connecting to sender...');
      const { data: signals, error: loadError } = await supabase.from('transfer_signals')
        .select('*').eq('transfer_id', offer.id).order('id', { ascending: true }).limit(150);
      if (loadError) throw loadError;
      const original = (signals || []).find(signal => signal.kind === 'offer' && signal.from_user === offer.sender_id);
      if (!original) throw new Error('Sender is not ready yet. Ask them to retry the transfer.');
      await pc.setRemoteDescription(original.payload.sdp);
      for (const signal of signals || []) {
        if (signal.kind === 'ice' && signal.from_user === offer.sender_id) await acceptIce(ctx, signal.payload.candidate);
      }
      await drainIce(ctx);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await recordSignal(offer.id, offer.sender_id, 'answer', { sdp: pc.localDescription.toJSON() });
      setStatus('Connecting to sender...');
    } catch (err) {
      pc?.close(); await writer?.abort().catch(() => {}); active.current = null; showError(err);
    }
  }

  async function rejectOffer(offer) {
    try {
      await recordSignal(offer.id, offer.sender_id, 'reject');
      setOffers(old => old.filter(item => item.id !== offer.id));
    } catch (err) { showError(err); }
  }

  async function cancelCurrent() {
    const ctx = active.current;
    if (ctx) {
      active.current = null;
      ctx.pc.close();
      if (ctx.writer) await ctx.writer.abort().catch(() => {});
      recordSignal(ctx.offer.id, ctx.peerId, 'cancel').catch(() => {});
    }
    setWorking(false); setStatus('Transfer cancelled'); setProgress(0);
  }

  return (
    <div className="files-widget">
      <button type="button" className="file-share-button" title="Share files peer to peer" aria-label="Share file" onClick={() => { setOpen(v => !v); setError(''); }}><Paperclip size={20}/></button>
      {open && <div className="file-popover" role="dialog" aria-label="File sharing">
        <div className="file-popover-title"><strong><FileUp size={19}/> Share a file</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close file sharing"><X size={19}/></button></div>
        <p className="file-help">Direct transfers up to <strong>20 GiB</strong>, no cloud storage. Both people must stay online in the channel. Some networks need a TURN relay.</p>
        <label htmlFor="file-recipient">SEND TO</label>
        <select id="file-recipient" value={recipient} onChange={e => setRecipient(e.target.value)} disabled={working}>
          {members.length === 0 && <option value="">Invite a friend first</option>}
          {members.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}
        </select>
        <input ref={fileInput} type="file" aria-label="Choose file" onChange={e => setFile(e.target.files?.[0] || null)} disabled={working}/>
        {file && <p className="file-info">{file.name} · {pretty(file.size)}</p>}
        <button className="primary-button wide" type="button" disabled={working || !file || !recipient} onClick={startSending}><FileUp size={17}/> Send file</button>
        {!!offers.length && <div className="file-incoming">
          <strong>Incoming file invitations</strong>
          {offers.map(offer => <div className="file-offer" key={offer.id}>
            <div className="file-offer-name">{offer.filename}<small>{pretty(offer.size_bytes)} · sender must be online</small></div>
            <div className="file-offer-actions"><button type="button" onClick={() => acceptOffer(offer)} disabled={working}><Download size={16}/> Accept</button><button type="button" onClick={() => rejectOffer(offer)} disabled={working}>Decline</button></div>
          </div>)}
        </div>}
        {!!status && <div className="file-status" role="status">
          {status === 'Transfer complete' || status.startsWith('Received and saved') ? <Check size={17} /> : <FileUp size={17}/>}
          <span>{status}</span><strong>{progress}%</strong>
        </div>}
        {working && <div className="file-meter"><div style={{width: progress + '%'}} /></div>}
        {working && <button type="button" className="file-cancel" onClick={cancelCurrent}>Cancel transfer</button>}
        {!!error && <p className="file-error" role="alert">{error}</p>}
        <p className="file-disclaimer">20 GiB saving requires Windows or a compatible streaming file picker. Mobile fallback is limited to 32 MiB until native storage support is added. No resumable transfers yet.</p>
      </div>}
    </div>
  );
}
