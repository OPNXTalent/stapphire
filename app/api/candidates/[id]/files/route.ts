import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const runtime = 'nodejs';
const FILE_BUCKET = 'candidate-files';
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function validFolderKey(value: string, sections: unknown): boolean {
  if (value === 'uploads') return true;
  if (!value.startsWith('custom-') || !Array.isArray(sections)) return false;
  return sections.some((section) => {
    const candidate = section as Record<string, unknown>;
    return candidate.key === value && candidate.system === false;
  });
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { data, error } = await supabaseAdmin
      .from('phase1_candidate_uploads')
      .select('id, folder_key, filename, mime_type, size_bytes, created_at')
      .eq('candidate_id', params.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ files: data ?? [] });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to load candidate uploads.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let storagePath: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get('file');
    const folderKey = String(form.get('folderKey') ?? 'uploads');
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_FILE_SIZE || file.name.length > 255) {
      return NextResponse.json({ error: 'Select a file up to 25 MB.' }, { status: 400 });
    }

    const [{ data: candidate, error: candidateError }, { data: layout, error: layoutError }] = await Promise.all([
      supabaseAdmin.from('phase1_candidates').select('id').eq('id', params.id).maybeSingle(),
      supabaseAdmin.from('phase1_candidate_file_layouts').select('sections').eq('candidate_id', params.id).maybeSingle()
    ]);
    if (candidateError) throw candidateError;
    if (layoutError) throw layoutError;
    if (!candidate) return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
    if (!validFolderKey(folderKey, layout?.sections)) {
      return NextResponse.json({ error: 'Upload destination is invalid.' }, { status: 400 });
    }

    const id = randomUUID();
    const extension = file.name.match(/(\.[A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() ?? '';
    storagePath = `${params.id}/uploads/${id}${extension}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'application/octet-stream';
    const { error: storageError } = await supabaseAdmin.storage.from(FILE_BUCKET).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });
    if (storageError) throw storageError;

    const { data, error } = await supabaseAdmin
      .from('phase1_candidate_uploads')
      .insert({
        id,
        candidate_id: params.id,
        folder_key: folderKey,
        filename: file.name,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: file.size
      })
      .select('id, folder_key, filename, mime_type, size_bytes, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ file: data }, { status: 201 });
  } catch (error) {
    if (storagePath) await supabaseAdmin.storage.from(FILE_BUCKET).remove([storagePath]);
    console.error(error);
    return NextResponse.json({ error: 'Unable to upload this candidate file.' }, { status: 500 });
  }
}
