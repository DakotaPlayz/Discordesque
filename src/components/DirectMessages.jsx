import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CheckCheck, Edit3, LogOut, Menu, MessageCircle,
  Plus, Search, Send, Settings2, ShieldCheck, Users, X
} from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import FileTransfers from './FileTransfers.jsx';
import HostedDmFiles from './HostedDmFiles.jsx';
const HOSTED_FILES_ENABLED=Boolean(import.meta.env.VITE_ATTACHMENT_SERVER_URL?.trim());
import {PersonAvatar,ProfilePeek} from './IdentityStudio.jsx';
import ContextMenu from './ContextMenu.jsx';
import FriendsPanel from './FriendsPanel.jsx';
import {BellOff,Pin,Star,UserRound,StickyNote,UserRoundPen,EyeOff,AppWindow,KeyRound,
  UsersRound,UserX,ShieldBan,VolumeX,Archive,LockKeyhole} from 'lucide-react';

const formatTime = (date) => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const formatDay = (date) => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const short = (name) => String(name || '?').trim().slice(0, 2).toUpperCase();

function InitialAvatar({ name, own = false, size = 'normal', path }) {
  return <PersonAvatar name={name} own={own} path={path} className={'dm-avatar '+size}/>;
}

export default function DirectMessages({ session, servers, displayName, profile, openProfile, sidebarOpen, setSidebarOpen, targetPeer }) {
  const uid = session.user.id;
  const [threads, setThreads] = useState([]);
  const [preferences,setPreferences] = useState({});
  const [dmContext,setDmContext] = useState(null);
  const [editor,setEditor] = useState(null);
  const [editorValue,setEditorValue] = useState('');
  const [nameMap, setNameMap] = useState({});
  const [peerMap, setPeerMap] = useState({});
  const [peek,setPeek] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [friendsView,setFriendsView] = useState(false);
  const [friendIds,setFriendIds] = useState(new Set());
  const [peers, setPeers] = useState([]);
  const [search, setSearch] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const scrollEnd = useRef(null);
  const activeIdRef = useRef(null);

  const contact = useCallback(thread => thread.user_low === uid ? thread.user_high : thread.user_low, [uid]);
  const closeDmContext=useCallback(()=>setDmContext(null),[]);

  const refreshPrefs=useCallback(async()=>{
    const {data,error:e}=await supabase.from('mirlume_dm_preferences').select('*').eq('user_id',uid);
    if(e){console.warn('Install context-menus-v0.5.2.sql for DM settings:',e.message);return;}
    setPreferences(Object.fromEntries((data||[]).map(p=>[p.conversation_id,p])));
  },[uid]);
  useEffect(()=>{refreshPrefs();},[refreshPrefs]);

  async function savePref(conversationId,changes){
    const original=preferences[conversationId]||{};
    const updated={user_id:uid,conversation_id:conversationId,nickname:'',private_note:'',
      pinned:false,favorite:false,hidden:false,ignored:false,blocked:false,...original,...changes,
      updated_at:new Date().toISOString()};
    setPreferences(prev=>({...prev,[conversationId]:updated}));
    const {error:e}=await supabase.from('mirlume_dm_preferences').upsert(updated,{onConflict:'user_id,conversation_id'});
    if(e){setPreferences(prev=>({...prev,[conversationId]:original}));setError('DM settings not saved: '+e.message);}
  }

  function openEditor(thread,kind){
    setEditor({thread,kind});
    setEditorValue(preferences[thread.id]?.[kind]||'');
  }
  async function saveEditor(event){
    event.preventDefault();
    if(!editor)return;
    const limit=editor.kind==='nickname'?40:500;
    await savePref(editor.thread.id,{[editor.kind]:editorValue.trim().slice(0,limit)});
    setEditor(null);
  }
  async function invitePeer(server,thread){
    setError('');
    const {error:e}=await supabase.from('direct_messages').insert({
      conversation_id:thread.id,author_id:uid,
      body:'Join me in '+server.name+' on Mirlume! Invite code: '+server.invite_code
    });
    if(e)setError('Invitation not sent: '+e.message);
    else if(activeId===thread.id){
      const {data}=await supabase.from('direct_messages').select('*')
        .eq('conversation_id',thread.id).order('created_at',{ascending:false}).limit(100);
      if(data)setMessages(data.reverse());
    }
  }

  async function reloadFriendIds(){
    const {data}=await supabase.from('mirlume_friends').select('user_low,user_high,status')
      .or('user_low.eq.'+uid+',user_high.eq.'+uid).eq('status','accepted');
    if(data)setFriendIds(new Set(data.map(r=>r.user_low===uid?r.user_high:r.user_low)));
  }
  useEffect(()=>{reloadFriendIds();const timer=setInterval(reloadFriendIds,15000);return()=>clearInterval(timer);},[uid]);

  function menuForDm(thread){
    const pref=preferences[thread.id]||{};
    const person=contact(thread);
    const display=pref.nickname||nameMap[person]||'Member';
    const muted=Boolean(pref.muted_until&&new Date(pref.muted_until)>new Date());
    const mute=minutes=>savePref(thread.id,{muted_until:minutes?new Date(Date.now()+minutes*60000).toISOString():null});
    return [
      {label:'Mark as Read',icon:CheckCheck,onClick:()=>savePref(thread.id,{last_read_at:new Date().toISOString()})},
      {divider:true},
      {label:pref.pinned?'Unpin':'Pin',icon:Pin,checked:Boolean(pref.pinned),
        onClick:()=>savePref(thread.id,{pinned:!pref.pinned})},
      {label:pref.favorite?'Remove Favorite':'Add to Favorites',icon:Star,checked:Boolean(pref.favorite),
        onClick:()=>savePref(thread.id,{favorite:!pref.favorite})},
      {divider:true},
      {label:'Profile',icon:UserRound,onClick:()=>setPeek(peerMap[person]||null)},
      {label:'Add Note',icon:StickyNote,description:pref.private_note?'Edit your private note':'Visible only to you',
        onClick:()=>openEditor(thread,'private_note')},
      {label:'Add Friend Nickname',icon:UserRoundPen,onClick:()=>openEditor(thread,'nickname')},
      {label:'Close DM',icon:Archive,onClick:()=>{
        savePref(thread.id,{hidden:true});
        if(activeId===thread.id)setActiveId(null);
      }},
      {divider:true},
      {label:'Apps',icon:AppWindow,disabled:true,description:'App integrations are not supported yet'},
      {label:'View Verification Code',icon:KeyRound,disabled:true,
        description:'End-to-end encryption and safety codes are not implemented'},
      {label:'Invite to Server',icon:UsersRound,submenu:servers.filter(x=>x.invite_code).map(item=>({
        label:item.name,onClick:()=>invitePeer(item,thread)
      }))},
      {label:friendIds.has(person)?'Remove Friend':'Add Friend',icon:friendIds.has(person)?UserX:UsersRound,
        onClick:async()=>{if(friendIds.has(person)&&!window.confirm('Remove '+display+' as a friend?'))return;
          const {error:e}=await supabase.rpc('mirlume_friend_action',{p_peer:person,p_action:friendIds.has(person)?'remove':'request'});
          if(e)setError(e.message);else await reloadFriendIds();}},
      {label:pref.ignored?'Stop Ignoring':'Ignore',icon:EyeOff,checked:Boolean(pref.ignored),
        onClick:()=>savePref(thread.id,{ignored:!pref.ignored,hidden:!pref.ignored})},
      {label:pref.blocked?'Unblock':'Block',icon:ShieldBan,danger:!pref.blocked,
        checked:Boolean(pref.blocked),onClick:()=>{
          if(!pref.blocked&&!window.confirm('Block '+display+'? Neither of you will be able to send messages in this conversation until you unblock.'))return;
          savePref(thread.id,{blocked:!pref.blocked});
        }},
      {divider:true},
      {label:muted?'Unmute '+display:'Mute '+display,icon:VolumeX,submenu:[
        {label:'Unmute',onClick:()=>mute(null),disabled:!muted},
        {label:'For 1 Hour',onClick:()=>mute(60)},
        {label:'For 8 Hours',onClick:()=>mute(480)},
        {label:'For 24 Hours',onClick:()=>mute(1440)},
        {label:'Until I change it',onClick:()=>mute(60*24*365*10)}
      ]}
    ];
  }

  const visibleThreads=useMemo(()=>threads.filter(t=>!preferences[t.id]?.hidden).sort((a,b)=>{
    const x=preferences[a.id]||{},y=preferences[b.id]||{};
    return (Number(Boolean(y.pinned))-Number(Boolean(x.pinned)))||
      (Number(Boolean(y.favorite))-Number(Boolean(x.favorite)))||
      new Date(b.created_at)-new Date(a.created_at);
  }),[threads,preferences]);
  const active = useMemo(() => threads.find(t => t.id === activeId) || null, [threads, activeId]);
  const activePerson = active && contact(active);
  const peerName = activePerson ? (preferences[activeId]?.nickname || nameMap[activePerson] || 'Member') : '';

  const refreshThreads = useCallback(async (selected) => {
    const { data, error: dbError } = await supabase.from('direct_conversations')
      .select('id,user_low,user_high,created_at')
      .or('user_low.eq.' + uid + ',user_high.eq.' + uid)
      .order('created_at', { ascending: false });
    if (dbError) { setError(dbError.message); return; }
    const rows = data || [];
    setThreads(rows);
    const contacts = [...new Set(rows.map(row => row.user_low === uid ? row.user_high : row.user_low))];
    if (contacts.length) {
      const { data: users } = await supabase.from('profiles').select('*').in('id', contacts);
      setNameMap(old=>({...old,...Object.fromEntries((users||[]).map(p=>[p.id,p.display_name]))}));
      setPeerMap(old=>({...old,...Object.fromEntries((users||[]).map(p=>[p.id,p]))}));
    }
    if (selected) setActiveId(selected);
  }, [uid]);

  useEffect(() => {
    refreshThreads();
    const realtime = supabase.channel('dm-threads-' + uid)
      .on('postgres_changes', {
        schema: 'public', table: 'direct_conversations', event: 'INSERT',
      }, () => refreshThreads()).subscribe();
    // Also recover conversations missed while offline or if realtime delivery lags.
    const interval = setInterval(() => refreshThreads(), 30000);
    return () => { clearInterval(interval); supabase.removeChannel(realtime); };
  }, [uid, refreshThreads]);

  useEffect(() => {
    activeIdRef.current = activeId;
    if (!activeId) { setMessages([]); return; }
    let live = true;
    const refresh = async () => {
      const { data, error: dbError } = await supabase.from('direct_messages')
        .select('id,conversation_id,author_id,body,created_at')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: false }).limit(100);
      if (!live) return;
      if (dbError) { setError(dbError.message); return; }
      setMessages((data || []).reverse());
      setLoading(false);
    };
    setMessages([]);
    setText('');
    setError('');
    setLoading(true);
    refresh();
    const realtime = supabase.channel('dm-messages-' + activeId)
      .on('postgres_changes', {
        schema: 'public', table: 'direct_messages', event: 'INSERT',
        filter: 'conversation_id=eq.' + activeId,
      }, () => refresh()).subscribe();
    return () => { live = false; supabase.removeChannel(realtime); };
  }, [activeId]);

  useEffect(() => { scrollEnd.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const openPicker = async () => {
    setFriendsView(false);
    setPicker(true);
    setPickerLoading(true);
    setSearch('');
    setError('');
    try {
      if (!servers.length && !friendIds.size) { setPeers([]); return; }
      let memberships=[];
      if(servers.length){
        const {data,error:membershipError}=await supabase.from('server_members').select('user_id')
          .in('server_id',servers.map(s=>s.id));
        if(membershipError)throw membershipError;
        memberships=data||[];
      }
      const ids=[...new Set([...memberships.map(m=>m.user_id),...friendIds].filter(id=>id!==uid))];
      if (!ids.length) { setPeers([]); return; }
      const { data: users, error: profilesError } = await supabase
        .from('profiles').select('id,display_name').in('id', ids).order('display_name');
      if (profilesError) throw profilesError;
      setPeers(users || []);
    } catch (err) { setError(err.message || 'Unable to load people'); }
    finally { setPickerLoading(false); }
  };

  const begin = async (otherId) => {
    if (!otherId || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: dbError } = await supabase.rpc('start_direct_message', { p_peer: otherId });
      if (dbError) throw dbError;
      await savePref(data,{hidden:false,ignored:false});
      await refreshThreads(data);
      setPicker(false);
      setFriendsView(false);
      setSidebarOpen(false);
    } catch (err) { setError(err.message || 'Unable to create conversation. Check that the DM migration is installed.'); }
    finally { setBusy(false); }
  };

  useEffect(()=>{
    if(!targetPeer?.id)return;
    let cancelled=false;
    async function openRequestedDm(){
      const {data,error:e}=await supabase.rpc('start_direct_message',{p_peer:targetPeer.id});
      if(cancelled)return;
      if(e){setError('Could not start DM: '+e.message);return;}
      setFriendsView(false);
      await refreshThreads(data);
    }
    openRequestedDm();
    return()=>{cancelled=true;};
  },[targetPeer?.request, targetPeer?.id, refreshThreads]);

  const send = async (event) => {
    event?.preventDefault();
    const body = text.trim();
    if (!body || !activeId || busy) return;
    setBusy(true); setError('');
    try {
      const { error: dbError } = await supabase.from('direct_messages')
        .insert({ conversation_id: activeId, author_id: uid, body });
      if (dbError) throw dbError;
      setText('');
      const { data } = await supabase.from('direct_messages')
        .select('id,conversation_id,author_id,body,created_at')
        .eq('conversation_id', activeId).order('created_at', { ascending: false }).limit(100);
      if (data && activeIdRef.current === activeId) setMessages(data.reverse());
    } catch (err) { setError(err.message || 'Message was not sent'); }
    finally { setBusy(false); }
  };

  const filtered = peers.filter(p => p.display_name.toLowerCase().includes(search.toLowerCase()));

  return <>
    <aside className="channel-sidebar dm-sidebar">
      <header className="server-header dm-sidebar-head">
        <div><span className="workspace-eyebrow">PRIVATE MESSAGES</span><strong>Messages</strong></div>
        <button type="button" className="icon-button" onClick={openPicker} title="New direct message" aria-label="New direct message"><Edit3 size={19}/></button>
      </header>
      <button type="button" className="dm-find-button" onClick={()=>{setFriendsView(true);setActiveId(null);setSidebarOpen(false);}}> <UsersRound size={17}/> Friends <Plus size={16}/></button>
      <button type="button" className="dm-find-button" onClick={openPicker}><Search size={17}/> Find a friend to message <Plus size={16}/></button>
      <div className="section-heading"><span>DIRECT MESSAGES</span><button type="button" className="icon-button" title="New message" onClick={openPicker}><Plus size={17}/></button></div>
      <div className="dm-thread-list">
        {visibleThreads.map(thread => {
          const id = contact(thread);
          const name = preferences[thread.id]?.nickname || nameMap[id] || 'Member';
          return <button key={thread.id}
            className={'dm-thread' + (activeId === thread.id ? ' selected' : '')+
              (preferences[thread.id]?.muted_until&&new Date(preferences[thread.id].muted_until)>new Date()?' is-muted':'')}
            type="button"
            onContextMenu={e=>{e.preventDefault();setDmContext({x:e.clientX,y:e.clientY,thread,title:name});}}
            onClick={() => { setFriendsView(false); setActiveId(thread.id); setSidebarOpen(false); }}>
            <InitialAvatar name={name} size="small" path={peerMap[id]?.avatar_path}/>
            <span className="dm-thread-text"><strong>{name}</strong><small>{preferences[thread.id]?.blocked?'Blocked':preferences[thread.id]?.pinned?'Pinned':preferences[thread.id]?.muted_until&&new Date(preferences[thread.id].muted_until)>new Date()?'Muted':'Direct message'}</small></span>
          </button>;
        })}
        {!visibleThreads.length && <div className="dm-no-threads"><MessageCircle size={27}/><strong>No messages yet</strong><span>Start a private conversation with someone in your spaces.</span><button type="button" className="mini-primary" onClick={openPicker}>New message</button></div>}
      </div>
      <div className="sidebar-spacer"/>
      <div className="account-bar">
        <InitialAvatar name={displayName} own size="small" path={profile?.avatar_path}/>
        <div className="account-name"><strong>{displayName}</strong><span>Available</span></div>
        <button type="button" className="icon-button" title="Profile" aria-label="Profile settings" onClick={openProfile}><Settings2 size={18}/></button>
        <button type="button" className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={18}/></button>
      </div>
    </aside>

    <main className="chat dm-chat">
      <header className="chat-header">
        <button className="icon-button menu-button" title="Show messages" aria-label="Show conversations" onClick={() => setSidebarOpen(true)}><Menu size={21}/></button>
        {active ? <><button type="button" className="profile-icon-button" onClick={()=>setPeek(peerMap[activePerson]||null)}><InitialAvatar name={peerName} size="tiny" path={peerMap[activePerson]?.avatar_path}/></button><strong>{peerName}</strong><span className="header-divider"/><span className="header-description">Private conversation</span></>
          : <><MessageCircle className="header-hash" size={21}/><strong>Direct Messages</strong><span className="header-description">A quieter place to connect</span></>}
        <div className="chat-header-right"><ShieldCheck size={16}/> Private</div>
      </header>
      <div className="message-scroll">
        {friendsView ? <FriendsPanel session={session} onMessage={begin}/> : !active ? <div className="empty-chat dm-hero">
          <div className="empty-chat-icon"><MessageCircle size={40}/></div>
          <span className="workspace-eyebrow">STAY CONNECTED</span>
          <h1>Good conversations start here.</h1>
          <p>Send a private message to someone in your spaces. Only the two of you can read the conversation through your accounts.</p>
          <button type="button" className="primary-button" onClick={openPicker}>Start a conversation <ArrowRight size={17}/></button>
        </div> : <div className="message-inner">
          <div className="channel-intro">
            <button type="button" className="profile-icon-button" onClick={()=>setPeek(peerMap[activePerson]||null)}><InitialAvatar name={peerName} path={peerMap[activePerson]?.avatar_path}/></button>
            <h1>{peerName}</h1>
            {peerMap[activePerson]?.bio&&<p className="dm-about">{peerMap[activePerson].bio}</p>}
            <p>This is the start of your private conversation. Say hello!</p>
          </div>
          {loading && <p className="loading-text">Loading messages…</p>}
          {messages.map((msg, index) => {
            const previous = messages[index - 1];
            const dayChange = !previous || new Date(previous.created_at).toDateString() !== new Date(msg.created_at).toDateString();
            const compact = !dayChange && previous?.author_id === msg.author_id &&
              (new Date(msg.created_at) - new Date(previous.created_at)) < 300000;
            const isMine = msg.author_id === uid;
            const name = isMine ? displayName : peerName;
            return <div key={msg.id}>
              {dayChange && <div className="day-marker"><span>{formatDay(msg.created_at)}</span></div>}
              <article className={'message' + (compact ? ' compact' : '')}>
                {compact ? <span className="compact-time">{formatTime(msg.created_at)}</span> : <button type="button" className="message-profile-trigger" onClick={()=>setPeek(isMine?profile:(peerMap[activePerson]||null))}><InitialAvatar name={name} own={isMine} size="small" path={isMine?profile?.avatar_path:peerMap[activePerson]?.avatar_path}/></button>}
                <div className="message-content">
                  {!compact && <div className="message-meta"><button type="button" className="message-user-link" onClick={()=>setPeek(isMine?profile:(peerMap[activePerson]||null))}>{name}</button><time>{formatTime(msg.created_at)}</time></div>}
                  <div className="message-body">{msg.body}</div>
                </div>
              </article>
            </div>;
          })}
          <div id={'dm-file-panel-'+activeId} className="dm-message-files"/>
          <div ref={scrollEnd}/>
        </div>}
      </div>
      {error && !picker && <div className="error-banner" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {active && <form className="composer-area" onSubmit={send}>
        <div className="composer dm-composer">
          {HOSTED_FILES_ENABLED ? <HostedDmFiles key={activeId} session={session} conversationId={activeId} peerName={peerName}/> : <FileTransfers key={activeId} session={session} conversationId={activeId} peerId={activePerson} peerName={peerName}/>}
          <textarea rows={1} maxLength={2000} placeholder={'Message @' + peerName} aria-label="Direct message"
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/>
          <button type="submit" className="send-button" aria-label="Send direct message" disabled={!text.trim() || busy}><Send size={18}/></button>
        </div>
        <p className="composer-tip">Enter to send · Shift+Enter for a new line</p>
      </form>}
    </main>

    {peek && <ProfilePeek person={peek} onClose={()=>setPeek(null)}/>}
    {dmContext&&<ContextMenu menu={dmContext} onClose={closeDmContext} items={menuForDm(dmContext.thread)}/>}
    {editor && <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setEditor(null);}}>
      <section className="dialog dm-edit-panel" role="dialog" aria-modal="true">
        <header><h2>{editor.kind==='nickname'?'Private nickname':'Personal note'}</h2>
          <button type="button" className="icon-button" onClick={()=>setEditor(null)} aria-label="Close"><X size={20}/></button>
        </header>
        <form className="modal-content" onSubmit={saveEditor}>
          <p>{editor.kind==='nickname'?'Only you will see this display name.':'Your private note will never appear in the conversation.'}</p>
          {editor.kind==='nickname'?
            <input autoFocus maxLength={40} value={editorValue} onChange={e=>setEditorValue(e.target.value)} placeholder="Friend nickname"/>:
            <textarea autoFocus rows={5} maxLength={500} value={editorValue} onChange={e=>setEditorValue(e.target.value)} placeholder="Something to remember…"/>}
          <button type="submit" className="primary-button">Save</button>
        </form>
      </section>
    </div>}
    {picker && <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPicker(false); }}>
      <section className="dialog dm-picker" role="dialog" aria-modal="true" aria-label="New direct message">
        <header><h2>New message</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setPicker(false)}><X size={20}/></button></header>
        <div className="modal-content">
          <p>Start a conversation with a friend or someone in a shared space.</p>
          <div className="dm-peer-search"><Search size={18}/><input autoFocus aria-label="Search people" placeholder="Search people" value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="dm-peer-results">
            {pickerLoading && <p className="dm-picker-hint">Finding members…</p>}
            {!pickerLoading && filtered.map(peer => <button type="button" className="dm-peer" key={peer.id} disabled={busy} onClick={() => begin(peer.id)}>
              <InitialAvatar name={peer.display_name} size="small"/><strong>{peer.display_name}</strong><ArrowRight size={18}/>
            </button>)}
            {!pickerLoading && filtered.length === 0 && <p className="dm-picker-hint">No members found. Add a friend or invite someone to a shared space.</p>}
          </div>
          {error && <div className="inline-notice" role="alert">{error}</div>}
        </div>
      </section>
    </div>}
  </>;
}
