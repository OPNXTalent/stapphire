export type ProspectScarcityLevel = 'BROAD' | 'COMPETITIVE' | 'SCARCE' | 'UNICORN';

export type ProspectFunnel = {
  totalTracks?: number;
  completedTracks?: number;
  reviewed?: number;
  qualified?: number;
};

export function observedScarcityLevel(
  progress: ProspectFunnel,
  fallback: ProspectScarcityLevel,
  terminal: boolean
): ProspectScarcityLevel {
  const totalTracks = progress.totalTracks || 0;
  const completedTracks = progress.completedTracks || 0;
  const reviewed = progress.reviewed || 0;
  const qualified = progress.qualified || 0;
  const allPathsComplete = totalTracks > 0 && completedTracks >= totalTracks;
  const clearanceRate = reviewed > 0 ? qualified / reviewed : 0;

  // While final screening is still underway, 0 cleared from a meaningful
  // sample across every planned search path is already useful recruiter
  // intelligence. It is provisional, but it is no longer merely a
  // theoretical "competitive" market.
  if (qualified === 0 && ((allPathsComplete && reviewed >= 16) || (terminal && reviewed >= 8))) return 'UNICORN';
  if (!terminal) return fallback;
  if (reviewed >= 12 && (qualified <= 2 || clearanceRate < 0.15)) return 'SCARCE';
  if (qualified >= 8 && completedTracks <= 2) return 'BROAD';
  return 'COMPETITIVE';
}

export function provisionalUnicornSummary(reviewed: number, remaining: number): string {
  return `Observed search evidence is tracking at unicorn-level difficulty: 0 of ${reviewed} reviewed identities have cleared across all search paths${remaining > 0 ? `, with ${remaining} still under review` : ''}. This does not mean no qualified person exists; it means one is proving exceptionally difficult to identify under the current scope and criteria.`;
}
