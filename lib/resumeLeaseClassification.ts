// Pure decision logic for what to do when claim_phase1_resume_operation_item
// returns a plain null (not {deferred:true}). The RPC returns this same
// null for two very different situations that are otherwise
// indistinguishable from the caller's perspective:
//
// 1. The item is genuinely terminal (completed/failed/cancelled) or
//    missing - there is nothing further to do. Safe no-op.
// 2. The item is still 'processing' (queue redelivered this message
//    before the DB lease naturally expired - e.g. because queue
//    visibilityTimeoutSeconds is now shorter than LEASE_SECONDS).
//    This case must defer/retry, not acknowledge.
//
// Disposition is based on status ALONE - lease_expires_at is never
// compared against "now" here. The follow-up SELECT that reads the
// item's current state happens strictly after the claim RPC call, in
// a separate round trip; the lease could expire in the gap between
// them. If this classifier treated an already-expired lease as safe
// to acknowledge, that TOCTOU race would let a redelivered message be
// acknowledged right as the lease becomes reclaimable but before
// anything actually reclaims it - stranding the item exactly as
// before. Any 'processing' item, regardless of lease_expires_at,
// defers unconditionally; the NEXT delivery re-enters
// claim_phase1_resume_operation_item, which remains the sole
// authority - atomically, under its own row lock - for deciding
// whether a lease is still active, has expired and can be reclaimed,
// or the item has since reached a terminal state.

export type NullClaimDisposition = 'defer' | 'noop';

export function classifyNullClaim(
  currentItem: { status: string; lease_expires_at?: string | null } | null
): NullClaimDisposition {
  if (currentItem && currentItem.status === 'processing') return 'defer';
  return 'noop';
}
