import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageCircle, Search, ShieldOff, UserMinus, UserPlus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import { isMissingSchemaObject } from '@/lib/errors';
import {
  fetchBlockedPeople, fetchContacts, keys, removeContact, respondContactRequest, searchPeople,
  sendContactRequest, startDirectChat, unblockUser, type ContactItem, type DirectoryPerson,
} from '@/features/chat/api';
import styles from './Contacts.module.css';

function useContactMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.contacts });
    void qc.invalidateQueries({ queryKey: keys.blocked });
    void qc.invalidateQueries({ queryKey: ['people'] });
    void qc.invalidateQueries({ queryKey: ['profile-card'] });
  };
  return refresh;
}

function ContactRow({ person, kind, onOpen }: { person: ContactItem | DirectoryPerson; kind: 'contact' | 'incoming' | 'sent' | 'search'; onOpen: () => void }) {
  const qc = useQueryClient();
  const refresh = useContactMutations();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const contact = 'contact_id' in person ? person : null;
  const requestId = 'contact_request_id' in person ? person.contact_request_id : null;

  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => respondContactRequest(id, accept),
    onSuccess: refresh, onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeContact(id),
    onSuccess: refresh, onError: (e) => setError(e.message),
  });
  const request = useMutation({
    mutationFn: () => sendContactRequest(person.username),
    onSuccess: refresh, onError: (e) => setError(e.message),
  });
  const message = useMutation({
    mutationFn: () => startDirectChat(person.username),
    onSuccess: async (cid) => {
      await qc.invalidateQueries({ queryKey: keys.conversations });
      navigate(`/app/chats/${cid}`);
    },
    onError: (e) => setError(e.message),
  });

  const displayName = person.display_name;
  const username = person.username;
  return (
    <li className={styles.person}>
      <button className={styles.personMain} onClick={onOpen}>
        <Avatar name={displayName} path={person.avatar_path} size={44} />
        <span className={styles.personCopy}>
          <strong>{displayName}</strong>
          <span>@{username}</span>
        </span>
      </button>
      <div className={styles.personActions}>
        {kind === 'incoming' && requestId && (
          <>
            <Button variant="primary" onClick={() => respond.mutate({ id: requestId, accept: true })} loading={respond.isPending}><Check size={15} aria-hidden /> Accept</Button>
            <Button variant="secondary" onClick={() => respond.mutate({ id: requestId, accept: false })} disabled={respond.isPending}><X size={15} aria-hidden /> Decline</Button>
          </>
        )}
        {kind === 'contact' && (
          <>
            <Button variant="secondary" onClick={() => message.mutate()} loading={message.isPending}><MessageCircle size={15} aria-hidden /> Message</Button>
            {contact && <Button variant="ghost" onClick={() => remove.mutate(contact.contact_id)} loading={remove.isPending} aria-label={`Remove ${displayName} from contacts`}><UserMinus size={15} aria-hidden /></Button>}
          </>
        )}
        {kind === 'sent' && (
          <Button variant="ghost" onClick={() => message.mutate()} loading={message.isPending}>
            <MessageCircle size={15} aria-hidden /> Message
          </Button>
        )}
        {kind === 'search' && (
          'is_contact' in person && person.is_contact
            ? <Button variant="secondary" onClick={() => message.mutate()} loading={message.isPending}><MessageCircle size={15} aria-hidden /> Message</Button>
            : requestId
              ? <span className={styles.sentLabel}>Request pending</span>
              : <Button variant="secondary" onClick={() => request.mutate()} loading={request.isPending}><UserPlus size={15} aria-hidden /> Add</Button>
        )}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </li>
  );
}

export function ContactsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const deferredTerm = useDeferredValue(term.trim());
  const contacts = useQuery({ queryKey: keys.contacts, queryFn: fetchContacts });
  const blocked = useQuery({ queryKey: keys.blocked, queryFn: fetchBlockedPeople });
  const people = useQuery({
    queryKey: keys.people(deferredTerm), queryFn: () => searchPeople(deferredTerm),
    enabled: deferredTerm.length >= 1,
  });
  const unblock = useMutation({
    mutationFn: unblockUser,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.blocked });
      void qc.invalidateQueries({ queryKey: ['people'] });
    },
  });

  const accepted = (contacts.data ?? []).filter((c) => c.status === 'accepted');
  const incoming = (contacts.data ?? []).filter((c) => c.status === 'pending' && !c.from_me);
  const sent = (contacts.data ?? []).filter((c) => c.status === 'pending' && c.from_me);
  const openProfile = (id: string) => navigate(`/app/people/${id}`);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>Your circle</h1>
          <p className={styles.lede}>Find people by username, accept invitations, and keep track of who can reach you.</p>
        </div>
        <Link to="/app/chats" className={styles.back}>Back to chats</Link>
      </header>

      <label className={styles.search}>
        <Search size={18} aria-hidden />
        <span className="sr-only">Find people</span>
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by username or name" autoCapitalize="none" />
      </label>

      {deferredTerm.length >= 1 && (
        <section className={styles.section} aria-labelledby="search-title">
          <h2 id="search-title">Search results</h2>
          {people.isLoading && <div className={styles.loading}><Skeleton height="3.5rem" /><Skeleton height="3.5rem" /></div>}
          {people.isError && <p className={styles.error} role="alert">Search failed. Check your connection.</p>}
          {people.isSuccess && people.data.length === 0 && <p className={styles.note}>No one matches “{deferredTerm}”.</p>}
          <ul className={styles.list}>
            {people.data?.map((p) => (
              <ContactRow key={p.id} person={p} kind="search" onOpen={() => openProfile(p.id)} />
            ))}
          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section className={styles.section} aria-labelledby="requests-title">
          <h2 id="requests-title">Contact requests <span className={styles.count}>{incoming.length}</span></h2>
          <ul className={styles.list}>
            {incoming.map((c) => <ContactRow key={c.contact_id} person={c} kind="incoming" onOpen={() => openProfile(c.user_id)} />)}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="contacts-title">
        <h2 id="contacts-title">Contacts <span className={styles.count}>{accepted.length}</span></h2>
        {contacts.isLoading && <div className={styles.loading}><Skeleton height="3.5rem" /><Skeleton height="3.5rem" /></div>}
        {contacts.isError && (
          <div className={styles.error} role="alert">
            <p>Could not load contacts. <button onClick={() => contacts.refetch()}>Retry</button></p>
            {isMissingSchemaObject(contacts.error) && (
              <p className={styles.hint}>The database schema is out of date. Apply migrations 0001 → 0006 in Supabase, then retry.</p>
            )}
          </div>
        )}
        {contacts.isSuccess && accepted.length === 0 && (
          <EmptyState variant="contacts" title="No contacts yet" compact>
            Search for someone by their username to send your first contact request.
          </EmptyState>
        )}
        <ul className={styles.list}>
          {accepted.map((c) => <ContactRow key={c.contact_id} person={c} kind="contact" onOpen={() => openProfile(c.user_id)} />)}
        </ul>
      </section>

      {sent.length > 0 && (
        <section className={styles.section} aria-labelledby="sent-title">
          <h2 id="sent-title">Sent requests <span className={styles.count}>{sent.length}</span></h2>
          <ul className={styles.list}>
            {sent.map((c) => <ContactRow key={c.contact_id} person={c} kind="sent" onOpen={() => openProfile(c.user_id)} />)}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-labelledby="blocked-title">
        <h2 id="blocked-title">Blocked people</h2>
        {blocked.isLoading && <p className={styles.note} role="status">Loading…</p>}
        {blocked.isError && (
          <p className={styles.error} role="alert">
            Could not load blocked people. <button onClick={() => blocked.refetch()}>Retry</button>
          </p>
        )}
        {blocked.isSuccess && blocked.data.length === 0 && <p className={styles.note}>You haven’t blocked anyone.</p>}
        <ul className={styles.list}>
          {blocked.data?.map((b) => (
            <li key={b.user_id} className={styles.person}>
              <button className={styles.personMain} onClick={() => openProfile(b.user_id)}>
                <Avatar name={b.display_name} path={b.avatar_path} size={44} />
                <span className={styles.personCopy}><strong>{b.display_name}</strong><span>@{b.username}</span></span>
              </button>
              <div className={styles.personActions}>
                <Button variant="secondary" onClick={() => unblock.mutate(b.user_id)} loading={unblock.isPending}><ShieldOff size={15} aria-hidden /> Unblock</Button>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.privacyNote}>Blocking stops direct messages and calls and is enforced by database policies. Group messages from a blocked person may still appear if you share a group.</p>
      </section>
    </section>
  );
}
