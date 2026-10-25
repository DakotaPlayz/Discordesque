import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, File, FilePlus2, LoaderCircle, Paperclip, ShieldCheck, X } from 'lucide-react';
import * as tus from 'tus-js-client';
import { supabase } from '../lib/supabase.js';

const BUCKET = 'mirlume-channel-files';
const MAX_SIZE = 50_000_000; // 50 MB (decimal), matching Supabase Free plan
const pretty = (bytes) => bytes >= 1_000_000 ? (bytes / 1_000_000).toFixed(1) + ' MB'
  : bytes >= 1000 ? (bytes / 1000).toFixed(1) + ' KB' : bytes + ' B';

export function ChannelAttachments({ channel, server }) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(null);

  const refresh = useCallback(async () => {
    if (!channel?.id) { setFiles([]); return; }
    const { data, error: queryError } = await supabase.from('channel_attachments')
      .select('id,filename,object_path,size_bytes,content_type,created_at,uploader_id')
      .eq('channel_id', channel.id).order('created_at', { ascending: false }).limit(50);
    if (queryError) { setError(queryError.message); return; }
    setError('');
    setFiles(data || []);
  }, [channel?.id]);

  useEffect(() => {
    refresh();
    if (!channel?.id) return;
    const subscription = supabase.channel('channel-files-' + channel.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'channel_attachments',
        filter: 'channel_id=eq.' + channel.id,
      }, () => refresh())
      .subscribe();
    const refreshOnFocus = () => refresh();
    window.addEventListener('focus', refreshOnFocus);
    return () => { supabase.removeChannel(subscription); window.removeEventListener('focus', refreshOnFocus); };
  }, [refresh, channel?.id]);

  async function download(attachment) {
    setDownloading(attachment.id); setError('');
    try {
      // Private signed URL checks membership at creation; expires after two minutes.
      const { data, error: signedError } = await supabase.storage.from(BUCKET)
        .createSignedUrl(attachment.object_path, 120, { download: attachment.filename });
      if (signedError) throw signedError;
      if (!data?.signedUrl) throw new Error('Could not generate a download link.');
      const anchor = document.createElement('a');
      anchor.href = data.signedUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (downloadError) { setError(downloadError.message || 'Download failed'); }
    finally { setDownloading(null); }
  }

  if (!channel || !server || (!files.length && !error)) return null;
  return <section className="channel-attachments" aria-label="Shared channel files">
    <div className="attachment-heading"><Paperclip size={17}/><strong>Shared files</strong><span>Private to {server.name}</span></div>
    {files.map(item => <article className="attachment-entry" key={item.id}>
      <span className="attachment-file-icon"><File size={20}/></span>
      <div className="attachment-information"><strong title={item.filename}>{item.filename}</strong><span>{pretty(item.size_bytes)} · {new Date(item.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</span></div>
      <button type="button" disabled={downloading === item.id} className="attachment-download" onClick={() => download(item)} title={'Download ' + item.filename} aria-label={'Download ' + item.filename}>
        {downloading === item.id ? <LoaderCircle size={17} className="spinning"/> : <Download size={18}/>}
      </button>
    </article>)}
    {error && <p className="file-error" role="alert">{error}. If you have not already, apply the v0.4 attachments migration in Supabase.</p>}
  </section>;
}

export function ChannelUpload({ session, server, channel }) {
  const inputRef = useRef(null);
  const uploadRef = useRef(null);
  const [progress, setProgress] = useState(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => () => { uploadRef.current?.abort(); }, []);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || progress !== null) return;
    setError(''); setDone('');
    if (file.size < 1 || file.size > MAX_SIZE) {
      setError('Channel attachments must be between 1 byte and 50 MB. For up to 20 GB, use a direct message.');
      return;
    }
    if (!server?.id || !channel?.id) return;
    const path = [server.id, channel.id, session.user.id, crypto.randomUUID()].join('/');
    setFilename(file.name);
    setProgress(0);
    try {
      const { data: { session: authSession }, error: authError } = await supabase.auth.getSession();
      if (authError || !authSession?.access_token) throw new Error('Sign in again to upload files.');
      const url = import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '');
      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: url + '/storage/v1/upload/resumable',
          retryDelays: [0, 2000, 5000, 10000],
          chunkSize: 6 * 1024 * 1024,
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          headers: { authorization: 'Bearer ' + authSession.access_token, 'x-upsert': 'false' },
          metadata: {
            bucketName: BUCKET,
            objectName: path,
            contentType: file.type || 'application/octet-stream',
            cacheControl: '3600',
          },
          onError: reject,
          onSuccess: resolve,
          onProgress: (uploaded, total) => setProgress(Math.round(uploaded / total * 100)),
        });
        uploadRef.current = upload;
        upload.start();
      });
      const { error: insertError } = await supabase.from('channel_attachments').insert({
        server_id: server.id, channel_id: channel.id, uploader_id: session.user.id,
        object_path: path, filename: file.name.slice(0, 255),
        size_bytes: file.size, content_type: file.type || 'application/octet-stream',
      });
      if (insertError) throw new Error(insertError.message + ' (file bytes uploaded; owner may need to clean up orphan object)');
      setDone(file.name + ' uploaded');
      setTimeout(() => setDone(''), 5000);
    } catch (uploadError) {
      setError(uploadError.message || 'Unable to upload file');
    } finally {
      uploadRef.current = null;
      setProgress(null);
      setFilename('');
    }
  }

  return <div className="channel-upload">
    <input ref={inputRef} className="visually-hidden" type="file" aria-label="Select file up to 50 MB" onChange={handleFile} disabled={progress !== null}/>
    <button type="button" className="file-share-button" title="Upload file to this channel · maximum 50 MB" aria-label="Upload a file to this channel (50 MB max)" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
      {progress !== null ? <LoaderCircle size={20} className="spinning"/> : <FilePlus2 size={20}/>}
    </button>
    {(progress !== null || error || done) && <div className="upload-popover" role="status">
      <div className="upload-state-line">
        <span>{progress !== null ? ('Uploading ' + filename) : error ? 'Upload failed' : done}</span>
        {progress !== null ? <strong>{progress}%</strong> : <button type="button" className="icon-button" aria-label="Dismiss upload message" onClick={() => {setError('');setDone('');}}><X size={14}/></button>}
      </div>
      {progress !== null && <div className="upload-meter"><div style={{width: progress + '%'}}/></div>}
      {error && <p className="file-error">{error}</p>}
      {done && <p className="upload-success"><ShieldCheck size={13}/> Stored privately for your channel members.</p>}
    </div>}
  </div>;
}
