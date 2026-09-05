'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getResumeSourceType } from '@/lib/resumeFiles';
import { addDismissedResumeOperationId, loadDismissedResumeOperationIds } from '@/lib/resumeOperationDismissals';

type LocalUploadItem = { id: string; filename: string; status: 'pending' | 'uploading' | 'accepted' | 'error'; error?: string };
export type LocalUploadBatch = {
  clientBatchKey: string;
  requisitionId: string;
  operationId: string | null;
  phase: 'creating' | 'uploading' | 'accepted' | 'error';
  items: LocalUploadItem[];
  error?: string;
};
type UploadManagerValue = {
  batches: LocalUploadBatch[];
  startUpload(requisitionId: string, files: File[]): Promise<void>;
  dismissBatch(clientBatchKey: string): void;
  dismissBatchItem(clientBatchKey: string, itemId: string): void;
  dismissedOperationIds: ReadonlySet<string>;
  dismissOperation(operationId: string): void;
};

const ResumeUploadManagerContext = createContext<UploadManagerValue | null>(null);
const UPLOAD_CONCURRENCY = 3;

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ResumeUploadManagerProvider({ children }: { children: ReactNode }) {
  const [batches, setBatches] = useState<LocalUploadBatch[]>([]);
  const [dismissedOperationIds, setDismissedOperationIds] = useState<Set<string>>(() =>
    loadDismissedResumeOperationIds(browserStorage())
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') console.debug('Resume upload manager mounted');
    return () => {
      if (process.env.NODE_ENV !== 'production') console.debug('Resume upload manager unmounted');
    };
  }, []);

  async function startUpload(requisitionId: string, files: File[]) {
    const clientBatchKey = crypto.randomUUID();
    const descriptors = files.map((file) => ({ id: crypto.randomUUID(), file }));
    setBatches((current) => [...current, {
      clientBatchKey, requisitionId, operationId: null, phase: 'creating',
      items: descriptors.map(({ id, file }) => ({ id, filename: file.name, status: 'pending' }))
    }]);
    if (process.env.NODE_ENV !== 'production') {
      console.debug('Resume upload batch retained by shell manager', {
        clientBatchKey,
        requisitionId,
        operationItemIds: descriptors.map((descriptor) => descriptor.id)
      });
    }
    try {
      const response = await fetch(`/api/requisitions/${requisitionId}/resume-operations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientBatchKey,
          items: descriptors.map(({ id, file }) => ({ id, filename: file.name, mimeType: file.type, sizeBytes: file.size }))
        })
      });
      const result = await response.json() as { operation?: { id?: unknown }; error?: string };
      if (!response.ok || !result.operation || typeof result.operation.id !== 'string') throw new Error(result.error || 'Unable to create resume operation.');
      const operationId = result.operation.id;
      setBatches((current) => current.map((batch) => batch.clientBatchKey === clientBatchKey ? { ...batch, operationId, phase: 'uploading' } : batch));

      let cursor = 0;
      async function uploadNext() {
        while (cursor < descriptors.length) {
          const descriptor = descriptors[cursor++];
          setBatches((current) => current.map((batch) => batch.clientBatchKey === clientBatchKey
            ? { ...batch, items: batch.items.map((item) => item.id === descriptor.id ? { ...item, status: 'uploading' } : item) } : batch));
          try {
            if (process.env.NODE_ENV !== 'production') {
              console.debug('Resume upload item started', { clientBatchKey, operationId, operationItemId: descriptor.id });
            }
            if (!getResumeSourceType(descriptor.file.name, descriptor.file.type)) throw new Error('Resume must be a PDF, DOCX, or TXT file.');
            const form = new FormData();
            form.append('resume', descriptor.file);
            const uploadResponse = await fetch(`/api/operations/${operationId}/items/${descriptor.id}/upload`, { method: 'POST', body: form });
            const uploadResult = await uploadResponse.json() as { error?: string };
            if (!uploadResponse.ok) throw new Error(uploadResult.error || 'Resume upload failed.');
            if (process.env.NODE_ENV !== 'production') {
              console.debug('Resume upload item accepted', { clientBatchKey, operationId, operationItemId: descriptor.id });
            }
            setBatches((current) => current.map((batch) => batch.clientBatchKey === clientBatchKey
              ? { ...batch, items: batch.items.map((item) => item.id === descriptor.id ? { ...item, status: 'accepted' } : item) } : batch));
          } catch (error) {
            setBatches((current) => current.map((batch) => batch.clientBatchKey === clientBatchKey
              ? { ...batch, items: batch.items.map((item) => item.id === descriptor.id
                ? { ...item, status: 'error', error: error instanceof Error ? error.message : 'Resume upload failed.' } : item) } : batch));
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, descriptors.length) }, () => uploadNext()));
      setBatches((current) => current.map((batch) => batch.clientBatchKey === clientBatchKey ? { ...batch, phase: 'accepted' } : batch));
    } catch (error) {
      setBatches((current) => current.map((batch) => batch.clientBatchKey === clientBatchKey
        ? { ...batch, phase: 'error', error: error instanceof Error ? error.message : 'Unable to start resume uploads.' } : batch));
    }
  }

  const value = useMemo<UploadManagerValue>(() => ({
    batches,
    startUpload,
    dismissBatch: (clientBatchKey) => setBatches((current) => current.filter((batch) => batch.clientBatchKey !== clientBatchKey)),
    dismissBatchItem: (clientBatchKey, itemId) => setBatches((current) => current.flatMap((batch) => {
      if (batch.clientBatchKey !== clientBatchKey) return [batch];
      const items = batch.items.filter((item) => item.id !== itemId);
      const stillNeedsAttention = batch.phase === 'error'
        ? items.length > 0
        : items.some((item) => item.status === 'error');
      return stillNeedsAttention ? [{ ...batch, items }] : [];
    })),
    dismissedOperationIds,
    dismissOperation: (operationId) => setDismissedOperationIds((current) =>
      addDismissedResumeOperationId(current, operationId, browserStorage())
    )
  }), [batches, dismissedOperationIds]);
  return <ResumeUploadManagerContext.Provider value={value}>{children}</ResumeUploadManagerContext.Provider>;
}

export function useResumeUploadManager(): UploadManagerValue {
  const value = useContext(ResumeUploadManagerContext);
  if (!value) throw new Error('Resume upload manager is unavailable.');
  return value;
}
