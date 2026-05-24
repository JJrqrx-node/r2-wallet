// Type declarations for the window.rsquared provider injected by R2 Wallet.
// dApp authors can reference this file for IDE support.

interface R2AccountInfo {
  accountName: string;
  activePubKey: string;
}

interface R2BalanceInfo {
  balance: string;
}

interface R2AccountData {
  account: {
    id: string;
    name: string;
    balances: Array<{ asset_id: string; amount: string }>;
  } | null;
}

interface R2TransferResult {
  txId: string | null;
  toAccountId: string;
}

interface R2WalletProvider {
  /** true — identifies this provider as R2 Wallet */
  readonly isR2Wallet: true;

  /**
   * Request permission to connect. Returns account name and active public key.
   * Requires user approval in the R2 Wallet popup.
   */
  requestAccounts(): Promise<R2AccountInfo>;

  /**
   * Request the user to sign and broadcast a transaction.
   * The transaction envelope is forwarded to the service worker, which shows
   * an approval prompt before signing with the active WIF.
   */
  signTransaction(txEnvelope: unknown): Promise<R2TransferResult>;

  /**
   * Get the balance of an asset for the connected account.
   * @param asset Asset ID in the form "1.3.x"
   */
  getBalance(asset: string): Promise<R2BalanceInfo>;

  /**
   * Fetch account data by name from the chain.
   * Does NOT require approval — read-only.
   */
  getAccount(name: string): Promise<R2AccountData>;
}

interface Window {
  rsquared?: R2WalletProvider;
}
