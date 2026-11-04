export type EntryMode = 'create' | 'join';

export type EntryResult = {
  mode: EntryMode;
  tripName: string;
  nickname: string;
  code: string;
};

/** Local-only interaction example. No room is created or joined. */
export async function submitEntry(mode: EntryMode, values: { tripName?: string; inviteCode?: string; nickname: string }, signal: AbortSignal): Promise<EntryResult> {
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 450);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request aborted', 'AbortError'));
    }, { once: true });
  });
  if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (mode === 'join' && values.inviteCode?.trim().toUpperCase() !== 'CB-DEMO') {
    throw new Error('데모 참여 코드는 CB-DEMO예요. 코드를 확인해 주세요.');
  }
  return { mode, tripName: values.tripName?.trim() || '초대 코드 데모', nickname: values.nickname.trim(), code: mode === 'create' ? 'OS-0427' : 'CB-DEMO' };
}
