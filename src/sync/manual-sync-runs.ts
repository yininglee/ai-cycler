export class ManualSyncInProgressError extends Error {}

export function createManualSyncState<T>() {
  return {
    active: new Map<string, { controller: AbortController; task: Promise<T | null>; operation: string | undefined }>(),
    disconnecting: new Map<string, Promise<void>>(),
  };
}

export class ManualSyncRuns<T> {
  private readonly state: ReturnType<typeof createManualSyncState<T>>;

  constructor(state = createManualSyncState<T>()) {
    this.state = state;
  }

  start(key: string, run: (signal: AbortSignal) => Promise<T | null>, operation?: string): Promise<T | null> {
    const { active, disconnecting } = this.state;
    if (disconnecting.has(key)) return Promise.resolve(null);
    const existing = active.get(key);
    if (existing) return existing.operation === operation ? existing.task : Promise.reject(new ManualSyncInProgressError());

    const controller = new AbortController();
    const task = run(controller.signal).finally(() => {
      if (active.get(key)?.controller === controller) active.delete(key);
    });
    active.set(key, { controller, task, operation });
    return task;
  }

  disconnect(key: string, removeConnection: () => Promise<void>): Promise<void> {
    const { active, disconnecting } = this.state;
    const pending = disconnecting.get(key);
    if (pending) return pending;
    const running = active.get(key);
    const task = removeConnection().then(() => {
      if (active.get(key) === running) active.delete(key);
      running?.controller.abort();
    }).finally(() => { disconnecting.delete(key); });
    disconnecting.set(key, task);
    return task;
  }
}

export function manualSyncKey(root: string, ownerId: string): string {
  return JSON.stringify([root, ownerId]);
}
