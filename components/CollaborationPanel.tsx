'use client';

import { useEffect, useRef, useState } from 'react';

type CollabEvent = {
  id: string;
  event_type: 'shared' | 'viewed' | 'commented' | 'decision';
  comment: string | null;
  decision: string | null;
  actor_name: string | null;
  attachment_path: string | null;
  attachment_filename: string | null;
  created_at: string;
  profiles: { full_name: string; role: string } | null;
};

type Note = {
  id: string;
  body: string;
  updated_at: string;
  profiles: { full_name: string } | null;
};

const ICONS: Record<CollabEvent['event_type'], string> = {
  decision: '✓',
  commented: '💬',
  viewed: '👁',
  shared: '⤴'
};

function describeEvent(e: CollabEvent) {
  const actor = e.actor_name || e.profiles?.full_name || 'Someone';
  switch (e.event_type) {
    case 'decision':
      return `${actor} decided to ${e.decision}`;
    case 'commented':
      return `${actor} commented`;
    case 'viewed':
      return `${actor} viewed the Candidate Matrix`;
    case 'shared':
      return `${actor} shared this requisition`;
  }
}

// This component owns its own data now — notes and collaboration events
// are fetched here based on requisitionId / activeCandidateId, rather
// than pre-fetched by the parent page. That's what makes the General
// vs. per-candidate toggle possible without threading extra state
// through every parent component.
//
// There's no login system yet, so anyone with a share link has full
// Collaboration access automatically — no invite step. To keep comments
// distinguishable, each person sets their own display name once; it's
// remembered in their browser and sent along with every comment.
export function CollaborationPanel({
  collapsed,
  onExpand,
  onCollapse,
  requisitionId,
  requisitionTitle,
  activeCandidateId,
  activeCandidateName,
  collaboratorName,
  hideNotesTab = false
}: {
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  requisitionId: string;
  requisitionTitle: string;
  activeCandidateId: string | null;
  activeCandidateName: string | null;
  collaboratorName: string;
  hideNotesTab?: boolean;
}) {
  const [tab, setTab] = useState<'notes' | 'collaboration'>(hideNotesTab ? 'collaboration' : 'notes');
  const [viewMode, setViewMode] = useState<'candidate' | 'general'>(activeCandidateId ? 'candidate' : 'general');
  const [notes, setNotes] = useState<Note[]>([]);
  const [events, setEvents] = useState<CollabEvent[]>([]);
  const [draft, setDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // No candidate expanded → this is about the requisition, not a
  // leftover selection. Clear notes too, since they're candidate-only.
  useEffect(() => {
    if (activeCandidateId) {
      setViewMode('candidate');
    } else {
      setViewMode('general');
      setNotes([]);
    }
  }, [activeCandidateId]);

  useEffect(() => {
    if (!hideNotesTab && activeCandidateId) loadNotes();
  }, [activeCandidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadEvents();
  }, [requisitionId, activeCandidateId, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadNotes() {
    if (!activeCandidateId) return;
    const res = await fetch(`/api/notes?candidate_id=${activeCandidateId}`, { cache: 'no-store' });
    const data = await res.json();
    setNotes(data.notes ?? []);
  }

  async function loadEvents() {
    const url =
      viewMode === 'candidate' && activeCandidateId
        ? `/api/collaboration?requisition_id=${requisitionId}&candidate_id=${activeCandidateId}`
        : `/api/collaboration?requisition_id=${requisitionId}&scope=general`;
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    setEvents(data.events ?? []);
  }

  async function handleSaveNote() {
    if (!activeCandidateId || !draft.trim()) return;
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_id: activeCandidateId, body: draft })
    });
    setDraft('');
    loadNotes();
  }

  async function handlePostComment() {
    if (!commentDraft.trim() && !attachedFile) return;
    setPosting(true);
    try {
      const formData = new FormData();
      formData.append('requisition_id', requisitionId);
      if (viewMode === 'candidate' && activeCandidateId) formData.append('candidate_id', activeCandidateId);
      formData.append('actor_name', collaboratorName || '');
      formData.append('event_type', 'commented');
      formData.append('comment', commentDraft);
      if (attachedFile) formData.append('file', attachedFile);

      await fetch('/api/collaboration', { method: 'POST', body: formData });

      setCommentDraft('');
      setAttachedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadEvents();
    } finally {
      setPosting(false);
    }
  }

  async function handleDownloadAttachment(eventId: string) {
    setDownloadingId(eventId);
    try {
      const res = await fetch(`/api/collaboration/${eventId}/attachment-url`);
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank');
    } finally {
      setDownloadingId(null);
    }
  }

  if (collapsed) {
    return (
      <div className="pull-tab" style={{ display: 'block' }} onClick={onExpand}>
        Collaboration
      </div>
    );
  }

  return (
    <div className="side-panel">
      <button className="panel-collapse-btn" onClick={onCollapse}>
        ›
      </button>
      <div className="side-tabs">
        {!hideNotesTab && (
          <button className={`side-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
            Private Notes
          </button>
        )}
        <button
          className={`side-tab ${tab === 'collaboration' ? 'active' : ''}`}
          onClick={() => setTab('collaboration')}
        >
          Collaboration
        </button>
      </div>

      {tab === 'notes' && !hideNotesTab ? (
        <div className="side-content">
          {activeCandidateId ? (
            <>
              <div className="note-target">
                On <strong>{activeCandidateName ?? 'this candidate'}</strong>
              </div>
              <textarea
                className="note-input"
                placeholder="Only you can see this..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={handleSaveNote}
              />
              <div className="save-hint">Saved when you click away</div>
            </>
          ) : (
            <div className="note-target">Expand a candidate to add a note</div>
          )}
          {notes.map((n) => (
            <div className="note-entry" key={n.id}>
              <div className="note-entry-meta">
                {n.profiles?.full_name ?? 'You'} · {new Date(n.updated_at).toLocaleDateString()}
              </div>
              <div className="note-entry-text">{n.body}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="side-content">
          <div className="filter-row" style={{ marginBottom: 14 }}>
            <span
              className={`filter-chip ${viewMode === 'general' ? 'active' : ''}`}
              onClick={() => setViewMode('general')}
            >
              {requisitionTitle || 'General'}
            </span>
            {activeCandidateId && (
              <span
                className={`filter-chip ${viewMode === 'candidate' ? 'active' : ''}`}
                onClick={() => setViewMode('candidate')}
              >
                {activeCandidateName ?? 'Candidate'}
              </span>
            )}
          </div>

          <div className="comment-compose">
            <textarea
              className="note-input"
              placeholder={
                viewMode === 'general'
                  ? `Comment on ${requisitionTitle || 'the requisition'} as a whole... (Enter to post)`
                  : `Comment on ${activeCandidateName ?? 'this candidate'}... (Enter to post)`
              }
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handlePostComment();
                }
              }}
              disabled={posting}
            />
            <div className="comment-compose-footer">
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => setAttachedFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="attach-btn"
                title="Attach a document"
                onClick={() => fileInputRef.current?.click()}
              >
                📎
              </button>
              {attachedFile && (
                <span className="attach-pending">
                  {attachedFile.name}
                  <button
                    type="button"
                    className="attach-remove"
                    onClick={() => {
                      setAttachedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>
          </div>

          {events.map((e) => (
            <div className="hist-entry" key={e.id}>
              <div className={`hist-icon ${e.event_type === 'decision' ? 'decision' : ''}`}>
                {ICONS[e.event_type]}
              </div>
              <div className="hist-body">
                <div className="hist-line">{describeEvent(e)}</div>
                {e.comment && <div className="hist-comment">{e.comment}</div>}
                {e.attachment_path && (
                  <button
                    className="hist-attachment"
                    disabled={downloadingId === e.id}
                    onClick={() => handleDownloadAttachment(e.id)}
                  >
                    📎 {downloadingId === e.id ? 'Preparing…' : e.attachment_filename ?? 'Attachment'}
                  </button>
                )}
                <div className="hist-time">{new Date(e.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
