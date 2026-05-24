// Thin typed wrapper around @r-squared/rsquared-js-ws.
// Exposes connect, lookup helpers, ticker / order book / fill history,
// market subscription, account lookup, and broadcast.

import { Apis } from "@r-squared/rsquared-js-ws";

export const RQRX_NODES = [
  "wss://node01.rsquared.digital:8090",
  "wss://node02.rsquared.digital:8090",
  "wss://node03.rsquared.digital:8090",
];

export const RQRX_CHAIN_ID =
  "a89f8a1cd2a699e5c521b87cc6210198ed0aad9e2a483322c6db2c391b278f64";

let connectPromise: Promise<void> | null = null;
let activeNode: string | null = null;

export function getActiveNode(): string | null {
  return activeNode;
}

export function connect(node: string = RQRX_NODES[0] ?? "wss://node01.rsquared.digital:8090"): Promise<void> {
  if (connectPromise && activeNode === node) return connectPromise;
  activeNode = node;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inst: any = (Apis as any).instance(node, true);
  const p: Promise<void> = inst.init_promise.then(() => {
    /* connected */
  });
  connectPromise = p;
  return p;
}

export async function reconnect(node: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await (Apis as any).close(); } catch { /* ignore */ }
  connectPromise = null;
  activeNode = null;
  await connect(node);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Apis as any).instance().db_api();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function historyApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Apis as any).instance().history_api();
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function networkApi(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (Apis as any).instance().network_api();
}

// --- Assets ---------------------------------------------------------------

export interface AssetInfo {
  id: string;
  symbol: string;
  precision: number;
}

export async function getAssets(symbols: string[]): Promise<AssetInfo[]> {
  const raw = await dbApi().exec("lookup_asset_symbols", [symbols]);
  return raw.map((a: AssetInfo) => ({
    id: a.id,
    symbol: a.symbol,
    precision: a.precision,
  }));
}

export async function getAssetById(id: string): Promise<AssetInfo | null> {
  const objs = await dbApi().exec("get_objects", [[id]]);
  const a = objs?.[0];
  if (!a) return null;
  return { id: a.id, symbol: a.symbol, precision: a.precision };
}

export async function getAssetsByIds(
  ids: string[]
): Promise<Record<string, AssetInfo>> {
  if (!ids.length) return {};
  const objs = await dbApi().exec("get_objects", [ids]);
  const out: Record<string, AssetInfo> = {};
  for (const a of objs || []) {
    if (a && a.id) {
      out[a.id] = { id: a.id, symbol: a.symbol, precision: a.precision };
    }
  }
  return out;
}

// --- Market data ----------------------------------------------------------

export interface Ticker {
  base: string;
  quote: string;
  latest: string;
  lowest_ask: string;
  highest_bid: string;
  percent_change: string;
  base_volume: string;
  quote_volume: string;
  time: string;
}

export function getTicker(base: string, quote: string): Promise<Ticker> {
  return dbApi().exec("get_ticker", [base, quote, false]);
}

export interface OrderBookLevel {
  price: string;
  base: string;
  quote: string;
}

export interface OrderBook {
  base: string;
  quote: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export function getOrderBook(
  base: string,
  quote: string,
  limit = 20
): Promise<OrderBook> {
  return dbApi().exec("get_order_book", [base, quote, limit]);
}

export interface MarketHistoryBucket {
  key: { base: string; quote: string; seconds: number; open: string };
  high_base: string;
  high_quote: string;
  low_base: string;
  low_quote: string;
  open_base: string;
  open_quote: string;
  close_base: string;
  close_quote: string;
  base_volume: string;
  quote_volume: string;
}

export function getMarketHistory(
  baseId: string,
  quoteId: string,
  bucketSeconds: number,
  startISO: string,
  endISO: string
): Promise<MarketHistoryBucket[]> {
  return historyApi().exec("get_market_history", [
    baseId,
    quoteId,
    bucketSeconds,
    startISO,
    endISO,
  ]);
}

export function getMarketHistoryBuckets(): Promise<number[]> {
  return historyApi().exec("get_market_history_buckets", []);
}

export async function subscribeToMarket(
  base: string,
  quote: string,
   
  cb: (notice: unknown) => void
): Promise<() => Promise<void>> {
  await dbApi().exec("subscribe_to_market", [cb, base, quote]);
  return async () => {
    try {
      await dbApi().exec("unsubscribe_from_market", [base, quote]);
    } catch { /* ignore */ }
  };
}

 
export async function getRecentTrades(
  baseId: string,
  quoteId: string,
  limit = 50
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  return historyApi().exec("get_fill_order_history", [baseId, quoteId, limit]);
}

// --- Account history ------------------------------------------------------

// Raw operation history entry returned by get_account_history. The shape
// varies by op type; we only consume the fields we care about (op[0] = type
// tag, op[1] = body).
export interface RawHistoryEntry {
  id: string;
  op: [number, Record<string, unknown>];
  result?: unknown[];
  block_num: number;
  trx_in_block?: number;
  op_in_trx?: number;
  virtual_op?: number;
}

// Fetch the most recent operation history for an account. `start` of
// '1.11.0' returns from newest; `stop` of '1.11.0' returns oldest possible.
export async function getAccountHistory(
  accountId: string,
  limit = 25
): Promise<RawHistoryEntry[]> {
  return historyApi().exec("get_account_history", [
    accountId,
    "1.11.0",
    limit,
    "1.11.0",
  ]);
}

// Look up account names for a set of ids in one round trip.
export async function getAccountNames(
  ids: string[]
): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const objs = await dbApi().exec("get_objects", [ids]);
  const out: Record<string, string> = {};
  for (const a of objs || []) {
    if (a && a.id && a.name) out[a.id as string] = a.name as string;
  }
  return out;
}

// --- Accounts -------------------------------------------------------------

export interface AccountBalance {
  asset_id: string;
  amount: string;
}

interface RawAccountBalance {
  id?: string;
  owner?: string;
  asset_type?: string;
  balance?: string | number;
  asset_id?: string;
  amount?: string | number;
}

export interface LimitOrder {
  id: string;
  seller: string;
  for_sale: string;
  sell_price: {
    base: { amount: string; asset_id: string };
    quote: { amount: string; asset_id: string };
  };
  expiration: string;
}

export interface FullAccount {
  account: { id: string; name: string; options?: unknown };
  balances: AccountBalance[];
  limit_orders: LimitOrder[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export async function getFullAccount(
  nameOrId: string
): Promise<FullAccount | null> {
  const raw = await dbApi().exec("get_full_accounts", [[nameOrId], false]);
  if (!raw?.length) return null;
  const entry = raw[0][1];
  const rawBalances: RawAccountBalance[] = entry.balances || [];
  const balances: AccountBalance[] = rawBalances.map((b) => ({
    asset_id: b.asset_id ?? b.asset_type ?? "",
    amount: String(b.amount ?? b.balance ?? "0"),
  }));
  return {
    ...entry,
    account: entry.account,
    balances,
    limit_orders: entry.limit_orders || [],
  };
}

export async function getAccount(
  nameOrId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const raw = await dbApi().exec("get_accounts", [[nameOrId]]);
  return raw?.[0] || null;
}

// Look up an account by one of its public keys (owner/active/memo).
// Returns the first matching account, or null if no account references this key.
export async function getAccountByPublicKey(
  pubKey: string
): Promise<{ id: string; name: string } | null> {
  // get_key_references returns array-of-arrays: one inner array per input key,
  // each containing all account IDs that reference that key.
  let refs: string[][];
  try {
    refs = await dbApi().exec("get_key_references", [[pubKey]]);
  } catch {
    return null;
  }
  const ids = refs?.[0] ?? [];
  if (!ids.length) return null;
  // Resolve the first account ID to a full account (for the name).
  const accounts = await dbApi().exec("get_accounts", [[ids[0]]]);
  const acc = accounts?.[0];
  if (!acc?.id || !acc?.name) return null;
  return { id: acc.id, name: acc.name };
}

// --- Fees -----------------------------------------------------------------

export interface FeeAmount {
  amount: string;
  asset_id: string;
}

// Estimate the on-chain fee for a transfer operation. We pass a representative
// operation (the chain hashes only the op type + payload shape to look up the
// fee schedule, so exact from/to/amount don't matter for the estimate). Result
// is returned in chain units of feeAssetId.
export async function getTransferFee(params: {
  fromId: string;
  toId: string;
  amount: { amount: string | number; asset_id: string };
  feeAssetId: string;
}): Promise<FeeAmount> {
  const op = [
    0, // transfer operation id
    {
      fee: { amount: 0, asset_id: params.feeAssetId },
      from: params.fromId,
      to: params.toId,
      amount: {
        amount: Number(params.amount.amount) || 0,
        asset_id: params.amount.asset_id,
      },
      extensions: [],
    },
  ];
  const fees = await dbApi().exec("get_required_fees", [[op], params.feeAssetId]);
  const f = Array.isArray(fees) && fees[0] ? fees[0] : { amount: "0", asset_id: params.feeAssetId };
  return { amount: String(f.amount ?? "0"), asset_id: f.asset_id ?? params.feeAssetId };
}

// --- Broadcast ------------------------------------------------------------

export function broadcastTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signedTx: any
): Promise<unknown> {
  return networkApi().exec("broadcast_transaction", [signedTx]);
}

// --- Global object (head block / chain props) -----------------------------

export interface DynamicGlobal {
  head_block_number: number;
  time: string;
  head_block_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export async function getDynamicGlobal(): Promise<DynamicGlobal> {
  const r = await dbApi().exec("get_objects", [["2.1.0"]]);
  return r[0];
}

// --- HTLC lookup ----------------------------------------------------------

export interface HtlcObject {
  id: string;
  transfer: {
    from: string;
    to: string;
    amount: number | string;
    asset_id: string;
  };
  conditions: {
    hash_lock: {
      preimage_hash: [number, string];
      preimage_size: number;
    };
    time_lock: {
      expiration: string;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export async function getHtlcsByTo(
  accountId: string,
  startId: string = "1.16.0",
  limit: number = 100
): Promise<HtlcObject[]> {
  return await dbApi().exec("get_htlc_by_to", [accountId, startId, limit]);
}

export async function getHtlcsByFrom(
  accountId: string,
  startId: string = "1.16.0",
  limit: number = 100
): Promise<HtlcObject[]> {
  return await dbApi().exec("get_htlc_by_from", [accountId, startId, limit]);
}

export async function findHtlcByHashlock(
  toAccountId: string,
  hashlockHex: string
): Promise<HtlcObject | null> {
  const target = hashlockHex.toLowerCase().replace(/^0x/, "");
  const htlcs = await getHtlcsByTo(toAccountId);
  for (const h of htlcs) {
    const ph = h?.conditions?.hash_lock?.preimage_hash;
    if (Array.isArray(ph) && typeof ph[1] === "string") {
      if (ph[1].toLowerCase() === target) return h;
    }
  }
  return null;
}
