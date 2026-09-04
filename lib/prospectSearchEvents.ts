export const PROSPECT_SEARCH_FOCUS_EVENT = 'stapphire:prospect-search-focus';
export const PROSPECT_SEARCHES_CHANGED_EVENT = 'stapphire:prospect-searches-changed';

export type ProspectSearchFocusDetail = {
  requisitionId: string;
  searchId: string;
};

export type ProspectSearchesChangedDetail = ProspectSearchFocusDetail;
