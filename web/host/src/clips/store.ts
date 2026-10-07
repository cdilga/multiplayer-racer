// Where the session recorder keeps a session (P1-F12): IndexedDB in the browser, memory in tests. Append-only for the
// journal (a chunk is written once), so recording never rewrites what it already stored. Nothing here touches the network.
import type { ClipWorld } from './types';

/** A world without its chunks (they are stored apart, one record each). */
export type WorldHeader = Omit<ClipWorld, 'chunks'>;

export interface SessionMeta {
  id: string;
  startedAt: string;
  build: string;
  /** Bytes this session holds in the store (what the budget counts). */
  bytes: number;
  /** The session summary and the rest of the file's non-journal content, as the recorder last wrote it. */
  doc: Record<string, unknown>;
  /** Journal records that didn't fit the budget (a dev-storage limit, never a gameplay one). */
  truncated: boolean;
}

export interface SessionStore {
  putMeta(meta: SessionMeta): Promise<void>;
  putWorld(session: string, header: WorldHeader): Promise<void>;
  /** Chunks `from`.. of a world, written once. */
  putChunks(session: string, world: number, from: number, chunks: string[]): Promise<void>;
  sessions(): Promise<SessionMeta[]>;
  /** A session's worlds, whole. */
  load(session: string): Promise<{ meta: SessionMeta; worlds: ClipWorld[] } | null>;
  remove(session: string): Promise<void>;
}

export class MemoryStore implements SessionStore {
  private metas = new Map<string, SessionMeta>();
  private worlds = new Map<string, Map<number, { header: WorldHeader; chunks: string[] }>>();

  async putMeta(meta: SessionMeta): Promise<void> {
    this.metas.set(meta.id, structuredClone(meta));
  }

  async putWorld(session: string, header: WorldHeader): Promise<void> {
    const m = this.worlds.get(session) ?? new Map();
    this.worlds.set(session, m);
    m.set(header.index, { header: structuredClone(header), chunks: m.get(header.index)?.chunks ?? [] });
  }

  async putChunks(session: string, world: number, from: number, chunks: string[]): Promise<void> {
    const w = this.worlds.get(session)?.get(world);
    if (!w) throw new Error(`no world ${world} in ${session}`);
    chunks.forEach((c, i) => (w.chunks[from + i] = c));
  }

  async sessions(): Promise<SessionMeta[]> {
    return [...this.metas.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async load(session: string) {
    const meta = this.metas.get(session);
    if (!meta) return null;
    const worlds = [...(this.worlds.get(session)?.values() ?? [])].sort((a, b) => a.header.index - b.header.index).map((w) => ({ ...w.header, chunks: [...w.chunks] }));
    return { meta, worlds };
  }

  async remove(session: string): Promise<void> {
    this.metas.delete(session);
    this.worlds.delete(session);
  }
}

const DB = 'jj-dev-sessions';

/** IndexedDB: `meta` (by id), `worlds` (by [session, index]) and `chunks` (by [session, world, seq]). */
export class IdbStore implements SessionStore {
  private db: Promise<IDBDatabase>;

  constructor(name = DB) {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('meta', { keyPath: 'id' });
        db.createObjectStore('worlds', { keyPath: ['session', 'header.index'] });
        db.createObjectStore('chunks', { keyPath: ['session', 'world', 'seq'] });
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }

  private async tx<T>(stores: string[], mode: IDBTransactionMode, f: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const req = f(tx);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async putMeta(meta: SessionMeta): Promise<void> {
    await this.tx(['meta'], 'readwrite', (tx) => tx.objectStore('meta').put(meta));
  }

  async putWorld(session: string, header: WorldHeader): Promise<void> {
    await this.tx(['worlds'], 'readwrite', (tx) => tx.objectStore('worlds').put({ session, header }));
  }

  async putChunks(session: string, world: number, from: number, chunks: string[]): Promise<void> {
    await this.tx(['chunks'], 'readwrite', (tx) => {
      const s = tx.objectStore('chunks');
      chunks.forEach((data, i) => s.put({ session, world, seq: from + i, data }));
    });
  }

  async sessions(): Promise<SessionMeta[]> {
    const all = (await this.tx(['meta'], 'readonly', (tx) => tx.objectStore('meta').getAll())) as SessionMeta[] | undefined;
    return (all ?? []).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async load(session: string) {
    const range = (a: unknown[], b: unknown[]) => IDBKeyRange.bound(a, b);
    const db = await this.db;
    const get = <T>(store: string, key: IDBKeyRange | IDBValidKey): Promise<T[]> =>
      new Promise((resolve, reject) => {
        const r = db.transaction([store], 'readonly').objectStore(store).getAll(key);
        r.onsuccess = () => resolve(r.result as T[]);
        r.onerror = () => reject(r.error);
      });
    const meta = (await get<SessionMeta>('meta', session))[0];
    if (!meta) return null;
    const headers = await get<{ header: WorldHeader }>('worlds', range([session, -Infinity], [session, Infinity]));
    const chunks = await get<{ world: number; seq: number; data: string }>('chunks', range([session, -Infinity, -Infinity], [session, Infinity, Infinity]));
    const worlds = headers
      .map((h) => ({ ...h.header, chunks: chunks.filter((c) => c.world === h.header.index).sort((a, b) => a.seq - b.seq).map((c) => c.data) }))
      .sort((a, b) => a.index - b.index);
    return { meta, worlds };
  }

  async remove(session: string): Promise<void> {
    await this.tx(['meta', 'worlds', 'chunks'], 'readwrite', (tx) => {
      tx.objectStore('meta').delete(session);
      tx.objectStore('worlds').delete(IDBKeyRange.bound([session, -Infinity], [session, Infinity]));
      tx.objectStore('chunks').delete(IDBKeyRange.bound([session, -Infinity, -Infinity], [session, Infinity, Infinity]));
    });
  }
}
