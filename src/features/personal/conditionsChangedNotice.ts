export type ConditionsNoticeState = {
  observedVersion: number | null;
  pendingVersion: number | null;
};

export type ConditionsNoticeEvent =
  | { type: 'observe'; conditionsVersion: number }
  | { type: 'confirmed'; conditionsVersion: number }
  | { type: 'reset' };

export const initialConditionsNoticeState: ConditionsNoticeState = {
  observedVersion: null,
  pendingVersion: null,
};

/** Tracks condition-version changes independently from personal-preparation loading state. */
export function transitionConditionsNotice(
  state: ConditionsNoticeState,
  event: ConditionsNoticeEvent,
): ConditionsNoticeState {
  if (event.type === 'reset') return initialConditionsNoticeState;

  if (event.type === 'observe') {
    const version = event.conditionsVersion;
    if (state.observedVersion === null) return { observedVersion: version, pendingVersion: null };
    if (version <= state.observedVersion) return state;

    // Version zero is the uninitialized baseline. The first saved conditions
    // version establishes a baseline too, so existing trips do not get a notice.
    if (state.observedVersion === 0 && state.pendingVersion === null) {
      return { observedVersion: version, pendingVersion: null };
    }

    return { observedVersion: version, pendingVersion: version };
  }

  if (
    state.pendingVersion === null ||
    event.conditionsVersion < state.pendingVersion ||
    event.conditionsVersion !== state.observedVersion
  ) return state;

  return { ...state, pendingVersion: null };
}
