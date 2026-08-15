import { BrandGem } from '@/components/BrandGem';

export function StapphirePrintHeader({ documentTitle }: { documentTitle: string }) {
  return <header className="print-document-header">
    <div className="print-document-brand"><BrandGem/><strong>Stapphire</strong></div>
    <span className="print-document-title">{documentTitle}</span>
  </header>;
}
