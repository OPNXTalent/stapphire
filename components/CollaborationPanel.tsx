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
  decision: '\u2713',
  commented: '\ud83d\udcac',
  viewed: '\ud83d\udc41',
  shared: '\u2934'
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
  activeCandidateId,
  notes,
  events,
  hasUnread,
  onSaveNote,
  onInvite
}: {
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  activeCandidateId: string | null;
  notes: Note[];
  events: CollabEvent[];
  hasUnread: boolean;
  onSaveNote: (body: string) => void;
  onInvite: (email: string) => void;
}) {
  const [tab, setTab] = useState<'notes' | 'collaboration'>('notes');
  const [draft, setDraft] = useState('');
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
        \u203a
      </button>
      <div className="side-tabs">
        <button className={`side-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
          Private Notes
        </button>
        <button
          className={`side-tab ${tab === 'collaboration' ? 'active' : ''}`}
          onClick={() => setTab('collaboration')}
        >
          Collaboration
          {hasUnread && <span className="tab-dot" />}
        </button>
      </div>

      {tab === 'notes' ? (
        <div className="side-content">
          {activeCandidateId ? (
            <>
              <textarea
                className="note-input"
                placeholder="Only you can see this..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => draft.trim() && onSaveNote(draft)}
              />
              <div className="save-hint">Saved automatically</div>
            </>
          ) : (
            <div className="note-target">Select a candidate to add a note</div>
          )}
          {notes.map((n) => (
            <div className="note-entry" key={n.id}>
              <div className="note-entry-meta">
                {n.profiles?.full_name ?? 'You'} \u00b7 {new Date(n.updated_at).toLocaleDateString()}
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
