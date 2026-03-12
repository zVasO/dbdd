// ---------------------------------------------------------------------------
// Fuzzy Search Bridge — main-thread interface to the fuzzy-search Web Worker
// ---------------------------------------------------------------------------

import type { SearchContext, ScoredItem } from '../workers/fuzzy-search.worker';

export type { SearchContext, ScoredItem };

// ---------------------------------------------------------------------------
// Worker outbound message types (what the worker sends back)
// ---------------------------------------------------------------------------

interface WorkerReadyMessage {
  type: 'ready';
}

interface WorkerResultsMessage {
  type: 'results';
  id: number;
  items: ScoredItem[];
}

type WorkerOutboundMessage = WorkerReadyMessage | WorkerResultsMessage;

// ---------------------------------------------------------------------------
// Schema data cache (for throttling & crash recovery)
// ---------------------------------------------------------------------------

interface SchemaData {
  tables: { name: string; database: string }[];
  columns: { name: string; table: string; type: string }[];
}

// ---------------------------------------------------------------------------
// Pending search tracker
// ---------------------------------------------------------------------------

interface PendingSearch {
  id: number;
  resolve: (items: ScoredItem[]) => void;
}

// ---------------------------------------------------------------------------
// Throttle interval for schema sync (ms)
// ---------------------------------------------------------------------------

const SCHEMA_SYNC_THROTTLE_MS = 500;

// ---------------------------------------------------------------------------
// Bridge class
// ---------------------------------------------------------------------------

export class FuzzySearchBridge {
  private worker: Worker;
  private nextId = 1;
  private latestRequestId = 0;
  private pendingSearch: PendingSearch | null = null;
  private pendingSync: SchemaData | null = null;
  private lastSyncTime = 0;
  private syncTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isDisposed = false;

  constructor() {
    this.worker = this.createWorker();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Sends schema data to the worker for index building.
   * Throttled: at most one sync-schema message per 500ms.
   */
  syncSchema(
    tables: { name: string; database: string }[],
    columns: { name: string; table: string; type: string }[],
  ): void {
    if (this.isDisposed) return;

    this.pendingSync = { tables, columns };

    const now = Date.now();
    const elapsed = now - this.lastSyncTime;

    if (elapsed >= SCHEMA_SYNC_THROTTLE_MS) {
      this.flushSync();
    } else {
      // Schedule a deferred sync if not already scheduled
      if (this.syncTimeoutId === null) {
        const delay = SCHEMA_SYNC_THROTTLE_MS - elapsed;
        this.syncTimeoutId = setTimeout(() => {
          this.syncTimeoutId = null;
          this.flushSync();
        }, delay);
      }
    }
  }

  /**
   * Searches the worker index. Auto-cancels any previous in-flight search.
   * Returns matching items sorted by score (descending).
   */
  search(
    input: string,
    context: SearchContext,
    options?: { limit?: number; resolvedTable?: string },
  ): Promise<ScoredItem[]> {
    if (this.isDisposed) {
      return Promise.resolve([]);
    }

    // Cancel previous in-flight search
    this.cancelPendingSearch();

    const id = this.nextId++;
    this.latestRequestId = id;

    // Send cancel message for previous request so worker can abort early
    if (id > 1) {
      this.worker.postMessage({ type: 'cancel', id: id - 1 });
    }

    return new Promise<ScoredItem[]>((resolve) => {
      this.pendingSearch = { id, resolve };

      this.worker.postMessage({
        type: 'search',
        id,
        input,
        context,
        limit: options?.limit ?? 50,
        resolvedTable: options?.resolvedTable,
      });
    });
  }

  /**
   * Terminates the worker and resolves any pending search with [].
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.syncTimeoutId !== null) {
      clearTimeout(this.syncTimeoutId);
      this.syncTimeoutId = null;
    }

    this.resolvePendingWithEmpty();
    this.worker.terminate();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private createWorker(): Worker {
    const worker = new Worker(
      new URL('../workers/fuzzy-search.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent<WorkerOutboundMessage>) => {
      this.handleMessage(e.data);
    };

    worker.onerror = (event: ErrorEvent) => {
      // Prevent unhandled error from propagating
      event.preventDefault();
      this.handleWorkerCrash();
    };

    return worker;
  }

  private handleMessage(msg: WorkerOutboundMessage): void {
    if (this.isDisposed) return;

    switch (msg.type) {
      case 'ready':
        // Schema index rebuilt — nothing to do on the bridge side
        break;

      case 'results': {
        // Ignore stale results
        if (msg.id < this.latestRequestId) break;

        if (this.pendingSearch !== null && this.pendingSearch.id === msg.id) {
          const { resolve } = this.pendingSearch;
          this.pendingSearch = null;
          resolve(msg.items);
        }
        break;
      }
    }
  }

  private handleWorkerCrash(): void {
    if (this.isDisposed) return;

    // Resolve any pending search gracefully
    this.resolvePendingWithEmpty();

    // Respawn
    try {
      this.worker.terminate();
    } catch {
      // Worker may already be dead — ignore
    }

    this.worker = this.createWorker();

    // Re-sync cached schema so the new worker has data
    if (this.pendingSync !== null) {
      this.flushSync();
    }
  }

  private cancelPendingSearch(): void {
    if (this.pendingSearch !== null) {
      const { id, resolve } = this.pendingSearch;
      this.pendingSearch = null;
      this.worker.postMessage({ type: 'cancel', id });
      resolve([]);
    }
  }

  private resolvePendingWithEmpty(): void {
    if (this.pendingSearch !== null) {
      const { resolve } = this.pendingSearch;
      this.pendingSearch = null;
      resolve([]);
    }
  }

  private flushSync(): void {
    if (this.isDisposed || this.pendingSync === null) return;

    this.lastSyncTime = Date.now();
    this.worker.postMessage({
      type: 'sync-schema',
      tables: this.pendingSync.tables,
      columns: this.pendingSync.columns,
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: FuzzySearchBridge | null = null;

export function getFuzzySearchBridge(): FuzzySearchBridge {
  if (instance === null) {
    instance = new FuzzySearchBridge();
  }
  return instance;
}

export function disposeFuzzySearchBridge(): void {
  if (instance !== null) {
    instance.dispose();
    instance = null;
  }
}
