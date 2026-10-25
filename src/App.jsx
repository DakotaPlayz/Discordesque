import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Check, Copy, Hash, LockKeyhole, LogOut, Menu, MessageCircle,
  Plus, Send, Settings2, ShieldCheck, Sparkles, UsersRound, X,
} from 'lucide-react';
import { configured, confirmationUrl, supabase } from './lib/supabase.js';
import { ChannelAttachments, ChannelUpload } from './components/ChannelAttachments.jsx';
import DirectMessages from './components/DirectMessages.jsx';
import {IdentityStudio,PersonAvatar,MediaImage,ProfilePeek} from './components/IdentityStudio.jsx';

function initials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

function timeOf(date) {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDay(date) {
  return new Date(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function Brand({ compact = false }) {
  return (
    <div className="brand">
      <div className="brand-icon"><span className="brand-letter">m<span className="brand-dot">.</span></span></div>
      {!compact && <span>Mirlume</span>}
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="splash">
      <div className="splash-card">
        <Brand />
        <div className="eyebrow">ONE-TIME OWNER SETUP</div>
        <h1>Your space is almost ready.</h1>
        <p>The app is built, but this copy doesn't have a chat backend connected yet. Create a free Supabase project, run the included SQL schema, and supply the public project URL and publishable key.</p>
        <div className="setup-steps">
          <div><span>1</span> Run <strong>supabase/schema.sql</strong> in Supabase SQL Editor.</div>
          <div><span>2</span> Set <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong>.</div>
          <div><span>3</span> Rebuild the app. Friends only need to sign up and enter your invite code.</div>
        </div>
        <a className="primary-button" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Open Supabase dashboard <ArrowRight size={17} /></a>
        <p className="small-note">For GitHub builds, set these once under repository Actions Variables. Never enter a service-role/secret key.</p>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setNotice('');
    try {
      const result = register
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: confirmationUrl } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (register && !result.data.session) {
        setNotice('Check your email and open the verification link. It leads to our free Mirlume website, then you can sign in here on any device.');
      } else if (register) {
        setNotice('Account created. Signing you in...');
      }
    } catch (error) {
      setNotice(error.message || 'Could not authenticate.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="splash auth-splash">
      <div className="auth-art">
        <div className="aurora" />
        <div className="hero-mark"><MessageCircle size={64} /></div>
        <h1>Good conversations.<br /><em>Your own space.</em></h1>
        <p>A private hangout for your favorite people, wherever they are.</p>
        <div className="art-tags"><span><ShieldCheck size={15} /> Invite-only spaces</span><span><Sparkles size={15} /> Built for friends</span></div>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h2>{register ? 'Create your account' : 'Welcome back'}</h2>
        <p>{register ? 'One account works on your phone and PC.' : 'Sign in to pick up where you left off.'}</p>
        <label htmlFor="email">EMAIL</label>
        <input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">PASSWORD</label>
        <input id="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={6} placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {notice && <div className="inline-notice" role="status">{notice}</div>}
        <button className="primary-button wide" type="submit" disabled={pending}>{pending ? 'Working...' : register ? 'Create account' : 'Sign in'} <ArrowRight size={18} /></button>
        <div className="auth-toggle">{register ? 'Already have an account?' : 'New to Mirlume?'} <button type="button" className="link-button" onClick={() => { setRegister(!register); setNotice(''); }}>{register ? 'Sign in' : 'Create an account'}</button></div>
      </form>
    </div>
  );
}

function Dialog({ title, children, onClose }) {
  const dialogRef = useRef(null);
  // Keep the latest close callback, but only attach the handler once.
  // Previously focusing the dialog on every render stole focus after each keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialogRef}>
        <header><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button></header>
        {children}
      </section>
    </div>
  );
}

function Avatar({ name, own = false }) {
  return <div className={'avatar' + (own ? ' own' : '')} aria-hidden="true">{initials(name)}</div>;
}


function ConfirmationScreen({ session, onContinue }) {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const linkError = fragment.get('error_description') || fragment.get('error_code');
  const success = Boolean(session);
  return (
    <div className="splash">
      <div className="splash-card confirm-card">
        <Brand />
        <div className={'confirmation-emblem' + (success ? '' : ' error-emblem')}>
          {success ? <Check size={41} strokeWidth={3} /> : <LockKeyhole size={37} />}
        </div>
        <div className="eyebrow">{success ? 'ACCOUNT VERIFIED' : 'CONFIRMATION LINK'}</div>
        <h1>{success ? 'Email confirmed!' : 'Could not confirm your email'}</h1>
        <p>{success
          ? 'You are all set. Your email is verified, and your Mirlume account can now sign in across Windows, Android, iOS and the web.'
          : linkError
            ? 'That confirmation link may be invalid or expired. Return to Mirlume and try signing in, or request a new verification email.'
            : 'We could not find an authenticated session from that link. Please check the newest confirmation email and try again.'}</p>
        {success ? (
          <>
            <button className="primary-button wide" onClick={onContinue}>Continue to Mirlume <ArrowRight size={17}/></button>
            <p className="small-note">Using the app on your phone or computer? Return to that app and sign in with the email and password you registered.</p>
          </>
        ) : <button className="primary-button wide" onClick={onContinue}>Go to sign in <ArrowRight size={17}/></button>}
      </div>
    </div>
  );
}

function ChatApp({ session }) {
  const [profile, setProfile] = useState(null);
  const [dmMode, setDmMode] = useState(false);
  const [memberProfiles,setMemberProfiles] = useState({});
  const [peek,setPeek] = useState(null);
  const [servers, setServers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [activeServerId, setActiveServerId] = useState(null);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [modal, setModal] = useState('');
  const [modalValue, setModalValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [mobileSidebar, setMobileSidebar] = useState(true);
  const [copied, setCopied] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesBottom = useRef(null);

  const currentName = profile?.display_name || 'Member';
  const server = useMemo(() => servers.find((s) => s.id === activeServerId), [servers, activeServerId]);
  const channel = useMemo(() => channels.find((c) => c.id === activeChannelId), [channels, activeChannelId]);
  const isOwner = server?.owner_id === session.user.id;

  const refreshServers = useCallback(async (preferredId) => {
    const { data, error: loadError } = await supabase
      .from('servers')
      .select('id, name, owner_id, invite_code, description, icon_path, banner_path')
      .order('created_at', { ascending: true });
    if (loadError) { setError(loadError.message); return; }
    const list = data || [];
    setServers(list);
    setActiveServerId((old) => {
      if (preferredId && list.some((item) => item.id === preferredId)) return preferredId;
      return list.some((item) => item.id === old) ? old : (list[0]?.id || null);
    });
  }, []);

  const refreshChannels = useCallback(async (serverId, preferredId) => {
    if (!serverId) { setChannels([]); setActiveChannelId(null); return; }
    const { data, error: loadError } = await supabase.from('channels')
      .select('id, name, server_id').eq('server_id', serverId)
      .order('created_at', { ascending: true });
    if (loadError) { setError(loadError.message); return; }
    const list = data || [];
    setChannels(list);
    setActiveChannelId((old) => {
      if (preferredId && list.some((item) => item.id === preferredId)) return preferredId;
      return list.some((item) => item.id === old) ? old : (list[0]?.id || null);
    });
  }, []);

  const refreshMessages = useCallback(async (channelId) => {
    if (!channelId) { setMessages([]); return; }
    const { data, error: loadError } = await supabase.from('messages')
      .select('id, channel_id, author_id, body, created_at, profiles!messages_author_id_fkey(display_name, avatar_path, banner_path, bio, pronouns, status_text, accent_color)')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (loadError) { setError(loadError.message); return; }
    setMessages((data || []).reverse());
  }, []);

  useEffect(() => {
    let live = true;
    async function initialize() {
      const { data, error: profileError } = await supabase.from('profiles')
        .select('*').eq('id', session.user.id).single();
      if (live && data) setProfile(data);
      if (live && profileError) setError(profileError.message);
      if (live) refreshServers();
    }
    initialize();
    return () => { live = false; };
  }, [session.user.id, refreshServers]);

  const refreshMemberProfiles=useCallback(async()=>{
    if(!activeServerId){setMemberProfiles({});return;}
    const {data}=await supabase.from('server_members')
      .select('user_id,nickname,server_avatar_path,server_bio')
      .eq('server_id',activeServerId);
    setMemberProfiles(Object.fromEntries((data||[]).map(p=>[p.user_id,p])));
  },[activeServerId]);

  useEffect(()=>{refreshMemberProfiles();},[refreshMemberProfiles]);

  const openPeek=async(id)=>{
    const {data,error:e}=await supabase.from('profiles').select('*').eq('id',id).single();
    if(e){setError(e.message);return;}
    const override=memberProfiles[id];
    setPeek({...data,display_name:override?.nickname||data.display_name,
      avatar_path:override?.server_avatar_path||data.avatar_path,
      bio:override?.server_bio||data.bio});
  };

  useEffect(() => {
    setActiveChannelId(null);
    setChannels([]);
    if (activeServerId) refreshChannels(activeServerId);
  }, [activeServerId, refreshChannels]);

  useEffect(() => {
    if (!activeChannelId) { setMessages([]); return; }
    let alive = true;
    setMessages([]);
    setLoadingMessages(true);
    refreshMessages(activeChannelId).finally(() => { if (alive) setLoadingMessages(false); });
    const liveChannel = supabase.channel('channel-' + activeChannelId)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'channel_id=eq.' + activeChannelId,
      }, () => { if (alive) refreshMessages(activeChannelId); })
      .subscribe((state) => {
        if (state === 'CHANNEL_ERROR' && alive) {
          setError('Live updates are unavailable. Messages still load when you switch channels.');
        }
      });
    return () => {
      alive = false;
      supabase.removeChannel(liveChannel);
    };
  }, [activeChannelId, refreshMessages]);

  useEffect(() => {
    messagesBottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  function openDialog(kind) {
    setError('');
    setModalValue(kind === 'profile' ? currentName : '');
    setCopied(false);
    setModal(kind);
  }

  async function submitDialog(event) {
    event.preventDefault();
    if (!modalValue.trim()) return;
    setPending(true);
    setError('');
    try {
      if (modal === 'create') {
        const { data, error: operationError } = await supabase.rpc('create_server', { p_name: modalValue.trim() });
        if (operationError) throw operationError;
        await refreshServers(data);
        setMobileSidebar(true);
      } else if (modal === 'join') {
        const { data, error: operationError } = await supabase.rpc('join_server', { p_code: modalValue.trim() });
        if (operationError) throw operationError;
        await refreshServers(data);
        setMobileSidebar(true);
      } else if (modal === 'channel') {
        const { data, error: operationError } = await supabase.rpc('create_channel', {
          p_server_id: activeServerId, p_name: modalValue.trim(),
        });
        if (operationError) throw operationError;
        await refreshChannels(activeServerId, data);
      } else if (modal === 'profile') {
        const name = modalValue.trim();
        if (name.length < 2 || name.length > 32) throw new Error('Use 2-32 characters for your display name.');
        const { error: operationError } = await supabase.from('profiles').update({ display_name: name }).eq('id', session.user.id);
        if (operationError) throw operationError;
        setProfile({ ...profile, display_name: name });
        if (activeChannelId) await refreshMessages(activeChannelId);
      }
      setModal('');
    } catch (operationError) {
      setError(operationError.message || 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !activeChannelId || pending) return;
    setPending(true);
    setError('');
    try {
      const { error: sendError } = await supabase.from('messages').insert({
        channel_id: activeChannelId, author_id: session.user.id, body: text,
      });
      if (sendError) throw sendError;
      setDraft('');
      await refreshMessages(activeChannelId);
    } catch (sendError) {
      setError(sendError.message || 'Could not send your message.');
    } finally {
      setPending(false);
    }
  }

  async function copyInvite() {
    if (!server) return;
    try {
      await navigator.clipboard.writeText(server.invite_code);
      setCopied(true);
    } catch {
      setError('Copy is unavailable here. Select the invite code and copy it manually.');
    }
  }

  function selectServer(id) {
    setDmMode(false);
    setActiveServerId(id);
    setMobileSidebar(true);
    setError('');
  }

  function selectChannel(id) {
    setActiveChannelId(id);
    setMobileSidebar(false);
    setError('');
  }

  const dialogTitle = {
    create: 'Create a private space',
    join: 'Join a space',
    channel: 'Create text channel',
    profile: 'Edit your display name',
    invite: 'Invite your friends',
  };

  return (
    <div className={'app-shell' + (mobileSidebar ? ' show-sidebar' : '')}>
      <nav className="server-rail" aria-label="Servers">
        <button type="button" className={'rail-brand rail-home' + (dmMode ? ' selected' : '')} title="Direct messages" aria-label="Direct messages" onClick={() => { setDmMode(true); setMobileSidebar(true); setError(''); }}><Brand compact /></button>
        <div className="rail-rule" />
        <div className="server-list">
          {servers.map((item) => (
            <button title={item.name} aria-label={item.name} key={item.id}
              className={'server-bubble' + (item.id === activeServerId ? ' active' : '')}
              onClick={() => selectServer(item.id)}><MediaImage bucket="mirlume-server-media" path={item.icon_path} alt={item.name} className="server-icon-image" fallback={initials(item.name)}/></button>
          ))}
        </div>
        <button className="server-bubble new-server" title="Create a space" aria-label="Create a space" onClick={() => openDialog('create')}><Plus size={24} /></button>
        <button className="server-bubble join-server" title="Join a space" aria-label="Join a space" onClick={() => openDialog('join')}><ArrowRight size={21} /></button>
      </nav>

      {dmMode ? <DirectMessages session={session} servers={servers} displayName={currentName}
        openProfile={() => openDialog('identity')} profile={profile} sidebarOpen={mobileSidebar}
        setSidebarOpen={setMobileSidebar}/> : <>
      <aside className="channel-sidebar">
        <div className="server-header"><div className="server-heading-text"><strong>{server?.name || 'Your spaces'}</strong>{server?.description&&<small>{server.description}</small>}</div><button className="icon-button" title="Server invitation" aria-label="Server invitation" onClick={() => openDialog(server ? 'invite' : 'join')}><UsersRound size={19} /></button></div>
        {server ? (
          <>
            <div className="server-showcase">
              <div className="server-showcase-banner">
                <MediaImage bucket="mirlume-server-media" path={server.banner_path} alt="Server banner" className="server-banner-image"/>
              </div>
              <div className="server-showcase-bottom">
                <span className="server-showcase-icon"><MediaImage bucket="mirlume-server-media" path={server.icon_path} alt="Server icon" className="server-icon-image" fallback={initials(server.name)}/></span>
                <span><strong>{server.name}</strong><small>{server.description||'A space for your crew'}</small></span>
                <button className="icon-button" title="Server identity and appearance" onClick={()=>openDialog('identity')}><Settings2 size={17}/></button>
              </div>
            </div>
            <div className="section-heading"><span>TEXT CHANNELS</span>{isOwner && <button className="icon-button" title="Add channel" aria-label="Add channel" onClick={() => openDialog('channel')}><Plus size={17} /></button>}</div>
            <div className="channel-list">{channels.map((item) => (
              <button className={'channel-item' + (activeChannelId === item.id ? ' selected' : '')} key={item.id} onClick={() => selectChannel(item.id)}>
                <Hash size={20} /><span>{item.name}</span>
              </button>
            ))}</div>
            <div className="sidebar-spacer" />
            <button className="invite-card" onClick={() => openDialog('invite')}><UsersRound size={20} /><span>Invite friends<small>Share a private invite code</small></span><ArrowRight size={16} /></button>
          </>
        ) : (
          <div className="sidebar-empty"><Sparkles size={26} /><p>Make a space for your crew, or enter their invite code.</p><button className="mini-primary" onClick={() => openDialog('create')}>Create space</button><button className="subtle-link" onClick={() => openDialog('join')}>Join with a code</button></div>
        )}
        <div className="account-bar"><PersonAvatar name={currentName} path={profile?.avatar_path} color={profile?.accent_color} own /><div className="account-name"><strong>{currentName}</strong><span>Online</span></div><button className="icon-button" title="Profile settings" aria-label="Profile settings" onClick={() => openDialog('identity')}><Settings2 size={18} /></button><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={18} /></button></div>
      </aside>

      <main className="chat">
        <header className="chat-header"><button className="icon-button menu-button" title="Show spaces" aria-label="Show spaces" onClick={() => setMobileSidebar(true)}><Menu size={23} /></button>
          <Hash size={23} className="header-hash" /><strong>{channel?.name || 'Welcome'}</strong>
          <span className="header-divider" /><span className="header-description">{server ? server.name : 'Your private hangout'}</span>
          {server && <button title="Invite friends" aria-label="Invite friends" className="icon-button invite-header" onClick={() => openDialog('invite')}><UsersRound size={20} /></button>}
        </header>
        <div className="message-scroll">
          {!channel ? (
            <div className="empty-chat"><div className="empty-chat-icon"><MessageCircle size={39} /></div><h1>Your conversations, your way.</h1><p>Create or join a private space to start chatting across phones and PCs.</p><div className="empty-actions"><button className="primary-button" onClick={() => openDialog('create')}>Create a space <Plus size={17} /></button><button className="secondary-button" onClick={() => openDialog('join')}>Join a space</button></div></div>
          ) : (
            <div className="message-inner">
              <div className="channel-intro"><div className="channel-intro-icon"><Hash size={30} /></div><h1>Welcome to #{channel.name}!</h1><p>This is the beginning of the <strong>#{channel.name}</strong> channel.</p></div>
              {loadingMessages && <p className="loading-text">Loading messages...</p>}
              {messages.map((message, index) => {
                const member = memberProfiles[message.author_id];
                const who = member?.nickname || message.profiles?.display_name || (message.author_id === session.user.id ? currentName : 'Member');
                const avatarPath = member?.server_avatar_path || message.profiles?.avatar_path;
                const prev = messages[index - 1];
                const dayChanged = !prev || new Date(prev.created_at).toDateString() !== new Date(message.created_at).toDateString();
                const compact = !dayChanged && prev?.author_id === message.author_id &&
                  (new Date(message.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000;
                return (
                  <div key={message.id}>
                    {dayChanged && <div className="day-marker"><span>{formatDay(message.created_at)}</span></div>}
                    <article className={'message' + (compact ? ' compact' : '')}>
                      {compact ? <span className="compact-time">{timeOf(message.created_at)}</span> :
                        <button type="button" className="message-profile-trigger" onClick={()=>openPeek(message.author_id)}><PersonAvatar name={who} path={avatarPath} color={message.profiles?.accent_color} own={message.author_id===session.user.id}/></button>}
                      <div className="message-content">{!compact && <div className="message-meta"><button type="button" className="message-user-link" onClick={()=>openPeek(message.author_id)}>{who}</button><time>{timeOf(message.created_at)}</time></div>}<div className="message-body">{message.body}</div></div>
                    </article>
                  </div>
                );
              })}
              <ChannelAttachments key={channel.id} server={server} channel={channel} />
              <div ref={messagesBottom} />
            </div>
          )}
        </div>
        {error && <div className="error-banner" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {channel && <form className="composer-area" onSubmit={sendMessage}><div className="composer"><ChannelUpload key={channel.id} session={session} server={server} channel={channel} /><textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={1} placeholder={'Message #' + channel.name} aria-label="Message" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendMessage(); } }} /><button type="submit" className="send-button" aria-label="Send message" disabled={!draft.trim() || pending}><Send size={19} /></button></div><p className="composer-tip">Enter to send · Shift+Enter for a new line</p></form>}
      </main>
      </>}

      {peek && <ProfilePeek person={peek} onClose={()=>setPeek(null)}/>}
      {modal && <Dialog title={modal==='identity'?'Personalize your Mirlume experience':dialogTitle[modal]} onClose={() => setModal('')}>
        {modal === 'identity' ? (
          <IdentityStudio session={session} profile={profile} server={server} isOwner={isOwner}
            onClose={()=>setModal('')}
            onSaved={async next=>{if(next)setProfile(next);await refreshServers();await refreshMemberProfiles();if(activeChannelId)await refreshMessages(activeChannelId);}}/>
        ) : modal === 'invite' ? (
          <div className="modal-content">
            <p>Share this code with your two friends. Anyone who has it can join <strong>{server?.name}</strong>.</p>
            <div className="invite-code"><code>{server?.invite_code}</code><button className="icon-button" title="Copy code" onClick={copyInvite}>{copied ? <Check size={21} /> : <Copy size={21} />}</button></div>
            <p className="small-note"><LockKeyhole size={14} /> Keep this code private.</p>
            <button className="primary-button wide" onClick={() => setModal('')}>Done</button>
          </div>
        ) : (
          <form className="modal-content" onSubmit={submitDialog}>
            <p>{modal === 'create' ? 'A cozy place for a small group. A #general channel is created automatically.' : modal === 'join' ? 'Enter an invitation code from a friend.' : modal === 'channel' ? 'Give your new text channel a short name.' : 'This is how your friends will see you in chat.'}</p>
            <label htmlFor="dialog-input">{modal === 'join' ? 'INVITE CODE' : modal === 'profile' ? 'DISPLAY NAME' : modal === 'channel' ? 'CHANNEL NAME' : 'SPACE NAME'}</label>
            <input autoFocus id="dialog-input" value={modalValue} onChange={(e) => setModalValue(e.target.value)} required maxLength={modal === 'join' ? 32 : modal === 'channel' || modal === 'profile' ? 32 : 48} placeholder={modal === 'join' ? 'Paste code here' : modal === 'channel' ? 'game-night' : modal === 'profile' ? 'Your nickname' : 'The Crew'} />
            {error && <div className="inline-notice">{error}</div>}
            <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setModal('')}>Cancel</button><button className="primary-button" type="submit" disabled={pending || !modalValue.trim()}>{pending ? 'Working...' : modal === 'create' ? 'Create space' : modal === 'join' ? 'Join space' : modal === 'channel' ? 'Create channel' : 'Save changes'} <ArrowRight size={16} /></button></div>
          </form>
        )}
      </Dialog>}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(
    new URLSearchParams(window.location.search).has('confirmed')
  );

  useEffect(() => {
    if (!supabase) { setChecking(false); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setChecking(false); }
    }).catch(() => { if (active) setChecking(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) { setSession(nextSession); setChecking(false); }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  if (!configured) return <SetupScreen />;
  if (checking) return <div className="loading-screen"><Brand /><p>Connecting to your space...</p></div>;
  if (showConfirmation) {
    return <ConfirmationScreen session={session} onContinue={() => {
      window.history.replaceState(null, '', window.location.pathname);
      setShowConfirmation(false);
    }} />;
  }
  return session ? <ChatApp key={session.user.id} session={session} /> : <AuthScreen />;;
}
