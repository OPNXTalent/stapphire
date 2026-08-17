'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type RequisitionView = 'requisition' | 'candidates';
export type RequisitionTab = 'job-description' | 'hiring-criteria' | 'market-analysis';
export type PanelTab = 'teamwork' | 'upload';

type RequisitionViewState = {
  view: RequisitionView;
  requisitionTab: RequisitionTab;
  panelTab: PanelTab;
};

const DEFAULT_STATE: RequisitionViewState = {
  view: 'requisition',
  requisitionTab: 'job-description',
  panelTab: 'teamwork'
};

type ContextValue = {
  getState: (requisitionId: string) => RequisitionViewState;
  setState: (requisitionId: string, patch: Partial<RequisitionViewState>) => void;
  subscribe: (requisitionId: string, listener: () => void) => () => void;
};

const RequisitionViewStateContext = createContext<ContextValue | null>(null);

// Lives at the AppShell level (root layout), so - unlike component-local
// useState inside the requisition page tree, which remounts and resets
// on every navigation - this survives navigating away to a different
// requisition, the home page, or Archived, and back. Keyed per
// requisition id, so each requisition remembers its own last-viewed
// tab independently rather than sharing one global value.
export function RequisitionViewStateProvider({ children }: { children: ReactNode }) {
  const store = useRef<Map<string, RequisitionViewState>>(new Map());
  const listeners = useRef<Map<string, Set<() => void>>>(new Map());

  const getState = useCallback((requisitionId: string) => store.current.get(requisitionId) || DEFAULT_STATE, []);

  const setState = useCallback((requisitionId: string, patch: Partial<RequisitionViewState>) => {
    const current = store.current.get(requisitionId) || DEFAULT_STATE;
    store.current.set(requisitionId, { ...current, ...patch });
    listeners.current.get(requisitionId)?.forEach((listener) => listener());
  }, []);

  const subscribe = useCallback((requisitionId: string, listener: () => void) => {
    if (!listeners.current.has(requisitionId)) listeners.current.set(requisitionId, new Set());
    listeners.current.get(requisitionId)!.add(listener);
    return () => listeners.current.get(requisitionId)?.delete(listener);
  }, []);

  const value = useMemo<ContextValue>(() => ({ getState, setState, subscribe }), [getState, setState, subscribe]);
  return <RequisitionViewStateContext.Provider value={value}>{children}</RequisitionViewStateContext.Provider>;
}

// Behaves like useState, but the value is stored outside this
// component instance (in the provider above), keyed by requisitionId -
// so it survives this component unmounting and remounting.
export function useRequisitionViewState(requisitionId: string) {
  const ctx = useContext(RequisitionViewStateContext);
  if (!ctx) throw new Error('useRequisitionViewState must be used within RequisitionViewStateProvider');
  const [, forceRender] = useState(0);

  // Re-render this component when this requisitionId's state changes
  // elsewhere (e.g. WorkspacePanel updates panelTab while
  // RequisitionViewToggle is also mounted for the same requisition).
  useEffect(() => {
    return ctx.subscribe(requisitionId, () => forceRender((n) => n + 1));
  }, [ctx, requisitionId]);

  const state = ctx.getState(requisitionId);
  const update = useCallback((patch: Partial<RequisitionViewState>) => ctx.setState(requisitionId, patch), [ctx, requisitionId]);

  return { state, update };
}
