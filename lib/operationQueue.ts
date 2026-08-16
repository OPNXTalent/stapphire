import 'server-only';
import { send } from '@vercel/queue';
import type { HiringCriteriaOperationMessage } from './operationTypes';

export const HIRING_CRITERIA_OPERATION_TOPIC = 'stapphire-hiring-criteria';

export interface OperationQueue {
  enqueueHiringCriteria(message: HiringCriteriaOperationMessage): Promise<void>;
}

class VercelOperationQueue implements OperationQueue {
  async enqueueHiringCriteria(message: HiringCriteriaOperationMessage): Promise<void> {
    await send(HIRING_CRITERIA_OPERATION_TOPIC, message, {
      retentionSeconds: 7 * 24 * 60 * 60
    });
  }
}

export const operationQueue: OperationQueue = new VercelOperationQueue();
