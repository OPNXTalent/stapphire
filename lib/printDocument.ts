export type StapphirePrintDocument = 'candidate-evaluation' | 'job-description' | 'interview-summary';

export function printStapphireDocument(documentType: StapphirePrintDocument): void {
  document.body.dataset.printDocument = documentType;
  const cleanup = () => delete document.body.dataset.printDocument;
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
