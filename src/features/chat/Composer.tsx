import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, Pause, Paperclip, Send, Trash2, X, AtSign } from 'lucide-react';
import type { Attachment, ReplyPreview } from './api';
import { messageSummary } from './format';
import { buildPath, uploadWithProgress } from './media/upload';
import { useVoiceRecorder } from './media/useVoiceRecorder';
import { VoicePlayer } from './media/VoicePlayer';
import { ALLOWED_MIME, formatBytes, formatDuration, kindOf, MAX_FILES_PER_MESSAGE, validateFile } from './media/validation';
import { useDrafts } from '@/stores/drafts';
import styles from './Composer.module.css';

type Item = {
  key: string; file: File; status: 'ready' | 'uploading' | 'done' | 'error'; progress: number;
  path?: string; durationMs?: number; waveform?: number[];
};
export type Mentionable = { username: string; display_name: string };
type Props = {
  cid: string;
  uid: string;
  replyTo: ReplyPreview | null;
  replyName?: string;
  onCancelReply: () => void;
  onSend: (body: string, messageId: string, attachments: Attachment[], replyTo: ReplyPreview | null) => Promise<void>;
  members?: Mentionable[];
  enterToSend?: boolean;
  onTyping?: () => void;
  onTypingStop?: () => void;
};

export function Composer({
  cid, uid, replyTo, replyName, onCancelReply, onSend, members = [], enterToSend = true, onTyping, onTypingStop,
}: Props) {
  const draftKey = `${uid}:${cid}`;
  const storedDraft = useDrafts((s) => s.drafts[draftKey] ?? '');
  const setDraft = useDrafts((s) => s.setDraft);
  const clearDraft = useDrafts((s) => s.clearDraft);

  const [text, setText] = useState(storedDraft);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const messageId = useRef(crypto.randomUUID());
  const controllers = useRef(new Map<string, AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const latestText = useRef(text);
  useEffect(() => { latestText.current = text; }, [text]);
  useEffect(() => () => { setDraft(draftKey, latestText.current); }, [draftKey, setDraft]);
  const voice = useVoiceRecorder();
  const previewUrl = useMemo(() => (voice.result ? URL.createObjectURL(voice.result.blob) : undefined), [voice.result]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => { const c = controllers.current; return () => c.forEach((a) => a.abort()); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => setDraft(draftKey, text), 300);
    return () => window.clearTimeout(t);
  }, [text, draftKey, setDraft]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [text]);

  const suggestions = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m) => m.username.toLowerCase().includes(q) || m.display_name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [mentionQuery, members]);

  const patchItem = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setError(null);
    const accepted: Item[] = [];
    for (const f of Array.from(list)) {
      const problem = validateFile(f);
      if (problem) { setError(problem); continue; }
      accepted.push({ key: crypto.randomUUID(), file: f, status: 'ready', progress: 0 });
    }
    if (items.length + accepted.length > MAX_FILES_PER_MESSAGE) { setError(`Up to ${MAX_FILES_PER_MESSAGE} files per message`); return; }
    setItems((cur) => [...cur, ...accepted]);
  };

  const removeItem = (key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    setItems((cur) => cur.filter((i) => i.key !== key));
  };

  /** Uploads whatever is not uploaded yet, then sends one message. Safe to retry after a failure. */
  const run = async (body: string, list: Item[]) => {
    setBusy(true); setError(null);
    const id = messageId.current;
    const metas: Attachment[] = [];
    try {
      for (const it of list) {
        let path = it.path;
        if (it.status !== 'done') {
          path = it.path ?? buildPath(cid, id, it.file.name);
          const ctl = new AbortController();
          controllers.current.set(it.key, ctl);
          patchItem(it.key, { status: 'uploading', progress: 0, path });
          try {
            await uploadWithProgress(path, it.file, (p) => patchItem(it.key, { progress: p }), ctl.signal);
          } catch (e) {
            if ((e as Error).name === 'AbortError') return;
            if (!/\(409\)/.test((e as Error).message)) {
              patchItem(it.key, { status: 'error' });
              setError(`${it.file.name} failed to upload. Retry to continue.`);
              return;
            }
          } finally { controllers.current.delete(it.key); }
          patchItem(it.key, { status: 'done', progress: 100 });
        }
        const mime = it.file.type.split(';')[0];
        metas.push({
          kind: kindOf(mime), storage_path: path!, file_name: it.file.name, mime_type: mime, size_bytes: it.file.size,
          duration_ms: it.durationMs ?? null, waveform: it.waveform ?? null,
        });
      }
      await onSend(body, id, metas, replyTo);
      messageId.current = crypto.randomUUID();
      setText('');
      clearDraft(draftKey);
      setItems([]);
      onTypingStop?.();
    } finally { setBusy(false); }
  };

  const submit = () => {
    const body = text.trim();
    if (busy || (!body && items.length === 0)) return;
    setMentionQuery(null);
    void run(body, items);
  };

  const sendVoice = () => {
    const r = voice.result;
    if (!r || busy) return;
    const ext = r.mime.split('/')[1];
    const file = new File([r.blob], `voice-note-${Date.now()}.${ext}`, { type: r.mime });
    const item: Item = { key: crypto.randomUUID(), file, status: 'ready', progress: 0, durationMs: Math.round(r.durationMs), waveform: r.waveform };
    voice.discard();
    void run('', [item]);
  };

  const onChange = (value: string) => {
    setText(value);
    if (value.trim()) onTyping?.();
    else onTypingStop?.();
    const caret = inputRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const hit = before.match(/(?:^|\s)@([a-z0-9_]{0,24})$/i);
    setMentionQuery(hit ? hit[1] : null);
  };

  const insertMention = (username: string) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/(?:^|\s)@[a-z0-9_]*$/i, (m) => `${m.trim().startsWith('@') ? ' ' : ''}@${username} `);
    setText(before + text.slice(caret));
    setMentionQuery(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(before.length, before.length); });
  };

  const recording = voice.state === 'recording' || voice.state === 'paused';
  const replyBar = replyTo && (
    <div className={styles.replyBar}>
      <div>
        <strong>{replyName ? `Replying to ${replyName}` : 'Replying'}</strong>
        <span>{messageSummary(replyTo.body, replyTo.attachments, replyTo.deleted_at)}</span>
      </div>
      <button type="button" onClick={onCancelReply} aria-label="Cancel reply"><X size={16} aria-hidden /></button>
    </div>
  );

  if (recording) {
    return (
      <div className={styles.wrap}>
        {replyBar}
        <div className={styles.bar} role="group" aria-label="Recording voice note">
          <button className={styles.round} onClick={voice.cancel} aria-label="Cancel recording"><Trash2 size={20} aria-hidden /></button>
          <span className={styles.recDot} data-paused={voice.state === 'paused'} aria-hidden />
          <span className={styles.timer} role="timer" aria-label="Recording time">{formatDuration(voice.elapsedMs)}</span>
          <span className={styles.live} aria-hidden>{voice.live.map((l, i) => <i key={i} style={{ height: `${Math.max(8, l * 100)}%` }} />)}</span>
          {voice.state === 'recording'
            ? <button className={styles.round} onClick={voice.pause} aria-label="Pause recording"><Pause size={20} aria-hidden /></button>
            : <button className={styles.round} onClick={voice.resume} aria-label="Resume recording"><Mic size={20} aria-hidden /></button>}
          <button className={styles.mint} onClick={voice.stop} aria-label="Finish recording"><Check size={20} aria-hidden /></button>
        </div>
      </div>
    );
  }
  if (voice.state === 'preview' && voice.result) {
    return (
      <div className={styles.wrap}>
        {replyBar}
        <div className={styles.bar} role="group" aria-label="Voice note preview">
          <button className={styles.round} onClick={voice.discard} aria-label="Discard voice note"><Trash2 size={20} aria-hidden /></button>
          <div className={styles.previewPlayer}><VoicePlayer src={previewUrl} durationMs={voice.result.durationMs} waveform={voice.result.waveform} /></div>
          <button className={styles.send} onClick={sendVoice} disabled={busy} aria-label="Send voice note"><Send size={20} aria-hidden /></button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {replyBar}
      {items.length > 0 && (
        <ul className={styles.queue} aria-label="Files to send">
          {items.map((i) => (
            <li key={i.key} className={styles.chip} data-status={i.status}>
              <span className={styles.chipName}>{i.file.name}</span>
              <small>{i.status === 'uploading' ? `${i.progress}%` : i.status === 'done' ? 'Uploaded' : i.status === 'error' ? 'Failed' : formatBytes(i.file.size)}</small>
              {i.status === 'uploading' && <progress value={i.progress} max={100} aria-label={`Uploading ${i.file.name}`} />}
              <button onClick={() => removeItem(i.key)} aria-label={i.status === 'uploading' ? `Cancel upload of ${i.file.name}` : `Remove ${i.file.name}`}><X size={14} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      {(error || voice.error) && <p className={styles.err} role="alert">{error ?? voice.error}</p>}
      {suggestions.length > 0 && (
        <ul className={styles.mentions} role="listbox" aria-label="Mention a member">
          {suggestions.map((s) => (
            <li key={s.username}>
              <button type="button" role="option" aria-selected={false} onClick={() => insertMention(s.username)}>
                <AtSign size={14} aria-hidden />
                <strong>{s.display_name}</strong>
                <span>@{s.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input ref={fileInput} type="file" multiple hidden accept={ALLOWED_MIME.join(',')} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className={styles.round} onClick={() => fileInput.current?.click()} aria-label="Attach files" disabled={busy}><Paperclip size={20} aria-hidden /></button>
        <label className="sr-only" htmlFor="composer">Message</label>
        <textarea
          ref={inputRef} id="composer" className={styles.input} rows={1} maxLength={4000}
          placeholder={enterToSend ? 'Write a message' : 'Write a message · Ctrl+Enter to send'} value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { setMentionQuery(null); onTypingStop?.(); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMentionQuery(null);
            if (e.key === 'Enter' && suggestions.length > 0 && !e.shiftKey) {
              e.preventDefault();
              insertMention(suggestions[0].username);
              return;
            }
            const send = enterToSend ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && (e.metaKey || e.ctrlKey));
            if (send && !mentionQuery) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {members.length > 1 && (
          <button type="button" className={styles.round} onClick={() => { if (inputRef.current) { inputRef.current.focus(); setMentionQuery(''); } }}
            aria-label="Mention a group member" disabled={busy}><AtSign size={20} aria-hidden /></button>
        )}
        {text.trim() || items.length ? (
          <button type="submit" className={styles.send} aria-label="Send message" disabled={busy}><Send size={20} aria-hidden /></button>
        ) : (
          <button type="button" className={styles.round} onClick={() => void voice.start()} aria-label={voice.supported ? 'Record voice note' : 'Voice notes are not supported in this browser'} disabled={!voice.supported || busy}>
            <Mic size={20} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
