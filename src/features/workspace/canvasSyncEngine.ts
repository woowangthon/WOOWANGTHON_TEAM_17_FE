import { CanvasHttpError, getCanvas, saveCanvas } from './canvasApi.ts';
import { mergeCanvasDocuments, parseCanvasDocument, type CanvasDocument, type CanvasState } from './canvasModel.ts';
import { reserveCanvasSave, type PendingCanvasSave } from './canvasSyncModel.ts';

export type CanvasSyncStatus = 'loading' | 'saved' | 'saving' | 'offline' | 'conflict' | 'error';
type HistoryEntry = { id: string; before: CanvasDocument; after: CanvasDocument };
type Travel = { direction: 'undo' | 'redo'; entry: HistoryEntry };
type SaveRequest = PendingCanvasSave & { actionIds: string[]; travel: Travel | null };
type Conflict = { base: CanvasDocument; local: CanvasDocument; remote: CanvasState };
export type CanvasTransport = {
  load: (signal?: AbortSignal) => Promise<CanvasState>;
  save: (request: PendingCanvasSave) => Promise<CanvasState>;
};
export type CanvasSyncSnapshot = {
  state: CanvasState | null;
  document: CanvasDocument | null;
  status: CanvasSyncStatus;
  message: string;
  canUndo: boolean;
  canRedo: boolean;
};
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const authorizationFailure = (error: unknown) => error instanceof CanvasHttpError
  && (error.status === 401 || error.status === 403 || error.code === 'TRIP_NOT_ACCESSIBLE' || error.code === 'TRIP_CLOSED');

/** Owns acknowledged history, optimistic edits and exactly one unresolved write. */
export class CanvasSyncEngine {
  private acknowledged: CanvasState | null = null;
  private local: CanvasDocument | null = null;
  private status: CanvasSyncStatus = 'loading';
  private message = '';
  private pending: SaveRequest | null = null;
  private writing = false;
  private reading = false;
  private deferredRemote: CanvasState | null = null;
  private conflict: Conflict | null = null;
  private queued: HistoryEntry[] = [];
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private travel: Travel | null = null;
  private fatal = false;
  private accessEpoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private tripId: string;
  private preview: boolean;
  private transport: CanvasTransport;
  private autoSave: boolean;
  private snapshot: CanvasSyncSnapshot;

  constructor(tripId: string, options: { preview?: boolean; autoSave?: boolean; transport?: CanvasTransport } = {}) {
    this.tripId = tripId;
    this.preview = options.preview ?? false;
    this.autoSave = options.autoSave ?? true;
    this.transport = options.transport ?? {
      load: (signal) => getCanvas(tripId, { signal }),
      save: (request) => saveCanvas(tripId, request.revision, request.body, request.key),
    };
    if (this.preview) {
      const initial: CanvasState = { tripId, revision: 0, document: {
        schemaVersion: 3, days: [{ id: crypto.randomUUID(), date: null }], nodes: [], edges: [],
      }, places: [], sourcePlan: null, updatedAt: new Date().toISOString() };
      this.acknowledged = initial;
      this.local = initial.document;
      this.status = 'saved';
    }
    this.snapshot = this.buildSnapshot();
  }

  private buildSnapshot(): CanvasSyncSnapshot {
    const idle = this.status === 'saved' && !this.pending && !this.writing && !this.conflict
      && !this.travel && this.queued.length === 0;
    return { state: this.acknowledged, document: this.local, status: this.status, message: this.message,
      canUndo: idle && this.past.length > 0, canRedo: idle && this.future.length > 0 };
  }
  getSnapshot = () => this.snapshot;
  acceptImportedState = (state: CanvasState) => {
    if (state.tripId !== this.tripId || this.preview) return;
    this.receive(state);
    this.emit();
    this.schedule();
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.autoSave || this.preview || this.status !== 'saving' || this.conflict || this.writing) return;
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, 350);
  }
  private setConflict(base: CanvasDocument, local: CanvasDocument, remote: CanvasState) {
    this.acknowledged = remote;
    this.local = local;
    this.conflict = { base, local, remote };
    this.status = 'conflict';
    this.message = '같은 항목을 함께 수정했어요. 내 편집을 유지하거나 겹친 부분에 상대 편집을 적용해 주세요.';
  }
  private invalidTravel(remote: CanvasState) {
    this.acknowledged = remote;
    this.local = remote.document;
    this.travel = null;
    this.queued = [];
    this.status = 'saved';
    this.message = '다른 참여자의 수정을 덮어쓸 수 있어 실행 취소·다시 실행을 적용하지 않았어요.';
  }
  private completeTravel(travel: Travel) {
    if (travel.direction === 'undo') {
      this.past = this.past.filter((entry) => entry.id !== travel.entry.id);
      this.future.push(travel.entry);
    } else {
      this.future = this.future.filter((entry) => entry.id !== travel.entry.id);
      this.past = [...this.past, travel.entry].slice(-50);
    }
    this.travel = null;
  }
  private settleMergedDraft() {
    if (this.acknowledged && this.local && equal(this.local, this.acknowledged.document)) {
      if (this.travel) this.completeTravel(this.travel);
      this.queued = [];
      this.status = 'saved';
    } else this.status = 'saving';
  }
  private receive(remote: CanvasState) {
    if (remote.tripId !== this.tripId || (this.acknowledged && remote.revision <= this.acknowledged.revision)) return;
    if (this.pending || this.writing) {
      if (!this.deferredRemote || remote.revision > this.deferredRemote.revision) this.deferredRemote = remote;
      return;
    }
    if (!this.acknowledged || !this.local) {
      this.acknowledged = remote; this.local = remote.document; this.status = 'saved'; this.message = ''; this.fatal = false;
      return;
    }
    if (this.conflict) {
      this.conflict = { ...this.conflict, local: this.local, remote };
      this.acknowledged = remote;
      return;
    }
    if (equal(this.local, this.acknowledged.document)) {
      if (this.travel) this.completeTravel(this.travel);
      this.queued = [];
      this.acknowledged = remote; this.local = remote.document; this.status = 'saved'; this.message = '';
      return;
    }
    const base = this.acknowledged.document;
    const merged = mergeCanvasDocuments(base, this.local, remote.document);
    if (!merged.document) {
      if (this.travel) this.invalidTravel(remote);
      else this.setConflict(base, this.local, remote);
      return;
    }
    this.acknowledged = remote;
    this.local = merged.document;
    this.settleMergedDraft();
  }

  update = (next: CanvasDocument | ((current: CanvasDocument) => CanvasDocument)): boolean => {
    if (!this.local || this.fatal || this.travel) return false;
    const candidate = typeof next === 'function' ? next(structuredClone(this.local)) : next;
    const parsed = parseCanvasDocument(candidate);
    if (!parsed) { this.message = '이 편집은 연결·날짜·댓글 규칙에 맞지 않아요.'; this.emit(); return false; }
    if (equal(parsed, this.local)) return false;
    const action: HistoryEntry = { id: crypto.randomUUID(), before: this.local, after: parsed };
    this.local = parsed;
    this.future = [];
    if (this.conflict) {
      this.conflict.local = parsed;
      this.status = 'conflict';
    } else if (this.preview && this.acknowledged) {
      this.past = [...this.past.slice(-49), action];
      this.acknowledged = { ...this.acknowledged, revision: this.acknowledged.revision + 1, document: parsed };
      this.status = 'saved';
    } else {
      this.queued.push(action);
      this.status = 'saving';
    }
    this.emit(); this.schedule();
    return true;
  };

  refresh = async (signal?: AbortSignal, allowRecovery = false): Promise<void> => {
    if (this.preview || this.reading || signal?.aborted || (this.fatal && !allowRecovery)) return;
    this.reading = true;
    const revision = this.acknowledged?.revision ?? -1;
    const accessEpoch = this.accessEpoch;
    try {
      const remote = await this.transport.load(signal);
      if (signal?.aborted || accessEpoch !== this.accessEpoch) return;
      if (remote.tripId !== this.tripId) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '다른 여행방의 응답을 적용하지 않았어요.');
      this.receive(remote);
      this.emit(); this.schedule();
    } catch (error) {
      if (signal?.aborted || accessEpoch !== this.accessEpoch) return;
      if (!authorizationFailure(error) && (this.acknowledged?.revision ?? -1) > revision) return;
      this.failure(error);
      this.emit();
    } finally { this.reading = false; }
  };

  private failure(error: unknown) {
    if (authorizationFailure(error)) {
      this.accessEpoch += 1;
      this.fatal = true; this.status = 'error'; this.local = null; this.acknowledged = null;
      this.pending = null; this.conflict = null; this.queued = []; this.past = []; this.future = [];
      this.travel = null; this.deferredRemote = null;
      this.message = '여행방 접근 권한을 확인해 주세요. 여행 시작 화면에서 다시 참여할 수 있어요.';
      return;
    }
    // A failed read cannot release a conflict or an unresolved write.
    if (!this.conflict) this.status = 'offline';
    this.message = error instanceof Error ? error.message : '연결을 확인하지 못했어요. 편집 내용은 화면에 남아 있어요.';
  }

  save = async (): Promise<void> => {
    if (this.preview || this.writing || this.conflict || this.fatal || !this.local || !this.acknowledged) return;
    if (!this.pending && equal(this.local, this.acknowledged.document)) {
      if (this.travel) this.completeTravel(this.travel);
      this.queued = []; this.status = 'saved'; this.emit(); return;
    }
    if (!this.pending) {
      this.pending = { ...reserveCanvasSave(null, this.local, this.acknowledged.revision, this.acknowledged.document),
        actionIds: this.queued.map((action) => action.id), travel: this.travel };
    }
    const request = this.pending;
    this.writing = true; this.status = 'saving'; this.emit();
    try {
      const saved = await this.transport.save(request);
      if (this.pending !== request) return;
      if (saved.tripId !== this.tripId || saved.revision <= request.revision) {
        throw new CanvasHttpError(502, 'INVALID_RESPONSE', '저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.');
      }
      this.pending = null;
      const acknowledgedIds = new Set(request.actionIds);
      if (request.travel) {
        this.completeTravel(request.travel);
      } else {
        this.past = [...this.past, ...this.queued.filter((entry) => acknowledgedIds.has(entry.id))].slice(-50);
      }
      this.queued = this.queued.filter((entry) => !acknowledgedIds.has(entry.id));
      const local = this.local ?? request.body;
      const merged = mergeCanvasDocuments(request.body, local, saved.document);
      this.acknowledged = saved;
      if (!merged.document) this.setConflict(request.body, local, saved);
      else { this.local = merged.document; this.settleMergedDraft(); this.message = ''; }
    } catch (error) {
      if (this.pending !== request) return;
      if (error instanceof CanvasHttpError && error.code === 'VERSION_CONFLICT') {
        // This response proves the PUT did not write; a rebased body gets a new key.
        this.pending = null;
        try {
          const remote = error.current ?? await this.transport.load();
          if (remote.tripId !== this.tripId) throw new Error('여행방 응답을 확인해 주세요.');
          if (request.travel) this.invalidTravel(remote);
          else {
            const local = this.local ?? request.body;
            const merged = mergeCanvasDocuments(request.base, local, remote.document);
            this.acknowledged = remote;
            if (!merged.document) this.setConflict(request.base, local, remote);
            else { this.local = merged.document; this.settleMergedDraft(); }
          }
        } catch (readError) { this.failure(readError); }
      } else if (error instanceof CanvasHttpError && [400, 404, 415, 422].includes(error.status)
        && error.code !== 'TRIP_NOT_ACCESSIBLE') {
        // A validation/unknown-place rejection proves there was no write.
        this.pending = null;
        this.travel = null;
        this.status = 'error';
        this.message = error.message;
      } else this.failure(error); // Unknown outcomes retain the exact pending body/key.
    } finally {
      this.writing = false;
      const remote = this.deferredRemote;
      this.deferredRemote = null;
      if (remote && !this.fatal) this.receive(remote);
      this.emit(); this.schedule();
    }
  };

  retry = () => {
    if (this.conflict) return;
    if (!this.acknowledged || !this.local || this.fatal) void this.refresh(undefined, true);
    else if (this.pending || !equal(this.local, this.acknowledged.document)) void this.save();
    else void this.refresh();
  };
  resolve = (choice: 'local' | 'remote') => {
    if (!this.conflict || !this.local) return;
    const { base, remote } = this.conflict;
    const merged = mergeCanvasDocuments(base, this.local, remote.document, choice);
    if (!merged.document) { this.message = '날짜나 연결이 겹쳐 적용할 수 없어요. 편집을 정리한 뒤 다시 선택해 주세요.'; this.emit(); return; }
    this.conflict = null; this.pending = null; this.travel = null;
    this.acknowledged = remote; this.local = merged.document;
    this.queued = equal(merged.document, remote.document) ? [] : [{ id: crypto.randomUUID(), before: remote.document, after: merged.document }];
    this.future = [];
    this.status = this.queued.length ? 'saving' : 'saved'; this.message = '';
    this.emit(); this.schedule();
  };
  private history(direction: 'undo' | 'redo'): boolean {
    if (!(direction === 'undo' ? this.snapshot.canUndo : this.snapshot.canRedo) || !this.local || !this.acknowledged) return false;
    const entry = (direction === 'undo' ? this.past : this.future).at(-1)!;
    const merged = mergeCanvasDocuments(direction === 'undo' ? entry.after : entry.before,
      direction === 'undo' ? entry.before : entry.after, this.local);
    if (!merged.document) { this.message = '다른 참여자가 이 항목을 수정해 실행 취소·다시 실행을 적용하지 않았어요.'; this.emit(); return false; }
    if (this.preview) {
      if (direction === 'undo') { this.past.pop(); this.future.push(entry); }
      else { this.future.pop(); this.past.push(entry); }
      this.local = merged.document; this.acknowledged = { ...this.acknowledged, document: merged.document };
    } else { this.travel = { direction, entry }; this.local = merged.document; this.status = 'saving'; }
    this.emit(); this.schedule(); return true;
  }
  undo = () => this.history('undo');
  redo = () => this.history('redo');
}
