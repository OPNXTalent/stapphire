'use client';

import { useEffect, useRef, useState } from 'react';

const DEMO_ORG_ID = process.env.NEXT_PUBLIC_DEMO_ORG_ID ?? '';

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
    <div style={{ width: '100%', maxWidth: 640, margin: '0 auto', padding: '48px 24px 60px' }}>
      <div className="matrix-role-pane" style={{ border: 'none', padding: 0, marginBottom: 20 }}>
        <input
          type="text"
          className="new-req-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled Requisition"
          autoFocus
        />
      </div>

      <div className="section-label">Job Description</div>
      <div className="prompt-box">
        <textarea
          className="prompt-input"
          style={{ minHeight: 140 }}
          placeholder="+ Paste, type, dictate, or attach the job description..."
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
        <div className="risk-note flagged" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}

      <div className="upload-hint" style={{ marginTop: 10 }}>
        Enter to create, Shift+Enter for a new line{voiceSupported ? ', 🎤 to dictate' : ''}
      </div>

      {onCancel && (
        <button className="qa-btn-text" style={{ marginTop: 14 }} onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
