// Shared by both Phone Screen and Structured Interview: decides whether
// changing a question's Question Type would silently discard real
// recruiter content. A question counts as "customized" only if its text
// is non-empty AND does not match the exact wording its *current* type's
// canonical template would have produced - a blank question, or one that
// still reads exactly as its own template, is safe to replace without
// asking first.
export function isQuestionTextCustomized(currentText: string, currentTemplateText: string | undefined): boolean {
  const trimmed = currentText.trim();
  if (!trimmed) return false;
  if (currentTemplateText !== undefined && currentText === currentTemplateText) return false;
  return true;
}
