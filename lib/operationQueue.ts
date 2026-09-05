import 'server-only';
import { send } from '@vercel/queue';
import type { HiringCriteriaOperationMessage, ProspectSearchOperationMessage, ResumeEvaluationOperationMessage } from './operationTypes';

export const HIRING_CRITERIA_OPERATION_TOPIC = 'stapphire-hiring-criteria';
export const RESUME_EVALUATION_OPERATION_TOPIC = 'stapphire-resume-evaluation';
export const PROSPECT_SEARCH_OPERATION_TOPIC = 'stapphire-prospect-search';

export interface OperationQueue {
  enqueueHiringCriteria(message: HiringCriteriaOperationMessage): Promise<void>;
  enqueueResumeEvaluation(message: ResumeEvaluationOperationMessage): Promise<void>;
  enqueueProspectSearch(message: ProspectSearchOperationMessage): Promise<void>;
}

class VercelOperationQueue implements OperationQueue {
  async enqueueHiringCriteria(message: HiringCriteriaOperationMessage): Promise<void> {
    await send(HIRING_CRITERIA_OPERATION_TOPIC, message, {
      retentionSeconds: 7 * 24 * 60 * 60
    });
  }

  async enqueueResumeEvaluation(message: ResumeEvaluationOperationMessage): Promise<void> {
    await send(RESUME_EVALUATION_OPERATION_TOPIC, message, {
      retentionSeconds: 7 * 24 * 60 * 60
    });
  }

  async enqueueProspectSearch(message: ProspectSearchOperationMessage): Promise<void> {
    await send(PROSPECT_SEARCH_OPERATION_TOPIC, message, {
      retentionSeconds: 7 * 24 * 60 * 60
    });
  }
}

export const operationQueue: OperationQueue = new VercelOperationQueue();
