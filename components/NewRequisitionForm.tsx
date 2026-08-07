'use client';

import { useEffect, useRef, useState } from 'react';

const DEMO_ORG_ID = process.env.NEXT_PUBLIC_DEMO_ORG_ID ?? '';

// Deliberately mirrors MatrixPanel's own structure — same "Candidate
// Matrix" header, same title-row + chevron pattern, same "Job Specific
// Fit Prompt" / "Job-Specific Fit Criteria" labels — so creating a new
// requisition looks and feels identical to editing an existing one,
// not like a separate, differently-styled form bolted on the side.
export function NewRequisitionForm({
  onCreated,
  onCancel
}: {
  onCreated: (requisitionId: string) => void;
  onCancel?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const [title, setTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setVoiceSupported(!!SpeechRecognition);
  }, []);

  const canSubmit = title.trim() && (jdText.trim() || jdFile);

  function toggleListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setJdText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    if (recognitionRef.current && listening) recognitionRef.current.stop();
    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('org_id', DEMO_ORG_ID);
      formData.append('title', title.trim());
      if (jdFile) {
        formData.append('file', jdFile);
      } else {
        formData.append('job_description', jdText.trim());
      }

      const res = await fetch('/api/requisitions', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong creating the requisition.');
        return;
      }

      onCreated(data.requisition.id);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong creating the requisition.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <div className="matrix-toggle open">
        <svg className="facet-icon" viewBox="0 0 24 24" fill="none">
          <polygon points="12,1 21,7 24,14 17,23 7,23 0,14 3,7" fill="var(--sapphire)" />
        </svg>
        <div className="matrix-toggle-label">Candidate Matrix</div>
        <div className="matrix-toggle-sub">Same rubric, every candidate — tap a name for the full picture</div>
      </div>

      <div className="new-req-pane">
        <div className="matrix-title-row" onClick={onCancel} style={{ cursor: onCancel ? 'pointer' : 'default' }}>
          <div className="new-req-title-row">
            <span className="matrix-title-chev">▾</span>
            <input
              type="text"
              className="new-req-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="Job Title Here..."
              autoFocus
            />
          </div>
        </div>

        <div className="section-label">Job Specific Fit Prompt</div>
        <div className="prompt-box" onClick={(e) => e.stopPropagation()}>
          <textarea
            className="prompt-input"
            placeholder="+ Paste, type, upload or simply tell me about your requisition..."
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            disabled={submitting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />

          {jdFile && (
            <div className="attach-pending" style={{ marginBottom: 8 }}>
              {jdFile.name}
              <button type="button" className="attach-remove" onClick={() => setJdFile(null)}>
                ✕
              </button>
            </div>
          )}

          <div className="composer-footer">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              style={{ display: 'none' }}
              onChange={(e) => setJdFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="composer-btn"
              title="Attach a document"
              onClick={() => fileInputRef.current?.click()}
            >
              +
            </button>
            <button
              type="button"
              className={`composer-btn ${listening ? 'composer-btn-active' : ''}`}
              title={voiceSupported ? 'Dictate' : 'Voice dictation not supported in this browser'}
              disabled={!voiceSupported}
              onClick={toggleListening}
            >
              🎤
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="composer-send"
              disabled={!canSubmit || submitting}
              onClick={handleSubmit}
              title="Create requisition"
            >
              {submitting ? '…' : '↑'}
            </button>
          </div>
        </div>

        {error && (
          <div className="risk-note flagged" style={{ marginTop: 14 }} onClick={(e) => e.stopPropagation()}>
            {error}
          </div>
        )}

        <div className="section-label">Job-Specific Fit Criteria</div>
      </div>
    </div>
  );
}
