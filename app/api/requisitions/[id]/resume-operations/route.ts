import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getResumeSourceType, MAX_RESUME_BATCH_SIZE, MAX_RESUME_SIZE } from '@/lib/resumeFiles';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';

export const runtime = 'nodejs';

type SubmittedItem = { id?: unknown; filename?: unknown; mimeType?: unknown; sizeBytes?: unknown };

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json() as { clientBatchKey?: unknown; items?: unknown };
    const clientBatchKey = typeof body.clientBatchKey === 'string' ? body.clientBatchKey.trim() : '';
    if (!clientBatchKey || clientBatchKey.length > 200 || !Array.isArray(body.items)
      || body.items.length < 1 || body.items.length > MAX_RESUME_BATCH_SIZE) {
      return NextResponse.json({ error: `Select between 1 and ${MAX_RESUME_BATCH_SIZE} resume files.` }, { status: 400 });
    }
    const items = (body.items as SubmittedItem[]).map((item) => {
      const id = typeof item.id === 'string' ? item.id : '';
      const filename = typeof item.filename === 'string' ? item.filename.trim() : '';
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : '';
      const sizeBytes = typeof item.sizeBytes === 'number' ? item.sizeBytes : 0;
      const sourceType = getResumeSourceType(filename, mimeType);
      if (!id || !filename || filename.length > 255 || !sourceType || sizeBytes < 1 || sizeBytes > MAX_RESUME_SIZE) {
        throw new Error('Resume batch contains invalid file metadata.');
      }
      return { id, filename, mime_type: sourceType.mimeType, size_bytes: sizeBytes, extension: sourceType.extension };
    });
    const { data, error } = await supabaseAdmin.rpc('create_phase1_resume_batch_operation', {
      p_requisition_id: params.id,
      p_client_batch_key: clientBatchKey,
      p_items: items
    });
    if (error) throw error;
    if (!data || typeof data !== 'object' || typeof data.id !== 'string' || !Array.isArray(data.items)) {
      throw new Error('Resume operation creation returned an invalid state.');
    }
    console.info('Resume operation created', {
      requisitionId: params.id,
      clientBatchKey,
      createdOperationId: data.id
    });
    return NextResponse.json({ operation: data }, { status: 201 });
  } catch (error) {
    console.error('Resume operation creation failed', { requisitionId: params.id, error: normalizeHiringCriteriaError(error) });
    return NextResponse.json({ error: normalizeHiringCriteriaError(error) }, { status: 400 });
  }
}
