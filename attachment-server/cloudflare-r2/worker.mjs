// Mirlume optional Cloudflare R2 attachment server.
// Deploy with Wrangler; requires R2 account/billing for >10 GB storage.
// Matches the existing Mirlume HostedDmFiles REST API without any always-on PC.
// 20 GiB per file, ~500 GB global soft reservation quota, 24-hour retention.
// NOTE: concurrent upload init requests can race the soft global quota.
// Enforce account limits with Durable Objects before selling storage commercially.
const CHUNK = 8 * 1024 * 1024;
const MAX_FILE = 20 * 1024 ** 3;
const MAX_POOL = 500_000_000_000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const ID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const metaKey = id => 'meta/' + id + '.json';
const fileKey = id => 'files/' + id;
const error = (message, status = 400) => Object.assign(new Error(message), {status});
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {status,headers:{
    'Content-Type':'application/json','Cache-Control':'no-store',...headers
  }});
async function authenticate(request, env) {
  const auth = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization')||'');
  if (!auth) throw error('Sign in required',401);
  const projectUrl=String(env.SUPABASE_URL||'').trim().replace(/\\/$/,'');
  const apiKey=String(env.SUPABASE_ANON_KEY||env.SUPABASE_PUBLISHABLE_KEY||'').trim();
  if(!/^https:\/\/[^/]+\\.supabase\\.co$/.test(projectUrl)||!apiKey)
    throw error('Cloudflare Worker Supabase configuration is missing or invalid',503);
  let res;
  try {
    res=await fetch(projectUrl+'/auth/v1/user',{headers:{
      apikey:apiKey,Authorization:'Bearer '+auth[1]
    }});
  }catch{
    throw error('Cloudflare could not reach the configured Supabase project',502);
  }
  if(!res.ok){
    if(res.status===401)throw error('Supabase rejected the session. Check that the Worker and app use the same Supabase project.',401);
    if(res.status===403)throw error('Supabase rejected the Worker API key. Check SUPABASE_ANON_KEY in Cloudflare.',503);
    throw error('Supabase authentication check failed (HTTP '+res.status+'). Verify Cloudflare Supabase settings.',502);
  }
  const user = await res.json();
  if(!user?.id)throw error('No active account',401);
  return {id:user.id,token:auth[1]};
}
async function verifyConversation(env,conv,user) {
  if(!ID.test(conv||''))throw error('Invalid DM',400);
  // Supabase RLS is authoritative: only conversation members can read this row.
  const params=new URLSearchParams({select:'id',id:'eq.'+conv,limit:'1'});
  const res=await fetch(env.SUPABASE_URL+'/rest/v1/direct_conversations?'+params.toString(),{
    headers:{apikey:env.SUPABASE_ANON_KEY,Authorization:'Bearer '+user.token}});
  if(!res.ok)throw error('DM permissions unavailable',403);
  const rows=await res.json();
  if(!Array.isArray(rows)||rows.length!==1)throw error('Not a member of this DM',403);
}
async function readBody(request) {
  const text=await request.text();
  if(text.length>8192)throw error('Request too large',413);
  try{return JSON.parse(text);}catch{throw error('Malformed JSON');}
}
async function getRecord(env,id) {
  if(!ID.test(id||''))return null;
  const entry=await env.FILES.get(metaKey(id));
  return entry?entry.json():null;
}
async function saveRecord(env,record) {
  await env.FILES.put(metaKey(record.id),JSON.stringify(record),{
    httpMetadata:{contentType:'application/json'}
  });
}
async function allRecords(env) {
  // Free Workers allow <= 50 subrequests per request. Keep a hard cap
  // of 40 simultaneously retained files for this small private group.
  // This still accommodates 25 x 20GB files (~500GB) but not unlimited
  // tiny attachments. A production service should use Durable Objects.
  const page=await env.FILES.list({prefix:'meta/',limit:41});
  if(page.truncated || page.objects.length>40)
    throw error('Private beta file-count quota full (max 40 retained uploads)',507);
  const records=[];
  for(const item of page.objects){
    const object=await env.FILES.get(item.key);
    if(object){try{records.push(await object.json());}catch{}}
  }
  return records;
}
async function ensureRecord(env,id,user) {
  const record=await getRecord(env,id);
  if(!record)throw error('File missing',404);
  if(record.expires_at<=Date.now())throw error('File expired',410);
  await verifyConversation(env,record.conversation_id,user);
  return record;
}
async function initiate(request,env,user) {
  const body=await readBody(request);
  const name=String(body.filename||'').slice(0,255);
  const size=Number(body.size_bytes);
  const conv=body.conversation_id;
  if(!name||!Number.isSafeInteger(size)||size<1||size>MAX_FILE)
    throw error('Files must be 1 byte to 20 GiB');
  await verifyConversation(env,conv,user);
  const all=await allRecords(env);
  if(all.length>=40)throw error('Private beta attachment count full (40 files)',507);
  const reserved=all.filter(x=>x.expires_at>Date.now()).reduce((n,x)=>n+x.size_bytes,0);
  if(reserved+size>MAX_POOL)throw error('500 GB pool full',507);
  const id=crypto.randomUUID(),now=Date.now();
  const mpu=await env.FILES.createMultipartUpload(fileKey(id),{
    httpMetadata:{contentType:'application/octet-stream'}
  });
  const record={id,conversation_id:conv,uploader_id:user.id,filename:name,size_bytes:size,
    created_at:now,expires_at:now+ONE_DAY,uploaded_bytes:0,state:'uploading',
    multipart_id:mpu.uploadId,parts:[]};
  await saveRecord(env,record);
  return json({file:record},201);
}
async function status(env,id,user) {
  const rec=await ensureRecord(env,id,user);
  if(rec.uploader_id!==user.id)throw error('Sender only',403);
  return json({uploaded_bytes:rec.uploaded_bytes,state:rec.state,id});
}
async function upload(request,env,id,user,url) {
  const rec=await ensureRecord(env,id,user);
  if(user.id!==rec.uploader_id)throw error('Sender only',403);
  if(rec.state!=='uploading')throw error('Upload already finished',409);
  const offset=Number(url.searchParams.get('offset'));
  const length=Number(request.headers.get('content-length'));
  if(!Number.isSafeInteger(offset)||offset!==rec.uploaded_bytes)
    throw error('Resume at '+rec.uploaded_bytes,409);
  if(!Number.isSafeInteger(length)||length<1||length>CHUNK||
     offset+length>rec.size_bytes)throw error('Invalid part size',413);
  if(offset%CHUNK!==0)throw error('Invalid chunk alignment',400);
  if(offset+length<rec.size_bytes&&length!==CHUNK)
    throw error('Non-final parts must be 8 MiB',400);
  const stream=request.body;
  if(!stream)throw error('Missing upload bytes');
  const mpu=env.FILES.resumeMultipartUpload(fileKey(id),rec.multipart_id);
  const part=await mpu.uploadPart(Math.floor(offset/CHUNK)+1,stream);
  rec.parts.push({partNumber:part.partNumber,etag:part.etag});
  rec.uploaded_bytes=offset+length;
  if(rec.uploaded_bytes===rec.size_bytes){
    await mpu.complete(rec.parts);
    rec.state='ready';
  }
  await saveRecord(env,rec);
  return json({uploaded_bytes:rec.uploaded_bytes,state:rec.state});
}
async function listDm(env,conv,user) {
  await verifyConversation(env,conv,user);
  const data=(await allRecords(env)).filter(x=>x.conversation_id===conv&&x.expires_at>Date.now())
    .sort((a,b)=>b.created_at-a.created_at).slice(0,60)
    .map(({id,conversation_id,uploader_id,filename,size_bytes,created_at,expires_at,uploaded_bytes,state})=>
      ({id,conversation_id,uploader_id,filename,size_bytes,created_at,expires_at,uploaded_bytes,state}));
  return json({files:data});
}
async function download(request,env,id,user) {
  const rec=await ensureRecord(env,id,user);
  if(rec.state!=='ready')throw error('File is still uploading',409);
  let options={};
  if(request.headers.has('Range'))options.range=request.headers;
  const object=await env.FILES.get(fileKey(id),options);
  if(!object)throw error('File is unavailable',404);
  const responseHeaders=new Headers();
  responseHeaders.set('Content-Type','application/octet-stream');
  responseHeaders.set('Cache-Control','private, no-store');
  responseHeaders.set('Accept-Ranges','bytes');
  const name=rec.filename.replace(/[^\w .-]/g,'_').slice(0,160)||'download.bin';
  responseHeaders.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));
  let status=200;
  if(object.range && request.headers.has('Range')){
    const r=object.range;
    status=206;
    responseHeaders.set('Content-Range','bytes '+r.offset+'-'+(r.offset+r.length-1)+'/'+rec.size_bytes);
    responseHeaders.set('Content-Length',String(r.length));
  } else responseHeaders.set('Content-Length',String(object.size));
  return new Response(object.body,{status,headers:responseHeaders});
}
async function erase(env,id,user) {
  const rec=await ensureRecord(env,id,user);
  if(rec.uploader_id!==user.id)throw error('Sender only',403);
  if(rec.state==='uploading') {
    await env.FILES.resumeMultipartUpload(fileKey(id),rec.multipart_id).abort().catch(()=>{});
  }
  await env.FILES.delete([metaKey(id),fileKey(id)]);
  return json({deleted:true});
}
async function purge(env) {
  const all=await allRecords(env);
  const expired=all.filter(x=>x.expires_at<=Date.now() ||
    (x.state==='uploading'&&x.created_at+12*60*60*1000<=Date.now()));
  for(const rec of expired){
    if(rec.state==='uploading')
      await env.FILES.resumeMultipartUpload(fileKey(rec.id),rec.multipart_id).abort().catch(()=>{});
    await env.FILES.delete([metaKey(rec.id),fileKey(rec.id)]);
  }
}
export default {
 async fetch(request,env) {
  const origin=request.headers.get('Origin');
  const allowed=String(env.MIRLUME_ALLOWED_ORIGINS||'https://dakotaplayz.github.io,http://localhost:5173,capacitor://localhost,http://localhost,null')
    .split(',').map(x=>x.trim());
  if(origin&&!allowed.includes(origin))return json({error:'Origin forbidden'},403);
  const cors=origin?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{};
  const headers={...cors,
    'Access-Control-Allow-Headers':'authorization,content-type,range',
    'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers':'Content-Length,Content-Range'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const path=new URL(request.url);
  if(request.method==='GET'&&path.pathname==='/health')return json({status:'ok',provider:'cloudflare-r2',expiry_hours:24},200,headers);
  try {
    const user=await authenticate(request,env);
    const name=path.pathname;
    let out;
    if(name==='/v1/files'&&request.method==='POST')out=await initiate(request,env,user);
    const listing=/^\/v1\/conversations\/([0-9a-f-]+)\/files$/i.exec(name);
    if(!out&&listing&&request.method==='GET')out=await listDm(env,listing[1],user);
    const file=/^\/v1\/files\/([0-9a-f-]+)(\/data|\/status)?$/i.exec(name);
    if(!out&&file) {
      if(request.method==='GET'&&file[2]==='/status')out=await status(env,file[1],user);
      else if(request.method==='PUT'&&file[2]==='/data')out=await upload(request,env,file[1],user,path);
      else if(request.method==='GET'&&!file[2])out=await download(request,env,file[1],user);
      else if(request.method==='DELETE'&&!file[2])out=await erase(env,file[1],user);
    }
    out ||= json({error:'Not found'},404);
    for(const [k,v] of Object.entries(headers))out.headers.set(k,v);
    return out;
  }catch(e){return json({error:e.message||'Server error'},e.status||500,headers);}
 },
 async scheduled(controller,env,ctx){ctx.waitUntil(purge(env));}
};
