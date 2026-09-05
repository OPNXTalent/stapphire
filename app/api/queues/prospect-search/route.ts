import { handleCallback } from '@vercel/queue';
import { isProspectSearchOperationMessage } from '@/lib/operationTypes';
import { processProspectSearch } from '@/lib/prospectSearchOperation';

export const runtime = 'nodejs';
export const maxDuration = 300;

class InvalidProspectSearchMessageError extends Error {}

const queueCallback = handleCallback(async (message) => {
  if (!isProspectSearchOperationMessage(message)) throw new InvalidProspectSearchMessageError('Invalid prospect search message.');
  const startedAt = Date.now();
  console.log(JSON.stringify({ level: 'info', message: 'Prospect search step started', searchId: message.searchId }));
  try {
    await processProspectSearch(message.searchId);
    console.log(JSON.stringify({ level: 'info', message: 'Prospect search step completed', searchId: message.searchId, durationMs: Date.now() - startedAt }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Prospect search step failed', searchId: message.searchId, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt }));
    throw error;
  }
}, {
  visibilityTimeoutSeconds: 360,
  retry: (error, metadata) => error instanceof InvalidProspectSearchMessageError
    ? { acknowledge: true }
    : { afterSeconds: Math.min(120, 5 * (2 ** Math.max(0, metadata.deliveryCount - 1))) }
});

export async function POST(request: Request): Promise<Response> {
  return queueCallback(request);
}
