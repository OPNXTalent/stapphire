import { NextResponse } from 'next/server';
import { extractTextFromBuffer } from '@/lib/extractText';
import { detectPositionTitle } from '@/lib/detectPositionTitle';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Choose a Job Description file.' }, { status: 400 });
    const text = (await extractTextFromBuffer(Buffer.from(await file.arrayBuffer()), file.name, file.type)).trim();
    if (!text) return NextResponse.json({ error: 'No readable Job Description text was found.' }, { status: 400 });
    return NextResponse.json({ jobDescription: text, suggestedTitle: detectPositionTitle(text) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read the Job Description.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
