'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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

const VIEW_VALUES: RequisitionView[] = ['requisition', 'candidates'];
const TAB_VALUES: RequisitionTab[] = ['job-description', 'hiring-criteria', 'market-analysis'];
const PANEL_VALUES: PanelTab[] = ['teamwork', 'upload'];

// Short, stable query param names - kept separate from any other
// params this app might use.
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

// Lives at the AppShell level (root layout), so - unlike component-local
// useState inside the requisition page tree, which remounts and resets
// on every navigation - this survives navigating away to a different
// requisition, the home page, or Archived, and back. Keyed per
// requisition id, so each requisition remembers its own last-viewed
// tab independently rather than sharing one global value.
//
// The in-memory map here is the fast, synchronous source of truth for
// rendering (avoids a round-trip through the URL/router on every tab
// click). The URL query string (view/tab/panel) is the durable,
// shareable copy, synced by useRequisitionViewState below - that's
// what survives an actual browser refresh or a shared link, which
// this in-memory store alone cannot do.
export function RequisitionViewStateProvider({ children }: { children: ReactNode }) {
  const store = useRef<Map<string, RequisitionViewState>>(new Map());
  const listeners = useRef<Map<string, Set<() => void>>>(new Map());

  const getState = useCallback((requisitionId: string) => store.current.get(requisitionId) || DEFAULT_STATE, []);

  const setState = useCallback((requisitionId: string, patch: Partial<RequisitionViewState>) => {
    const current = store.current.get(requisitionId) || DEFAULT_STATE;
    store.current.set(requisitionId, { ...current, ...patch });
    listeners.current.get(requisitionId)?.forEach((listener) => listener());
  }, []);

  // Seeds the in-memory store from URL params without notifying
  // listeners if nothing actually changed - avoids an extra render on
  // first mount when the URL already matches the default state.
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

// Behaves like useState, but the value is stored outside this
// component instance (in the provider above), keyed by requisitionId,
// and mirrored into the URL's query string. Multiple components
// (RequisitionViewToggle, WorkspacePanel) can call this for the same
// requisitionId - each update() call merges into the CURRENT url
// params read fresh at call time, so one component's update never
// clobbers another's param.
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

  // On mount (and whenever the URL's relevant params change - e.g. the
  // user opened a shared link, or used browser back/forward), seed the
  // in-memory store from the URL so a bookmarked/shared link opens to
  // the right tab instead of always defaulting.
  const paramsKey = searchParams.toString();
  useEffect(() => {
    if (!requisitionId) return;
    const fromUrl = readStateFromParams(new URLSearchParams(paramsKey));
    ctx.syncFromUrl(requisitionId, fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, requisitionId, paramsKey]);

  const state = ctx.getState(requisitionId);

  const update = useCallback((patch: Partial<RequisitionViewState>) => {
    ctx.setState(requisitionId, patch);
    if (!requisitionId) return;
    // Merge into the CURRENT url params (read fresh via window.location,
    // not the possibly-stale searchParams closure) so a concurrent
    // update from the other component sharing this page isn't lost.
    const next = new URLSearchParams(window.location.search);
    if (patch.view) next.set(PARAM_KEYS.view, patch.view);
    if (patch.requisitionTab) next.set(PARAM_KEYS.requisitionTab, patch.requisitionTab);
    if (patch.panelTab) next.set(PARAM_KEYS.panelTab, patch.panelTab);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [ctx, requisitionId, router, pathname]);

  return { state, update };
}
