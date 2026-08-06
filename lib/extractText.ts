// Shared by resume uploads (/api/evaluate) and job description uploads
// (/api/requisitions), so both accept the same file types the same way.

export async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    // .docx is a zip archive of XML, not plain text — reading it as raw
    // UTF-8 (the old fallback) produced unreadable binary/XML soup that
    // the model correctly flagged as "not a resume." mammoth actually
    // parses the document structure.
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Legacy .doc (pre-2007 binary format) isn't supported by mammoth or
  // pdf-parse. Flag it clearly rather than silently returning garbage.
  if (name.endsWith('.doc')) {
    throw new Error(
      'Legacy .doc files are not supported — please save as .docx or .pdf and re-upload.'
    );
  }

  // Plain text and anything else: treat as UTF-8 text.
  return buffer.toString('utf-8');
}
