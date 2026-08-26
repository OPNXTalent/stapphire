'use client';

import { useEffect, useState, type FormEvent } from 'react';

type Note = { id: string; author_name: string; body: string; created_at: string };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RequisitionNotes({ requisitionId }: { requisitionId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/requisitions/${requisitionId}/notes`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setNotes(data.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [requisitionId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) return;

    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author_name: 'Team member', body: trimmedBody })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to post note.');
      setNotes((prev) => [...(prev ?? []), data.note]);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to post note.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="requisition-notes">
      <div className="requisition-notes-feed">
        {notes === null && <p className="muted">Loading…</p>}
        {notes !== null && notes.length === 0 && (
          <p className="muted">No notes yet. Leave one for the hiring team below.</p>
        )}
        {notes?.map((note) => (
          <div className="requisition-note" key={note.id}>
            <div className="requisition-note-head">
              <span className="requisition-note-author">{note.author_name}</span>
              <span className="requisition-note-time">{timeAgo(note.created_at)}</span>
            </div>
            <p className="requisition-note-body">{note.body}</p>
          </div>
        ))}
      </div>

      <form className="requisition-notes-form" onSubmit={submit}>
        <textarea
          placeholder="Leave a note for the hiring team…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={3}
          required
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={posting}>
          {posting ? 'Posting…' : 'Post note'}
        </button>
      </form>
    </div>
  );
}
