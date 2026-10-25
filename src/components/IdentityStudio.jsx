import {useEffect,useState} from 'react';
import {Camera, ImagePlus, Save, ShieldCheck, UserRound, Server, Palette, Check, AlertTriangle} from 'lucide-react';
import {supabase} from '../lib/supabase.js';

const links=new Map();
export const safeColor=(value)=>/^#[0-9a-fA-F]{6}$/.test(value||'')?value:'#75DCC2';

export function MediaImage({bucket='mirlume-profile-media',path,alt='',className='',fallback=null}) {
  const [src,setSrc]=useState('');
  useEffect(()=>{
    if(!path){setSrc('');return;}
    const key=bucket+'/'+path;let live=true;
    const hit=links.get(key);
    if(hit&&hit.until>Date.now()){setSrc(hit.url);return;}
    setSrc('');
    supabase.storage.from(bucket).createSignedUrl(path,600).then(({data})=>{
      if(live&&data?.signedUrl){
        links.set(key,{url:data.signedUrl,until:Date.now()+8*60*1000});
        setSrc(data.signedUrl);
      }
    });
    return()=>{live=false;};
  },[bucket,path]);
  if(!path||!src)return fallback;
  return <img className={className} src={src} alt={alt} loading="lazy"
      referrerPolicy="no-referrer" onError={()=>setSrc('')}/>;
}

export function PersonAvatar({name='Member',path,own=false,className='',color}) {
  return <span className={'person-avatar '+className+(own?' is-own':'')}
    style={{'--person-tint':safeColor(color)}} title={name}>
      <MediaImage path={path} alt={name+' avatar'} className="person-avatar-img"
        fallback={<span>{String(name||'?').trim().slice(0,2).toUpperCase()}</span>}/>
    </span>;
}

const IMAGE_MIME=['image/png','image/jpeg','image/webp','image/gif'];
async function uploadPicture(file,bucket,prefix,maxBytes){
  if(!file)return null;
  if(!IMAGE_MIME.includes(file.type))throw Error('Use PNG, JPEG, WebP or GIF.');
  if(file.size>maxBytes)throw Error('Image is too large. Maximum is '+Math.floor(maxBytes/1e6)+' MB.');
  const path=prefix+'/'+crypto.randomUUID();
  const {error}=await supabase.storage.from(bucket).upload(path,file,{
    contentType:file.type,upsert:false,cacheControl:'3600'
  });
  if(error)throw error;
  return path;
}

function ImageChooser({title,description,value,onChange,kind}) {
  return <label className={'identity-upload '+kind}>
    <span className="identity-upload-icon">{kind==='avatar'?<Camera size={18}/>:<ImagePlus size={18}/>}</span>
    <span className="identity-upload-content"><strong>{title}</strong><small>{value?.name||description}</small></span>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>onChange(e.target.files?.[0]||null)}/>
  </label>;
}

export function IdentityStudio({session,profile,server,isOwner,onSaved,onClose}) {
  const uid=session.user.id;
  const [tab,setTab]=useState('account');
  const [member,setMember]=useState(null);
  const [draft,setDraft]=useState({
    display_name:profile?.display_name||'',
    bio:profile?.bio||'',
    status_text:profile?.status_text||'',
    pronouns:profile?.pronouns||'',
    accent_color:profile?.accent_color||'#75DCC2',
    avatar_path:profile?.avatar_path||null,
    banner_path:profile?.banner_path||null
  });
  const [serverDraft,setServerDraft]=useState({description:server?.description||'',icon_path:server?.icon_path||null,banner_path:server?.banner_path||null});
  const [nick,setNick]=useState('');
  const [serverBio,setServerBio]=useState('');
  const [serverAvatar,setServerAvatar]=useState(null);
  const [images,setImages]=useState({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{
    if(!server?.id)return;
    let live=true;
    supabase.from('server_members').select('nickname,server_avatar_path,server_bio')
      .eq('server_id',server.id).eq('user_id',uid).maybeSingle().then(({data})=>{
        if(live&&data){setMember(data);setNick(data.nickname||'');setServerBio(data.server_bio||'');
          setServerAvatar(data.server_avatar_path||null);}
      });
    return()=>{live=false;};
  },[server?.id,uid]);
  const setD=(key,value)=>setDraft(d=>({...d,[key]:value}));
  const setS=(key,value)=>setServerDraft(d=>({...d,[key]:value}));
  async function save(event){
    event.preventDefault();setError('');setSaved(false);setBusy(true);
    try{
      if(tab==='account'){
        const updated={...draft};
        for(const kind of ['avatar','banner']){
          if(images[kind]) updated[kind+'_path']=await uploadPicture(images[kind],'mirlume-profile-media',
            uid+'/'+kind,kind==='avatar'?5e6:10e6);
        }
        if(updated.display_name.trim().length<2||updated.display_name.trim().length>32)throw Error('Display name: 2–32 characters.');
        const {data,error:e}=await supabase.from('profiles').update({
          display_name:updated.display_name.trim(),bio:updated.bio,status_text:updated.status_text,
          pronouns:updated.pronouns,accent_color:updated.accent_color,
          avatar_path:updated.avatar_path,banner_path:updated.banner_path
        }).eq('id',uid).select().single();
        if(e)throw e;setDraft(data);await onSaved?.(data);
      }else if(tab==='serverProfile'&&server){
        let avatar=serverAvatar;
        if(images.member)avatar=await uploadPicture(images.member,'mirlume-profile-media',
          'members/'+server.id+'/'+uid,5e6);
        const {error:e}=await supabase.rpc('mirlume_set_member_identity',{
          p_server:server.id,p_nickname:nick.trim()||null,p_bio:serverBio,p_avatar:avatar
        });
        if(e)throw e;setServerAvatar(avatar);await onSaved?.();
      }else if(tab==='serverBrand'&&server&&isOwner){
        const brand={...serverDraft};
        for(const kind of ['icon','banner']){
          const key='server_'+kind;
          if(images[key])brand[kind+'_path']=await uploadPicture(images[key],'mirlume-server-media',
            server.id+'/'+kind,kind==='icon'?5e6:10e6);
        }
        const {error:e}=await supabase.rpc('mirlume_set_server_branding',{
          p_server:server.id,p_description:brand.description,
          p_icon_path:brand.icon_path,p_banner_path:brand.banner_path
        });
        if(e)throw e;setServerDraft(brand);await onSaved?.();
      }
      setImages({});setSaved(true);
    }catch(e){setError(e.message||String(e));}finally{setBusy(false);}
  }
  return <div className="identity-studio">
    <div className="identity-tabs" role="tablist" aria-label="Identity settings">
      <button type="button" onClick={()=>{setTab('account');setSaved(false);}} className={tab==='account'?'active':''}><UserRound size={16}/> Your profile</button>
      {server&&<button type="button" onClick={()=>{setTab('serverProfile');setSaved(false);}} className={tab==='serverProfile'?'active':''}><Palette size={16}/> Server profile</button>}
      {server&&isOwner&&<button type="button" onClick={()=>{setTab('serverBrand');setSaved(false);}} className={tab==='serverBrand'?'active':''}><Server size={16}/> Server appearance</button>}
    </div>
    <form onSubmit={save} className="identity-form">
      {tab==='account'&&<>
        <div className="identity-showcase" style={{'--identity-color':safeColor(draft.accent_color)}}>
          <div className="identity-banner">
            <MediaImage path={draft.banner_path} className="identity-banner-img" alt="Your banner" />
          </div>
          <div className="identity-showcase-details">
            <PersonAvatar name={draft.display_name} path={draft.avatar_path} color={draft.accent_color} className="identity-large-avatar"/>
            <div><strong>{draft.display_name||'Your name'}</strong><small>{draft.status_text||'Make your space yours.'}</small></div>
          </div>
        </div>
        <div className="identity-form-grid">
          <ImageChooser title="Profile photo" description="Up to 5 MB" kind="avatar" value={images.avatar} onChange={f=>setImages(d=>({...d,avatar:f}))}/>
          <ImageChooser title="Profile banner" description="Up to 10 MB" kind="banner" value={images.banner} onChange={f=>setImages(d=>({...d,banner:f}))}/>
        </div>
        <label>DISPLAY NAME<input value={draft.display_name} maxLength={32} required onChange={e=>setD('display_name',e.target.value)}/></label>
        <label>ABOUT ME<textarea value={draft.bio} maxLength={500} rows={3} placeholder="Tell your friends about yourself..." onChange={e=>setD('bio',e.target.value)}/></label>
        <div className="identity-form-grid">
          <label>STATUS<input value={draft.status_text} maxLength={100} placeholder="What's happening?" onChange={e=>setD('status_text',e.target.value)}/></label>
          <label>PRONOUNS<input value={draft.pronouns} maxLength={40} onChange={e=>setD('pronouns',e.target.value)}/></label>
        </div>
        <label>YOUR ACCENT COLOR<input type="color" value={safeColor(draft.accent_color)} onChange={e=>setD('accent_color',e.target.value)}/></label>
      </>}
      {tab==='serverProfile'&&server&&<>
        <div className="identity-server-preview"><PersonAvatar name={nick||draft.display_name} path={serverAvatar||draft.avatar_path} className="identity-large-avatar"/><div><strong>{nick||draft.display_name}</strong><small>Only in {server.name}</small></div></div>
        <ImageChooser kind="avatar" title="Server avatar" description="Different from your regular profile · 5 MB" value={images.member} onChange={f=>setImages(d=>({...d,member:f}))}/>
        <label>SERVER NICKNAME<input value={nick} maxLength={32} onChange={e=>setNick(e.target.value)} placeholder={draft.display_name}/></label>
        <label>SERVER BIO<textarea value={serverBio} rows={3} maxLength={300} onChange={e=>setServerBio(e.target.value)} placeholder="A short introduction for this server"/></label>
      </>}
      {tab==='serverBrand'&&server&&isOwner&&<>
        <div className="identity-server-preview"><PersonAvatar name={server.name} path={serverDraft.icon_path} className="identity-large-avatar" /></div>
        <div className="identity-form-grid">
          <ImageChooser kind="avatar" title="Server icon" description="Up to 5 MB" value={images.server_icon} onChange={f=>setImages(d=>({...d,server_icon:f}))}/>
          <ImageChooser kind="banner" title="Server banner" description="Up to 10 MB" value={images.server_banner} onChange={f=>setImages(d=>({...d,server_banner:f}))}/>
        </div>
        <label>SERVER DESCRIPTION<textarea rows={4} value={serverDraft.description} maxLength={500} onChange={e=>setS('description',e.target.value)}/></label>
      </>}
      <div className="identity-actions">
        <span>{saved?<><Check size={16}/> Saved!</>:error?<><AlertTriangle size={16}/>{error}</>:<><ShieldCheck size={15}/> Images are visible only to authorized contacts.</>}</span>
        <button className="primary-button" type="submit" disabled={busy}><Save size={17}/>{busy?'Saving...':'Save changes'}</button>
      </div>
    </form>
  </div>;
}

export function ProfilePeek({person,onClose,onMessage}) {
  if(!person)return null;
  return <div className="profile-peek-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section className="profile-peek" role="dialog" aria-label={'Profile of '+person.display_name}>
      <div className="profile-peek-banner" style={{'--identity-color':safeColor(person.accent_color)}}>
        <MediaImage path={person.banner_path} className="identity-banner-img" alt="Profile banner"/>
        <button type="button" onClick={onClose} className="profile-peek-close">×</button>
      </div>
      <div className="profile-peek-body">
        <PersonAvatar name={person.display_name} path={person.avatar_path} color={person.accent_color} className="identity-large-avatar"/>
        <strong>{person.display_name}</strong>
        {person.pronouns&&<small>{person.pronouns}</small>}
        {person.status_text&&<p className="profile-status">{person.status_text}</p>}
        <h4>ABOUT</h4><p>{person.bio||'Nothing here yet.'}</p>
        {onMessage&&<button type="button" onClick={onMessage} className="primary-button">Send a message</button>}
      </div>
    </section>
  </div>;
}
