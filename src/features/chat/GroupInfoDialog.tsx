import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Crown, LogOut, Plus, ShieldCheck, Trash2, UserMinus } from 'lucide-react';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { Dialog } from '@/components/Dialog/Dialog';
import { TextField } from '@/components/TextField/TextField';
import { supabase } from '@/lib/supabase';
import {
  addGroupMembers, deleteGroup, fetchContacts, fetchMembers, keys, leaveGroup, removeGroupMember,
  setGroupMemberRole, setGroupPhoto, updateGroup, type ConversationItem, type MemberInfo,
} from './api';
import styles from './ChatDialogs.module.css';

type Confirm =
  | { kind: 'remove'; member: MemberInfo }
  | { kind: 'leave' }
  | { kind: 'delete' }
  | null;

export function GroupInfoDialog({ onClose, conv, uid }: {
  onClose: () => void; conv: ConversationItem; uid: string;
}) {
  const cid = conv.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState(conv.title ?? '');
  const [description, setDescription] = useState(conv.description ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [photoBusy, setPhotoBusy] = useState(false);


  const members = useQuery({ queryKey: keys.members(cid), queryFn: () => fetchMembers(cid) });
  const contacts = useQuery({ queryKey: keys.contacts, queryFn: fetchContacts });
  const isAdmin = conv.my_role === 'admin' || members.data?.find((m) => m.user_id === uid)?.role === 'admin';
  const memberIds = useMemo(() => new Set((members.data ?? []).map((m) => m.user_id)), [members.data]);
  const available = (contacts.data ?? []).filter((c) => c.status === 'accepted' && !memberIds.has(c.user_id));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.members(cid) });
    void qc.invalidateQueries({ queryKey: keys.conversations });
  };

  const saveGroup = useMutation({
    mutationFn: () => updateGroup(cid, title.trim(), description.trim()),
    onSuccess: () => { setMsg({ ok: true, text: 'Group details saved.' }); refresh(); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const addMembers = useMutation({
    mutationFn: () => addGroupMembers(cid, picked),
    onSuccess: (count) => {
      setMsg({ ok: true, text: `${count} ${count === 1 ? 'person' : 'people'} added.` });
      setPicked([]); setAdding(false); refresh();
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const role = useMutation({
    mutationFn: ({ id, admin }: { id: string; admin: boolean }) => setGroupMemberRole(cid, id, admin),
    onSuccess: () => { setMsg({ ok: true, text: 'Member role updated.' }); refresh(); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeGroupMember(cid, id),
    onSuccess: () => { setConfirm(null); setMsg({ ok: true, text: 'Member removed.' }); refresh(); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const leave = useMutation({
    mutationFn: () => leaveGroup(cid),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.conversations });
      onClose(); navigate('/app/chats');
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });
  const destroy = useMutation({
    mutationFn: () => deleteGroup(cid),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: keys.conversations });
      onClose(); navigate('/app/chats');
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  const uploadPhoto = async (file: File | null) => {
    if (!file || !supabase) return;
    setPhotoBusy(true); setMsg(null);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPEG, PNG or WebP image.');
      if (file.size > 2 * 1024 * 1024) throw new Error('Group photos must be under 2 MB.');
      const ext = file.type.split('/')[1];
      const path = `${cid}/photo-${Date.now()}.${ext}`;
      const up = await supabase.storage.from('group-photos').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      await setGroupPhoto(cid, path);
      if (conv.photo_path) await supabase.storage.from('group-photos').remove([conv.photo_path]).catch(() => {});
      setMsg({ ok: true, text: 'Group photo updated.' });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    if (!conv.photo_path || !supabase) return;
    setPhotoBusy(true);
    try {
      await setGroupPhoto(cid, null);
      await supabase.storage.from('group-photos').remove([conv.photo_path]).catch(() => {});
      setMsg({ ok: true, text: 'Group photo removed.' });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setPhotoBusy(false); }
  };

  const dirty = title.trim() !== (conv.title ?? '') || description.trim() !== (conv.description ?? '');

  return (
    <>
      <Dialog open onClose={onClose} title="Group information" size="lg" description="Details, members and roles are stored on the server. Admin actions are enforced by database policies.">
        <div className={styles.groupHead}>
          <Avatar name={conv.title ?? 'Group'} path={conv.photo_path} bucket="group-photos" size={72} />
          <div className={styles.groupHeadCopy}>
            <strong>{conv.title ?? 'Group'}</strong>
            <span>{conv.member_count} {conv.member_count === 1 ? 'member' : 'members'}</span>
            {isAdmin && (
              <div className={styles.photoActions}>
                <label className={styles.upload}>
                  <Camera size={14} aria-hidden /> {photoBusy ? 'Uploading…' : 'Change photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={photoBusy}
                    onChange={(e) => { void uploadPhoto(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                </label>
                {conv.photo_path && <Button variant="ghost" onClick={() => void removePhoto()} disabled={photoBusy}>Remove</Button>}
              </div>
            )}
          </div>
        </div>

        {msg && <p className={msg.ok ? styles.success : styles.error} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

        {isAdmin ? (
          <div className={styles.section}>
            <h3>Group details</h3>
            <div className={styles.groupFields}>
              <TextField label="Group name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
              <TextField label="Description" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className={styles.photoActions}>
              <Button onClick={() => saveGroup.mutate()} loading={saveGroup.isPending} disabled={!title.trim() || !dirty}>Save details</Button>
            </div>
          </div>
        ) : (
          <>
            {conv.description && <p className={styles.hint}>{conv.description}</p>}
            <p className={styles.hint}><ShieldCheck size={14} aria-hidden /> Only group admins can change details or manage members.</p>
          </>
        )}

        <div className={styles.section}>
          <div className={styles.groupLabel}>
            <h3>Members</h3>
            {isAdmin && <Button variant="secondary" onClick={() => setAdding((v) => !v)} disabled={available.length === 0}>
              <Plus size={15} aria-hidden /> Add people
            </Button>}
          </div>
          {adding && isAdmin && (
            <div className={styles.memberSearch}>
              {available.length === 0 ? <p className={styles.note}>All of your contacts are already in this group.</p> : (
                <ul className={styles.members}>
                  {available.map((c) => (
                    <li key={c.user_id}>
                      <label className={styles.checkRow} style={{ flex: 1 }}>
                        <input type="checkbox" checked={picked.includes(c.user_id)}
                          onChange={() => setPicked((cur) => (cur.includes(c.user_id) ? cur.filter((x) => x !== c.user_id) : [...cur, c.user_id]))} />
                        <Avatar name={c.display_name} path={c.avatar_path} size={36} />
                        <span className={styles.personCopy}><strong>{c.display_name}</strong><small>@{c.username}</small></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.footer}>
                <Button variant="secondary" onClick={() => { setAdding(false); setPicked([]); }}>Cancel</Button>
                <Button onClick={() => addMembers.mutate()} loading={addMembers.isPending} disabled={picked.length === 0}>
                  Add {picked.length || ''} {picked.length === 1 ? 'person' : 'people'}
                </Button>
              </div>
            </div>
          )}
          {members.isLoading && <p className={styles.note} role="status">Loading members…</p>}
          {members.isError && <p className={styles.error} role="alert">Could not load members.</p>}
          <ul className={styles.members}>
            {members.data?.map((m) => (
              <li key={m.user_id}>
                <Avatar name={m.display_name} path={m.avatar_path} size={38} />
                <span className={styles.memberCopy}>
                  <Link to={`/app/people/${m.user_id}`} onClick={onClose}>
                    <strong>{m.display_name}{m.user_id === uid ? ' (you)' : ''}</strong>
                    <small>@{m.username}</small>
                  </Link>
                  {m.role === 'admin' && <span className={styles.adminPill}><Crown size={10} aria-hidden /> Admin</span>}
                </span>
                {isAdmin && m.user_id !== uid && (
                  <span className={styles.memberActions}>
                    <Button variant="ghost" onClick={() => role.mutate({ id: m.user_id, admin: m.role !== 'admin' })} loading={role.isPending}>
                      {m.role === 'admin' ? 'Make member' : 'Make admin'}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirm({ kind: 'remove', member: m })} aria-label={`Remove ${m.display_name}`}>
                      <UserMinus size={15} aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.dangerZone}>
          <Button variant="secondary" onClick={() => setConfirm({ kind: 'leave' })}><LogOut size={15} aria-hidden /> Leave group</Button>
          {isAdmin && <Button variant="danger" onClick={() => setConfirm({ kind: 'delete' })}><Trash2 size={15} aria-hidden /> Delete group</Button>}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirm?.kind === 'remove'} onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.kind === 'remove' ? remove.mutate(confirm.member.user_id) : undefined}
        loading={remove.isPending} destructive title={`Remove ${confirm?.kind === 'remove' ? confirm.member.display_name : 'member'}?`} confirmLabel="Remove"
      >
        They will lose access to this group and its messages. They can be added again by an admin.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === 'leave'} onClose={() => setConfirm(null)}
        onConfirm={() => leave.mutate()} loading={leave.isPending} destructive title="Leave this group?" confirmLabel="Leave group"
      >
        You will stop receiving its messages. If you are an admin, another member will become admin automatically when needed.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === 'delete'} onClose={() => setConfirm(null)}
        onConfirm={() => destroy.mutate()} loading={destroy.isPending} destructive title="Delete this group for everyone?" confirmLabel="Delete group"
      >
        All messages, attachments, group calls and membership will be removed. This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
