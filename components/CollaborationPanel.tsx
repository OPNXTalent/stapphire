'use client';

import { useState } from 'react';

type CollabEvent = {
  id: string;
  event_type: 'shared' | 'viewed' | 'commented' | 'decision';
  comment: string | null;
  decision: string | null;
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
  const actor = e.profiles?.full_name ?? 'Someone';
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

export function CollaborationPanel({
  collapsed,
  onExpand,
  onCollapse,
  tab,
  onTabChange,
  activeCandidateId,
  activeCandidateName,
  notes,
  events,
  hasUnread,
  onSaveNote,
  onComment,
  onInvite,
  hideNotesTab = false
}: {
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  tab: 'notes' | 'collaboration';
  onTabChange: (tab: 'notes' | 'collaboration') => void;
  activeCandidateId: string | null;
  activeCandidateName: string | null;
  notes: Note[];
  events: CollabEvent[];
  hasUnread: boolean;
  onSaveNote: (body: string) => void;
  onComment: (body: string) => void;
  onInvite: (email: string) => void;
  hideNotesTab?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [email, setEmail] = useState('');

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
          <button className={`side-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => onTabChange('notes')}>
            Private Notes
          </button>
        )}
        <button
          className={`side-tab ${tab === 'collaboration' ? 'active' : ''}`}
          onClick={() => onTabChange('collaboration')}
        >
          Collaboration
          {hasUnread && <span className="tab-dot" />}
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
                onBlur={() => {
                  if (draft.trim()) {
                    onSaveNote(draft);
                    setDraft('');
                  }
                }}
              />
              <div className="save-hint">Saved when you click away</div>
            </>
          ) : (
            <div className="note-target">Select a candidate to add a note</div>
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
          <div className="invite-row">
            <input
              type="text"
              placeholder="Add hiring manager by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className="invite-btn"
              onClick={() => {
                if (email.trim()) {
                  onInvite(email.trim());
                  setEmail('');
                }
              }}
            >
              Invite
            </button>
          </div>

          {activeCandidateId ? (
            <>
              <div className="note-target">
                Comment on <strong>{activeCandidateName ?? 'this candidate'}</strong>
              </div>
              <textarea
                className="note-input"
                placeholder="Visible to everyone with access to this requisition..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
              />
              <button
                className="invite-btn"
                style={{ marginBottom: 14 }}
                disabled={!commentDraft.trim()}
                onClick={() => {
                  if (commentDraft.trim()) {
                    onComment(commentDraft);
                    setCommentDraft('');
                  }
                }}
              >
                Post comment
              </button>
            </>
          ) : (
            <div className="note-target">Select a candidate to see or leave collaboration history</div>
          )}

          {events.map((e) => (
            <div className="hist-entry" key={e.id}>
              <div className={`hist-icon ${e.event_type === 'decision' ? 'decision' : ''}`}>
                {ICONS[e.event_type]}
              </div>
              <div className="hist-body">
                <div className="hist-line">{describeEvent(e)}</div>
                {e.comment && <div className="hist-comment">{e.comment}</div>}
                <div className="hist-time">{new Date(e.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
