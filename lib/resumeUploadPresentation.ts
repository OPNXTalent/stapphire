// Pure presentation-derivation helpers for the Resume Upload panel.
//
// These exist purely to make the panel's copy/derivation logic directly,
// behaviorally testable (real function, real input, real assertion on the
// output) rather than only checkable via source-text regex - the same
// extraction pattern already used for target-resolution
// (lib/resumeOperationPolling.ts) and authority scoping
// (lib/resumeUploadAuthority.ts). None of this touches polling, target
// resolution, tracked-operation authority/cleanup, or evaluation
// accounting - it only decides what a given, already-resolved snapshot of
// local/durable state should say and show.

export type LocalUploadItem = { status: string };

// A local batch's item is "needs attention" once it settled with an
// error status - almost always an exact-duplicate résumé the durable
// duplicate-protection RPC rejected and deleted server-side, so it has
// no durable operation item of its own to ever appear in an evaluation
// queue.
export function failedLocalItems<T extends LocalUploadItem>(items: readonly T[]): T[] {
  return items.filter((item) => item.status === 'error');
}

export function needsAttentionHeading(count: number): string {
  return count === 1 ? "1 résumé wasn't added" : `${count} résumés weren't added`;
}

export function evaluatingHeading(total: number): string {
  return `Evaluating ${total} ${total === 1 ? 'résumé' : 'résumés'}`;
}

export function progressLabel(completed: number, total: number): string {
  return `${completed} of ${total} complete`;
}

// The concise terminal summary. Failed durable items (a genuine
// evaluation failure, distinct from a duplicate rejection - those never
// reach a durable operation at all) still need to be surfaced, so that
// case keeps its existing "need attention" phrasing instead of claiming
// everything was added.
export function completedSummary(completed: number, failedCount: number): string {
  if (failedCount > 0) return `${completed} completed · ${failedCount} need attention`;
  return `${completed} ${completed === 1 ? 'résumé' : 'résumés'} evaluated and added`;
}

export function detailsToggleLabel(expanded: boolean): string {
  return expanded ? 'Hide details' : 'View details';
}
