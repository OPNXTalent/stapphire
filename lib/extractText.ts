// Shared by resume uploads (/api/evaluate) and job description uploads
// (/api/requisitions), so both accept the same file types the same way.
// Takes a Buffer rather than a File so callers can reuse the same bytes
// for storage (e.g. saving the original resume) without reading the
// upload twice.

export function sanitizeExtractedText(text: string): string {
  return text.replaceAll('\0', '');
}

type PdfExtractionDependencies = {
  parse(buffer: Buffer): Promise<{ text: string }>;
  normalize(buffer: Buffer): Promise<Buffer>;
  log(message: string, detail?: unknown): void;
};

function isRepairablePdfStructureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /xref|cross-reference|trailer|invalid pdf|bad object|invalid object|object stream|startxref/i.test(message);
}

async function defaultPdfDependencies(): Promise<PdfExtractionDependencies> {
  const pdfParse = (await import('pdf-parse')).default;
  return {
    parse: (buffer) => pdfParse(buffer),
    normalize: async (buffer) => {
      const { PDFDocument } = await import('pdf-lib');
      const document = await PDFDocument.load(buffer, {
        ignoreEncryption: false,
        updateMetadata: false,
        throwOnInvalidObject: false
      });
      return Buffer.from(await document.save({ useObjectStreams: false, updateFieldAppearances: false }));
    },
    log: (message, detail) => console.warn(message, detail)
  };
}

export async function extractPdfTextWithRepair(
  buffer: Buffer,
  dependencies?: PdfExtractionDependencies
): Promise<string> {
  const pdf = dependencies || await defaultPdfDependencies();
  try {
    return sanitizeExtractedText((await pdf.parse(buffer)).text);
  } catch (originalError) {
    if (!isRepairablePdfStructureError(originalError)) throw originalError;
    pdf.log('PDF extraction failed structurally; attempting temporary normalization.', originalError);
    try {
      const repaired = await pdf.normalize(buffer);
      const text = sanitizeExtractedText((await pdf.parse(repaired)).text);
      pdf.log('PDF extraction succeeded after temporary normalization.');
      return text;
    } catch (repairError) {
      pdf.log('PDF extraction failed after temporary normalization.', repairError);
      throw new AggregateError(
        [originalError, repairError],
        'Unable to read this PDF after attempting structural repair.'
      );
    }
  }
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<string> {
  const name = filename.toLowerCase();

  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdfTextWithRepair(buffer);
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    // .docx is a zip archive of XML, not plain text — reading it as raw
    // UTF-8 (the old fallback) produced unreadable binary/XML soup that
    // the model correctly flagged as "not a resume." mammoth actually
    // parses the document structure.
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return sanitizeExtractedText(result.value);
  }

  // Legacy .doc (pre-2007 binary format) isn't supported by mammoth or
  // pdf-parse. Flag it clearly rather than silently returning garbage.
  if (name.endsWith('.doc')) {
    throw new Error(
      'Legacy .doc files are not supported — please save as .docx or .pdf and re-upload.'
    );
  }

  // Plain text and anything else: treat as UTF-8 text.
  return sanitizeExtractedText(buffer.toString('utf-8'));
}
