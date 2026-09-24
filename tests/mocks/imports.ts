interface StorageChange {
  oldValue: unknown;
  newValue: unknown;
}

type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string
) => void;

type RuntimeMessageListener = (
  message: unknown,
  sender?: unknown,
  sendResponse?: (response?: unknown) => void
) => void | boolean;

type TabUpdatedListener = (
  tabId: number,
  changeInfo: { status?: string },
  tab?: { id?: number }
) => void;

type TabRemovedListener = (tabId: number, removeInfo?: unknown) => void;

const localStore = new Map<string, unknown>();
const changeListeners = new Set<StorageChangeListener>();
const runtimeMessageListeners = new Set<RuntimeMessageListener>();
const tabUpdatedListeners = new Set<TabUpdatedListener>();
const tabRemovedListeners = new Set<TabRemovedListener>();
let runtimeSendMessageHandler: (message: unknown) => Promise<unknown> = async () => ({
  success: true,
});
let tabsSendMessageHandler: (tabId: number, message: unknown) => Promise<unknown> = async () => ({
  success: true,
});

function emitStorageChange(key: string, oldValue: unknown, newValue: unknown): void {
  const changes: Record<string, StorageChange> = {
    [key]: { oldValue, newValue },
  };

  for (const listener of changeListeners) {
    listener(changes, "local");
  }
}

export const storage = {
  defineItem<T>(key: string, options: { fallback: T }) {
    return {
      async getValue(): Promise<T> {
        if (localStore.has(key)) {
          return localStore.get(key) as T;
        }
        return options.fallback;
      },
      async setValue(value: T): Promise<void> {
        const oldValue = localStore.has(key) ? localStore.get(key) : options.fallback;
        localStore.set(key, value);
        emitStorageChange(key, oldValue, value);
      },
    };
  },
};

export const browser = {
  storage: {
    onChanged: {
      addListener(listener: StorageChangeListener) {
        changeListeners.add(listener);
      },
      removeListener(listener: StorageChangeListener) {
        changeListeners.delete(listener);
      },
    },
  },
  runtime: {
    onMessage: {
      addListener(listener: RuntimeMessageListener) {
        runtimeMessageListeners.add(listener);
      },
      removeListener(listener: RuntimeMessageListener) {
        runtimeMessageListeners.delete(listener);
      },
    },
    async sendMessage(message: unknown) {
      return runtimeSendMessageHandler(message);
    },
  },
  tabs: {
    async sendMessage(tabId: number, message: unknown) {
      return tabsSendMessageHandler(tabId, message);
    },
    onUpdated: {
      addListener(listener: TabUpdatedListener) {
        tabUpdatedListeners.add(listener);
      },
      removeListener(listener: TabUpdatedListener) {
        tabUpdatedListeners.delete(listener);
      },
    },
    onRemoved: {
      addListener(listener: TabRemovedListener) {
        tabRemovedListeners.add(listener);
      },
      removeListener(listener: TabRemovedListener) {
        tabRemovedListeners.delete(listener);
      },
    },
  },
};

export function __setRuntimeSendMessageHandler(
  handler: (message: unknown) => Promise<unknown>
): void {
  runtimeSendMessageHandler = handler;
}

export function __setTabsSendMessageHandler(
  handler: (tabId: number, message: unknown) => Promise<unknown>
): void {
  tabsSendMessageHandler = handler;
}

export function __emitRuntimeMessage(message: unknown): void {
  for (const listener of runtimeMessageListeners) {
    listener(message, undefined, () => {});
  }
}

export function __dispatchRuntimeMessage(
  message: unknown,
  sender?: unknown
): Promise<unknown[]> {
  const responses: unknown[] = [];
  const promises: Promise<void>[] = [];

  for (const listener of runtimeMessageListeners) {
    promises.push(
      new Promise<void>((resolve) => {
        let settled = false;
        const sendResponse = (response?: unknown) => {
          responses.push(response);
          settled = true;
          resolve();
        };

        const result = listener(message, sender, sendResponse);

        if (result === true) {
          setTimeout(() => {
            if (!settled) resolve();
          }, 0);
          return;
        }

        if (!settled) resolve();
      })
    );
  }

  return Promise.all(promises).then(() => responses);
}

export function __emitTabUpdated(
  tabId: number,
  changeInfo: { status?: string } = {},
  tab: { id?: number } = { id: tabId }
): void {
  for (const listener of tabUpdatedListeners) {
    listener(tabId, changeInfo, tab);
  }
}

export function __emitTabRemoved(tabId: number, removeInfo?: unknown): void {
  for (const listener of tabRemovedListeners) {
    listener(tabId, removeInfo);
  }
}

export function __resetImportsMock(): void {
  localStore.clear();
  changeListeners.clear();
  runtimeMessageListeners.clear();
  tabUpdatedListeners.clear();
  tabRemovedListeners.clear();
  runtimeSendMessageHandler = async () => ({ success: true });
  tabsSendMessageHandler = async () => ({ success: true });
}
