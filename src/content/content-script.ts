// Content script: runs at document_start on r2dex.io and localhost.
// Injects inpage.ts into the page context, then relays messages
// between the page (window.postMessage) and the service worker
// (chrome.runtime.sendMessage). Also forwards DAPP_EVENT pushes from the SW
// to the page so the inpage provider can re-emit them as wallet events.

import {
  isInpageMessage,
  methodToSwType,
  CONTENT_SOURCE,
} from "../lib/dapp-bridge";
import type { WalletMessage } from "../lib/messages";
import {
  DAPP_EVENT_SOURCE,
  type DappEventMessage,
} from "../lib/dapp-events";

// Note: the inpage script (which defines window.rsquared) is now injected
// directly via the manifest using `world: "MAIN"` on a separate content
// script entry. That bypasses the page's CSP and runs synchronously at
// document_start. This file (the isolated-world bridge) just relays
// postMessage between the page and the service worker.

// --- Page -> Service Worker -----------------------------------------------
// Listen for messages from the inpage script and forward to SW.
window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isInpageMessage(event.data)) return;

  const { id, method, params } = event.data;
  const swType = methodToSwType(method);
  if (!swType) {
    window.postMessage(
      {
        source: CONTENT_SOURCE,
        id,
        error: `Unknown method: ${method}`,
      },
      "*"
    );
    return;
  }

  const origin = window.location.origin;

  // Build the SW message depending on method type.
  let swMessage: WalletMessage;
  switch (swType) {
    case "DAPP_REQUEST_ACCOUNTS":
      swMessage = { type: "DAPP_REQUEST_ACCOUNTS", origin, requestId: id };
      break;
    case "DAPP_SIGN_TRANSACTION":
      swMessage = {
        type: "DAPP_SIGN_TRANSACTION",
        origin,
        requestId: id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        txEnvelope: (params as any)?.txEnvelope ?? params,
      };
      break;
    case "DAPP_GET_BALANCE":
      swMessage = {
        type: "DAPP_GET_BALANCE",
        origin,
        requestId: id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        asset: (params as any)?.asset ?? "",
      };
      break;
    case "DAPP_GET_ACCOUNT":
      swMessage = {
        type: "DAPP_GET_ACCOUNT",
        origin,
        requestId: id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        name: (params as any)?.name ?? "",
      };
      break;
    case "DISCONNECT_ORIGIN":
      swMessage = { type: "DISCONNECT_ORIGIN", origin };
      break;
    default:
      return;
  }

  chrome.runtime.sendMessage(swMessage, (response: unknown) => {
    if (chrome.runtime.lastError) {
      window.postMessage(
        {
          source: CONTENT_SOURCE,
          id,
          error: chrome.runtime.lastError.message ?? "Extension error",
        },
        "*"
      );
      return;
    }
    window.postMessage({ source: CONTENT_SOURCE, id, result: response }, "*");
  });
});

// --- Service Worker -> Page (push events) ---------------------------------
// The SW sends DAPP_EVENT messages via chrome.tabs.sendMessage when wallet
// state changes (lock, disconnect, accountsChanged). We forward them into
// the page main world via window.postMessage with a distinctive source so
// the inpage provider can re-emit them as wallet events.
chrome.runtime.onMessage.addListener(
  (
    message: DappEventMessage | { type?: string },
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response: unknown) => void
  ) => {
    if (message && (message as DappEventMessage).type === "DAPP_EVENT") {
      const evt = message as DappEventMessage;
      window.postMessage(
        {
          source: DAPP_EVENT_SOURCE,
          event: evt.event,
          data: evt.data,
        },
        "*"
      );
    }
    return false;
  }
);
