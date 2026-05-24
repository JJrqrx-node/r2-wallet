// Typed message protocol between popup / sidepanel / content-script / service worker.
// All messages are discriminated unions on the `type` field.

// --- Outbound (popup/content -> SW) ---------------------------------------

export interface MsgCreateAccount {
  type: "CREATE_ACCOUNT";
  accountName: string;
  brainKey: string;
  ownerPubKey: string;
  activePubKey: string;
  memoPubKey: string;
  passphrase: string;
}

export interface MsgUnlock {
  type: "UNLOCK";
  passphrase: string;
}

export interface MsgLock {
  type: "LOCK";
}

export interface MsgGetState {
  type: "GET_STATE";
}

export interface MsgSignTransaction {
  type: "SIGN_TRANSACTION";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txEnvelope: any;
}

export interface MsgApproveRequest {
  type: "APPROVE_REQUEST";
  requestId: string;
}

export interface MsgRejectRequest {
  type: "REJECT_REQUEST";
  requestId: string;
}

export interface MsgSendTransfer {
  type: "SEND_TRANSFER";
  toAccountName: string;
  assetId: string;
  amount: string; // chain units
  feeAssetId: string;
}

export interface MsgGetBalances {
  type: "GET_BALANCES";
}

export interface MsgGetTransferFee {
  type: "GET_TRANSFER_FEE";
  toAccountName: string;
  assetId: string;
  amount: string; // chain units
  feeAssetId: string;
}

export interface MsgSetNode {
  type: "SET_NODE";
  nodeUrl: string;
}

// --- Inbound dApp requests (content-script -> SW) -------------------------

export interface MsgDappRequestAccounts {
  type: "DAPP_REQUEST_ACCOUNTS";
  origin: string;
  requestId: string;
}

export interface MsgDappSignTransaction {
  type: "DAPP_SIGN_TRANSACTION";
  origin: string;
  requestId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txEnvelope: any;
}

export interface MsgDappGetBalance {
  type: "DAPP_GET_BALANCE";
  origin: string;
  requestId: string;
  asset: string;
}

export interface MsgDappGetAccount {
  type: "DAPP_GET_ACCOUNT";
  origin: string;
  requestId: string;
  name: string;
}

export interface MsgRevealBrainKey {
  type: "REVEAL_BRAIN_KEY";
  passphrase: string;
}

export interface MsgGetHistory {
  type: "GET_HISTORY";
  limit?: number;
}

export interface MsgListConnections {
  type: "LIST_CONNECTIONS";
}

export interface MsgDisconnectOrigin {
  type: "DISCONNECT_ORIGIN";
  origin: string;
}

export interface MsgResolveAccount {
  type: "RESOLVE_ACCOUNT";
  name: string;
}

// --- Union types ----------------------------------------------------------

export type WalletMessage =
  | MsgCreateAccount
  | MsgUnlock
  | MsgLock
  | MsgGetState
  | MsgSignTransaction
  | MsgApproveRequest
  | MsgRejectRequest
  | MsgSendTransfer
  | MsgGetBalances
  | MsgGetTransferFee
  | MsgSetNode
  | MsgDappRequestAccounts
  | MsgDappSignTransaction
  | MsgDappGetBalance
  | MsgDappGetAccount
  | MsgRevealBrainKey
  | MsgGetHistory
  | MsgListConnections
  | MsgDisconnectOrigin
  | MsgResolveAccount;

// --- Responses ------------------------------------------------------------

export interface StateResponse {
  locked: boolean;
  hasVault: boolean;
  accountName?: string;
  accountId?: string;
  activePubKey?: string;
  ownerPubKey?: string;
  memoPubKey?: string;
  nodeUrl?: string;
}

export interface ErrorResponse {
  error: string;
}

export interface OkResponse {
  ok: true;
}

// Pending dApp approval item shown in the Approval screen.
export interface PendingApproval {
  requestId: string;
  type: "requestAccounts" | "signTransaction";
  origin: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}
