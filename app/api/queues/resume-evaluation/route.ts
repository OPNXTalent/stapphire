import { handleCallback } from '@vercel/queue';
import { DeferredResumeOperationError, processResumeEvaluationOperationItem, RetryableResumeOperationError } from '@/lib/resumeEvaluationOperation';
import { isResumeEvaluationOperationMessage } from '@/lib/operationTypes';

export const runtime = 'nodejs';
export const maxDuration = 300;

class InvalidResumeOperationMessageError extends Error {}

const queueCallback = handleCallback(
  async (message) => {
    if (!isResumeEvaluationOperationMessage(message)) throw new InvalidResumeOperationMessageError('Invalid resume operation message.');
    await processResumeEvaluationOperationItem(message.operationItemId);
  },
  {
    visibilityTimeoutSeconds: 360,
    retry: (error, metadata) => {
      if (error instanceof InvalidResumeOperationMessageError) return { acknowledge: true };
      if (error instanceof DeferredResumeOperationError) return { afterSeconds: 10 };
      if (error instanceof RetryableResumeOperationError) {
        return { afterSeconds: Math.min(120, 5 * (2 ** Math.max(0, metadata.deliveryCount - 1))) };
      }
      return { afterSeconds: 30 };
    }
  }
);

export async function POST(request: Request): Promise<Response> {
  return queueCallback(request);
}
