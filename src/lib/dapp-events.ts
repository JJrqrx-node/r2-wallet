// Push events from the service worker to dApp pages.
// The SW sends these to all tabs matching a given origin via chrome.tabs.sendMessage,
// the content script forwards them to the page via window.postMessage, and the
// inpage provider re-emits them as wallet events that the dApp can subscribe to.

export const DAPP_EVENT_SOURCE = "r2-wallet-event";

export type DappEventName = "accountsChanged" | "disconnect" | "connect";

export interface DappEventMessage {
  type: "DAPP_EVENT";
  event: DappEventName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

export interface DappEventEnvelope {
  source: typeof DAPP_EVENT_SOURCE;
  event: DappEventName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}
