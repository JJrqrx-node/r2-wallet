import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "R2 Wallet",
  version: "0.1.14",
  description:
    "Non-custodial wallet for the R-Squared blockchain (r2dex.io). Create accounts, hold balances, sign transactions, and connect to R-Squared dApps.",
  // No default_popup — clicking the toolbar icon opens the side panel
  // (wired in the service worker via chrome.sidePanel + action.onClicked).
  action: {
    default_title: "R2 Wallet",
    default_icon: {
      16: "src/manifest/icons/icon-16.png",
      32: "src/manifest/icons/icon-32.png",
      48: "src/manifest/icons/icon-48.png",
    },
  },
  side_panel: {
    default_path: "sidepanel.html",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    // Main-world inpage provider: runs directly in the page context so
    // window.rsquared is defined synchronously at document_start, bypassing
    // the page's CSP (which restricts script-src to 'self').
    {
      matches: ["https://r2dex.io/*"],
      js: ["src/content/inpage.ts"],
      run_at: "document_start",
      world: "MAIN",
    },
    // Isolated-world bridge: relays postMessage between the page and the
    // service worker. Runs in the extension's isolated context so it can
    // call chrome.runtime APIs.
    {
      matches: ["https://r2dex.io/*"],
      js: ["src/content/content-script.ts"],
      run_at: "document_start",
    },
  ],
  permissions: ["storage", "sidePanel", "alarms", "downloads", "tabs"],
  host_permissions: [
    "https://r2dex.io/*",
    "https://r2-wallet-download.vercel.app/*",
    "wss://*.rsquared.digital/*",
  ],
  icons: {
    16: "src/manifest/icons/icon-16.png",
    32: "src/manifest/icons/icon-32.png",
    48: "src/manifest/icons/icon-48.png",
    128: "src/manifest/icons/icon-128.png",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src 'self' https://r2dex.io https://r2-wallet-download.vercel.app wss://*.rsquared.digital:8090",
  },
};

export default manifest;
