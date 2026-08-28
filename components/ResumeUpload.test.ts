import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This project has no React/DOM testing infrastructure (no
// @testing-library/react, no jsdom) - every other test here covers
// pure, non-React functions directly, and CreateRequisitionForm.test.ts
// established the same source-level regression pattern used here.
// These tests inspect the component's source for the specific
// behaviors this simplified, persistence-first architecture depends
// on. They do not exercise runtime behavior.

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ResumeUpload.tsx'),
  'utf8'
);

test('there is exactly one place that fetches durable résumé-operation state - a single synchronization mechanism', () => {
  const matches = source.match(/fetch\(`\/api\/requisitions\/\$\{requisitionId\}\/operations`/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one fetch call site - no competing polling paths');
});

test('no generation counter or wake-coalescing machinery exists - the simplified design accepts brief visual delay instead of that complexity', () => {
  assert.doesNotMatch(source, /wakeRequestedRef|generation counter|myGeneration/i, 'this architecture explicitly trades instantaneous updates for simplicity - no coalescing/staleness-guard machinery should be needed or present');
});

test('an in-flight fetch is never overlapped - a concurrent trigger is skipped and retried on the next interval, not coalesced into an immediate follow-up', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch, 'expected to find tick()');
  assert.match(tickMatch[1], /if \(inFlight\) \{/, 'expected an in-flight guard');
});

test('a failed poll preserves last-known operation state rather than clearing it', () => {
  const catchMatch = source.match(/\} catch \{([\s\S]*?)\n      \} finally \{/);
  assert.ok(catchMatch, 'expected to find the catch block');
  assert.doesNotMatch(catchMatch[1], /setTrackedOperation\(null\)/, 'a transient failure must not clear the tracked operation - the persisted server-side work is not endangered by a failed read, so the UI must not act as if it were');
});

test('a failed poll still keeps polling for a known target - the durable work is not endangered by a temporary read failure', () => {
  const catchMatch = source.match(/\} catch \{([\s\S]*?)\n      \} finally \{/);
  assert.ok(catchMatch);
  assert.match(catchMatch[1], /if \(targetOperationIdRef\.current\) timer = setTimeout/, 'expected polling to continue for a known target even after a fetch failure');
});

test('on mount with no known local batch, one reconstruction attempt recovers the latest persisted operation - not indefinite polling for something that may never appear', () => {
  // The actual reconstruction decision now lives in the behaviorally-tested
  // advancePollTarget (lib/resumeOperationPolling.test.ts); this only
  // checks that tick() still short-circuits once pollState says
  // reconstruction is spent, rather than fetching forever.
  assert.match(source, /pollState\.attemptedReconstruction/);
  assert.match(source, /if \(!targetId && pollState\.attemptedReconstruction\) return;/, 'expected polling to stop once reconstruction has been tried and found nothing, rather than continuing to poll indefinitely merely because the page remains open');
});

test('terminal notification is independent of the polling reschedule decision', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch);
  const notificationIndex = tickMatch[1].indexOf('dispatchResumeOperationTerminal');
  const scheduleIndex = tickMatch[1].indexOf('stillUnresolved');
  assert.ok(notificationIndex >= 0 && scheduleIndex >= 0);
  assert.ok(notificationIndex < scheduleIndex, 'terminal notification must occur before the independent scheduling decision');
  assert.match(tickMatch[1], /targetOperationIdRef\.current = null/, 'terminal state must clear the polling target before rendering');
});

test('manual retry deliberately reopens tracking for the same formerly-terminal operation', () => {
  const retryMatch = source.match(/async function retryFailed\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(retryMatch);
  assert.match(retryMatch[1], /terminalNotificationOperationIdsRef\.current\.delete\(trackedOperation\.id\)/);
  assert.match(retryMatch[1], /targetOperationIdRef\.current = trackedOperation\.id/);
  assert.match(retryMatch[1], /restartRef\.current\(\)/);
});

test('upload confirmation is superseded by durable per-item uploaded state, not local batch state alone', () => {
  const match = source.match(/const showUploadConfirmed = [\s\S]*?;/);
  assert.ok(match);
  assert.match(match[0], /allItemsDurablyUploaded/, 'upload confirmation must be derivable from durable, server-confirmed per-item uploaded state - not local batch state alone - so it can render even while local upload promises remain unresolved');
});

test('durable upload confirmation is scoped through the extracted authority resolver, not derived from trackedOperation independent of batch identity', () => {
  const match = source.match(/const allItemsDurablyUploaded = [\s\S]*?;/);
  assert.ok(match, 'expected to find allItemsDurablyUploaded');
  assert.match(match[0], /trackedOperationAuthoritative/, 'durable confirmation must be gated on the operation being proven authoritative for the current context (matches the current batch, or there is no local batch to conflict with) - never computed from trackedOperation alone, which could be a retained, unrelated older operation');
});

test('resolveTrackedOperationAuthority is imported from the extracted, independently-tested authority module, not reimplemented inline', () => {
  assert.match(source, /import \{ resolveTrackedOperationAuthority \} from '@\/lib\/resumeUploadAuthority';/, 'expected the identity/scoping logic to be imported from lib/resumeUploadAuthority.ts, which has its own direct behavioral tests, rather than duplicated inline where it could drift');
});

test('the full operation-progress view (with its Done button) is also scoped by authority, not shown for a retained older operation while an unrelated new batch is uploading', () => {
  const match = source.match(/const showTrackedOperationView = Boolean\(([\s\S]*?)\n  \);/);
  assert.ok(match, 'expected to find showTrackedOperationView');
  assert.match(match[1], /trackedOperationAuthoritative/, 'the full progress/Done view must respect the same authority scoping - otherwise a stale, terminal older operation could keep showing its own Done button while a brand new batch is still uploading');
});

test('the local uploading bridge is forcibly suppressed once durable state confirms uploads are done or the operation is terminal - server truth supersedes local phase unconditionally', () => {
  const match = source.match(/const localUploading = Boolean\(([\s\S]*?)\n  \);/);
  assert.ok(match, 'expected to find localUploading');
  assert.match(match[1], /!allItemsDurablyUploaded/, 'expected local uploading state to be suppressed once durable state confirms all items uploaded');
  assert.match(match[1], /!trackedOperationTerminal/, 'expected local uploading state to be suppressed once the durable operation is terminal, regardless of local phase');
});

test('the durable per-item uploaded field is read into the render logic, not just fetched and ignored', () => {
  assert.match(source, /item\.uploaded/, 'expected the durable uploaded field to actually be used in a render-affecting computation');
});

test('the required "safe to leave" messaging is present once upload is confirmed', () => {
  assert.match(source, /Evaluation continues in the background/, 'expected explicit messaging that evaluation continues without the browser, per the required UX contract');
  assert.match(source, /navigate anywhere in Stapphire/i);
});

test('a distinct checking state is shown while a target operation is known but not yet confirmed, never blank', () => {
  assert.match(source, /showCheckingStatus/);
  assert.match(source, /Checking résumé processing status/);
});

test('the Evaluating animation and Done control are both gated on the durable operation actually being active, inside the shared operation-card renderer', () => {
  const cardMatch = source.match(/function renderOperationCard\([\s\S]*?\n  \}/);
  assert.ok(cardMatch, 'expected to find renderOperationCard');
  assert.match(cardMatch[0], /const active = isActiveOperation\(operation\.status\);/);
  assert.match(cardMatch[0], /active\s*\n?\s*\? <StapphireProcessing/, 'expected the Evaluating animation gated on active state');
  assert.match(cardMatch[0], /\{!active && <div className="upload-complete">/, 'expected the Done control gated on NOT active, so it cannot appear while still active');
  assert.match(cardMatch[0], /<button type="button" className="upload-go-btn" onClick=\{options\.onDismiss\}>Done<\/button>/);
});

test('the component unmounting does not endanger durable work - the cleanup only clears local timers/flags, never touches server state', () => {
  const cleanupMatch = source.match(/return \(\) => \{\s*cancelled = true;[\s\S]*?\n    \};/);
  assert.ok(cleanupMatch, 'expected to find the effect cleanup');
  assert.doesNotMatch(cleanupMatch[0], /fetch\(|dismiss|cancel.*operation/i, 'unmount cleanup must only stop this component\'s own local polling, never cancel or otherwise affect the persisted durable operation');
});

test('adding and submitting another selection stays available while a local batch is uploading', () => {
  assert.match(source, /className="upload-add-btn"[^>]*onClick=\{\(\) => inputRef\.current\?\.click\(\)\}>/);
  assert.doesNotMatch(source, /className="upload-add-btn"[^>]*disabled=\{localUploading\}/);
  assert.match(source, /\{staged\.length > 0 && <button[^>]*onClick=\{beginUpload\}/);
  assert.doesNotMatch(source, /staged\.length > 0 && !localUploading/);
});

test('the same rendered staged selection can be handed off only once without blocking a later selection', () => {
  const beginUpload = source.match(/function beginUpload\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(beginUpload);
  assert.match(beginUpload[1], /handedOffStagedRef\.current === staged/, 'a re-entrant click from the same render must be rejected');
  assert.match(beginUpload[1], /handedOffStagedRef\.current = staged/, 'the current staged-array identity must be claimed synchronously before dispatch');
  assert.match(beginUpload[1], /void startUpload\(requisitionId, files\)/);
  assert.doesNotMatch(beginUpload[1], /localUploading|\.finally\(/, 'the handoff guard must not wait for prior upload work to finish');
});

test('all retained local batches render instead of replacing the visible queue with only the newest batch', () => {
  assert.match(source, /const visibleLocalBatches = localBatches\.filter/);
  assert.match(source, /visibleLocalBatches\.map/);
  assert.match(source, /batch\.items\.map/);
});

test('durable operations are accumulated and rendered so prior processing, completed, and failed items remain visible', () => {
  assert.match(source, /setKnownOperations\(\(current\) =>/);
  assert.match(source, /knownOperations\.filter\(\(operation\) => operation\.id !== trackedOperation\?\.id\)\.map/);
  assert.match(source, /item\.status === 'failed'/);
  assert.match(source, /item\.status === 'completed'/);
});

// The target-resolution decision itself (found / awaiting-creation /
// confirmed-deleted, including the duplicate-deleted-before-first-poll
// race and the reconstruction-after-deletion hazard) is extracted into
// lib/resumeOperationPolling.ts and has full behavioral coverage there
// (lib/resumeOperationPolling.test.ts) - a real function called with real
// inputs, not a source-text shape check. What remains to verify here is
// only that tick() is actually wired to that function, not a parallel
// reimplementation that could drift from it.
test('the polling loop delegates its target-resolution decision to the extracted, independently-tested pure function, not an inline reimplementation', () => {
  assert.match(source, /import \{ advancePollTarget, type PollTargetState \} from '@\/lib\/resumeOperationPolling';/, 'expected the target-resolution decision to be imported from lib/resumeOperationPolling.ts, which has its own direct behavioral tests, rather than duplicated inline where it could drift');
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch, 'expected to find tick()');
  assert.doesNotMatch(tickMatch[1], /confirmedTargetId === targetId|list\.find\(\(operation\) => operation\.id === targetId\)/, 'the found/confirmed/deleted decision must not be reimplemented inline inside tick()');
  assert.match(tickMatch[1], /const advanced = advancePollTarget\(pollState, list, \{/, 'expected tick() to call the extracted decision function with the current poll state');
  assert.match(tickMatch[1], /localBatchFullySettledId: settledBatchOperationIdRef\.current/, 'expected the local-batch-settlement proof (the fix for the duplicate-deleted-before-first-poll race) to actually be threaded into the decision function, not just computed and ignored');
  assert.match(tickMatch[1], /pollState = advanced\.state;\s*\n\s*targetOperationIdRef\.current = pollState\.targetId;/, 'expected the resolved state to actually be written back to both the loop\'s own memory and the cross-cutting ref other code reads/writes');
});

test('the local-batch-settlement proof read by the polling loop is derived from the same phase the local error-visibility logic uses, not a separate/divergent notion of "settled"', () => {
  assert.match(source, /settledBatchOperationIdRef\.current = currentLocalBatch\?\.phase === 'accepted' \? currentLocalBatch\.operationId : null;/, 'expected settlement to be keyed off phase === \'accepted\', the same condition localBatchNeedsAttention already uses, so the two mechanisms cannot disagree about when a batch has finished attempting every item');
});

test('a batch that finishes with a locally-failed item (e.g. an exact-duplicate résumé) stays visible after the batch settles, not only while genuinely uploading', () => {
  assert.match(source, /const currentBatchHasLocalErrors = Boolean\(currentLocalBatch\?\.items\.some\(\(item\) => item\.status === 'error'\)\)/);
  assert.match(source, /const localBatchNeedsAttention = Boolean\(currentLocalBatch\?\.phase === 'accepted' && currentBatchHasLocalErrors\)/);
  const visibleMatch = source.match(/const visibleLocalBatches = localBatches\.filter\(\(batch\) =>([\s\S]*?)\n {2}\);/);
  assert.ok(visibleMatch);
  assert.match(visibleMatch[1], /localUploading \|\| localBatchNeedsAttention/, 'a batch with a failed item must remain visible once settled, not disappear the moment phase leaves creating/uploading');
});

test('the failed-item message is actually rendered while still in flight, not just tracked in state', () => {
  assert.match(source, /\{item\.status === 'error' && item\.error && <span className="upload-queue-msg">\{item\.error\}<\/span>\}/, 'expected the local per-item error message (e.g. "This resume has already been uploaded.") to render, matching how durable item.errorSummary already renders');
});

test('the uploading spinner stops once the batch has settled - only a genuinely in-flight batch shows the animation', () => {
  const mapBlock = source.match(/\{visibleLocalBatches\.map\(\(batch\) => \{([\s\S]*?)\n {6}\}\)\}/);
  assert.ok(mapBlock, 'expected to find the local batch render block');
  assert.match(mapBlock[1], /const stillInFlight = batch\.phase === 'creating' \|\| batch\.phase === 'uploading'/);
  const inFlightBranch = mapBlock[1].match(/if \(stillInFlight\) \{([\s\S]*?)\n {8}\}/);
  assert.ok(inFlightBranch, 'expected a single, resolved-up-front still-in-flight branch');
  assert.match(inFlightBranch[1], /<StapphireProcessing/, 'the spinner must render for the still-in-flight branch');
  const spinnerOccurrences = mapBlock[1].match(/<StapphireProcessing/g) || [];
  assert.equal(spinnerOccurrences.length, 1, 'the animation must only ever render once, from the still-in-flight branch - a settled batch must never show it');
});

test('needs-attention heading is singular/plural and derived from the extracted, independently-tested presentation helper, not a hand-rolled sentence', () => {
  assert.match(source, /import \{[\s\S]*?needsAttentionHeading[\s\S]*?\} from '@\/lib\/resumeUploadPresentation';/, 'expected needsAttentionHeading to be imported from the presentation helper module, which has its own direct behavioral tests');
  assert.match(source, /\{needsAttentionHeading\(attentionItems\.length\)\}/);
});

test('once settled, only failed local items are rendered as needing attention - a successfully uploaded résumé does not reappear here', () => {
  assert.match(source, /const attentionItems = failedLocalItems\(batch\.items\);/, 'expected the settled branch to filter down to only failed items via the extracted, independently-tested helper');
  assert.match(source, /\{attentionItems\.map\(\(item\) =>/, 'expected the settled branch to render attentionItems, not the full unfiltered batch.items list');
});

test('each needs-attention item shows its filename and error message on separate lines, without redundantly duplicating a visible "Failed" label next to the full error sentence', () => {
  const attentionItemMatch = source.match(/\{attentionItems\.map\(\(item\) => <li[\s\S]*?<\/li>\)\}/);
  assert.ok(attentionItemMatch, 'expected to find the needs-attention item template');
  assert.match(attentionItemMatch[0], /<span className="upload-queue-name">\{item\.filename\}<\/span>/, 'filename must render clearly');
  assert.match(attentionItemMatch[0], /\{item\.error && <span className="upload-queue-msg">\{item\.error\}<\/span>\}/, 'the complete error sentence must render as its own element (a second line via upload-queue-item-attention layout)');
  assert.doesNotMatch(attentionItemMatch[0], />Failed</, 'must not also render a redundant visible "Failed" label alongside the complete error sentence');
  assert.match(attentionItemMatch[0], /className="visually-hidden"/, 'a screen-reader-only label must still identify the row as failed for accessibility');
});

test('a settled batch with a failed item offers a way to dismiss it, labeled distinctly from the durable operation\'s own Done control', () => {
  const mapBlock = source.match(/\{visibleLocalBatches\.map\(\(batch\) => \{([\s\S]*?)\n {6}\}\)\}/);
  assert.ok(mapBlock);
  assert.match(mapBlock[1], /onClick=\{\(\) => dismissBatch\(batch\.clientBatchKey\)\}>Dismiss<\/button>/, 'expected a "Dismiss" control (not "Done") that clears only the settled local error presentation, so it cannot be mistaken for the durable operation\'s Done control');
});

test('local Dismiss only clears local batch/dismissal state - it does not touch durable operation state (trackedOperation/knownOperations/dismissOperation)', () => {
  assert.match(source, /onClick=\{\(\) => dismissBatch\(batch\.clientBatchKey\)\}/);
  assert.doesNotMatch(source, /dismissBatch\(batch\.clientBatchKey\)[\s\S]{0,40}dismissOperation/, 'dismissing a local batch\'s needs-attention row must not also dismiss durable operation state');
});

// A proven-deleted target (e.g. an exact-duplicate résumé's operation,
// which the duplicate-protection RPC deletes outright once its only item
// is rejected) resolves through advancePollTarget to found: null with its
// polling target cleared - but until this fix, nothing ever told
// trackedOperation React state to let go of its last-known, now-stale
// snapshot, since setTrackedOperation was only ever called inside
// `if (found)`. That left the "Evaluating résumés…" card rendering
// forever, surviving only a full page refresh (a fresh mount resets
// trackedOperation to null).
test('a proven-deleted target clears the stale tracked-operation snapshot in the same tick, not just the polling target ref', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch, 'expected to find tick()');
  assert.match(
    tickMatch[1],
    /\} else if \(targetId && !pollState\.targetId\) \{\s*\n[\s\S]*?setTrackedOperation\(\(current\) => \(current && current\.id === targetId \? null : current\)\);/,
    'expected the found/not-found branch to clear trackedOperation when advancePollTarget just resolved the exact id it was tracking as confirmed-deleted'
  );
});

test('the stale-snapshot clear is scoped to the exact proven-deleted id, never a blanket clear of trackedOperation', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch);
  const branchMatch = tickMatch[1].match(/\} else if \(targetId && !pollState\.targetId\) \{([\s\S]*?)\n {8}\}/);
  assert.ok(branchMatch, 'expected the confirmed-deleted else-if branch');
  assert.match(branchMatch[1], /current && current\.id === targetId \? null : current/, 'must only null out trackedOperation when it still references the exact id just proven deleted, preserving it otherwise');
  assert.doesNotMatch(branchMatch[1], /setKnownOperations\(\[\]\)|setTrackedOperation\(null\)(?!\)| ==)/, 'must not unconditionally null trackedOperation or blanket-clear knownOperations - only the exact matching id may be cleared');
});

test('the confirmed-deleted clear only fires when advancePollTarget actually resolved the tracked id away (targetId was set, pollState.targetId now cleared) - never on an unrelated null-target tick such as reconstruction finding nothing', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch);
  assert.match(tickMatch[1], /\} else if \(targetId && !pollState\.targetId\) \{/, 'the guard must require a truthy prior targetId, so a tick that already had no target (e.g. reconstruction) cannot spuriously trigger this branch');
});

test('a found operation (e.g. the surviving résumé in a mixed duplicate/unique batch) still updates trackedOperation exactly as before - the new branch never runs instead of the existing found path', () => {
  const tickMatch = source.match(/async function tick\(\) \{([\s\S]*?)\n    \}\n/);
  assert.ok(tickMatch);
  assert.match(tickMatch[1], /if \(found\) \{\s*\n\s*setTrackedOperation\(found\);/, 'the found path must remain unchanged - a surviving operation must keep rendering its live progress');
  const foundIndex = tickMatch[1].indexOf('if (found) {');
  const elseIfIndex = tickMatch[1].indexOf('} else if (targetId && !pollState.targetId) {');
  assert.ok(foundIndex >= 0 && elseIfIndex > foundIndex, 'the confirmed-deleted branch must be the else-if counterpart of the same found check, mutually exclusive with it');
});

test('local duplicate-error visibility (message and Done control) is untouched by the tracked-operation fix - it is driven by visibleLocalBatches/currentLocalBatch, not trackedOperation', () => {
  assert.match(source, /\{item\.status === 'error' && item\.error && <span className="upload-queue-msg">\{item\.error\}<\/span>\}/);
  const mapBlock = source.match(/\{visibleLocalBatches\.map\(\(batch\) => \{([\s\S]*?)\n {6}\}\)\}/);
  assert.ok(mapBlock);
  assert.doesNotMatch(mapBlock[1], /trackedOperation/, 'the local per-batch error row/Done control must remain independent of trackedOperation state, so clearing a stale tracked operation can never affect it');
});

// Presentation cleanup round - regression coverage for the required UX
// contract (needs-attention/evaluating/completed sections, and the
// duplicate-only vs. mixed-batch cases). This deliberately does not
// touch polling, advancePollTarget, tracked-operation authority/cleanup,
// duplicate detection, or evaluation accounting - only what is shown.

test('an exact-duplicate-only batch shows only the needs-attention section, never an empty evaluation section', () => {
  // showTrackedOperationView (and therefore renderOperationCard for the
  // tracked operation) is unconditionally gated on trackedOperation
  // itself being truthy. A duplicate-only batch's operation is deleted
  // outright server-side (protected behavior, unchanged by this round -
  // see the confirmed-deleted clearing tests above), so trackedOperation
  // is null once settled, and this gate alone is what keeps the
  // evaluation section from ever rendering empty.
  assert.match(source, /const showTrackedOperationView = Boolean\(\s*\n\s*trackedOperation && !showCheckingStatus && trackedOperationAuthoritative\s*\n\s*\);/);
  assert.match(source, /\{showTrackedOperationView && trackedOperation && renderOperationCard\(/, 'the evaluation section must not render at all when there is no tracked operation - not render-with-empty-state');
  // The needs-attention section, by contrast, depends only on the local
  // batch's own settled state - independent of trackedOperation - so it
  // renders regardless of whether any durable operation exists at all.
  assert.doesNotMatch(source.match(/const localBatchNeedsAttention = [\s\S]*?;/)![0], /trackedOperation/, 'needs-attention visibility must not depend on a durable operation existing');
});

test('needs-attention and evaluation sections are always sourced from disjoint data - local batch items vs. the durable operation\'s own items - so a mixed batch can never show the same filename in both', () => {
  assert.match(source, /const attentionItems = failedLocalItems\(batch\.items\);/, 'needs-attention is derived from the local batch\'s own items');
  const cardMatch = source.match(/function renderOperationCard\([\s\S]*?\n  \}/);
  assert.ok(cardMatch);
  assert.match(cardMatch[0], /operation\.items\.map/, 'the evaluation queue is derived from the durable operation\'s own items, a structurally distinct source');
  assert.doesNotMatch(cardMatch[0], /batch\.items/, 'the evaluation card must never read from local batch items');
});

test('active evaluation progress ("N of M complete") is rendered exactly once per card, via the extracted presentation helper, not duplicated in a second summary line', () => {
  const cardMatch = source.match(/function renderOperationCard\([\s\S]*?\n  \}/);
  assert.ok(cardMatch);
  const progressOccurrences = cardMatch[0].match(/progressLabel\(completed, total\)/g) || [];
  assert.equal(progressOccurrences.length, 1, 'progress must be computed/rendered exactly once per card');
  assert.match(cardMatch[0], /title=\{evaluatingHeading\(total\)\}/, 'expected the heading to state the résumé count, e.g. "Evaluating 6 résumés"');
});

test('a completed operation\'s filename list is collapsed by default (expandedOperationIds starts empty) and only renders while active or explicitly expanded', () => {
  assert.match(source, /const \[expandedOperationIds, setExpandedOperationIds\] = useState<Set<string>>\(new Set\(\)\);/, 'expected details to start collapsed for every operation - an empty expanded set');
  const cardMatch = source.match(/function renderOperationCard\([\s\S]*?\n  \}/);
  assert.ok(cardMatch);
  assert.match(cardMatch[0], /const showQueue = active \|\| expanded;/, 'the filename list must only show while active (in-progress) or explicitly expanded once terminal - collapsed by default otherwise');
});

test('the "View details"/"Hide details" toggle is keyboard-accessible and reflects expanded state via aria-expanded, using the extracted label helper', () => {
  const cardMatch = source.match(/function renderOperationCard\([\s\S]*?\n  \}/);
  assert.ok(cardMatch);
  assert.match(cardMatch[0], /<button type="button" className="upload-retry-action" aria-expanded=\{expanded\} onClick=\{\(\) => toggleOperationDetails\(operation\.id\)\}>/, 'expected a real <button> (keyboard-operable) with aria-expanded reflecting current state');
  assert.match(cardMatch[0], /\{detailsToggleLabel\(expanded\)\}/, 'expected the label to toggle between View details / Hide details via the extracted helper');
  assert.match(source, /function toggleOperationDetails\(operationId: string\) \{/);
});

test('Done dismisses only the durable operation (and its exactly-matching local batch, if any) - the needs-attention Dismiss control is a separate function entirely', () => {
  const dismissProgressMatch = source.match(/function dismissProgress\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(dismissProgressMatch);
  assert.match(dismissProgressMatch[1], /dismissOperation\(trackedOperation\.id\)/);
  assert.match(dismissProgressMatch[1], /setTrackedOperation\(null\)/);
  const dismissKnownMatch = source.match(/function dismissKnownOperation\(operation: ResumeOperationSummary\) \{([\s\S]*?)\n  \}/);
  assert.ok(dismissKnownMatch);
  assert.match(dismissKnownMatch[1], /dismissOperation\(operation\.id\)/);
  // Distinct from the local needs-attention Dismiss button, which calls
  // dismissBatch directly and neither of these two functions.
  assert.doesNotMatch(dismissProgressMatch[1], /dismissBatch\(batch\.clientBatchKey\)/);
});
