// Injected directly into the page's main world by Chrome (declared in the
// manifest with `world: "MAIN"`). Creates window.rsquared — the R2 Wallet
// dApp provider. All methods return Promises that resolve when the user
// approves (or rejects) in the extension popup.
//
// IMPORTANT: this file MUST NOT import from anywhere else. It runs in the
// page's main world, where dynamic imports of chrome-extension:// URLs may
// be blocked by the page's CSP. By keeping it self-contained, @crxjs's
// bundler produces a single chunk with no follow-on imports.

// Mirrored from lib/dapp-bridge.ts (intentionally inlined for isolation).
const INPAGE_SOURCE = "r2-wallet-inpage";
const CONTENT_SOURCE = "r2-wallet-content";
interface ContentResponse {
  source: typeof CONTENT_SOURCE;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  error?: string;
}

// Mirrored from lib/dapp-events.ts (intentionally inlined).
const DAPP_EVENT_SOURCE = "r2-wallet-event";
type DappEventName =
  | "connect"
  | "disconnect"
  | "accountsChanged"
  | "chainChanged";
interface DappEventEnvelope {
  source: typeof DAPP_EVENT_SOURCE;
  event: DappEventName;
  data?: unknown;
}

// Pending request callbacks, keyed by request ID.
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (r: string) => void }
>();

let requestCounter = 0;

function nextId(): string {
  return `r2-${Date.now()}-${++requestCounter}`;
}

// Send a request to the content-script and return a Promise.
function request(method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pending.set(id, { resolve, reject });
    window.postMessage(
      { source: INPAGE_SOURCE, id, method, params } satisfies {
        source: typeof INPAGE_SOURCE;
        id: string;
        method: string;
        params?: unknown;
      },
      "*"
    );
  });
}

// --- Event listeners (page-side subscription) -----------------------------

type EventListener = (data?: unknown) => void;
const listeners = new Map<DappEventName, Set<EventListener>>();

function emit(event: DappEventName, data?: unknown): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const cb of set) {
    try {
      cb(data);
    } catch {
      // Swallow listener errors so one bad subscriber doesn't break others.
    }
  }
}

// --- In-memory connected state (mirror of background storage) -------------
// Updated by connect/disconnect/accountsChanged events. The page can poll
// `isConnected()` for an authoritative answer (round-trips to the SW).

let connectedAccountName: string | null = null;

// Receive responses + push events from the content-script.
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;

  // Push events from the service worker (forwarded by content-script).
  if ((data as DappEventEnvelope).source === DAPP_EVENT_SOURCE) {
    const env = data as DappEventEnvelope;
    if (env.event === "connect") {
      const d = env.data as { accountName?: string } | undefined;
      if (d?.accountName) connectedAccountName = d.accountName;
    } else if (env.event === "disconnect") {
      connectedAccountName = null;
    } else if (env.event === "accountsChanged") {
      const d = env.data as { accounts?: string[] } | undefined;
      connectedAccountName = d?.accounts?.[0] ?? null;
    }
    emit(env.event, env.data);
    return;
  }

  // Response to a pending request.
  const resp = data as ContentResponse;
  if (resp.source !== CONTENT_SOURCE) return;
  const entry = pending.get(resp.id);
  if (!entry) return;
  pending.delete(resp.id);
  if (resp.error) {
    entry.reject(resp.error);
  } else {
    entry.resolve(resp.result);
  }
});

// --- window.rsquared provider ---------------------------------------------

interface R2WalletProvider {
  isR2Wallet: true;
  requestAccounts(): Promise<{ accountName: string; activePubKey: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction(txEnvelope: unknown): Promise<any>;
  getBalance(asset: string): Promise<{ balance: string }>;
  getAccount(name: string): Promise<unknown>;
  // Connection management
  disconnect(): Promise<void>;
  isConnected(): boolean; // synchronous best-effort
  // Event subscription (MetaMask-style)
  on(event: DappEventName, cb: EventListener): void;
  off(event: DappEventName, cb: EventListener): void;
}

const provider: R2WalletProvider = {
  isR2Wallet: true,

  async requestAccounts(): Promise<{ accountName: string; activePubKey: string }> {
    const r = (await request("requestAccounts")) as {
      accountName: string;
      activePubKey: string;
    };
    if (r?.accountName) connectedAccountName = r.accountName;
    return r;
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction(txEnvelope: unknown): Promise<any> {
    return request("signTransaction", { txEnvelope });
  },

  getBalance(asset: string): Promise<{ balance: string }> {
    return request("getBalance", { asset }) as Promise<{ balance: string }>;
  },

  getAccount(name: string): Promise<unknown> {
    return request("getAccount", { name });
  },

  async disconnect(): Promise<void> {
    await request("disconnect");
    connectedAccountName = null;
  },

  isConnected(): boolean {
    return connectedAccountName !== null;
  },

  on(event: DappEventName, cb: EventListener): void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(cb);
  },

  off(event: DappEventName, cb: EventListener): void {
    const set = listeners.get(event);
    if (set) set.delete(cb);
  },
};

// Freeze to prevent dApp tampering.
Object.freeze(provider);

// Assign to window — use defineProperty to prevent overwriting.
Object.defineProperty(window, "rsquared", {
  value: provider,
  writable: false,
  configurable: false,
});

// Announce that the provider is ready so dApps loading after document_start
// can detect us without polling.
window.dispatchEvent(new Event("r2wallet#initialized"));
