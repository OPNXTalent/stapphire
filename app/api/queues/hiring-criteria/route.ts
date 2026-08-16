import { handleCallback } from '@vercel/queue';
import { processHiringCriteriaOperation } from '@/lib/hiringCriteriaOperation';
import { isHiringCriteriaOperationMessage } from '@/lib/operationTypes';

export const runtime = 'nodejs';
export const maxDuration = 300;

class InvalidOperationMessageError extends Error {}

const queueCallback = handleCallback(
  async (message) => {
    if (!isHiringCriteriaOperationMessage(message)) throw new InvalidOperationMessageError('Invalid Hiring Criteria operation message.');
    await processHiringCriteriaOperation(message.operationId);
  },
  {
    visibilityTimeoutSeconds: 360,
    retry: (error, metadata) => {
      if (error instanceof InvalidOperationMessageError) return { acknowledge: true };
      return { afterSeconds: Math.min(120, 5 * (2 ** Math.max(0, metadata.deliveryCount - 1))) };
    }
  }
);

export async function POST(request: Request): Promise<Response> {
  return queueCallback(request);
}
