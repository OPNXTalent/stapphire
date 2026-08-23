'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type RequisitionView = 'requisition' | 'candidates';
export type RequisitionTab = 'job-description' | 'hiring-criteria' | 'interviews';
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

const VIEW_VALUES: RequisitionView[] = ['requisition', 'candidates'];
const TAB_VALUES: RequisitionTab[] = ['job-description', 'hiring-criteria', 'interviews'];
const PANEL_VALUES: PanelTab[] = ['teamwork', 'upload'];

const PARAM_KEYS = { view: 'view', requisitionTab: 'tab', panelTab: 'panel' } as const;

function readStateFromParams(params: URLSearchParams): Partial<RequisitionViewState> {
  const result: Partial<RequisitionViewState> = {};
  const view = params.get(PARAM_KEYS.view);
  if (view && (VIEW_VALUES as string[]).includes(view)) result.view = view as RequisitionView;
  const tab = params.get(PARAM_KEYS.requisitionTab);
  if (tab && (TAB_VALUES as string[]).includes(tab)) result.requisitionTab = tab as RequisitionTab;
  const panel = params.get(PARAM_KEYS.panelTab);
  if (panel && (PANEL_VALUES as string[]).includes(panel)) result.panelTab = panel as PanelTab;
  return result;
}

type ContextValue = {
  getState: (requisitionId: string) => RequisitionViewState;
  setState: (requisitionId: string, patch: Partial<RequisitionViewState>) => void;
  subscribe: (requisitionId: string, listener: () => void) => () => void;
  syncFromUrl: (requisitionId: string, params: Partial<RequisitionViewState>) => void;
};

const RequisitionViewStateContext = createContext<ContextValue | null>(null);

export function RequisitionViewStateProvider({ children }: { children: ReactNode }) {
  const store = useRef<Map<string, RequisitionViewState>>(new Map());
  const listeners = useRef<Map<string, Set<() => void>>>(new Map());

  const getState = useCallback((requisitionId: string) => store.current.get(requisitionId) || DEFAULT_STATE, []);

  const setState = useCallback((requisitionId: string, patch: Partial<RequisitionViewState>) => {
    const current = store.current.get(requisitionId) || DEFAULT_STATE;
    store.current.set(requisitionId, { ...current, ...patch });
    listeners.current.get(requisitionId)?.forEach((listener) => listener());
  }, []);

  const syncFromUrl = useCallback((requisitionId: string, patch: Partial<RequisitionViewState>) => {
    if (Object.keys(patch).length === 0) return;
    const current = store.current.get(requisitionId) || DEFAULT_STATE;
    const next = { ...current, ...patch };
    if (next.view === current.view && next.requisitionTab === current.requisitionTab && next.panelTab === current.panelTab) return;
    store.current.set(requisitionId, next);
    listeners.current.get(requisitionId)?.forEach((listener) => listener());
  }, []);

  const subscribe = useCallback((requisitionId: string, listener: () => void) => {
    if (!listeners.current.has(requisitionId)) listeners.current.set(requisitionId, new Set());
    listeners.current.get(requisitionId)!.add(listener);
    return () => listeners.current.get(requisitionId)?.delete(listener);
  }, []);

  const value = useMemo<ContextValue>(() => ({ getState, setState, subscribe, syncFromUrl }), [getState, setState, subscribe, syncFromUrl]);
  return <RequisitionViewStateContext.Provider value={value}>{children}</RequisitionViewStateContext.Provider>;
}

export function useRequisitionViewState(requisitionId: string) {
  const ctx = useContext(RequisitionViewStateContext);
  if (!ctx) throw new Error('useRequisitionViewState must be used within RequisitionViewStateProvider');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, forceRender] = useState(0);

  useEffect(() => {
    return ctx.subscribe(requisitionId, () => forceRender((n) => n + 1));
  }, [ctx, requisitionId]);

  const paramsKey = searchParams.toString();
  useEffect(() => {
    if (!requisitionId) return;
    const fromUrl = readStateFromParams(new URLSearchParams(paramsKey));
    ctx.syncFromUrl(requisitionId, fromUrl);
  }, [ctx, requisitionId, paramsKey]);

  const state = ctx.getState(requisitionId);

  const update = useCallback((patch: Partial<RequisitionViewState>) => {
    ctx.setState(requisitionId, patch);
    if (!requisitionId) return;
    const next = new URLSearchParams(window.location.search);
    if (patch.view) next.set(PARAM_KEYS.view, patch.view);
    if (patch.requisitionTab) next.set(PARAM_KEYS.requisitionTab, patch.requisitionTab);
    if (patch.panelTab) next.set(PARAM_KEYS.panelTab, patch.panelTab);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [ctx, requisitionId, router, pathname]);

  return { state, update };
}
