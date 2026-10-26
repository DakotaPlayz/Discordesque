// Mirlume hosted DM attachments: persist independently of sender's connection.
// Enabled only after the owner deploys an HTTPS attachment server and sets
// VITE_ATTACHMENT_SERVER_URL. Up to 20 GiB/file, automatic 7-day expiry.
import {useCallback,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Paperclip,FileUp,Download,LoaderCircle,X,Check,Clock3} from 'lucide-react';
import {supabase} from '../lib/supabase.js';
import {getWriter} from './FileTransfers.jsx';

const base=(import.meta.env.VITE_ATTACHMENT_SERVER_URL||'').trim().replace(/\/$/,'');
const MAX=20*1024**3;
const CHUNK=8*1024**2;
const pretty=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GiB':n>=1024**2?(n/1024**2).toFixed(1)+' MiB':(n/1024).toFixed(1)+' KiB';

async function token(forceRefresh=false){
  const {data,error}=forceRefresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();
  if(error||!data?.session?.access_token)throw Error('Your login has expired. Sign out of Mirlume and sign back in.');
  return data.session.access_token;
}
async function request(url,options={}){
  let bearer=await token();
  const fetchFromWorker = async accessToken => {
    try {
      return await fetch(base+url,{...options,headers:{Authorization:'Bearer '+accessToken,...options.headers}});
    } catch (err) {
      if (err instanceof TypeError) {
        throw Error('Could not reach Mirlume file storage. On Android this may be blocked by the Cloudflare Worker origin settings (https://localhost), or the Worker may be offline. Ask the server owner to deploy the latest Cloudflare R2 Worker.');
      }
      throw err;
    }
  };
  let result=await fetchFromWorker(bearer);
  // A cached token may have expired. Refresh it once before showing an error.
  if(result.status===401){
    bearer=await token(true);
    result=await fetchFromWorker(bearer);
  }
  if(!result.ok){
    const json=await result.json().catch(()=>({}));
    if(result.status===401)throw Error('DM file authentication failed: '+(json.error||'Supabase rejected the session')+'. Check that the Cloudflare Worker uses the same Supabase project as Mirlume.');
    throw Error(json.error||'Attachment server responded '+result.status);
  }
  return result;
}
export default function HostedDmFiles({session,conversationId,peerName}) {
  const [files,setFiles]=useState([]);
  const [working,setWorking]=useState(false);
  const [progress,setProgress]=useState(0);
  const [status,setStatus]=useState('');
  const [error,setError]=useState('');
  const picker=useRef(null),mounted=useRef(true),abort=useRef(null);
  const busy=useRef(false);
  const refresh=useCallback(async()=>{
    if(!conversationId)return;
    try{
      const response=await request('/v1/conversations/'+conversationId+'/files');
      const data=await response.json();
      if(mounted.current)setFiles(data.files||[]);
    }catch(e){if(mounted.current)setError(e.message);}
  },[conversationId]);
  useEffect(()=>{
    mounted.current=true;refresh();
    const timer=setInterval(refresh,9000);
    const onFocus=()=>refresh();
    window.addEventListener('focus',onFocus);
    return()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',onFocus);abort.current?.abort();};
  },[refresh]);
  async function send(file){
    if(!file||busy.current)return;
    if(!file.size||file.size>MAX){setError('Files must be between 1 byte and 20 GiB.');return;}
    const controller=new AbortController();
    abort.current=controller;busy.current=true;setWorking(true);setProgress(0);setError('');
    setStatus('Uploading '+file.name+' for '+peerName+'…');
    try{
      const start=await request('/v1/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        conversation_id:conversationId,filename:file.name,size_bytes:file.size,
      }),signal:controller.signal});
      const {file:record}=await start.json();
      await refresh();
      let offset=0;
      while(offset<file.size){
        const end=Math.min(offset+CHUNK,file.size),bytes=await file.slice(offset,end).arrayBuffer();
        let response;
        try{
          response=await request('/v1/files/'+record.id+'/data?offset='+offset,{
            method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes,signal:controller.signal,
          });
        }catch(err){
          if(controller.signal.aborted)throw err;
          // Chunk may have reached server before a connection dropped: recover
          // the exact committed offset instead of duplicating its bytes.
          const statusResponse=await request('/v1/files/'+record.id+'/status',{signal:controller.signal});
          const state=await statusResponse.json();
          if(state.uploaded_bytes===offset)throw err;
          if(state.uploaded_bytes!==end)throw Error('Server returned an unexpected resume position.');
          response=statusResponse;
        }
        const data=await response.json();
        offset=data.uploaded_bytes;
        if(mounted.current){setProgress(Math.round(offset*100/file.size));setStatus('Uploading '+file.name+'…');}
      }
      if(mounted.current){setProgress(100);setStatus('Uploaded. '+peerName+' can download whenever they sign in.');}
      await refresh();
    }catch(e){if(mounted.current){setError(e.name==='AbortError'?'Upload stopped.':e.message);setStatus('');}}
    finally{busy.current=false;abort.current=null;if(mounted.current)setWorking(false);}
  }
  async function download(file){
    if(busy.current||file.state!=='ready')return;
    busy.current=true;setWorking(true);setProgress(0);setError('');
    const controller=new AbortController();abort.current=controller;
    let writer;
    try{
      // The click grants permission for a browser save picker. Native clients
      // write to their Downloads folder without loading the whole file into RAM.
      writer=await getWriter(file);
      setStatus('Downloading '+file.filename+'…');
      const response=await request('/v1/files/'+file.id,{signal:controller.signal});
      if(!response.body)throw Error('This device cannot stream downloads.');
      const reader=response.body.getReader();
      let received=0;
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        for(let offset=0;offset<value.byteLength;offset+=48*1024){
          const part=value.subarray(offset,offset+48*1024);
          const bytes=part.buffer.slice(part.byteOffset,part.byteOffset+part.byteLength);
          await writer.write(bytes);
          received+=part.byteLength;
        }
        if(mounted.current)setProgress(Math.round(received*100/file.size_bytes));
      }
      if(received!==file.size_bytes)throw Error('Download was incomplete.');
      await writer.close();writer=null;
      if(mounted.current){setStatus('Saved to Downloads.');setProgress(100);}
    }catch(e){
      await writer?.abort().catch(()=>{});
      if(mounted.current){setError(e.name==='AbortError'?'Download stopped.':e.message);setStatus('');}
    }finally{busy.current=false;abort.current=null;if(mounted.current)setWorking(false);}
  }
  const display=document.getElementById('dm-file-panel-'+conversationId);
  return <div className="mirlume-transfer">
    <input type="file" ref={picker} className="visually-hidden" aria-label="Attach file to DM"
      onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)send(file);}}/>
    <button type="button" className="file-share-button" onClick={()=>picker.current?.click()} disabled={working}
      title={'Upload an attachment for '+peerName} aria-label={'Attach file for '+peerName}><Paperclip size={20}/></button>
    {display&&createPortal(<div className="dm-file-history" aria-label="DM file attachments">
      {files.map(f=><article className="dm-file-tile" key={f.id}>
        <div className="dm-file-symbol"><FileUp size={18}/></div>
        <div className="dm-file-description"><strong title={f.filename}>{f.filename}</strong>
          <small>{pretty(f.size_bytes)} · {f.uploader_id===session.user.id?'You shared':'Shared by '+peerName}
            {' · '}Expires {new Date(f.expires_at).toLocaleDateString()}</small>
        </div>
        {f.state==='ready'?<button type="button" disabled={working} className="dm-file-download"
          onClick={()=>download(f)}><Download size={16}/> Download</button>
          :<span className="dm-file-status"><Clock3 size={14}/> Uploading</span>}
      </article>)}
    </div>,display)}
    {(working||error||status)&&<div className="dm-transfer-state" role="status">
      <span>{working&&<LoaderCircle size={15} className="spinning"/>}{error||status}</span>
      {working?<><strong>{progress}%</strong><button type="button" aria-label="Stop transfer"
        onClick={()=>abort.current?.abort()}><X size={15}/></button></>:
      <button type="button" aria-label="Dismiss" onClick={()=>{setStatus('');setError('');}}><X size={15}/></button>}
      {working&&<div className="dm-transfer-meter"><div style={{width:progress+'%'}}/></div>}
    </div>}
  </div>;
}
