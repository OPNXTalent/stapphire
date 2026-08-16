import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getResumeSourceType, MAX_RESUME_SIZE } from '@/lib/resumeFiles';
import { operationQueue } from '@/lib/operationQueue';
import { normalizeHiringCriteriaError } from '@/lib/hiringCriteriaError';

export const runtime = 'nodejs';
const RESUME_BUCKET = 'candidate-resumes';

export async function POST(request: Request, { params }: { params: { operationId: string; itemId: string } }) {
  let storagePath: string | null = null;
  let storageAccepted = false;
  let itemAccepted = false;
  try {
    const { data: item, error: itemError } = await supabaseAdmin
      .from('phase1_operation_items')
      .select('id,operation_id,status,input_ref')
      .eq('id', params.itemId)
      .eq('operation_id', params.operationId)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: 'Resume operation item not found.' }, { status: 404 });
    if (['queued', 'processing', 'completed'].includes(item.status)) return NextResponse.json({ accepted: true, itemId: item.id });
    if (item.status !== 'uploading') return NextResponse.json({ error: 'Resume operation item cannot accept an upload.' }, { status: 409 });
    console.info('Resume upload item started', { operationId: params.operationId, operationItemId: params.itemId });

    const inputRef = item.input_ref as Record<string, unknown>;
    storagePath = typeof inputRef.storagePath === 'string' ? inputRef.storagePath : null;
    const expectedFilename = typeof inputRef.originalFilename === 'string' ? inputRef.originalFilename : '';
    const expectedSize = typeof inputRef.sizeBytes === 'number' ? inputRef.sizeBytes : 0;
    const expectedMime = typeof inputRef.mimeType === 'string' ? inputRef.mimeType : '';
    if (!storagePath || !expectedFilename || !expectedMime) throw new Error('Resume upload metadata is invalid.');

    const form = await request.formData();
    const file = form.get('resume');
    if (!(file instanceof File) || file.size < 1) throw new Error('A resume file is required.');
    if (file.size > MAX_RESUME_SIZE || file.size !== expectedSize || file.name !== expectedFilename) throw new Error('Resume upload does not match its operation item.');
    const sourceType = getResumeSourceType(file.name, file.type);
    if (!sourceType || sourceType.mimeType !== expectedMime) throw new Error('Resume must be a PDF, DOCX, or TXT file.');
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const { error: storageError } = await supabaseAdmin.storage.from(RESUME_BUCKET).upload(storagePath, buffer, {
      contentType: sourceType.mimeType,
      upsert: false
    });
    if (storageError) throw new Error('Unable to preserve the original resume file.');
    storageAccepted = true;
    console.info('Resume upload item stored', { operationId: params.operationId, operationItemId: params.itemId });

    const { error: uploadedError } = await supabaseAdmin.rpc('mark_phase1_resume_item_uploaded', {
      p_operation_id: params.operationId,
      p_item_id: params.itemId,
      p_content_hash: contentHash
    });
    if (uploadedError) throw uploadedError;
    itemAccepted = true;
    console.info('Resume upload item queued', { operationId: params.operationId, operationItemId: params.itemId });
    try {
      await operationQueue.enqueueResumeEvaluation({ operationItemId: params.itemId });
      console.info('Resume upload item published', { operationId: params.operationId, operationItemId: params.itemId });
    } catch (dispatchError) {
      await supabaseAdmin.rpc('fail_phase1_resume_item_dispatch', {
        p_item_id: params.itemId,
        p_error: normalizeHiringCriteriaError(dispatchError)
      });
      throw dispatchError;
    }
    return NextResponse.json({ accepted: true, itemId: params.itemId }, { status: 202 });
  } catch (error) {
    const message = normalizeHiringCriteriaError(error);
    if (storageAccepted && !itemAccepted && storagePath) {
      const { error: cleanupError } = await supabaseAdmin.storage.from(RESUME_BUCKET).remove([storagePath]);
      if (cleanupError) console.error('Orphaned resume upload cleanup failed', { operationItemId: params.itemId, error: normalizeHiringCriteriaError(cleanupError) });
    }
    if (!itemAccepted) {
      await supabaseAdmin.rpc('fail_phase1_resume_item_upload', {
        p_operation_id: params.operationId,
        p_item_id: params.itemId,
        p_error: message
      });
    }
    console.error('Resume upload failed', { operationId: params.operationId, operationItemId: params.itemId, error: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
