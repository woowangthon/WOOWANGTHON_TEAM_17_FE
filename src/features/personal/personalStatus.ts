import type { PersonalConfirmation } from './personalApi.ts';
import type { PersonalDraft } from '../room/roomData.ts';

export type PersonalSaveStatus = 'loading' | 'saving' | 'unsaved' | 'saved' | 'confirmed' | 'unknown' | 'empty';

export type PersonalSaveStatusInput = {
  state: 'loading' | 'ready' | 'error' | 'fatal';
  phase: 'idle' | 'saving' | 'analyzing' | 'confirming';
  dirty: boolean;
  savedDraft: PersonalDraft;
  preferenceVersion: number;
  confirmation: PersonalConfirmation | null;
  conditionsChanged: boolean;
};

function hasPersistedDraft(draft: PersonalDraft): boolean {
  return Boolean(draft.originalText || draft.likes || draft.avoid || draft.food || draft.walking);
}

export function derivePersonalSaveStatus(input: PersonalSaveStatusInput): PersonalSaveStatus {
  if (input.state === 'loading') return 'loading';
  if (input.phase !== 'idle') return 'saving';
  if (input.state === 'error' || input.state === 'fatal' || input.conditionsChanged) return 'unknown';
  if (input.dirty) return 'unsaved';

  const confirmation = input.confirmation;
  if (
    confirmation?.status === 'confirmed' &&
    confirmation.confirmedConditionsVersion !== null &&
    confirmation.confirmedPreferenceVersion === input.preferenceVersion
  ) return 'confirmed';

  if (hasPersistedDraft(input.savedDraft) || input.preferenceVersion > 0) return 'saved';
  return 'empty';
}
