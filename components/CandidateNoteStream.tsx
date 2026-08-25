'use client';

import { useEffect, useState, type FormEvent } from 'react';
import styles from './CandidateNoteStream.module.css';

type Note = { id: string; author_name: string; body: string; created_at: string };

function timestamp(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(iso));
}

export function CandidateNoteStream({
  candidateId,
  endpoint,
  emptyCopy,
  placeholder,
  privacyCopy,
  fill = false
}: {
  candidateId: string;
  endpoint: string;
  emptyCopy: string;
  placeholder: string;
  privacyCopy?: string;
  fill?: boolean;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    fetch(endpoint)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load notes.');
        return data;
      })
      .then((data) => {
        if (!cancelled) setNotes(data.notes ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setNotes([]);
          setError(err instanceof Error ? err.message : 'Unable to load notes.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId, endpoint]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) return;

    setPosting(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmedBody })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to post note.');
      setNotes((current) => [...(current ?? []), data.note]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post note.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className={`${styles.stream} ${fill ? styles.fill : ''}`}>
      {privacyCopy && <div className={styles.privacy}>{privacyCopy}</div>}
      <div className={styles.feed}>
        {notes === null && <p className={styles.empty}>Loading…</p>}
        {notes !== null && notes.length === 0 && <p className={styles.empty}>{emptyCopy}</p>}
        {notes?.map((note) => (
          <article className={styles.note} key={note.id}>
            <div className={styles.noteHead}>
              <strong>{note.author_name}</strong>
              <time dateTime={note.created_at}>{timestamp(note.created_at)}</time>
            </div>
            <p>{note.body}</p>
          </article>
        ))}
      </div>

      <form className={styles.form} onSubmit={submit}>
        <textarea
          placeholder={placeholder}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={4000}
          rows={3}
          required
        />
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="submit" disabled={posting}>{posting ? 'Posting…' : 'Post note'}</button>
      </form>
    </div>
  );
}
