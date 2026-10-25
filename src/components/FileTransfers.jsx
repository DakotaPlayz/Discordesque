// Peer-to-peer DM attachments. Clicking the attachment starts the download.
// Bytes never go to Supabase; the sender must keep the conversation open.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Download, FileUp, Paperclip, LoaderCircle, X, Check } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

const Native = registerPlugin('MirlumeFileWriter');
const MAX = 20 * 1024 ** 3;
const MEM_LIMIT = 32 * 1024 ** 2;
const CHUNK = 16 * 1024;
const BATCH = 512 * 1024;
const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const niceSize = (n) => n >= 1024**3 ? (n/1024**3).toFixed(2) + ' GiB' : n >= 1024**2 ? (n/1024**2).toFixed(1) + ' MiB' : Math.ceil(n/1024) + ' KiB';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function b64(buffer) {
  const bytes = new Uint8Array(buffer);
  let chars = '';
  for (let i = 0; i < bytes.length; i++) chars += String.fromCharCode(bytes[i]);
  return btoa(chars);
}
async function getWriter(offer) {
  const filename = String(offer.filename).split(/[\\/]/).pop() || 'download.bin';
  if (window.discordesqueFiles?.start) {
    const result = await window.discordesqueFiles.start(filename, offer.size_bytes);
    if (!result?.id) throw Error('Could not create download destination.');
    return { location:result.location, write:bytes=>window.discordesqueFiles.write(result.id,bytes),
      close:()=>window.discordesqueFiles.finish(result.id),abort:()=>window.discordesqueFiles.cancel(result.id) };
  }
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === 'android' || platform === 'ios') {
      const result = await Native.start({ filename, size: offer.size_bytes });
      if (!result?.id) throw Error('Native file storage is unavailable.');
      return { location:result.location || 'Mirlume downloads',
        write:bytes=>Native.write({id:result.id, chunk:b64(bytes)}),
        close:()=>Native.finish({id:result.id}),
        abort:()=>Native.cancel({id:result.id}) };
    }
  }
  // A file-picker is permitted because the receiver CLICKED Download.
  if (typeof window.showSaveFilePicker === 'function') {
    const handle = await window.showSaveFilePicker({suggestedName:filename});
    const sink = await handle.createWritable();
    return { location:'chosen folder', write:bytes=>sink.write(bytes),
      close:()=>sink.close(), abort:()=>sink.abort() };
  }
  if (offer.size_bytes > MEM_LIMIT)
    throw Error('This browser cannot stream such a large file to disk. Use Mirlume for Windows, Android or iOS, or a compatible desktop browser.');
  const chunks=[];
  return { location:'Downloads', write:async bytes=>{chunks.push(bytes);},close:async()=>{
    const href=URL.createObjectURL(new Blob(chunks));
    const a=document.createElement('a');a.href=href;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(href),120000);
  },abort:async()=>{chunks.length=0;} };
}
async function drain(channel) {
  if(channel.readyState!=='open') throw Error('Peer disconnected.');
  if(channel.bufferedAmount < 256*1024) return;
  await new Promise((resolve,reject)=>{
    const t=setTimeout(()=>{clean();reject(Error('Peer stalled.'));},120000);
    const onLow=()=>{if(channel.bufferedAmount < 256*1024){clean();resolve();}};
    const onClose=()=>{clean();reject(Error('Peer disconnected.'));};
    const clean=()=>{clearTimeout(t);channel.removeEventListener('bufferedamountlow',onLow);channel.removeEventListener('close',onClose);};
    channel.bufferedAmountLowThreshold=128*1024;
    channel.addEventListener('bufferedamountlow',onLow);
    channel.addEventListener('close',onClose);
    onLow();
  });
}

export default function FileTransfers({session, conversationId, peerId, peerName}) {
  const self=session.user.id;
  const [transfers,setTransfers]=useState([]);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const pick=useRef(null);
  const active=useRef(null);
  const seen=useRef(new Set());
  const mounted=useRef(true);
  const busyRef=useRef(false);
  const update=(text,percent)=>{if(mounted.current){setStatus(text);if(percent!==undefined)setProgress(percent);}};

  const finish=useCallback(async(id,outcome)=>{
    const {error:e}=await supabase.rpc('finish_mirlume_dm_transfer',{p_transfer_id:id,p_outcome:outcome});
    if(e) console.warn('Transfer status:',e.message);
  },[]);
  const signal=useCallback(async(id,to,kind,payload={})=>{
    const {error:e}=await supabase.from('transfer_signals').insert({
      transfer_id:id,from_user:self,to_user:to,kind,payload
    });if(e)throw e;
  },[self]);
  const reload=useCallback(async()=>{
    if(!conversationId)return;
    const {data,error:e}=await supabase.from('file_transfers')
      .select('id,conversation_id,sender_id,recipient_id,filename,size_bytes,transfer_status,created_at')
      .eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(35);
    if(e){if(mounted.current)setError(e.message);return;}
    if(mounted.current)setTransfers(data||[]);
  },[conversationId]);
  const failed=useCallback(err=>{
    const ctx=active.current;active.current=null;busyRef.current=false;
    if(ctx){
      ctx.pc.close();
      if(ctx.writer)Promise.resolve(ctx.writer.abort()).catch(()=>{});
      finish(ctx.offer.id,ctx.role==='receiver'?'failed':'cancelled').catch(()=>{});
      signal(ctx.offer.id,ctx.peer,'cancel').catch(()=>{});
    }
    if(mounted.current){setBusy(false);setError(err?.message||String(err));setStatus('Transfer failed');}
    reload().catch(()=>{});
  },[finish,signal,reload]);
  const addIce=async(ctx,candidate)=>{
    if(!candidate)return;
    if(!ctx.pc.remoteDescription){ctx.queued.push(candidate);return;}
    try{await ctx.pc.addIceCandidate(candidate);}catch(e){console.warn('ICE candidate rejected',e);}
  };
  const onSignal=useCallback(async entry=>{
    if(seen.current.has(entry.id))return;
    seen.current.add(entry.id);if(seen.current.size>1000)seen.current.clear();
    const ctx=active.current;
    if(!ctx||entry.transfer_id!==ctx.offer.id)return;
    if(entry.kind==='ice')await addIce(ctx,entry.payload.candidate);
    else if(entry.kind==='answer'&&ctx.role==='sender'&&!ctx.pc.remoteDescription){
      await ctx.pc.setRemoteDescription(entry.payload.sdp);
      for(const ice of ctx.queued.splice(0))await addIce(ctx,ice);
    }else if(entry.kind==='cancel'||entry.kind==='reject'){
      failed(Error('Transfer was cancelled or the peer disconnected.'));
    }
  },[failed]);
  const wire=ctx=>{
    ctx.pc.onicecandidate=event=>{
      if(event.candidate)signal(ctx.offer.id,ctx.peer,'ice',{candidate:event.candidate.toJSON()}).catch(failed);
    };
    ctx.pc.onconnectionstatechange=()=>{
      if(active.current===ctx&&ctx.pc.connectionState==='failed')
        failed(Error('Could not connect directly. A TURN relay may be needed on this network.'));
    };
  };
  const sendBytes=async(ctx,dc)=>{
    let cursor=0;
    while(cursor<ctx.file.size){
      if(active.current!==ctx)throw Error('Transfer interrupted.');
      const end=Math.min(cursor+BATCH,ctx.file.size);
      const bytes=await ctx.file.slice(cursor,end).arrayBuffer();
      let ackOK,ackFail;
      const ack=new Promise((res,rej)=>{ackOK=res;ackFail=rej;});
      const timer=setTimeout(()=>ackFail(Error('Receiver did not acknowledge data.')),120000);
      ctx.ack=()=>{clearTimeout(timer);ackOK();};
      try{
        for(let i=0;i<bytes.byteLength;i+=CHUNK){await drain(dc);dc.send(bytes.slice(i,i+CHUNK));}
        await ack;
      }finally{clearTimeout(timer);ctx.ack=null;}
      cursor=end;update('Sending '+ctx.file.name+'…',Math.round(cursor*100/ctx.file.size));
    }
    dc.send(JSON.stringify({type:'finished'}));
    update('Finalizing download…',100);
  };
  const senderChannel=(ctx,dc)=>{
    dc.binaryType='arraybuffer';
    dc.onopen=()=>sendBytes(ctx,dc).catch(failed);
    dc.onmessage=ev=>{
      if(typeof ev.data!=='string')return;
      try{
        const p=JSON.parse(ev.data);
        if(p.type==='ack')ctx.ack?.();
        if(p.type==='complete'){
          active.current=null;busyRef.current=false;ctx.pc.close();
          update('Delivered to '+peerName,100);setBusy(false);reload();
        }
      }catch(e){console.warn(e);}
    };
    dc.onclose=()=>{if(active.current===ctx)failed(Error('Transfer connection closed.'));};
  };
  const receiverChannel=(ctx,dc)=>{
    dc.binaryType='arraybuffer';ctx.chain=Promise.resolve();ctx.received=0;ctx.ackBytes=0;
    dc.onopen=()=>update('Downloading '+ctx.offer.filename+'…',0);
    dc.onmessage=event=>{
      if(typeof event.data==='string'){
        try{
          const p=JSON.parse(event.data);
          if(p.type==='finished'){
            ctx.chain=ctx.chain.then(async()=>{
              if(ctx.received!==ctx.offer.size_bytes)throw Error('Incomplete download.');
              await ctx.writer.close();
              ctx.writer=null;
              await finish(ctx.offer.id,'completed');
              dc.send(JSON.stringify({type:'complete'}));
              active.current=null;busyRef.current=false;
              update('Downloaded to '+ctx.location,100);setBusy(false);
              setTimeout(()=>ctx.pc.close(),1800);reload();
            }).catch(failed);
          }
        }catch(e){failed(e);}return;
      }
      const bytes=event.data;
      ctx.chain=ctx.chain.then(async()=>{
        if(active.current!==ctx)return;
        if(ctx.received+bytes.byteLength>ctx.offer.size_bytes)throw Error('File exceeds expected size.');
        await ctx.writer.write(bytes);ctx.received+=bytes.byteLength;ctx.ackBytes+=bytes.byteLength;
        update('Downloading '+ctx.offer.filename+'…',Math.round(ctx.received*100/ctx.offer.size_bytes));
        if(ctx.ackBytes>=BATCH||ctx.received===ctx.offer.size_bytes){
          ctx.ackBytes=0;dc.send(JSON.stringify({type:'ack'}));
        }
      }).catch(failed);
    };
    dc.onclose=()=>{if(active.current===ctx&&ctx.received!==ctx.offer.size_bytes)failed(Error('File transfer interrupted.'));};
  };

  async function sendFile(file){
    if(!file||busyRef.current||!peerId)return;
    if(file.size<1||file.size>MAX){setError('Choose a file between 1 byte and 20 GiB.');return;}
    busyRef.current=true;setBusy(true);setError('');update('Sharing '+file.name+' with '+peerName+'…',0);
    try{
      const {data:offer,error:e}=await supabase.from('file_transfers').insert({
        conversation_id:conversationId,sender_id:self,recipient_id:peerId,
        filename:file.name.slice(0,255),size_bytes:file.size,
      }).select().single();
      if(e)throw e;
      const pc=new RTCPeerConnection(STUN);
      const ctx={offer,pc,peer:peerId,role:'sender',file,queued:[],ack:null};
      active.current=ctx;wire(ctx);
      const dc=pc.createDataChannel('mirlume-file',{ordered:true});
      senderChannel(ctx,dc);
      await pc.setLocalDescription(await pc.createOffer());
      await signal(offer.id,peerId,'offer',{sdp:pc.localDescription.toJSON()});
      update('Shared in chat · waiting for '+peerName+' to click Download',0);
      await reload();
    }catch(e){failed(e);}
  }

  async function downloadFile(offer){
    if(busyRef.current||offer.sender_id!==peerId)return;
    // The click is the only action required from the recipient.
    busyRef.current=true;setBusy(true);setError('');update('Preparing download…',0);
    let writer=null,pc=null,claimed=false;
    try{
      // For browsers, the picker must open in the user's click event, before await RPC.
      writer=await getWriter(offer);
      const {data,error:e}=await supabase.rpc('claim_mirlume_dm_transfer',{p_transfer_id:offer.id});
      if(e)throw e;
      if(!data)throw Error('This download has already started or expired. Ask your friend to send it again.');
      claimed=true;
      pc=new RTCPeerConnection(STUN);
      const ctx={offer,pc,writer,location:writer.location||'Downloads',role:'receiver',peer:peerId,queued:[]};
      active.current=ctx;wire(ctx);
      pc.ondatachannel=ev=>receiverChannel(ctx,ev.channel);
      let signals=[],original;
      for(let attempt=0;attempt<24;attempt++){
        const {data:records,error:readError}=await supabase.from('transfer_signals')
          .select('*').eq('transfer_id',offer.id).order('id',{ascending:true}).limit(300);
        if(readError)throw readError;
        signals=records||[];original=signals.find(x=>x.kind==='offer'&&x.from_user===peerId);
        if(original)break;
        await sleep(400);
      }
      if(!original)throw Error('Sender is no longer online.');
      await pc.setRemoteDescription(original.payload.sdp);
      for(const msg of signals){
        if(msg.kind==='ice'&&msg.from_user===peerId){seen.current.add(msg.id);await addIce(ctx,msg.payload.candidate);}
      }
      for(const candidate of ctx.queued.splice(0))await addIce(ctx,candidate);
      await pc.setLocalDescription(await pc.createAnswer());
      await signal(offer.id,peerId,'answer',{sdp:pc.localDescription.toJSON()});
      update('Connecting to '+peerName+'…',0);reload();
    }catch(e){
      pc?.close();if(writer)await writer.abort().catch(()=>{});
      if(claimed){finish(offer.id,'failed').catch(()=>{});signal(offer.id,peerId,'cancel').catch(()=>{});}
      active.current=null;busyRef.current=false;setBusy(false);setError(e.message||String(e));reload();
    }
  }

  async function cancel(){
    const ctx=active.current;active.current=null;busyRef.current=false;
    if(ctx){ctx.pc.close();if(ctx.writer)await ctx.writer.abort().catch(()=>{});
      await finish(ctx.offer.id,'cancelled');await signal(ctx.offer.id,ctx.peer,'cancel').catch(()=>{});}
    setBusy(false);update('Transfer cancelled');reload();
  }
  useEffect(()=>{
    mounted.current=true;reload();
    const subscription=supabase.channel('mirlume-dm-files-'+conversationId+'-'+self)
      .on('postgres_changes',{event:'*',schema:'public',table:'file_transfers'},
        ()=>reload())
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'transfer_signals',
        filter:'to_user=eq.'+self},({new:entry})=>onSignal(entry).catch(failed))
      .subscribe();
    const timer=setInterval(async()=>{
      reload();
      const ctx=active.current;
      if(ctx){
        const {data}=await supabase.from('transfer_signals').select('*')
          .eq('transfer_id',ctx.offer.id).eq('to_user',self).order('id',{ascending:true}).limit(400);
        for(const entry of data||[])onSignal(entry).catch(failed);
      }
    },4500);
    return ()=>{
      mounted.current=false;clearInterval(timer);supabase.removeChannel(subscription);
      const ctx=active.current;active.current=null;
      if(ctx){ctx.pc.close();if(ctx.writer)ctx.writer.abort().catch(()=>{});
        finish(ctx.offer.id,ctx.role==='receiver'?'failed':'cancelled').catch(()=>{});}
    };
  },[conversationId,self,reload,onSignal,failed,finish]);

  return <div className="mirlume-transfer">
    <input type="file" ref={pick} className="visually-hidden" aria-label="Attach direct message file"
      onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)sendFile(f);}}/>
    <button type="button" className="file-share-button"
      title={'Attach file to '+peerName} aria-label={'Attach file to '+peerName}
      disabled={busy} onClick={()=>pick.current?.click()}>
      <Paperclip size={20}/>
    </button>
    {transfers.length>0&&<div className="dm-file-history" aria-label="DM shared files">
      {transfers.map(item=><div className="dm-file-tile" key={item.id}>
        <div className="dm-file-symbol"><FileUp size={18}/></div>
        <div className="dm-file-description">
          <strong title={item.filename}>{item.filename}</strong>
          <small>{niceSize(item.size_bytes)} · {item.sender_id===self?'You shared':'Shared with you'}</small>
        </div>
        {item.sender_id!==self&&item.transfer_status==='waiting'
          ?<button type="button" onClick={()=>downloadFile(item)} disabled={busy}
              className="dm-file-download" aria-label={'Download '+item.filename}><Download size={16}/> Download</button>
          :<span className="dm-file-status">{item.transfer_status==='completed'?<Check size={14}/>:null}{item.transfer_status}</span>}
      </div>)}
    </div>}
    {(busy||status||error)&&<div className="dm-transfer-state" role="status">
      <span>{busy?<LoaderCircle size={15} className="spinning"/>:null}{error||status}</span>
      {busy?<><strong>{progress}%</strong><button type="button" onClick={cancel} aria-label="Cancel transfer"><X size={15}/></button></>
        :<button type="button" onClick={()=>{setStatus('');setError('');}} aria-label="Dismiss"><X size={15}/></button>}
      {busy?<div className="dm-transfer-meter"><div style={{width:progress+'%'}}/></div>:null}
    </div>}
  </div>;
}
