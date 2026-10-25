import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../lib/supabase.js';
import {UserPlus,Check,X,MessageCircle,Search,UserX} from 'lucide-react';

export default function FriendsPanel({session,onMessage}) {
 const uid=session.user.id;
 const [relationships,setRelationships]=useState([]);
 const [names,setNames]=useState({});
 const [query,setQuery]=useState('');
 const [results,setResults]=useState([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState('');
 const load=useCallback(async()=>{
  const {data,error:e}=await supabase.from('mirlume_friends')
    .select('user_low,user_high,requested_by,status,created_at')
    .or('user_low.eq.'+uid+',user_high.eq.'+uid).order('created_at',{ascending:false});
  if(e){setError('Friends not available: '+e.message+' — run friends-v0.5.4.sql in Supabase.');return;}
  setRelationships(data||[]);
  const ids=[...new Set((data||[]).map(r=>r.user_low===uid?r.user_high:r.user_low))];
  if(ids.length){
   const {data:profiles,error:pe}=await supabase.from('profiles').select('id,display_name').in('id',ids);
   if(pe){setError('Cannot load friend names: '+pe.message);return;}
   setNames(Object.fromEntries((profiles||[]).map(p=>[p.id,p.display_name])));
  }
 },[uid]);
 useEffect(()=>{load();const t=setInterval(load,15000);return()=>clearInterval(t);},[load]);
 async function findPeople(e){
  e?.preventDefault();setError('');setResults([]);
  if(query.trim().length<2){setError('Enter at least 2 characters.');return;}
  const {data,error:e2}=await supabase.rpc('mirlume_find_people',{p_query:query.trim()});
  if(e2)setError('Search failed: '+e2.message);else setResults(data||[]);
 }
 async function action(peer,type){
  setBusy(peer);setError('');
  const {error:e}=await supabase.rpc('mirlume_friend_action',{p_peer:peer,p_action:type});
  if(e)setError(e.message);
  else {await load();if(query.trim().length>=2)await findPeople();}
  setBusy('');
 }
 const itemFor=id=>relationships.find(r=>r.user_low===id||r.user_high===id);
 const peerOf=r=>r.user_low===uid?r.user_high:r.user_low;
 const incoming=relationships.filter(r=>r.status==='pending'&&r.requested_by!==uid);
 const outgoing=relationships.filter(r=>r.status==='pending'&&r.requested_by===uid);
 const friends=relationships.filter(r=>r.status==='accepted');
 const entry=(r)=>{const id=peerOf(r);return <div key={id} className="mirlume-friend-item">
  <strong>{names[id]||id.slice(0,8)}</strong>
  <span className="mirlume-friend-actions">
   {r.status==='accepted'?<><button type="button" onClick={()=>onMessage(id)}><MessageCircle size={15}/> Message</button><button type="button" disabled={busy===id} onClick={()=>{if(window.confirm('Remove this friend?'))action(id,'remove');}}><UserX size={15}/> Remove</button></>:
    r.requested_by===uid?<button disabled={busy===id} onClick={()=>action(id,'remove')}><X size={15}/> Cancel</button>:
    <><button disabled={busy===id} onClick={()=>action(id,'accept')}><Check size={15}/> Accept</button><button disabled={busy===id} onClick={()=>action(id,'remove')}><X size={15}/> Decline</button></>}
  </span>
 </div>};
 return <section className="mirlume-friends-panel">
  <h2>Friends</h2><p>Add people by their display name. They'll need to accept your request.</p>
  <form onSubmit={findPeople} className="mirlume-friend-search"><input aria-label="Find people" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search display name" maxLength={32}/><button type="submit"><Search size={16}/> Search</button></form>
  {error&&<p role="alert" className="inline-notice">{error}</p>}
  {results.length>0&&<div><h3>People</h3>{results.map(p=>{const rel=itemFor(p.id);return <div className="mirlume-friend-item" key={p.id}>
    <strong>{p.display_name}</strong><span className="mirlume-friend-actions">
     {rel?.status==='accepted'?<span>Friends</span>:rel?.requested_by===uid?<span>Request sent</span>:
      <button type="button" disabled={busy===p.id} onClick={()=>action(p.id,rel?'accept':'request')}><UserPlus size={15}/>{rel?'Accept':'Add Friend'}</button>}
    </span></div>})}</div>}
  <h3>Incoming requests ({incoming.length})</h3>{incoming.length?incoming.map(entry):<p>No incoming requests.</p>}
  <h3>Friends ({friends.length})</h3>{friends.length?friends.map(entry):<p>No friends added yet.</p>}
  <h3>Sent requests ({outgoing.length})</h3>{outgoing.length?outgoing.map(entry):<p>No pending requests.</p>}
 </section>;
}
