import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const FILE_BUCKET = 'candidate-files';

async function findFile(candidateId: string, fileId: string) {
  const { data, error } = await supabaseAdmin
    .from('phase1_candidate_uploads')
    .select('id, filename, storage_path, mime_type')
    .eq('id', fileId)
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(_request: Request, { params }: { params: { id: string; fileId: string } }) {
  try {
    const file = await findFile(params.id, params.fileId);
    if (!file) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    const { data, error } = await supabaseAdmin.storage.from(FILE_BUCKET).download(file.storage_path);
    if (error || !data) throw error || new Error('Stored file unavailable.');
    const safeName = file.filename.replace(/[\r\n"]/g, '_');
    return new NextResponse(data, {
      headers: {
        'Content-Type': file.mime_type,
        'Content-Disposition': `attachment; filename="${safeName}"`
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to download this candidate file.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string; fileId: string } }) {
  try {
    const file = await findFile(params.id, params.fileId);
    if (!file) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    const { error: storageError } = await supabaseAdmin.storage.from(FILE_BUCKET).remove([file.storage_path]);
    if (storageError) throw storageError;
    const { error } = await supabaseAdmin.from('phase1_candidate_uploads').delete().eq('id', file.id).eq('candidate_id', params.id);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Unable to delete this candidate file.' }, { status: 500 });
  }
}
