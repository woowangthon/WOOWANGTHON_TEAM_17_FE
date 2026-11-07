export const UNKNOWN_RESULT_MS = 24 * 60 * 60 * 1000;
const pendingStore = 'osami-live-entry-request-v1';
const generationStore = 'osami-live-session-generation-v1';
const lifecycleLock = 'osami-live-session-bootstrap';
const unsafeRetryMessage = '요청 결과를 안전하게 확인할 수 없어요. 중복 방지를 위해 다시 보내지 않았습니다. 이 기기의 여행 목록에서 결과를 확인해 주세요.';
// oxlint-disable-next-line no-control-regex -- The API contract explicitly rejects C0/C1 controls and Unicode line separators.
const controlChars = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const codePoints = (value) => Array.from(value).length;
function hasLoneSurrogate(value) {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

export function validateEntry(mode, input) {
  const rawName = String(input.name ?? '');
  const rawNickname = String(input.nickname ?? '');
  const rawInviteCode = String(input.inviteCode ?? '');
  const rawFields = mode === 'create' ? [['name', rawName], ['nickname', rawNickname]] : [['inviteCode', rawInviteCode], ['nickname', rawNickname]];
  for (const [field, value] of rawFields) {
    if (controlChars.test(value)) return { field, error: '줄바꿈이나 제어 문자는 입력할 수 없어요.' };
    if (hasLoneSurrogate(value)) return { field, error: '올바르지 않은 문자가 포함되어 있어요.' };
  }
  const name = rawName.trim();
  const nickname = rawNickname.trim();
  const inviteCodeTrimmed = rawInviteCode.trim();
  const inviteCode = inviteCodeTrimmed;
  const checks = mode === 'create' ? [['name', name, 40], ['nickname', nickname, 20]] : [['inviteCode', inviteCodeTrimmed, 20], ['nickname', nickname, 20]];
  for (const [field, value, max] of checks) {
    if (controlChars.test(value)) return { field, error: '줄바꿈이나 제어 문자는 입력할 수 없어요.' };
    if (!value) return { field, error: field === 'inviteCode' ? '초대 코드를 입력해 주세요.' : field === 'name' ? '여행방 이름을 입력해 주세요.' : '닉네임을 입력해 주세요.' };
    if (field !== 'inviteCode' && codePoints(value) > max) return { field, error: `${field === 'name' ? '여행방 이름은' : '닉네임은'} ${max}자 이내로 입력해 주세요.` };
  }
  if (mode === 'join' && !/^[A-Za-z0-9-]{1,20}$/u.test(inviteCode)) return { field: 'inviteCode', error: '초대 코드를 확인해 주세요.' };
  return { values: mode === 'create' ? { name, nickname } : { inviteCode: inviteCode.toUpperCase(), nickname } };
}


function readPending(storage) {
  try { return JSON.parse(storage?.getItem(pendingStore) ?? 'null'); } catch { return null; }
}
function writePending(storage, pending) {
  try { if (pending) storage?.setItem(pendingStore, JSON.stringify(pending)); else storage?.removeItem(pendingStore); } catch { /* storage may be disabled */ }
}
function getSessionStorage() {
  try { return globalThis.sessionStorage; } catch { return null; }
}
function getLocalStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}
function readGeneration(storage) {
  try { return storage?.getItem(generationStore) ?? null; } catch { return null; }
}
function writeGeneration(storage, generation) {
  try {
    storage?.setItem(generationStore, generation);
    if (storage?.getItem(generationStore) !== generation) throw new Error();
  } catch {
    throw new Error('이 브라우저에서는 안전한 기기 연결 상태를 보관할 수 없어요. 브라우저 저장 기능을 확인해 주세요.');
  }
}

export class LiveEntryClient {
  constructor({ fetcher = (...args) => globalThis.fetch(...args), locks = navigator.locks, storage = getSessionStorage(), sharedStorage = getLocalStorage(), now = Date.now, randomUUID = () => crypto.randomUUID() } = {}) {
    this.fetcher = fetcher; this.locks = locks; this.storage = storage; this.sharedStorage = sharedStorage; this.now = now; this.randomUUID = randomUUID;
    this.sessionPromise = null;
  }
  async post(path, body, key) {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    const response = await this.fetcher(`/api/v1/${path}`, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) });
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) { const error = new Error(data?.error?.message || '요청을 처리하지 못했어요. 입력을 확인하고 다시 시도해 주세요.'); error.status = response.status; error.code = data?.error?.code ?? null; error.retryAfter = response.headers?.get?.('Retry-After') ?? null; error.fieldErrors = data?.error?.fieldErrors ?? null; throw error; }
    return data;
  }
  ensureSession() {
    if (!this.locks?.request) throw new Error('이 브라우저에서는 안전한 기기 연결을 시작할 수 없어요. 최신 Chrome이나 Edge를 사용해 주세요.');
    if (!this.sessionPromise) this.sessionPromise = this.locks.request(lifecycleLock, async () => {
      const generation = this.randomUUID();
      writeGeneration(this.sharedStorage, generation);
      await this.post('device-session', {});
      return generation;
    }).catch((error) => { this.sessionPromise = null; throw error; });
    return this.sessionPromise;
  }
  async submit(mode, input) {
    const validation = validateEntry(mode, input);
    if ('field' in validation) throw Object.assign(new Error(validation.error), { field: validation.field });
    const body = validation.values;
    const path = mode === 'create' ? 'trips' : 'trip-memberships';
    const fingerprint = JSON.stringify({ path, body });
    let pending = readPending(this.storage);
    if (pending?.blocked) throw new Error(pending.blockedMessage || unsafeRetryMessage);
    if (pending && this.now() - pending.createdAt >= UNKNOWN_RESULT_MS) throw new Error(unsafeRetryMessage);
    if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, key: this.randomUUID(), createdAt: this.now() };
    writePending(this.storage, pending);
    let entryRequestStarted = false;
    try {
      if (readPending(this.storage)?.key !== pending.key) throw new Error('요청 상태를 안전하게 보관할 수 없어요. 브라우저 저장 기능을 확인해 주세요.');
      if (!pending.reuseSession) await this.ensureSession();
      if (!this.locks?.request) throw new Error('이 브라우저에서는 안전한 기기 연결을 시작할 수 없어요. 최신 Chrome이나 Edge를 사용해 주세요.');
      const result = await this.locks.request(lifecycleLock, async () => {
        const currentPending = readPending(this.storage);
        if (currentPending?.key !== pending.key) throw new Error('요청 상태를 안전하게 보관할 수 없어요. 브라우저 저장 기능을 확인해 주세요.');
        if (currentPending.blocked) throw new Error(currentPending.blockedMessage || unsafeRetryMessage);
        const currentGeneration = readGeneration(this.sharedStorage);
        if (pending.reuseSession) {
          if (!pending.generation || !currentGeneration || pending.generation !== currentGeneration) {
            const blocked = { ...currentPending, blocked: true, blockedMessage: unsafeRetryMessage };
            writePending(this.storage, blocked);
            throw new Error(unsafeRetryMessage);
          }
        } else {
          if (!currentGeneration) throw new Error('이 브라우저에서는 안전한 기기 연결 상태를 확인할 수 없어요. 브라우저 저장 기능을 확인해 주세요.');
          pending = { ...currentPending, generation: currentGeneration, reuseSession: true };
          writePending(this.storage, pending);
          if (readPending(this.storage)?.key !== pending.key || readPending(this.storage)?.generation !== currentGeneration) throw new Error('요청 상태를 안전하게 보관할 수 없어요. 브라우저 저장 기능을 확인해 주세요.');
        }
        entryRequestStarted = true;
        const response = await this.post(path, body, pending.key);
        if (!response || typeof response.trip?.id !== 'string' || !response.trip.id || typeof response.member?.nickname !== 'string' || !response.member.nickname) {
          throw new Error('여행방 응답을 확인할 수 없어요. 같은 입력으로 다시 시도해 주세요.');
        }
        return response;
      });
      writePending(this.storage, null);
      this.sessionPromise = null;
      return result;
    } catch (error) {
      const retryableConflict = error.status === 409 && error.code === 'REQUEST_IN_PROGRESS';
      const retryableRateLimit = error.status === 429;
      if (entryRequestStarted && error.status === 401) {
        const blocked = { ...pending, reuseSession: true, blocked: true, blockedMessage: unsafeRetryMessage };
        writePending(this.storage, blocked);
      } else if (error.status && error.status < 500 && !retryableConflict && !retryableRateLimit) writePending(this.storage, null);
      else if (entryRequestStarted) { pending.reuseSession = true; writePending(this.storage, pending); }
      throw error;
    }
  }
}

export async function reconnectTrip(tripId, fetcher = fetch) {
  if (!tripId) throw new Error('여행방을 선택해 주세요.');
  const response = await fetcher(`/api/v1/trips/${encodeURIComponent(tripId)}/reconnect`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) { const error = new Error(data?.error?.message || '여행방을 불러오지 못했어요.'); error.status = response.status; throw error; }
  return data;
}
