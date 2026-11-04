export type EntryMode = 'create' | 'join';
export type EntryField = 'tripName' | 'nickname' | 'inviteCode';
export type EntryValues = { tripName: string; nickname: string; inviteCode: string };
export type EntryResult = { mode: EntryMode; tripName: string; nickname: string; code: string };
export type EntryValidation = { values: EntryValues } | { field: EntryField; error: string };

// oxlint-disable-next-line no-control-regex -- The API contract explicitly rejects C0/C1 controls.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const INVITE_CODE_INPUT = /^[A-Za-z0-9-]{1,20}$/u;
const codePointLength = (value: string) => Array.from(value).length;

/** Apply the same input normalization before local mock calls and future API requests. */
export function validateEntryInput(mode: EntryMode, input: EntryValues): EntryValidation {
  const rawFields: EntryField[] = mode === 'create' ? ['tripName', 'nickname'] : ['inviteCode', 'nickname'];
  const controlField = rawFields.find((field) => CONTROL_CHARACTERS.test(input[field]));
  if (controlField) return { field: controlField, error: '줄바꿈이나 제어 문자는 입력할 수 없어요.' };

  const tripName = input.tripName.trim();
  const nickname = input.nickname.trim();
  const rawInviteCode = input.inviteCode.trim();
  const inviteCode = rawInviteCode.toUpperCase();
  if (mode === 'create' && !tripName) return { field: 'tripName', error: '여행 이름을 입력해 주세요.' };
  if (mode === 'join' && !inviteCode) return { field: 'inviteCode', error: '초대 코드를 입력해 주세요.' };
  if (!nickname) return { field: 'nickname', error: '닉네임을 입력해 주세요.' };
  if (mode === 'create' && codePointLength(tripName) > 40) return { field: 'tripName', error: '여행 이름은 공백을 정리한 뒤 40자 이내로 입력해 주세요.' };
  if (codePointLength(nickname) > 20) return { field: 'nickname', error: '닉네임은 공백을 정리한 뒤 20자 이내로 입력해 주세요.' };
  if (mode === 'join' && (!INVITE_CODE_INPUT.test(rawInviteCode) || codePointLength(inviteCode) > 20)) {
    return { field: 'inviteCode', error: '초대 코드는 영문 대문자, 숫자, 하이픈으로 20자 이내로 입력해 주세요.' };
  }
  return { values: { tripName, nickname, inviteCode } };
}

/** Local-only fixture. It has no HTTP, device session, or persistent reconnect behavior. */
export async function submitEntry(mode: EntryMode, values: EntryValues, signal: AbortSignal): Promise<EntryResult> {
  const validation = validateEntryInput(mode, values);
  if ('field' in validation) throw new Error(validation.error);
  const normalized = validation.values;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 450);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request aborted', 'AbortError'));
    }, { once: true });
  });
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (mode === 'join' && normalized.inviteCode !== 'CB-DEMO') {
    throw new Error('데모 참여 코드는 CB-DEMO예요. 코드를 확인해 주세요.');
  }
  return { mode, tripName: normalized.tripName || '초대 코드 데모', nickname: normalized.nickname, code: 'CB-DEMO' };
}
