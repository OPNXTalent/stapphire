// Pure decision logic for what to do when claim_phase1_resume_operation_item
// returns a plain null (not {deferred:true}). The RPC returns this same
// null for two very different situations that are otherwise
// indistinguishable from the caller's perspective:
//
// 1. The item is genuinely terminal (completed/failed/cancelled) or
//    missing - there is nothing further to do. Safe no-op.
// 2. The item is still 'processing' under ANOTHER worker's unexpired
//    DB lease (queue redelivered this message before that lease
//    naturally expired - e.g. because queue visibilityTimeoutSeconds
//    is now shorter than LEASE_SECONDS). Acknowledging this as a
//    no-op would let the queue message disappear while the DB lease
//    is still authoritative; if the original worker crashed, nothing
//    would ever retry this item once its lease does expire. This case
//    must defer/retry, not acknowledge.
//
// Deliberately does not touch DB lease authority itself - the claim
// RPC remains the sole place that decides whether a lease can be
// reclaimed. This only decides how the QUEUE side should react to a
// null claim it already received.

export type NullClaimDisposition = 'defer' | 'noop';

export function classifyNullClaim(
  currentItem: { status: string; lease_expires_at: string | null } | null,
  now: Date = new Date()
): NullClaimDisposition {
  if (
    currentItem &&
    currentItem.status === 'processing' &&
    currentItem.lease_expires_at &&
    new Date(currentItem.lease_expires_at).getTime() > now.getTime()
  ) {
    return 'defer';
  }
  return 'noop';
}
