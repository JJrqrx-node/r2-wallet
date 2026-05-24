// Per-origin connection registry. Persists which origins have been authorized
// to read the active account from window.rsquared.
//
// Storage shape (chrome.storage.local):
//   r2_connections: {
//     [origin]: { accountName: string, connectedAt: number }
//   }
//
// We key by exact origin (scheme + host + port) so https://r2dex.io and
// http://localhost:5173 are independent entries.

const STORAGE_KEY = "r2_connections";

export interface ConnectionEntry {
  origin: string;
  accountName: string;
  connectedAt: number;
}

interface ConnectionMap {
  [origin: string]: { accountName: string; connectedAt: number };
}

async function loadAll(): Promise<ConnectionMap> {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  const v = r[STORAGE_KEY];
  if (v && typeof v === "object") return v as ConnectionMap;
  return {};
}

async function saveAll(map: ConnectionMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: map });
}

export async function listConnections(): Promise<ConnectionEntry[]> {
  const map = await loadAll();
  return Object.entries(map)
    .map(([origin, v]) => ({
      origin,
      accountName: v.accountName,
      connectedAt: v.connectedAt,
    }))
    .sort((a, b) => b.connectedAt - a.connectedAt);
}

export async function isConnected(
  origin: string,
  accountName?: string
): Promise<boolean> {
  const map = await loadAll();
  const entry = map[origin];
  if (!entry) return false;
  if (accountName && entry.accountName !== accountName) return false;
  return true;
}

export async function getConnection(
  origin: string
): Promise<ConnectionEntry | null> {
  const map = await loadAll();
  const entry = map[origin];
  if (!entry) return null;
  return { origin, accountName: entry.accountName, connectedAt: entry.connectedAt };
}

export async function addConnection(
  origin: string,
  accountName: string
): Promise<void> {
  const map = await loadAll();
  map[origin] = { accountName, connectedAt: Date.now() };
  await saveAll(map);
}

export async function removeConnection(origin: string): Promise<void> {
  const map = await loadAll();
  delete map[origin];
  await saveAll(map);
}

export async function clearAllConnections(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// Rebind every existing connection to a new account name. Called when the
// user wipes the vault and re-imports a different account so old connections
// don't silently leak the new name to previously-authorized origins.
export async function rebindAllConnections(
  newAccountName: string
): Promise<void> {
  const map = await loadAll();
  for (const k of Object.keys(map)) {
    const entry = map[k];
    if (entry) entry.accountName = newAccountName;
  }
  await saveAll(map);
}
