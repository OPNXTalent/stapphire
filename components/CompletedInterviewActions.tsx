'use client';

import styles from './CompletedInterviewActions.module.css';

export function CompletedInterviewActions({ href, compact = false }: { href: string; compact?: boolean }) {
  function printForm() {
    const target = `${href}${href.includes('?') ? '&' : '?'}print=1`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  async function shareForm() {
    const url = new URL(href, window.location.origin).toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Completed interview assessment', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      window.alert('Interview link copied.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        window.alert('Interview link copied.');
      } catch {
        window.prompt('Copy this interview link:', url);
      }
    }
  }

  return (
    <span className={`${styles.actions} ${compact ? styles.compact : ''}`}>
      <button type="button" onClick={printForm}>Print</button>
      <button type="button" onClick={shareForm}>Share</button>
    </span>
  );
}
