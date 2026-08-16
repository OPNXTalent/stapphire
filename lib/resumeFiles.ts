export const MAX_RESUME_SIZE = 10 * 1024 * 1024;
export const MAX_RESUME_BATCH_SIZE = 50;

export type ResumeSourceType = { extension: '.pdf' | '.docx' | '.txt'; mimeType: string };

export function getResumeSourceType(filename: string, mimeType: string): ResumeSourceType | null {
  const name = filename.toLowerCase();
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) return { extension: '.pdf', mimeType: 'application/pdf' };
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    return { extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (mimeType === 'text/plain' || name.endsWith('.txt')) return { extension: '.txt', mimeType: 'text/plain' };
  return null;
}
