import type { RoomDraft } from '../room/roomData.ts';

export const CHUNGBUK_REGIONS = [
  { value: '충북 청주', label: '청주시' },
  { value: '충북 충주', label: '충주시' },
  { value: '충북 제천', label: '제천시' },
  { value: '충북 보은', label: '보은군' },
  { value: '충북 옥천', label: '옥천군' },
  { value: '충북 영동', label: '영동군' },
  { value: '충북 증평', label: '증평군' },
  { value: '충북 진천', label: '진천군' },
  { value: '충북 괴산', label: '괴산군' },
  { value: '충북 음성', label: '음성군' },
  { value: '충북 단양', label: '단양군' },
] as const;

export type RegionSelection = {
  kind: 'unset' | 'all' | 'specific' | 'legacy';
  value: string;
  label: string;
};

const allRegionValues = new Set(['충북', '충청북도', '충북 전체']);
const cityAliases = new Map<string, (typeof CHUNGBUK_REGIONS)[number]>(
  CHUNGBUK_REGIONS.flatMap((region) => {
    const name = region.value.replace('충북 ', '');
    return [[region.value, region], [name, region], [region.label, region]];
  }),
);

/** Interpret legacy persisted region strings without rewriting their stored value. */
export function regionSelection(value: string): RegionSelection {
  if (!value) return { kind: 'unset', value, label: '' };
  if (allRegionValues.has(value)) return { kind: 'all', value, label: '충북 전체' };

  const normalized = value.trim();
  if (/^(?:충북|충청북도)\s*전체$/u.test(normalized)) return { kind: 'all', value, label: '충북 전체' };
  const cityName = normalized.replace(/^(?:충북|충청북도)\s*/u, '');
  const match = cityAliases.get(cityName);
  if (match && /^(?:(?:충북|충청북도)\s*)?(?:청주(?:시)?|충주(?:시)?|제천(?:시)?|보은(?:군)?|옥천(?:군)?|영동(?:군)?|증평(?:군)?|진천(?:군)?|괴산(?:군)?|음성(?:군)?|단양(?:군)?)$/u.test(normalized)) {
    return { kind: 'specific', value, label: match.label };
  }
  return { kind: 'legacy', value, label: value };
}

/** Use the latest hidden values when saving the simplified visible form. */
export function withPreservedHiddenConditions(visibleDraft: RoomDraft, latest: RoomDraft | null): RoomDraft {
  return {
    ...visibleDraft,
    lodging: latest?.lodging ?? visibleDraft.lodging,
    fixedSchedule: latest?.fixedSchedule ?? visibleDraft.fixedSchedule,
  };
}
