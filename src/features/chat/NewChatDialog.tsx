import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Search, Users } from 'lucide-react';
import { Dialog } from '@/components/Dialog/Dialog';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import {
  createGroup, fetchContacts, keys, searchPeople, startDirectChat,
} from './api';
import styles from './ChatDialogs.module.css';

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'direct' | 'group'>('direct');
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const contacts = useQuery({ queryKey: keys.contacts, queryFn: fetchContacts });
  const people = useQuery({
    queryKey: keys.people(term.trim()), queryFn: () => searchPeople(term.trim()),
    enabled: term.trim().length >= 1,
  });
  const accepted = useMemo(() => (contacts.data ?? []).filter((c) => c.status === 'accepted'), [contacts.data]);

  const openDirect = useMutation({
    mutationFn: startDirectChat,
    onSuccess: async (cid) => {
      await qc.invalidateQueries({ queryKey: keys.conversations });
      onClose();
      navigate(`/app/chats/${cid}`);
    },
    onError: (e) => setError(e.message),
  });
  const makeGroup = useMutation({
    mutationFn: () => createGroup(title.trim(), description.trim(), selected),
    onSuccess: async (cid) => {
      await qc.invalidateQueries({ queryKey: keys.conversations });
      onClose();
      navigate(`/app/chats/${cid}`);
    },
    onError: (e) => setError(e.message),
  });

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const directRows = term.trim().length >= 1 ? people.data ?? [] : accepted;

  return (
    <Dialog open onClose={onClose} title="Start something new" description="Open a private conversation or bring people together in a group." size="md">
      <div className={styles.tabs} role="tablist" aria-label="New conversation type">
        <button role="tab" aria-selected={tab === 'direct'} onClick={() => { setTab('direct'); setError(null); }}>
          <MessageCircle size={16} aria-hidden /> New chat
        </button>
        <button role="tab" aria-selected={tab === 'group'} onClick={() => { setTab('group'); setError(null); }}>
          <Users size={16} aria-hidden /> New group
        </button>
      </div>

      {tab === 'direct' && (
        <div className={styles.panel}>
          <label className={styles.search}>
            <Search size={17} aria-hidden />
            <span className="sr-only">Search people by username or name</span>
            <input value={term} onChange={(e) => { setTerm(e.target.value); setError(null); }} placeholder="Search by username or name" autoCapitalize="none" />
          </label>
          {term.trim().length === 0 && <p className={styles.hint}>Your contacts appear here. Search to find anyone by username.</p>}
          {term.trim().length >= 1 && people.isLoading && <p className={styles.note} role="status">Searching people…</p>}
          {term.trim().length >= 1 && people.isError && <p className={styles.error} role="alert">Could not search people. Check your connection.</p>}
          {term.trim().length >= 1 && people.isSuccess && people.data.length === 0 && <p className={styles.note}>No one matches “{term.trim()}”.</p>}
          {contacts.isError && <p className={styles.error} role="alert">Could not load contacts.</p>}
          <ul className={styles.people} aria-label="People">
            {!term.trim() && contacts.isLoading && <li className={styles.note} role="status">Loading contacts…</li>}
            {!term.trim() && contacts.isSuccess && accepted.length === 0 && (
              <li className={styles.empty}>
                <strong>No contacts yet</strong>
                <p>Search for a username above to start a chat.</p>
              </li>
            )}
            {directRows.map((p) => {
              const isContact = 'user_id' in p;
              const id = isContact ? p.user_id : p.id;
              const username = p.username;
              const name = p.display_name;
              const avatar = p.avatar_path;
              return (
                <li key={id} className={styles.person}>
                  <Avatar name={name} path={avatar} size={40} />
                  <span className={styles.personCopy}><strong>{name}</strong><small>@{username}</small></span>
                  <Button variant="secondary" onClick={() => openDirect.mutate(username)} loading={openDirect.isPending}>
                    <MessageCircle size={15} aria-hidden /> Message
                  </Button>
                </li>
              );
            })}
          </ul>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      )}

      {tab === 'group' && (
        <div className={styles.panel}>
          <div className={styles.groupFields}>
            <TextField label="Group name" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend plans" />
            <TextField label="Description (optional)" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this group for?" />
          </div>
          <div className={styles.groupLabel}>
            <strong>Members</strong>
            <span>{selected.length} selected · up to 50 people</span>
          </div>
          {contacts.isLoading && <p className={styles.note} role="status">Loading contacts…</p>}
          {contacts.isSuccess && accepted.length === 0 && <p className={styles.note}>Add contacts from the People page before creating a group.</p>}
          <ul className={styles.people} aria-label="Choose group members">
            {accepted.map((c) => (
              <li key={c.user_id}>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={selected.includes(c.user_id)} onChange={() => toggle(c.user_id)} />
                  <Avatar name={c.display_name} path={c.avatar_path} size={38} />
                  <span className={styles.personCopy}><strong>{c.display_name}</strong><small>@{c.username}</small></span>
                </label>
              </li>
            ))}
          </ul>
          <p className={styles.hint}>Only accepted contacts can be added. You will be the group admin and can add more people later.</p>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => makeGroup.mutate()} loading={makeGroup.isPending} disabled={!title.trim() || selected.length === 0}>
              <Users size={16} aria-hidden /> Create group
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
