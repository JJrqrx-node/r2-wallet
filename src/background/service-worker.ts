// MV3 Service Worker for R2 Wallet.
// Responsibilities:
//   - Maintain WSS connection to the R-Squared node (keepalive via chrome.alarms)
//   - Handle vault unlock/lock (keys stored in chrome.storage.session)
//   - Process transfer requests from the popup
//   - Queue and route dApp approval requests

import { connect, reconnect, getFullAccount, getAssetsByIds, getTransferFee, getAccount, getAccountHistory, getAccountNames, RQRX_NODES, isSocketOpen, forceReconnect, type RawHistoryEntry } from "../lib/chain";
import { decryptVault, encryptVault, needsReEncrypt } from "../lib/crypto";
import { loadVault, saveVault, hasVault, wipeVault } from "../lib/vault";
import { setUnlockedKeys, getUnlockedKeys, lock } from "../lib/session";
import { transfer, signAndBroadcast, type SignEnvelope } from "../lib/tx";
import { deriveFromBrainKey } from "../lib/signup";
import { formatChainError } from "../lib/chainError";
import { runUpdateCheck, readUpdateInfo } from "../lib/update-check";
import {
  listConnections,
  isConnected,
  addConnection,
  removeConnection,
  clearAllConnections,
  type ConnectionEntry,
} from "../lib/connections";
import type { DappEventName } from "../lib/dapp-events";
import type {
  WalletMessage,
  StateResponse,
  PendingApproval,
} from "../lib/messages";

// --- Keepalive alarm ------------------------------------------------------
// MV3 service workers die after ~30 s idle. An alarm every 24 s keeps it alive
// and also serves as a heartbeat to reconnect a dropped WSS connection.

const ALARM_NAME = "keepalive";
const UPDATE_ALARM = "update-check";

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.4 });
// Check for a new release every 6 hours, plus once at startup (below).
chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 60 * 6, when: Date.now() + 60 * 1000 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    ensureConnected().catch(() => {
      // Connection will be retried on next alarm tick.
    });
  } else if (alarm.name === UPDATE_ALARM) {
    runUpdateCheck().catch(() => {
      // Best-effort: failures are recorded inside the stored UpdateInfo.
    });
  }
});

// Also run a check on extension install / browser startup so users see the
// banner immediately after a Chrome restart.
chrome.runtime.onInstalled.addListener(() => {
  runUpdateCheck().catch(() => { /* ignore */ });
  // Make the toolbar icon open the side panel directly. This is the
  // browser-supported way to skip the popup entirely.
  try {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => { /* ignore — older Chrome */ });
  } catch { /* ignore */ }
});
chrome.runtime.onStartup.addListener(() => {
  runUpdateCheck().catch(() => { /* ignore */ });
  try {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => { /* ignore */ });
  } catch { /* ignore */ }
});

// --- Node URL (persisted in chrome.storage.local) -------------------------

let currentNodeUrl: string = RQRX_NODES[0] ?? "wss://node01.rsquared.digital:8090";

async function loadNodeUrl(): Promise<void> {
  const result = await chrome.storage.local.get("r2_node_url");
  if (typeof result["r2_node_url"] === "string") {
    currentNodeUrl = result["r2_node_url"];
  }
}

async function saveNodeUrl(url: string): Promise<void> {
  currentNodeUrl = url;
  await chrome.storage.local.set({ r2_node_url: url });
}

// --- WSS connection -------------------------------------------------------

let connectingPromise: Promise<void> | null = null;

async function ensureConnected(): Promise<void> {
  // If the underlying socket is closed/closing, force a fresh reconnect so
  // we don't hand callers a dead connection. The keepalive alarm runs this
  // every ~24 s, so a dropped socket recovers within one tick.
  if (!isSocketOpen()) {
    if (connectingPromise) {
      try { await connectingPromise; } catch { /* fall through to reconnect */ }
    }
    connectingPromise = forceReconnect().finally(() => {
      connectingPromise = null;
    });
    return connectingPromise;
  }
  if (connectingPromise) return connectingPromise;
  connectingPromise = connect(currentNodeUrl).finally(() => {
    connectingPromise = null;
  });
  return connectingPromise;
}

// True if the error looks like a dropped/closing WebSocket so the caller can
// transparently force-reconnect and retry once.
function isClosedSocketError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /closed|closing|readyState|state error|not connected|connection lost|websocket/i.test(msg);
}

// Wrap a chain call so a single dropped-socket failure retries after a
// forced reconnect. Used by every handler that talks to the node.
async function withReconnect<T>(fn: () => Promise<T>): Promise<T> {
  await ensureConnected();
  try {
    return await fn();
  } catch (e) {
    if (!isClosedSocketError(e)) throw e;
    try { await forceReconnect(); } catch { /* fall through to original throw */ }
    return await fn();
  }
}

// --- dApp approval queue --------------------------------------------------

const pendingApprovals = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason: string) => void;
    approval: PendingApproval;
  }
>();

function getPendingApprovals(): PendingApproval[] {
  return Array.from(pendingApprovals.values()).map((v) => v.approval);
}

// --- Message handler ------------------------------------------------------

chrome.runtime.onMessage.addListener(
  (
    message: WalletMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((e: unknown) => {
        sendResponse({ error: formatChainError(e) });
      });
    // Return true to keep the message channel open for async response.
    return true;
  }
);

async function handleMessage(
  message: WalletMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "GET_STATE":
      return getState();

    case "UNLOCK":
      return handleUnlock(message.passphrase);

    case "LOCK":
      await lock();
      return { ok: true };

    case "CREATE_ACCOUNT":
      return handleCreateAccount(message);

    case "SEND_TRANSFER":
      return handleSendTransfer(message);

    case "GET_BALANCES":
      return handleGetBalances();

    case "GET_TRANSFER_FEE":
      return handleGetTransferFee(message);

    case "SET_NODE": {
      await saveNodeUrl(message.nodeUrl);
      await reconnect(message.nodeUrl);
      return { ok: true };
    }

    case "APPROVE_REQUEST":
      return handleApproveRequest(message.requestId);

    case "REJECT_REQUEST":
      return handleRejectRequest(message.requestId);

    case "DAPP_REQUEST_ACCOUNTS":
      return handleDappRequestAccounts(message, sender);

    case "DAPP_SIGN_TRANSACTION":
      return handleDappSignTransaction(message, sender);

    case "DAPP_GET_BALANCE":
      return handleDappGetBalance(message, sender);

    case "DAPP_GET_ACCOUNT":
      return handleDappGetAccount(message, sender);

    case "SIGN_TRANSACTION":
      // Direct sign without dApp flow (future use)
      return { error: "Use DAPP_SIGN_TRANSACTION for signing" };

    case "REVEAL_BRAIN_KEY":
      return handleRevealBrainKey(message.passphrase);

    case "GET_HISTORY":
      return handleGetHistory(message.limit ?? 25);

    case "LIST_CONNECTIONS":
      return handleListConnections();

    case "RESOLVE_ACCOUNT":
      return handleResolveAccount(message.name);

    case "DISCONNECT_ORIGIN":
      return handleDisconnectOrigin(message.origin);

    default:
      return { error: "Unknown message type" };
  }
}

// --- Handlers -------------------------------------------------------------

async function getState(): Promise<StateResponse> {
  const vaultExists = await hasVault();
  const keys = await getUnlockedKeys();
  const result = await chrome.storage.local.get("r2_node_url");
  const nodeUrl = (result["r2_node_url"] as string | undefined) ?? currentNodeUrl;

  if (!vaultExists) {
    return { locked: true, hasVault: false, nodeUrl };
  }
  if (!keys) {
    return { locked: true, hasVault: true, nodeUrl };
  }
  return {
    locked: false,
    hasVault: true,
    accountName: keys.accountName,
    accountId: keys.accountId,
    activePubKey: keys.activePubKey,
    ownerPubKey: keys.ownerPubKey,
    memoPubKey: keys.memoPubKey,
    nodeUrl,
  };
}

async function handleUnlock(
  passphrase: string
): Promise<StateResponse | { error: string }> {
  const vaultData = await loadVault();
  if (!vaultData) return { error: "No vault found. Create an account first." };

  let payload;
  try {
    payload = await decryptVault(vaultData, passphrase);
  } catch {
    return { error: "Incorrect passphrase." };
  }

  // Opportunistic envelope upgrade: if the stored vault is on an older
  // version or below the current PBKDF2 iteration count, transparently
  // re-encrypt with the current parameters using the same passphrase.
  // Failure is silent — the user is still unlocked with the old envelope.
  if (needsReEncrypt(vaultData)) {
    try {
      const upgraded = await encryptVault(payload, passphrase);
      await saveVault(upgraded);
    } catch {
      // best effort — leave the legacy envelope in place
    }
  }

  // Derive active WIF from brain key.
  const derived = deriveFromBrainKey(payload.brainKey);

  // Fetch account ID from chain.
  let accountId = "";
  try {
    const acc = await withReconnect(() => getFullAccount(payload.accountName));
    accountId = acc?.account?.id ?? "";
  } catch {
    // Proceed without account ID — will be resolved on next balance fetch.
  }

  await setUnlockedKeys({
    accountName: payload.accountName,
    accountId,
    brainKey: payload.brainKey,
    activeWif: derived.active.wif,
    ownerPubKey: payload.ownerPubKey,
    activePubKey: payload.activePubKey,
    memoPubKey: payload.memoPubKey,
  });

  return {
    locked: false,
    hasVault: true,
    accountName: payload.accountName,
    accountId,
    activePubKey: payload.activePubKey,
    ownerPubKey: payload.ownerPubKey,
    memoPubKey: payload.memoPubKey,
    nodeUrl: currentNodeUrl,
  };
}

async function handleCreateAccount(
  msg: Extract<WalletMessage, { type: "CREATE_ACCOUNT" }>
): Promise<{ ok: true } | { error: string }> {
  const encrypted = await encryptVault(
    {
      accountName: msg.accountName,
      brainKey: msg.brainKey,
      ownerPubKey: msg.ownerPubKey,
      activePubKey: msg.activePubKey,
      memoPubKey: msg.memoPubKey,
    },
    msg.passphrase
  );
  await saveVault(encrypted);
  // Immediately unlock into session.
  const derived = deriveFromBrainKey(msg.brainKey);
  let accountId = "";
  try {
    const acc = await withReconnect(() => getFullAccount(msg.accountName));
    accountId = acc?.account?.id ?? "";
  } catch {
    // Proceed.
  }
  await setUnlockedKeys({
    accountName: msg.accountName,
    accountId,
    brainKey: msg.brainKey,
    activeWif: derived.active.wif,
    ownerPubKey: msg.ownerPubKey,
    activePubKey: msg.activePubKey,
    memoPubKey: msg.memoPubKey,
  });
  return { ok: true };
}

async function handleSendTransfer(
  msg: Extract<WalletMessage, { type: "SEND_TRANSFER" }>
): Promise<{ txId: string | null; toAccountId: string } | { error: string }> {
  const keys = await getUnlockedKeys();
  if (!keys) return { error: "Wallet is locked. Unlock before sending." };

  try {
    return await withReconnect(() => transfer({
      fromAccountId: keys.accountId,
      toAccountName: msg.toAccountName,
      amount: { asset_id: msg.assetId, amount: msg.amount },
      feeAssetId: msg.feeAssetId,
      activeWif: keys.activeWif,
    }));
  } catch (e) {
    return { error: formatChainError(e) };
  }
}

// History entry shape returned to popup (enriched).
export interface HistoryEntry {
  id: string;
  blockNum: number;
  opType: number;
  direction: "in" | "out" | "self" | "other";
  // Transfer-specific fields (op[0] === 0). May be undefined for other ops.
  fromId?: string;
  toId?: string;
  fromName?: string;
  toName?: string;
  amount?: string; // raw integer string
  assetId?: string;
  assetSymbol?: string;
  assetPrecision?: number;
  feeAmount?: string;
  feeAssetId?: string;
  feeAssetSymbol?: string;
  feeAssetPrecision?: number;
  memoHex?: string; // raw memo blob — wallet doesn't decrypt yet
  // Best-effort timestamp from block header. May be undefined if block
  // header fetch fails (history will still render with block number).
  timestamp?: string;
  // Trade-related enrichment for limit_order_create (54) and fill_order
  // (57). Pay = what the user gave up. Receive = what the user got.
  payAmount?: string;
  payAssetId?: string;
  payAssetSymbol?: string;
  payAssetPrecision?: number;
  receiveAmount?: string;
  receiveAssetId?: string;
  receiveAssetSymbol?: string;
  receiveAssetPrecision?: number;
  // "sell_rqrx" means user paid RQRX. "buy_rqrx" means user received RQRX.
  // For non-RQRX trade pairs (e.g. ETH/USDT), set to "sell_<symbol>" or
  // "buy_<symbol>" using the pay asset.
  tradeSide?: string;
  // limit_order_cancel (55) carries just the order id.
  orderId?: string;
}

async function handleGetHistory(
  limit: number
): Promise<{ entries: HistoryEntry[] } | { error: string }> {
  const keys = await getUnlockedKeys();
  if (!keys) return { error: "Wallet is locked." };
  if (!keys.accountId) return { error: "Account ID not yet resolved. Refresh balances first." };

  let raw: RawHistoryEntry[];
  try {
    raw = await withReconnect(() => getAccountHistory(keys.accountId, limit));
  } catch (e) {
    return { error: formatChainError(e) };
  }

  // Collect asset ids + account ids referenced by any op we know how to
  // enrich (transfers, limit orders, fill orders) so we can resolve
  // symbols/names in one batch round trip.
  const assetIds = new Set<string>();
  const accountIds = new Set<string>();
  for (const entry of raw) {
    const opType = entry.op[0];
    const body = entry.op[1] as Record<string, unknown>;
    const fee = body.fee as { asset_id?: string } | undefined;
    if (fee?.asset_id) assetIds.add(fee.asset_id);

    if (opType === 0) {
      // transfer
      const amount = body.amount as { asset_id?: string } | undefined;
      const from = body.from as string | undefined;
      const to = body.to as string | undefined;
      if (amount?.asset_id) assetIds.add(amount.asset_id);
      if (from) accountIds.add(from);
      if (to) accountIds.add(to);
    } else if (opType === 54) {
      // limit_order_create
      const sell = body.amount_to_sell as { asset_id?: string } | undefined;
      const recv = body.min_to_receive as { asset_id?: string } | undefined;
      if (sell?.asset_id) assetIds.add(sell.asset_id);
      if (recv?.asset_id) assetIds.add(recv.asset_id);
    } else if (opType === 57) {
      // fill_order
      const pays = body.pays as { asset_id?: string } | undefined;
      const recv = body.receives as { asset_id?: string } | undefined;
      if (pays?.asset_id) assetIds.add(pays.asset_id);
      if (recv?.asset_id) assetIds.add(recv.asset_id);
    }
  }

  let assetMap: Awaited<ReturnType<typeof getAssetsByIds>> = {};
  let nameMap: Record<string, string> = {};
  try {
    [assetMap, nameMap] = await Promise.all([
      getAssetsByIds(Array.from(assetIds)),
      getAccountNames(Array.from(accountIds)),
    ]);
  } catch { /* tolerate — we'll fall back to raw ids */ }

  const entries: HistoryEntry[] = raw.map((entry) => {
    const opType = entry.op[0];
    const body = entry.op[1] as Record<string, unknown>;
    const out: HistoryEntry = {
      id: entry.id,
      blockNum: entry.block_num,
      opType,
      direction: "other",
    };

    // Fee is shared by every op. Enrich once up front.
    const fee = body.fee as { asset_id?: string; amount?: string | number } | undefined;
    if (fee?.amount !== undefined) out.feeAmount = String(fee.amount);
    if (fee?.asset_id) {
      out.feeAssetId = fee.asset_id;
      const a = assetMap[fee.asset_id];
      if (a) { out.feeAssetSymbol = a.symbol; out.feeAssetPrecision = a.precision; }
    }

    if (opType === 0) {
      // transfer
      const amount = body.amount as { asset_id?: string; amount?: string | number } | undefined;
      const from = body.from as string | undefined;
      const to = body.to as string | undefined;
      const memo = body.memo as { message?: string } | undefined;
      out.fromId = from;
      out.toId = to;
      out.fromName = from ? nameMap[from] : undefined;
      out.toName = to ? nameMap[to] : undefined;
      if (amount?.amount !== undefined) out.amount = String(amount.amount);
      if (amount?.asset_id) {
        out.assetId = amount.asset_id;
        const a = assetMap[amount.asset_id];
        if (a) { out.assetSymbol = a.symbol; out.assetPrecision = a.precision; }
      }
      if (memo?.message) out.memoHex = memo.message;
      if (from === keys.accountId && to === keys.accountId) out.direction = "self";
      else if (from === keys.accountId) out.direction = "out";
      else if (to === keys.accountId) out.direction = "in";
    } else if (opType === 54) {
      // limit_order_create
      const sell = body.amount_to_sell as { asset_id?: string; amount?: string | number } | undefined;
      const recv = body.min_to_receive as { asset_id?: string; amount?: string | number } | undefined;
      if (sell?.amount !== undefined) out.payAmount = String(sell.amount);
      if (sell?.asset_id) {
        out.payAssetId = sell.asset_id;
        const a = assetMap[sell.asset_id];
        if (a) { out.payAssetSymbol = a.symbol; out.payAssetPrecision = a.precision; }
      }
      if (recv?.amount !== undefined) out.receiveAmount = String(recv.amount);
      if (recv?.asset_id) {
        out.receiveAssetId = recv.asset_id;
        const a = assetMap[recv.asset_id];
        if (a) { out.receiveAssetSymbol = a.symbol; out.receiveAssetPrecision = a.precision; }
      }
      // Direction is always "out" for the seller — they are paying away an
      // asset. We classify the trade by what they sold.
      out.direction = "out";
      if (out.payAssetSymbol) out.tradeSide = `sell_${out.payAssetSymbol.toLowerCase()}`;
    } else if (opType === 55) {
      // limit_order_cancel
      const orderId = body.order as string | undefined;
      if (orderId) out.orderId = orderId;
      out.direction = "other";
    } else if (opType === 57) {
      // fill_order — emitted by the chain when an order matches.
      const acct = body.account_id as string | undefined;
      const pays = body.pays as { asset_id?: string; amount?: string | number } | undefined;
      const recv = body.receives as { asset_id?: string; amount?: string | number } | undefined;
      if (pays?.amount !== undefined) out.payAmount = String(pays.amount);
      if (pays?.asset_id) {
        out.payAssetId = pays.asset_id;
        const a = assetMap[pays.asset_id];
        if (a) { out.payAssetSymbol = a.symbol; out.payAssetPrecision = a.precision; }
      }
      if (recv?.amount !== undefined) out.receiveAmount = String(recv.amount);
      if (recv?.asset_id) {
        out.receiveAssetId = recv.asset_id;
        const a = assetMap[recv.asset_id];
        if (a) { out.receiveAssetSymbol = a.symbol; out.receiveAssetPrecision = a.precision; }
      }
      // A fill_order is reported from the perspective of one side. The
      // account in body.account_id is the one whose order filled — they
      // paid `pays` and got `receives`.
      if (acct === keys.accountId) {
        out.direction = "in"; // net positive, even though they paid something
        if (out.payAssetSymbol) out.tradeSide = `sell_${out.payAssetSymbol.toLowerCase()}`;
      }
    }
    return out;
  });

  return { entries };
}

async function handleRevealBrainKey(
  passphrase: string
): Promise<{ brainKey: string } | { error: string }> {
  // Require the wallet to be unlocked AND re-verify the passphrase. This
  // prevents shoulder-surfers from revealing the brain key just because the
  // wallet is already unlocked.
  const keys = await getUnlockedKeys();
  if (!keys) return { error: "Wallet is locked. Unlock first." };

  const vaultData = await loadVault();
  if (!vaultData) return { error: "No vault found." };

  let payload;
  try {
    payload = await decryptVault(vaultData, passphrase);
  } catch {
    return { error: "Incorrect passphrase." };
  }
  return { brainKey: payload.brainKey };
}

async function handleGetBalances(): Promise<
  | {
      balances: Array<{
        asset_id: string;
        amount: string;
        symbol?: string;
        precision?: number;
      }>;
    }
  | { error: string }
> {
  const keys = await getUnlockedKeys();
  if (!keys) return { error: "Wallet is locked." };

  try {
    const acc = await withReconnect(() => getFullAccount(keys.accountName));
    if (!acc) return { error: "Account not found on chain." };
    // Update cached account ID if it changed.
    if (acc.account.id && acc.account.id !== keys.accountId) {
      await setUnlockedKeys({ ...keys, accountId: acc.account.id });
    }
    // Enrich with symbol + precision so the UI can display human-readable
    // asset names (e.g. "RQRX") instead of raw IDs (e.g. "1.3.0").
    let enriched = acc.balances.map((b) => ({
      asset_id: b.asset_id,
      amount: b.amount,
    })) as Array<{ asset_id: string; amount: string; symbol?: string; precision?: number }>;
    try {
      const ids = enriched.map((b) => b.asset_id).filter(Boolean);
      if (ids.length) {
        const info = await getAssetsByIds(ids);
        enriched = enriched.map((b) => {
          const a = info[b.asset_id];
          return a
            ? { ...b, symbol: a.symbol, precision: a.precision }
            : b;
        });
      }
    } catch {
      // Best-effort: if asset lookup fails, fall back to raw IDs.
    }
    return { balances: enriched };
  } catch (e) {
    return { error: formatChainError(e) };
  }
}

async function handleGetTransferFee(
  msg: Extract<WalletMessage, { type: "GET_TRANSFER_FEE" }>
): Promise<
  | { fee: { amount: string; asset_id: string } }
  | { error: string }
> {
  const keys = await getUnlockedKeys();
  if (!keys) return { error: "Wallet is locked." };
  try {
    // Resolve recipient name -> account id (fallback to sender if unknown so
    // the chain still returns a fee estimate for the op).
    let toId = keys.accountId;
    if (msg.toAccountName) {
      try {
        const acc = await withReconnect(() => getAccount(msg.toAccountName!));
        if (acc?.id) toId = acc.id;
      } catch {
        // Recipient may not exist yet — use sender id for the fee estimate.
      }
    }
    const fee = await withReconnect(() => getTransferFee({
      fromId: keys.accountId,
      toId,
      amount: { amount: msg.amount || "0", asset_id: msg.assetId },
      feeAssetId: msg.feeAssetId,
    }));
    return { fee };
  } catch (e) {
    return { error: formatChainError(e) };
  }
}

async function handleApproveRequest(
  requestId: string
): Promise<{ ok: true } | { error: string }> {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return { error: "No pending request with that ID." };

  const keys = await getUnlockedKeys();
  if (!keys) {
    pending.reject("Wallet is locked. Unlock before approving.");
    pendingApprovals.delete(requestId);
    return { error: "Wallet is locked." };
  }

  if (pending.approval.type === "requestAccounts") {
    // Persist the connection so future requestAccounts from this origin are
    // returned instantly without prompting again.
    await addConnection(pending.approval.origin, keys.accountName);
    pending.resolve({
      accountName: keys.accountName,
      activePubKey: keys.activePubKey,
    });
    // Push a connect event to the dApp so it can update its UI immediately.
    void emitDappEvent(pending.approval.origin, "connect", {
      accountName: keys.accountName,
      activePubKey: keys.activePubKey,
    });
    void emitDappEvent(pending.approval.origin, "accountsChanged", {
      accounts: [keys.accountName],
    });
  } else if (pending.approval.type === "signTransaction") {
    try {
      const payload = pending.approval.payload as Record<string, unknown>;

      // Generic envelope path: { operations: [...], feeAssetId? }.
      if (payload && Array.isArray((payload as { operations?: unknown }).operations)) {
        const result = await withReconnect(() => signAndBroadcast({
          envelope: payload as unknown as SignEnvelope,
          activeWif: keys.activeWif,
        }));
        pending.resolve(result);
      } else if (payload && typeof payload.toAccountName === "string") {
        // Backward-compatible transfer-shaped payload (v0.1.10 and earlier).
        const result = await withReconnect(() => transfer({
          fromAccountId: keys.accountId,
          ...(payload as unknown as {
            toAccountName: string;
            amount: { asset_id: string; amount: string };
            feeAssetId: string;
          }),
          activeWif: keys.activeWif,
        }));
        pending.resolve(result);
      } else {
        throw new Error(
          "Unrecognized sign payload. Expected { operations: [...] } or a transfer payload."
        );
      }
    } catch (e) {
      pending.reject(formatChainError(e));
    }
  }

  pendingApprovals.delete(requestId);
  clearApprovalBadge();
  return { ok: true };
}

async function handleRejectRequest(
  requestId: string
): Promise<{ ok: true } | { error: string }> {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return { error: "No pending request with that ID." };
  pending.reject("User rejected the request.");
  pendingApprovals.delete(requestId);
  clearApprovalBadge();
  return { ok: true };
}

// Clear the action badge only when there are no more pending approvals.
// We don't blindly clear because the update-check code also paints "UP"
// when a wallet update is available — if no approvals remain we want
// update-check to repaint its badge on next tick. The simplest correct
// behavior: only clear when approvals are empty, then let update-check
// re-set its own badge text on its own schedule.
function clearApprovalBadge(): void {
  if (pendingApprovals.size === 0) {
    chrome.action.setBadgeText({ text: "" }).catch(() => { /* ignore */ });
    // Re-paint the update-available badge if applicable, so clearing the
    // approval badge doesn't accidentally hide a pending wallet update.
    void readUpdateInfo()
      .then((info) => {
        if (info?.available) {
          chrome.action.setBadgeBackgroundColor({ color: "#10B981" }).catch(() => {});
          chrome.action.setBadgeText({ text: "UP" }).catch(() => {});
        }
      })
      .catch(() => { /* ignore */ });
  }
}

// Cross-check the origin claimed by the content-script message body against
// the URL the browser reports for the sender. Returns the verified origin or
// an error response. This is defense-in-depth: with current manifest matches
// the content-script cannot run on origins outside our allow-list, but we
// don't want to trust unverified attacker-controlled strings either.
function verifyDappSender(
  sender: chrome.runtime.MessageSender,
  claimedOrigin: string
): { ok: true; origin: string } | { ok: false; error: string } {
  if (!sender.url || !sender.tab) {
    return { ok: false, error: "Invalid sender: no tab context" };
  }
  let real: string;
  try {
    real = new URL(sender.url).origin;
  } catch {
    return { ok: false, error: "Invalid sender URL" };
  }
  if (real !== claimedOrigin) {
    return { ok: false, error: "Origin mismatch" };
  }
  return { ok: true, origin: real };
}

async function handleDappRequestAccounts(
  msg: Extract<WalletMessage, { type: "DAPP_REQUEST_ACCOUNTS" }>,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const check = verifyDappSender(sender, msg.origin);
  if (!check.ok) return { error: check.error };
  const origin = check.origin;

  const keys = await getUnlockedKeys();

  // If we have a previously-saved connection for this origin AND the wallet
  // is unlocked, return immediately without prompting. This is the standard
  // "already connected" behavior of wallet providers.
  if (keys) {
    const already = await isConnected(origin, keys.accountName);
    if (already) {
      return {
        accountName: keys.accountName,
        activePubKey: keys.activePubKey,
      };
    }
  }

  // Otherwise queue an explicit approval prompt — even if unlocked. The user
  // must approve each new origin once.
  return queueApproval(
    "requestAccounts",
    origin,
    msg.requestId,
    undefined,
    sender.tab?.id
  );
}

async function handleListConnections(): Promise<{ connections: ConnectionEntry[] }> {
  const connections = await listConnections();
  return { connections };
}

async function handleDisconnectOrigin(
  origin: string
): Promise<{ ok: true } | { error: string }> {
  await removeConnection(origin);
  // Notify any open tabs at that origin so the dApp can update its UI.
  void emitDappEvent(origin, "disconnect", { origin });
  void emitDappEvent(origin, "accountsChanged", { accounts: [] });
  return { ok: true };
}

// Look up an account by name on-chain. Used by the Send route to flag
// unregistered recipients before the user submits a doomed transfer.
// Returns { exists: false } for clearly-non-existent names (chain answered
// with no account) and { error } only for connectivity issues.
async function handleResolveAccount(
  name: string
): Promise<
  | { exists: true; accountId: string; accountName: string }
  | { exists: false }
  | { error: string }
> {
  const trimmed = (name || "").trim().toLowerCase();
  if (!trimmed) return { exists: false };
  // Account-name validity check matches the R-Squared graphene rules:
  // lowercase, digits, dot, dash; 3–63 chars; must start with a letter.
  if (!/^[a-z][a-z0-9.-]{2,62}$/.test(trimmed)) return { exists: false };

  try {
    const acc = await withReconnect(() => getAccount(trimmed));
    if (acc && acc.id && acc.name) {
      return { exists: true, accountId: acc.id, accountName: acc.name };
    }
    return { exists: false };
  } catch (e) {
    return { error: formatChainError(e) };
  }
}

async function handleDappSignTransaction(
  msg: Extract<WalletMessage, { type: "DAPP_SIGN_TRANSACTION" }>,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const check = verifyDappSender(sender, msg.origin);
  if (!check.ok) return { error: check.error };
  const origin = check.origin;

  const keys = await getUnlockedKeys();
  if (!keys) {
    return {
      error: "Wallet is locked. Open R2 Wallet and unlock before signing.",
    };
  }
  // Require the origin to have an established connection before letting it
  // queue a signing approval. Without this, any matched origin could spam
  // approval prompts at the user.
  const already = await isConnected(origin, keys.accountName);
  if (!already) {
    return {
      error:
        "Origin is not connected to this wallet. Call requestAccounts() first.",
    };
  }
  // Always require explicit approval for signing.
  return queueApproval(
    "signTransaction",
    origin,
    msg.requestId,
    msg.txEnvelope,
    sender.tab?.id
  );
}

async function handleDappGetBalance(
  msg: Extract<WalletMessage, { type: "DAPP_GET_BALANCE" }>,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const check = verifyDappSender(sender, msg.origin);
  if (!check.ok) return { error: check.error };
  const origin = check.origin;

  const keys = await getUnlockedKeys();
  if (!keys) return { error: "Wallet is locked." };
  // Balance is private data — only return it to origins the user has
  // explicitly connected to this account.
  const already = await isConnected(origin, keys.accountName);
  if (!already) {
    return {
      error:
        "Origin is not connected to this wallet. Call requestAccounts() first.",
    };
  }
  try {
    const acc = await withReconnect(() => getFullAccount(keys.accountName));
    const balance = acc?.balances.find((b) => b.asset_id === msg.asset);
    return { balance: balance?.amount ?? "0" };
  } catch (e) {
    return { error: formatChainError(e) };
  }
}

async function handleDappGetAccount(
  msg: Extract<WalletMessage, { type: "DAPP_GET_ACCOUNT" }>,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  // getAccount is a generic chain lookup of any public account by name. It
  // does not return wallet-private data, so we only enforce origin-shape
  // validation (must come from a tabbed sender) but not a connection check.
  if (!sender.url || !sender.tab) {
    return { error: "Invalid sender: no tab context" };
  }
  try {
    const acc = await withReconnect(() => getFullAccount(msg.name));
    if (!acc) return { account: null };
    return {
      account: {
        id: acc.account.id,
        name: acc.account.name,
        balances: acc.balances,
      },
    };
  } catch (e) {
    return { error: formatChainError(e) };
  }
}

function queueApproval(
  type: PendingApproval["type"],
  origin: string,
  requestId: string,
  payload: unknown,
  tabId?: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const approval: PendingApproval = { requestId, type, origin, payload };
    pendingApprovals.set(requestId, { resolve, reject, approval });

    // Notify popup via badge.
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#DC2626" });

    // Best-effort: try to open the side panel on the tab the request came
    // from. This requires a recent user gesture (the dApp button click that
    // triggered the request counts). Falls back to badge-only on failure,
    // and the dApp will still see the approval if the user opens the side
    // panel themselves within 5 minutes.
    if (tabId !== undefined) {
      try {
        void chrome.sidePanel.open({ tabId }).catch(() => { /* ignore */ });
      } catch {
        // ignore — some Chromium variants block this without a user gesture
      }
    }

    // Timeout after 5 minutes.
    setTimeout(() => {
      if (pendingApprovals.has(requestId)) {
        pendingApprovals.delete(requestId);
        reject("Approval request timed out.");
        clearApprovalBadge();
      }
    }, 5 * 60 * 1000);
  });
}

// Export pending approvals accessor for popup query.
// The popup calls GET_STATE and we inject pending into the response.
// Override: handle a secondary GET_PENDING message.
chrome.runtime.onMessage.addListener(
  (
    message: { type?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === "GET_PENDING_APPROVALS") {
      sendResponse({ approvals: getPendingApprovals() });
      return true;
    }
    return false;
  }
);

// Initialize on SW startup.
(async () => {
  await loadNodeUrl();
  await ensureConnected().catch(() => {
    // Will retry on next alarm.
  });
  // Kick off an update check on cold start so the badge reflects reality.
  void runUpdateCheck().catch(() => { /* ignore */ });
})();

// --- Update-check message router -----------------------------------------
// We register a second listener (alongside the GET_PENDING_APPROVALS one) so
// the popup can pull the latest stored UpdateInfo or force a refresh.
chrome.runtime.onMessage.addListener(
  (
    message: { type?: string },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === "GET_UPDATE_INFO") {
      readUpdateInfo()
        .then((info) => sendResponse({ info }))
        .catch((e: unknown) =>
          sendResponse({ info: null, error: formatChainError(e) })
        );
      return true;
    }
    if (message.type === "CHECK_FOR_UPDATE") {
      runUpdateCheck()
        .then((info) => sendResponse({ info }))
        .catch((e: unknown) =>
          sendResponse({ info: null, error: formatChainError(e) })
        );
      return true;
    }
    return false;
  }
);

// Fallback for browsers that don't honor setPanelBehavior (or if the user has
// somehow disabled it): explicitly open the side panel when the icon is
// clicked. With openPanelOnActionClick enabled, action.onClicked won't fire
// in Chrome — but this is a no-cost belt-and-suspenders.
chrome.action.onClicked.addListener((tab) => {
  if (pendingApprovals.size === 0) {
    chrome.action.setBadgeText({ text: "" });
  }
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => { /* ignore */ });
  }
});

// --- dApp push events -----------------------------------------------------
// Find all tabs at a given origin (scheme + host + port) and send them a
// DAPP_EVENT message. The content script forwards it to the page via
// window.postMessage, where the inpage provider re-emits it as a wallet
// event the dApp can subscribe to.

async function emitDappEvent(
  origin: string,
  event: DappEventName,
  data?: unknown
): Promise<void> {
  try {
    // Convert origin -> URL pattern for chrome.tabs.query.
    // origin is like "https://r2dex.io" — turn into "https://r2dex.io/*".
    const pattern = `${origin}/*`;
    const tabs = await chrome.tabs.query({ url: pattern });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        // Best-effort. If a tab has no content script (e.g. extension page)
        // chrome.tabs.sendMessage will reject — we swallow it.
        chrome.tabs
          .sendMessage(tab.id, { type: "DAPP_EVENT", event, data })
          .catch(() => { /* ignore */ });
      }
    }
  } catch {
    // chrome.tabs may be unavailable in some contexts — ignore.
  }
}

async function emitToAllConnectedOrigins(
  event: DappEventName,
  data?: unknown
): Promise<void> {
  const list = await listConnections();
  for (const c of list) {
    void emitDappEvent(c.origin, event, data);
  }
}

// On LOCK, notify every connected origin that the wallet is no longer
// available. We piggy-back on the main message stream with a side listener
// that doesn't intercept the response — the main handler still runs lock().
chrome.runtime.onMessage.addListener(
  (
    message: { type?: string },
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response: unknown) => void
  ) => {
    if (message.type === "LOCK") {
      void emitToAllConnectedOrigins("disconnect", { reason: "locked" });
      void emitToAllConnectedOrigins("accountsChanged", { accounts: [] });
    }
    return false;
  }
);

// Export for use in tests (not accessible from content scripts directly).
export { getPendingApprovals, wipeVault, clearAllConnections };
