// Pure identity/scoping logic: whether a tracked durable résumé
// operation may be treated as authoritative for the CURRENT local
// upload batch's display state, right now.
//
// This exists because retained durable state from an OLDER operation
// must never supersede or confirm a brand new, unrelated local batch.
// A local batch only proves its relationship to a durable operation
// once it has that operation's id - before that, nothing durable can
// be proven to represent it, no matter what trackedOperation currently
// holds (which could easily be a prior batch's now-terminal
// operation, still sitting in state simply because nothing has
// replaced it yet).

export type LocalBatchIdentity = { operationId: string | null };
export type TrackedOperationIdentity = { id: string } | null;

export function resolveTrackedOperationAuthority(
  currentLocalBatch: LocalBatchIdentity | null,
  trackedOperation: TrackedOperationIdentity
): { matchesCurrentBatch: boolean; authoritative: boolean } {
  const matchesCurrentBatch = Boolean(
    currentLocalBatch?.operationId && trackedOperation && trackedOperation.id === currentLocalBatch.operationId
  );
  // Authoritative either when there is no local batch at all to
  // conflict with (the reconstruction-after-navigation case, which
  // must keep working exactly as before) or when the tracked operation
  // is proven to match the current local batch specifically.
  const authoritative = Boolean(!currentLocalBatch || matchesCurrentBatch);
  return { matchesCurrentBatch, authoritative };
}
