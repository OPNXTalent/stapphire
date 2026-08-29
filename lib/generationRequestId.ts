// Every question in a generation batch is derived from the caller's
// own generation request id and its position in the batch (0-4),
// never a fresh random id per attempt. This is what lets a retry of
// the same generation request (after an uncertain network failure)
// reuse the exact same five question_key values the database function
// uses to recognize and safely replay an already-completed batch,
// rather than minting a second, independent set of ids and risking a
// duplicate QC charge. A genuinely new generation action gets a new
// requestId from the caller, which naturally derives five new ids.
//
// Kept in its own file, with no other imports, specifically so it can
// be unit-tested directly - interviewQuestionGenerator.ts (its only
// caller) imports 'server-only' and calls OpenAI, and so cannot be
// imported outside Next's own bundler at all (confirmed: a plain node
// --test run fails to resolve the 'server-only' package, since Next
// aliases it away at build time rather than it being a real
// standalone dependency).
export function generatedQuestionId(requestId: string, index: number): string {
  return `ai-${requestId}-${index}`;
}
