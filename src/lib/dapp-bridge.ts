// Helpers used by the content-script to relay messages between the page
// (window.postMessage) and the service worker (chrome.runtime.sendMessage).

export const INPAGE_SOURCE = "r2-wallet-inpage";
export const CONTENT_SOURCE = "r2-wallet-content";

export interface InpageMessage {
  source: typeof INPAGE_SOURCE;
  id: string;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
}

export interface ContentResponse {
  source: typeof CONTENT_SOURCE;
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  error?: string;
}

export function isInpageMessage(data: unknown): data is InpageMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as InpageMessage).source === INPAGE_SOURCE &&
    typeof (data as InpageMessage).id === "string" &&
    typeof (data as InpageMessage).method === "string"
  );
}

// Map inpage method names to SW message types.
export function methodToSwType(
  method: string
):
  | "DAPP_REQUEST_ACCOUNTS"
  | "DAPP_SIGN_TRANSACTION"
  | "DAPP_GET_BALANCE"
  | "DAPP_GET_ACCOUNT"
  | "DISCONNECT_ORIGIN"
  | null {
  switch (method) {
    case "requestAccounts":
      return "DAPP_REQUEST_ACCOUNTS";
    case "signTransaction":
      return "DAPP_SIGN_TRANSACTION";
    case "getBalance":
      return "DAPP_GET_BALANCE";
    case "getAccount":
      return "DAPP_GET_ACCOUNT";
    case "disconnect":
      return "DISCONNECT_ORIGIN";
    default:
      return null;
  }
}
