import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CheckCheck, Edit3, LogOut, Menu, MessageCircle,
  Plus, Search, Send, Settings2, ShieldCheck, Users, X
} from 'lucide-react';
import { supabase } from '../lib/supabase.js';
import FileTransfers from './FileTransfers.jsx';

const formatTime = (date) => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const formatDay = (date) => new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const short = (name) => String(name || '?').trim().slice(0, 2).toUpperCase();

function InitialAvatar({ name, own = false, size = 'normal' }) {
  return <div className={'dm-avatar ' + (own ? 'mine ' : '') + size} aria-hidden="true">{short(name)}</div>;
}

export default function DirectMessages({ session, servers, displayName, openProfile, sidebarOpen, setSidebarOpen }) {
  const uid = session.user.id;
  const [threads, setThreads] = useState([]);
  const [nameMap, setNameMap] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [peers, setPeers] = useState([]);
  const [search, setSearch] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const scrollEnd = useRef(null);
  const activeIdRef = useRef(null);

  const contact = useCallback(thread => thread.user_low === uid ? thread.user_high : thread.user_low, [uid]);
  const active = useMemo(() => threads.find(t => t.id === activeId) || null, [threads, activeId]);
  const activePerson = active && contact(active);
  const peerName = activePerson ? (nameMap[activePerson] || 'Member') : '';

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
      const { data: users } = await supabase.from('profiles').select('id,display_name').in('id', contacts);
      setNameMap(old => ({ ...old, ...Object.fromEntries((users || []).map(p => [p.id, p.display_name])) }));
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
    setPicker(true);
    setPickerLoading(true);
    setSearch('');
    setError('');
    try {
      if (!servers.length) { setPeers([]); return; }
      const { data: memberships, error: membershipError } = await supabase
        .from('server_members').select('user_id')
        .in('server_id', servers.map(s => s.id));
      if (membershipError) throw membershipError;
      const ids = [...new Set((memberships || []).map(m => m.user_id).filter(id => id !== uid))];
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
      await refreshThreads(data);
      setPicker(false);
      setSidebarOpen(false);
    } catch (err) { setError(err.message || 'Unable to create conversation. Check that the DM migration is installed.'); }
    finally { setBusy(false); }
  };

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
      <button type="button" className="dm-find-button" onClick={openPicker}><Search size={17}/> Find a friend to message <Plus size={16}/></button>
      <div className="section-heading"><span>DIRECT MESSAGES</span><button type="button" className="icon-button" title="New message" onClick={openPicker}><Plus size={17}/></button></div>
      <div className="dm-thread-list">
        {threads.map(thread => {
          const id = contact(thread);
          const name = nameMap[id] || 'Member';
          return <button key={thread.id} className={'dm-thread' + (activeId === thread.id ? ' selected' : '')}
            type="button" onClick={() => { setActiveId(thread.id); setSidebarOpen(false); }}>
            <InitialAvatar name={name} size="small"/>
            <span className="dm-thread-text"><strong>{name}</strong><small>Direct message</small></span>
          </button>;
        })}
        {!threads.length && <div className="dm-no-threads"><MessageCircle size={27}/><strong>No messages yet</strong><span>Start a private conversation with someone in your spaces.</span><button type="button" className="mini-primary" onClick={openPicker}>New message</button></div>}
      </div>
      <div className="sidebar-spacer"/>
      <div className="account-bar">
        <InitialAvatar name={displayName} own size="small"/>
        <div className="account-name"><strong>{displayName}</strong><span>Available</span></div>
        <button type="button" className="icon-button" title="Profile" aria-label="Profile settings" onClick={openProfile}><Settings2 size={18}/></button>
        <button type="button" className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => supabase.auth.signOut()}><LogOut size={18}/></button>
      </div>
    </aside>

    <main className="chat dm-chat">
      <header className="chat-header">
        <button className="icon-button menu-button" title="Show messages" aria-label="Show conversations" onClick={() => setSidebarOpen(true)}><Menu size={21}/></button>
        {active ? <><InitialAvatar name={peerName} size="tiny"/><strong>{peerName}</strong><span className="header-divider"/><span className="header-description">Private conversation</span></>
          : <><MessageCircle className="header-hash" size={21}/><strong>Direct Messages</strong><span className="header-description">A quieter place to connect</span></>}
        <div className="chat-header-right"><ShieldCheck size={16}/> Private</div>
      </header>
      <div className="message-scroll">
        {!active ? <div className="empty-chat dm-hero">
          <div className="empty-chat-icon"><MessageCircle size={40}/></div>
          <span className="workspace-eyebrow">STAY CONNECTED</span>
          <h1>Good conversations start here.</h1>
          <p>Send a private message to someone in your spaces. Only the two of you can read the conversation through your accounts.</p>
          <button type="button" className="primary-button" onClick={openPicker}>Start a conversation <ArrowRight size={17}/></button>
        </div> : <div className="message-inner">
          <div className="channel-intro">
            <InitialAvatar name={peerName}/>
            <h1>{peerName}</h1>
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
                {compact ? <span className="compact-time">{formatTime(msg.created_at)}</span> : <InitialAvatar name={name} own={isMine} size="small"/>}
                <div className="message-content">
                  {!compact && <div className="message-meta"><strong>{name}</strong><time>{formatTime(msg.created_at)}</time></div>}
                  <div className="message-body">{msg.body}</div>
                </div>
              </article>
            </div>;
          })}
          <div ref={scrollEnd}/>
        </div>}
      </div>
      {error && !picker && <div className="error-banner" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {active && <form className="composer-area" onSubmit={send}>
        <div className="composer dm-composer">
          <FileTransfers key={activeId} session={session} conversationId={activeId} peerId={activePerson} peerName={peerName}/>
          <textarea rows={1} maxLength={2000} placeholder={'Message @' + peerName} aria-label="Direct message"
            value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/>
          <button type="submit" className="send-button" aria-label="Send direct message" disabled={!text.trim() || busy}><Send size={18}/></button>
        </div>
        <p className="composer-tip">Enter to send · Shift+Enter for a new line</p>
      </form>}
    </main>

    {picker && <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setPicker(false); }}>
      <section className="dialog dm-picker" role="dialog" aria-modal="true" aria-label="New direct message">
        <header><h2>New message</h2><button type="button" className="icon-button" aria-label="Close" onClick={() => setPicker(false)}><X size={20}/></button></header>
        <div className="modal-content">
          <p>Start a conversation with someone who shares a space with you.</p>
          <div className="dm-peer-search"><Search size={18}/><input autoFocus aria-label="Search people" placeholder="Search people" value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="dm-peer-results">
            {pickerLoading && <p className="dm-picker-hint">Finding members…</p>}
            {!pickerLoading && filtered.map(peer => <button type="button" className="dm-peer" key={peer.id} disabled={busy} onClick={() => begin(peer.id)}>
              <InitialAvatar name={peer.display_name} size="small"/><strong>{peer.display_name}</strong><ArrowRight size={18}/>
            </button>)}
            {!pickerLoading && filtered.length === 0 && <p className="dm-picker-hint">No members found. Invite someone to a shared space first.</p>}
          </div>
          {error && <div className="inline-notice" role="alert">{error}</div>}
        </div>
      </section>
    </div>}
  </>;
}
