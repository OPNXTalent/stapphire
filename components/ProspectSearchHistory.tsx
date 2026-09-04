'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PROSPECT_SEARCH_FOCUS_EVENT,
  PROSPECT_SEARCHES_CHANGED_EVENT,
  type ProspectSearchesChangedDetail
} from '@/lib/prospectSearchEvents';
import styles from './ProspectSearchHistory.module.css';

type SearchHistoryItem = {
  id: string;
  created_at: string;
  prospectCount: number;
  isCurrentCriteria: boolean;
  search_strategy?: {
    config?: { targetLocation?: string; searchScope?: string };
    marketAnalysis?: { scarcityLevel?: string };
  };
};

type HistoryPayload = {
  search: { id: string } | null;
  history: SearchHistoryItem[];
};

const SCOPE_LABELS: Record<string, string> = {
  '25_MILES': '25 mi',
  '50_MILES': '50 mi',
  '100_MILES': '100 mi',
  '500_MILES': '500 mi',
  NATIONAL: 'National',
  GLOBAL: 'Global'
};

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export function ProspectSearchHistory({ requisitionId }: { requisitionId: string }) {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async (preferredId?: string) => {
    try {
      setError('');
      const response = await fetch(`/api/requisitions/${requisitionId}/prospects?view=history`, { cache: 'no-store' });
      const body = await response.json() as HistoryPayload & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Unable to load search history.');
      setHistory(body.history || []);
      setSelectedId(preferredId || body.search?.id || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load search history.');
    } finally {
      setLoading(false);
    }
  }, [requisitionId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    function searchesChanged(event: Event) {
      const detail = (event as CustomEvent<ProspectSearchesChangedDetail>).detail;
      if (detail?.requisitionId === requisitionId) void loadHistory(detail.searchId);
    }
    window.addEventListener(PROSPECT_SEARCHES_CHANGED_EVENT, searchesChanged);
    return () => window.removeEventListener(PROSPECT_SEARCHES_CHANGED_EVENT, searchesChanged);
  }, [loadHistory, requisitionId]);

  function selectSearch(searchId: string) {
    setSelectedId(searchId);
    window.dispatchEvent(new CustomEvent(PROSPECT_SEARCH_FOCUS_EVENT, {
      detail: { requisitionId, searchId }
    }));
  }

  if (loading) return <p className={styles.status}>Loading saved searches…</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!history.length) return <div className={styles.empty}><strong>No saved searches yet</strong><span>Your first sourcing run will appear here automatically.</span></div>;

  return (
    <div className={styles.history}>
      <header>
        <span>Search history</span>
        <small>{history.length} saved</small>
      </header>
      <div className={styles.list}>
        {history.map((item, index) => {
          const config = item.search_strategy?.config;
          const location = config?.targetLocation || (config?.searchScope === 'GLOBAL' ? 'Worldwide' : 'Location not specified');
          const scope = SCOPE_LABELS[config?.searchScope || ''] || 'Custom scope';
          const market = item.search_strategy?.marketAnalysis?.scarcityLevel;
          const selected = selectedId === item.id;
          return (
            <button
              type="button"
              key={item.id}
              className={`${styles.item} ${selected ? styles.selected : ''}`}
              onClick={() => selectSearch(item.id)}
              aria-pressed={selected}
            >
              <span className={styles.itemTop}><strong>{index === 0 ? 'Latest search' : formatTimestamp(item.created_at)}</strong><em className={item.isCurrentCriteria ? styles.current : styles.prior}>{item.isCurrentCriteria ? 'Current criteria' : 'Prior criteria'}</em></span>
              {index === 0 && <time dateTime={item.created_at}>{formatTimestamp(item.created_at)}</time>}
              <span className={styles.location}>{location}</span>
              <span className={styles.meta}><span>{scope}</span><span>{item.prospectCount} {item.prospectCount === 1 ? 'prospect' : 'prospects'}</span>{market && <span>{market} market</span>}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.help}>Select a search to reopen its results. Reviewing saved results never uses QC.</p>
    </div>
  );
}
