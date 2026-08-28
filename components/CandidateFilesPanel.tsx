'use client';

import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { CandidateNoteStream } from '@/components/CandidateNoteStream';
import { CompletedInterviewActions } from '@/components/CompletedInterviewActions';
import type { CandidateFilesSelection } from '@/lib/candidateFilesEvents';
import styles from './CandidateFilesPanel.module.css';

type SubmittedInterview = {
  id: string;
  stage: string;
  status: 'submitted';
  roundTitle: string;
  participantName: string | null;
  submittedAt: string | null;
};

type CandidateUpload = {
  id: string;
  folder_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type UploadTask = { id: string; folderKey: string; filename: string; status: 'uploading' | 'error'; error?: string };

type FileSection = {
  key: string;
  name: string;
  system: boolean;
};

const DEFAULT_SECTIONS: FileSection[] = [
  { key: 'resume', name: 'Resume', system: true },
  { key: 'notes', name: 'Notes', system: true },
  { key: 'uploads', name: 'Uploads', system: true },
  { key: 'interviews', name: 'Interviews', system: true }
];

function submittedLabel(iso: string | null) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
}

export function CandidateFilesPanel({ candidate }: { candidate: CandidateFilesSelection }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [interviews, setInterviews] = useState<SubmittedInterview[] | null>(null);
  const [uploads, setUploads] = useState<CandidateUpload[]>([]);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [sections, setSections] = useState<FileSection[]>(DEFAULT_SECTIONS);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSections(DEFAULT_SECTIONS);
    fetch(`/api/candidates/${candidate.id}/file-layout`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load Candidate Files layout.');
        return data;
      })
      .then((data) => {
        if (!cancelled && Array.isArray(data.sections)) setSections(data.sections);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load saved Candidate Files layout.');
      });
    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  useEffect(() => {
    let cancelled = false;
    setUploads([]);
    fetch(`/api/candidates/${candidate.id}/files`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load candidate uploads.');
        return data;
      })
      .then((data) => {
        if (!cancelled) setUploads(Array.isArray(data.files) ? data.files : []);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load candidate uploads.');
      });
    return () => { cancelled = true; };
  }, [candidate.id]);

  useEffect(() => {
    let cancelled = false;
    setInterviews(null);
    fetch(`/api/candidates/${candidate.id}/interview-invitations`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load interviews.');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const submitted = (data.invitations ?? [])
          .filter((item: { status?: string }) => item.status === 'submitted')
          .map((item: SubmittedInterview) => item);
        setInterviews(submitted);
      })
      .catch(() => {
        if (!cancelled) setInterviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [candidate.id]);

  async function persistSections(next: FileSection[]) {
    if (layoutSaving) return false;
    const previous = sections;
    setSections(next);
    setLayoutSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/file-layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: next })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save Candidate Files layout.');
      return true;
    } catch (err) {
      setSections(previous);
      setError(err instanceof Error ? err.message : 'Unable to save Candidate Files layout.');
      return false;
    } finally {
      setLayoutSaving(false);
    }
  }

  async function downloadResume() {
    if (!candidate.resumeAvailable || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const response = await fetch(`/api/candidates/${candidate.id}/resume`);
      if (!response.ok) throw new Error('Unable to download resume.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = candidate.sourceFilename || 'resume';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Unable to download resume.');
    } finally {
      setDownloading(false);
    }
  }

  async function moveSection(sourceKey: string, targetKey: string) {
    if (sourceKey === targetKey || layoutSaving) return;
    const from = sections.findIndex((section) => section.key === sourceKey);
    const to = sections.findIndex((section) => section.key === targetKey);
    if (from < 0 || to < 0) return;

    const next = [...sections];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    await persistSections(next);
  }

  function startDrag(event: DragEvent<HTMLSpanElement>, key: string) {
    if (layoutSaving) {
      event.preventDefault();
      return;
    }
    setDraggedKey(key);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  }

  function dropOn(event: DragEvent<HTMLDivElement>, targetKey: string) {
    event.preventDefault();
    const sourceKey = draggedKey || event.dataTransfer.getData('text/plain');
    setDraggedKey(null);
    if (sourceKey) void moveSection(sourceKey, targetKey);
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name || name.length > 80 || layoutSaving) return;
    const key = `custom-${crypto.randomUUID()}`;
    const saved = await persistSections([...sections, { key, name, system: false }]);
    if (saved) {
      setNewFolderName('');
      setNewFolderOpen(false);
    }
  }

  async function deleteFolder(section: FileSection) {
    if (section.system || layoutSaving) return;
    if (uploads.some((file) => file.folder_key === section.key)) {
      setError('Move or delete this folder’s uploaded files before deleting the folder.');
      return;
    }
    if (!window.confirm(`Delete the “${section.name}” folder?`)) return;
    await persistSections(sections.filter((item) => item.key !== section.key));
  }

  async function uploadFiles(folderKey: string, selected: FileList | null) {
    if (!selected?.length) return;
    const tasks = Array.from(selected).map((file) => ({
      id: crypto.randomUUID(),
      folderKey,
      filename: file.name,
      status: 'uploading' as const,
      file
    }));
    setUploadTasks((current) => [...current, ...tasks.map(({ file: _file, ...task }) => task)]);
    await Promise.all(tasks.map(async (task) => {
      try {
        const form = new FormData();
        form.append('file', task.file);
        form.append('folderKey', folderKey);
        const response = await fetch(`/api/candidates/${candidate.id}/files`, { method: 'POST', body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Upload failed.');
        setUploads((current) => [data.file as CandidateUpload, ...current]);
        setUploadTasks((current) => current.filter((item) => item.id !== task.id));
      } catch (uploadError) {
        setUploadTasks((current) => current.map((item) => item.id === task.id
          ? { ...item, status: 'error', error: uploadError instanceof Error ? uploadError.message : 'Upload failed.' }
          : item));
      }
    }));
  }

  async function deleteUpload(file: CandidateUpload) {
    if (!window.confirm(`Delete “${file.filename}”?`)) return;
    const response = await fetch(`/api/candidates/${candidate.id}/files/${file.id}`, { method: 'DELETE' });
    if (response.ok) {
      setUploads((current) => current.filter((item) => item.id !== file.id));
    } else {
      const data = await response.json();
      setError(data.error || 'Unable to delete this candidate file.');
    }
  }

  function uploadedFiles(section: FileSection) {
    const files = uploads.filter((file) => file.folder_key === section.key);
    const tasks = uploadTasks.filter((task) => task.folderKey === section.key);
    return (
      <div className={styles.uploadFolder}>
        <label className={styles.uploadButton}>
          Upload files
          <input type="file" multiple hidden onChange={(event) => { void uploadFiles(section.key, event.target.files); event.target.value = ''; }} />
        </label>
        {tasks.map((task) => (
          <div className={styles.uploadTask} key={task.id}>
            <span>{task.filename}</span>
            <strong>{task.status === 'uploading' ? 'Uploading…' : task.error || 'Upload failed'}</strong>
          </div>
        ))}
        {files.map((file) => (
          <div className={styles.uploadedFile} key={file.id}>
            <a href={`/api/candidates/${candidate.id}/files/${file.id}`}>{file.filename}</a>
            <button type="button" onClick={() => void deleteUpload(file)}>Delete</button>
          </div>
        ))}
        {files.length === 0 && tasks.length === 0 && <p className={styles.empty}>No files in this folder yet.</p>}
      </div>
    );
  }

  function sectionBody(section: FileSection) {
    if (section.key === 'resume') {
      return candidate.resumeAvailable ? (
        <button type="button" className={styles.fileRow} onClick={downloadResume} disabled={downloading}>
          <span className={styles.fileName}>{candidate.sourceFilename || 'Resume'}</span>
          <span className={styles.fileAction}>{downloading ? 'Downloading…' : 'Download'}</span>
        </button>
      ) : <p className={styles.empty}>Resume unavailable.</p>;
    }

    if (section.key === 'notes') {
      return (
        <CandidateNoteStream
          candidateId={candidate.id}
          endpoint={`/api/candidates/${candidate.id}/private-notes`}
          emptyCopy="No private recruiter notes yet."
          placeholder="Add a private recruiter note…"
          privacyCopy="Recruiter-only notes. These are separate from Teamwork and are not shown to Hiring Leaders."
        />
      );
    }

    if (section.key === 'uploads') {
      return uploadedFiles(section);
    }

    if (section.key === 'interviews') {
      return (
        <>
          {interviews === null && <p className={styles.empty}>Loading interviews…</p>}
          {interviews !== null && interviews.length === 0 && <p className={styles.empty}>No completed interview assessments yet.</p>}
          {interviews?.map((interview) => {
            const href = `/candidates/${candidate.id}/interviews/${interview.id}`;
            const isCurrent = interview.id === candidate.focusInterviewId;
            return (
              <div key={interview.id} className={`${styles.interviewRow} ${isCurrent ? styles.interviewRowActive : ''}`}>
                <a className={styles.interviewView} href={href} aria-current={isCurrent ? 'true' : undefined}>
                  <span className={styles.interviewInfo}>
                    <span className={styles.fileName}>{interview.roundTitle || 'Interview'}</span>
                    <span className={styles.fileMeta}>
                      {[`Submitted · ${interview.stage}`, interview.participantName || 'Interview participant', submittedLabel(interview.submittedAt)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={styles.fileAction}>View</span>
                </a>
                <CompletedInterviewActions href={href} compact />
              </div>
            );
          })}
        </>
      );
    }

    return (
      <div className={styles.customFolderBody}>
        {uploadedFiles(section)}
        <button type="button" className={styles.deleteFolder} onClick={() => void deleteFolder(section)} disabled={layoutSaving}>
          Delete folder
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Candidate files</span>
        <div className={styles.headerRow}>
          <h2>{candidate.name}</h2>
          <button type="button" className={styles.newFolderButton} onClick={() => setNewFolderOpen((current) => !current)}>
            + New Folder
          </button>
        </div>
        {newFolderOpen && (
          <form className={styles.newFolderForm} onSubmit={createFolder}>
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="Folder name"
              maxLength={80}
              required
            />
            <button type="submit" disabled={layoutSaving || !newFolderName.trim()}>Create</button>
            <button type="button" onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}>Cancel</button>
          </form>
        )}
      </div>

      <div className={styles.folders} aria-busy={layoutSaving}>
        {sections.map((section) => (
          <div
            key={section.key}
            className={`${styles.folderShell} ${draggedKey === section.key ? styles.dragging : ''}`}
            onDragOver={(event) => {
              if (draggedKey && draggedKey !== section.key) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(event) => dropOn(event, section.key)}
          >
            <details className={styles.folder} open={section.key === 'interviews' && Boolean(candidate.focusInterviewId)}>
              <summary>{section.name}</summary>
              <div className={styles.folderBody}>{sectionBody(section)}</div>
            </details>
            <div className={styles.folderControls} aria-label={`${section.name} folder controls`}>
              <span
                className={styles.dragHandle}
                draggable={!layoutSaving}
                onDragStart={(event) => startDrag(event, section.key)}
                onDragEnd={() => setDraggedKey(null)}
                title="Drag to reorder"
                aria-hidden="true"
              >⋮⋮</span>
            </div>
          </div>
        ))}
      </div>

      {layoutSaving && <p className={styles.saving} role="status">Saving folder order…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
