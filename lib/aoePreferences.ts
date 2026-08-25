import { AREAS_OF_EVALUATION } from './interviewQuestionBank';

export const AOE_PREFERENCES_CHANGED_EVENT = 'stapphire:aoe-preferences-changed';

export type AoePreferences = {
  hiddenStandardAreas: string[];
  customAreas: string[];
};

export const DEFAULT_AOE_PREFERENCES: AoePreferences = {
  hiddenStandardAreas: [],
  customAreas: []
};

export function activeAoeAreas(preferences: AoePreferences): string[] {
  const hidden = new Set(preferences.hiddenStandardAreas);
  return [
    ...AREAS_OF_EVALUATION.filter((area) => !hidden.has(area)),
    ...preferences.customAreas
  ];
}
