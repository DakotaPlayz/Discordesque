import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import path from 'node:path';

// Optional, separately hosted Mirlume large-file service. Requires real disk.
const root=path.resolve(process.env.MIRLUME_STORAGE_DIR||'./mirlume-storage');
const metaDir=path.join(root,'meta'), dataDir=path.join(root,'data');
const quota=Number(process.env.MIRLUME_QUOTA_BYTES||500_000_000_000);
const retentionDays=Number(process.env.MIRLUME_RETENTION_DAYS||1);
const maxFile=20*1024**3, maxChunk=8*1024**2;
const ttl=retentionDays*86400*1000;
const origins=(process.env.MIRLUME_ALLOWED_ORIGINS||'https://dakotaplayz.github.io,http://localhost:5173,capacitor://localhost,http://localhost,null').split(',').map(x=>x.trim());
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_ANON_KEY;
if(!/^https:\/\//.test(url||'')||!key)throw Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
if(!Number.isSafeInteger(quota)||quota<maxFile)throw Error('Quota must allow a 20 GiB file');
if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>30)throw Error('Retention must be 1–30 days');
const authClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const locks=new Set();
const sessionCache=new Map(),membershipCache=new Map();
let reservationBusy=false;
await fs.mkdir(metaDir,{recursive:true});await fs.mkdir(dataDir,{recursive:true});
const valid=id=>/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id||'');
const metaPath=id=>path.join(metaDir,id+'.json');
const partPath=id=>path.join(dataDir,id+'.part');
const finalPath=id=>path.join(dataDir,id+'.bin');
const problem=(message,status=400)=>Object.assign(Error(message),{status});
function reply(res,status,value){if(res.headersSent)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function getMeta(id){if(!valid(id))return null;try{return JSON.parse(await fs.readFile(metaPath(id),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(info){const tmp=metaPath(info.id)+'.'+randomUUID();await fs.writeFile(tmp,JSON.stringify(info));await fs.rename(tmp,metaPath(info.id));}
async function listAll(){const files=[];for(const name of await fs.readdir(metaDir)){if(!/^[0-9a-f-]+\.json$/i.test(name))continue;try{files.push(JSON.parse(await fs.readFile(path.join(metaDir,name),'utf8')));}catch{console.warn('Unusable file metadata:',name);}}return files;}
async function remove(info){await Promise.allSettled([fs.unlink(metaPath(info.id)),fs.unlink(partPath(info.id)),fs.unlink(finalPath(info.id))]);}
async function purge(){let count=0;for(const f of await listAll()){if(locks.has(f.id))continue;if(f.expires_at<Date.now()||(f.state==='uploading'&&f.created_at+12*3600000<Date.now())){await remove(f);count++;}}if(count)console.log('Purged expired/abandoned files:',count);}
await purge();setInterval(()=>purge().catch(console.error),900000).unref();
async function user(req){const m=/^Bearer\s+(.+)$/i.exec(req.headers.authorization||'');if(!m)throw problem('Sign in required',401);const digest=createHash('sha256').update(m[1]).digest('hex');const hit=sessionCache.get(digest);if(hit?.until>Date.now())return {id:hit.id,token:m[1]};const {data,error}=await authClient.auth.getUser(m[1]);if(error||!data?.user?.id)throw problem('Session expired',401);sessionCache.set(digest,{id:data.user.id,until:Date.now()+15000});if(sessionCache.size>500)sessionCache.clear();return {id:data.user.id,token:m[1]};}
async function membership(conv,token){if(!valid(conv))throw problem('Unknown conversation',404);const cacheKey=createHash('sha256').update(token+':'+conv).digest('hex');if(membershipCache.get(cacheKey)>Date.now())return;const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}});const {data,error}=await client.from('direct_conversations').select('id').eq('id',conv).maybeSingle();if(error||!data)throw problem('Not permitted in this conversation',403);membershipCache.set(cacheKey,Date.now()+15000);if(membershipCache.size>1000)membershipCache.clear();}
async function jsonBody(req){let body='';for await(const bytes of req){body+=bytes.toString('utf8');if(body.length>8192)throw problem('Body too large',413);}try{return JSON.parse(body);}catch{throw problem('Invalid JSON');}}
async function authorized(id,principal){const f=await getMeta(id);if(!f)throw problem('File not found',404);if(f.expires_at<Date.now())throw problem('File expired',410);await membership(f.conversation_id,principal.token);return f;}
async function initialize(req,res,principal){
  const body=await jsonBody(req),filename=String(body.filename||'').slice(0,255),size=Number(body.size_bytes);
  if(!filename||!Number.isSafeInteger(size)||size<1||size>maxFile)throw problem('File must be between 1 byte and 20 GiB');
  await membership(body.conversation_id,principal.token);
  if(reservationBusy)throw problem('Another storage reservation is being processed; retry',503);
  reservationBusy=true;
  try{
  const reserved=(await listAll()).filter(f=>f.expires_at>Date.now()).reduce((sum,f)=>sum+f.size_bytes,0);
  if(reserved+size>quota)throw problem('Storage quota full; old files are purged automatically',507);
  const stats=await fs.statfs(dataDir);
  if(stats.bavail*stats.bsize<size+1024**3)throw problem('Storage disk is out of space',507);
  const id=randomUUID(),now=Date.now();
  const info={id,conversation_id:body.conversation_id,uploader_id:principal.id,filename,size_bytes:size,created_at:now,expires_at:now+ttl,uploaded_bytes:0,state:'uploading'};
  const h=await fs.open(partPath(id),'wx');await h.close();await save(info);
  reply(res,201,{file:info});
  }finally{reservationBusy=false;}

}
async function upload(req,res,id,principal,query){
  const info=await authorized(id,principal);
  if(info.uploader_id!==principal.id)throw problem('Only sender may upload',403);
  if(info.state!=='uploading')throw problem('Already uploaded',409);
  const offset=Number(query.searchParams.get('offset')),length=Number(req.headers['content-length']);
  if(!Number.isSafeInteger(offset)||offset!==info.uploaded_bytes)throw problem('Retry from offset '+info.uploaded_bytes,409);
  if(!Number.isSafeInteger(length)||length<1||length>maxChunk||offset+length>info.size_bytes)throw problem('Bad chunk length',413);
  if(locks.has(id))throw problem('Concurrent upload',409);
  locks.add(id);let handle;
  try{
    handle=await fs.open(partPath(id),'r+');let written=0;
    for await(const bytes of req){
      if(written+bytes.length>length)throw problem('Chunk longer than announced',413);
      let part=0;
      while(part<bytes.length){const {bytesWritten}=await handle.write(bytes,part,bytes.length-part,offset+written+part);if(!bytesWritten)throw Error('Disk write failed');part+=bytesWritten;}
      written+=bytes.length;
    }
    if(written!==length)throw problem('Incomplete chunk',400);
    info.uploaded_bytes=offset+written;
    if(info.uploaded_bytes===info.size_bytes){
      await handle.sync();await handle.close();handle=null;
      await fs.rename(partPath(id),finalPath(id));info.state='ready';
    }
    await save(info);
    reply(res,200,{uploaded_bytes:info.uploaded_bytes,state:info.state});
  }finally{if(handle)await handle.close().catch(()=>{});locks.delete(id);}
}
async function uploadStatus(res,id,principal){
  const info=await authorized(id,principal);
  if(info.uploader_id!==principal.id)throw problem('Only sender may inspect upload state',403);
  reply(res,200,{id:info.id,uploaded_bytes:info.uploaded_bytes,state:info.state});
}
async function entries(res,conversation,principal){
  await membership(conversation,principal.token);
  const files=(await listAll()).filter(f=>f.conversation_id===conversation&&f.expires_at>Date.now()).sort((a,b)=>b.created_at-a.created_at).slice(0,60);
  reply(res,200,{files});
}
async function download(req,res,id,principal){
  const info=await authorized(id,principal);
  if(info.state!=='ready')throw problem('File is still uploading',409);
  const stat=await fs.stat(finalPath(id));
  if(stat.size!==info.size_bytes)throw problem('File incomplete on disk',500);
  const name=info.filename.replace(/[^A-Z0-9._ -]/gi,'_').slice(0,150)||'download.bin';
  let start=0,end=stat.size-1,status=200;
  if(req.headers.range){
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!match)throw problem('Invalid range',416);
    start=Number(match[1]);end=match[2]?Number(match[2]):end;status=206;
    if(start>end||end>=stat.size)throw problem('Invalid range',416);
  }
  const headers={'Content-Type':'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name),'Cache-Control':'private, no-store'};
  if(status===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+stat.size;
  res.writeHead(status,headers);
  createReadStream(finalPath(id),{start,end}).on('error',()=>res.destroy()).pipe(res);
}
async function erase(res,id,principal){
  const info=await authorized(id,principal);
  if(info.uploader_id!==principal.id)throw problem('Only sender can delete',403);
  if(locks.has(id))throw problem('Upload in progress',409);
  await remove(info);reply(res,200,{deleted:true});
}
const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(origin&&!origins.includes(origin)){reply(res,403,{error:'Origin not allowed'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Headers','authorization,content-type,range');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers','Content-Length,Content-Range');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.method==='GET'&&req.url==='/health'){reply(res,200,{status:'ok',quota_bytes:quota});return;}
  try{
    const principal=await user(req),query=new URL(req.url,'http://localhost');
    if(req.method==='POST'&&query.pathname==='/v1/files')return await initialize(req,res,principal);
    const listing=/^\/v1\/conversations\/([0-9a-f-]+)\/files$/i.exec(query.pathname);
    if(req.method==='GET'&&listing)return await entries(res,listing[1],principal);
    const file=/^\/v1\/files\/([0-9a-f-]+)(\/data|\/status)?$/i.exec(query.pathname);
    if(file&&req.method==='PUT'&&file[2]==='/data')return await upload(req,res,file[1],principal,query);
    if(file&&req.method==='GET'&&file[2]==='/status')return await uploadStatus(res,file[1],principal);
    if(file&&req.method==='GET'&&!file[2])return await download(req,res,file[1],principal);
    if(file&&req.method==='DELETE'&&!file[2])return await erase(res,file[1],principal);
    reply(res,404,{error:'Not found'});
  }catch(error){console.error(req.method,req.url,error.message);if(!res.headersSent)reply(res,error.status||500,{error:error.message});else res.destroy();}
});
server.requestTimeout=0;
server.listen(Number(process.env.PORT||8799),process.env.HOST||'127.0.0.1',()=>console.log('Mirlume hosted files: quota '+quota+' bytes; purge after '+retentionDays+' days'));
