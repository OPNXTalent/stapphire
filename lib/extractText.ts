// Shared by resume uploads (/api/evaluate) and job description uploads
// (/api/requisitions), so both accept the same file types the same way.

export async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  // .docx and plain text: treat as UTF-8 text for v1. A dedicated .docx
  // extractor (e.g. mammoth) is a straightforward follow-up.
  return buffer.toString('utf-8');
}
