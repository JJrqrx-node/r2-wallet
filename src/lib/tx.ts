// Transaction building, signing, broadcasting.

import { PrivateKey, TransactionBuilder } from "@r-squared/rsquared-js";
import { getAccount } from "./chain";

// --- Generic envelope signer --------------------------------------------
//
// A dApp can request the wallet to sign and broadcast an arbitrary set of
// chain operations by passing an envelope of the form:
//
//   {
//     operations: [{ op_name: "transfer", op_data: {...} }, ...],
//     feeAssetId?: string
//   }
//
// Each op_data is the raw chain operation payload (without the `fee` field —
// the wallet fills that in via set_required_fees). We iterate the operations
// into a single TransactionBuilder, sign with the user's active key, and
// broadcast atomically.

export interface SignEnvelopeOp {
  op_name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  op_data: Record<string, any>;
}

export interface SignEnvelope {
  operations: SignEnvelopeOp[];
  feeAssetId?: string;
}

export interface SignAndBroadcastParams {
  envelope: SignEnvelope;
  activeWif: string;
}

export interface SignAndBroadcastResult {
  txId: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  operationResults: any[] | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPlainObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export async function signAndBroadcast(
  p: SignAndBroadcastParams
): Promise<SignAndBroadcastResult> {
  const env = p.envelope;
  if (!env || !Array.isArray(env.operations) || env.operations.length === 0) {
    throw new Error("Envelope must contain at least one operation.");
  }
  const feeAssetId = env.feeAssetId || "1.3.0";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr: any = new TransactionBuilder();
  for (const op of env.operations) {
    if (!op || typeof op.op_name !== "string" || !isPlainObject(op.op_data)) {
      throw new Error(
        "Each operation must have a string op_name and object op_data."
      );
    }
    // Inject zero-fee placeholder if not provided. set_required_fees will
    // overwrite with the actual chain-required fee.
    const opData = { ...op.op_data } as Record<string, unknown>;
    if (!opData.fee || !isPlainObject(opData.fee)) {
      opData.fee = { amount: 0, asset_id: feeAssetId };
    }
    if (!Array.isArray(opData.extensions)) {
      opData.extensions = [];
    }
    tr.add_type_operation(op.op_name, opData);
  }

  await tr.set_required_fees();
  await tr.update_head_block();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv: any = PrivateKey.fromWif(p.activeWif);
  tr.add_signer(priv, priv.toPublicKey().toPublicKeyString());
  const result = await tr.broadcast();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const head: any = Array.isArray(result) ? result[0] : result;
  const txId =
    head && typeof head === "object" && typeof head.id === "string"
      ? head.id
      : null;
  const operationResults =
    head && typeof head === "object" && Array.isArray(head.operation_results)
      ? head.operation_results
      : null;
  return { txId, operationResults, raw: result };
}

export interface LimitOrderParams {
  sellerAccountId: string;
  amountToSell: { asset_id: string; amount: string };
  minToReceive: { asset_id: string; amount: string };
  feeAssetId: string;
  expirationISO: string;
  fillOrKill?: boolean;
  activeWif: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createLimitOrder(p: LimitOrderParams): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr: any = new TransactionBuilder();
  tr.add_type_operation("limit_order_create", {
    fee: { amount: 0, asset_id: p.feeAssetId },
    seller: p.sellerAccountId,
    amount_to_sell: p.amountToSell,
    min_to_receive: p.minToReceive,
    expiration: p.expirationISO,
    fill_or_kill: !!p.fillOrKill,
    extensions: [],
  });
  await tr.set_required_fees();
  await tr.update_head_block();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv: any = PrivateKey.fromWif(p.activeWif);
  tr.add_signer(priv, priv.toPublicKey().toPublicKeyString());
  await tr.broadcast();
  return tr;
}

export interface CancelOrderParams {
  feePayingAccountId: string;
  orderId: string;
  feeAssetId: string;
  activeWif: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cancelLimitOrder(p: CancelOrderParams): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr: any = new TransactionBuilder();
  tr.add_type_operation("limit_order_cancel", {
    fee: { amount: 0, asset_id: p.feeAssetId },
    fee_paying_account: p.feePayingAccountId,
    order: p.orderId,
    extensions: [],
  });
  await tr.set_required_fees();
  await tr.update_head_block();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv: any = PrivateKey.fromWif(p.activeWif);
  tr.add_signer(priv, priv.toPublicKey().toPublicKeyString());
  await tr.broadcast();
  return tr;
}

// Convert a human amount (e.g. "12.5") into chain units given the asset precision.
export function toChainUnits(amount: string, precision: number): string {
  if (!amount) return "0";
  const [intPart, fracRaw = ""] = amount.split(".");
  const frac = (fracRaw + "0".repeat(precision)).slice(0, precision);
  const combined = `${intPart}${frac}`.replace(/^0+(?=\d)/, "");
  return combined || "0";
}

export function fromChainUnits(amount: string, precision: number): string {
  if (!amount) return "0";
  const s = amount.toString();
  if (precision === 0) return s;
  if (s.length <= precision) {
    return "0." + "0".repeat(precision - s.length) + s;
  }
  return s.slice(0, s.length - precision) + "." + s.slice(s.length - precision);
}

// --- Transfer -------------------------------------------------------------

export interface TransferParams {
  fromAccountId: string;
  toAccountName: string;
  amount: { asset_id: string; amount: string };
  feeAssetId: string;
  memo?: string;
  activeWif: string;
}

export interface TransferResult {
  txId: string | null;
  toAccountId: string;
}

export async function transfer(p: TransferParams): Promise<TransferResult> {
  const toAcc = await getAccount(p.toAccountName);
  if (!toAcc || !toAcc.id) {
    throw new Error(`Recipient account '${p.toAccountName}' not found on chain`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr: any = new TransactionBuilder();
  tr.add_type_operation("transfer", {
    fee: { amount: 0, asset_id: p.feeAssetId },
    from: p.fromAccountId,
    to: toAcc.id,
    amount: p.amount,
    extensions: [],
  });
  await tr.set_required_fees();
  await tr.update_head_block();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv: any = PrivateKey.fromWif(p.activeWif);
  tr.add_signer(priv, priv.toPublicKey().toPublicKeyString());
  const result = await tr.broadcast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txId = Array.isArray(result) ? (result[0] as any)?.id : (result as any)?.id;
  return { txId: txId || null, toAccountId: toAcc.id };
}

// --- HTLC -----------------------------------------------------------------

export interface HtlcCreateParams {
  fromAccountId: string;
  toAccountId: string;
  amount: { asset_id: string; amount: string };
  hashlockHex: string;
  preimageSize: number;
  claimPeriodSeconds: number;
  feeAssetId: string;
  activeWif: string;
}

export interface HtlcCreateResult {
  txId: string | null;
  htlcId: string | null;
}

 
export async function createHtlc(p: HtlcCreateParams): Promise<HtlcCreateResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr: any = new TransactionBuilder();
  tr.add_type_operation("htlc_create", {
    fee: { amount: 0, asset_id: p.feeAssetId },
    from: p.fromAccountId,
    to: p.toAccountId,
    amount: p.amount,
    preimage_hash: [2, p.hashlockHex],
    preimage_size: p.preimageSize,
    claim_period_seconds: p.claimPeriodSeconds,
    extensions: [],
  });
  await tr.set_required_fees();
  await tr.update_head_block();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv: any = PrivateKey.fromWif(p.activeWif);
  tr.add_signer(priv, priv.toPublicKey().toPublicKeyString());
  const result = await tr.broadcast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txId = Array.isArray(result) ? (result[0] as any)?.id : (result as any)?.id;
  let htlcId: string | null = null;
  const opResults =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Array.isArray(result) ? (result[0] as any)?.operation_results : (result as any)?.operation_results) ?? null;
  if (Array.isArray(opResults) && opResults.length > 0) {
    const first = opResults[0];
    if (Array.isArray(first) && typeof first[1] === "string") {
      htlcId = first[1];
    }
  }
  return { txId: txId || null, htlcId };
}

export interface HtlcRedeemParams {
  htlcId: string;
  redeemerAccountId: string;
  preimageHex: string;
  feeAssetId: string;
  activeWif: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function redeemHtlc(p: HtlcRedeemParams): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tr: any = new TransactionBuilder();
  tr.add_type_operation("htlc_redeem", {
    fee: { amount: 0, asset_id: p.feeAssetId },
    htlc_id: p.htlcId,
    redeemer: p.redeemerAccountId,
    preimage: p.preimageHex,
    extensions: [],
  });
  await tr.set_required_fees();
  await tr.update_head_block();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv: any = PrivateKey.fromWif(p.activeWif);
  tr.add_signer(priv, priv.toPublicKey().toPublicKeyString());
  await tr.broadcast();
  return tr;
}
