import { createHash } from 'crypto';

export function resumeContentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
