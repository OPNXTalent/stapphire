import { StapphireBrand } from '@/components/StapphireBrand';

export function StapphirePrintHeader({ documentTitle }: { documentTitle: string }) {
  return <header className="print-document-header">
    <div className="print-document-brand"><StapphireBrand compact decorative/><strong>Stapphire</strong></div>
    <span className="print-document-title">{documentTitle}</span>
  </header>;
}
