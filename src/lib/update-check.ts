// Update check for R2 Wallet.
//
// Chrome only auto-installs updates for extensions delivered via the Chrome
// Web Store. Until the wallet is listed (and for users who side-load the .zip
// from r2-wallet-download.vercel.app), we poll a small manifest hosted next to
// the zip and surface a banner in the popup so users know when a new version
// is available.
//
// Manifest shape (served at VERSION_MANIFEST_URL):
//   {
//     "version":      "0.1.5",
//     "sha256":       "<hex digest of the zip>",
//     "zipUrl":       "https://r2-wallet-download.vercel.app/r2-wallet-0.1.5.zip",
//     "downloadPage": "https://r2-wallet-download.vercel.app",
//     "releaseNotes": "Asset symbol labels + update checker.",
//     "publishedAt":  "2026-05-23T22:00:00Z",
//     "minVersion":   "0.1.0"
//   }

export const VERSION_MANIFEST_URL =
  "https://r2-wallet-download.vercel.app/version.json";

export interface VersionManifest {
  version: string;
  sha256?: string;
  zipUrl?: string;
  downloadPage?: string;
  releaseNotes?: string;
  publishedAt?: string;
  minVersion?: string;
}

export interface UpdateInfo {
  available: boolean;
  current: string;
  latest?: string;
  zipUrl?: string;
  downloadPage?: string;
  releaseNotes?: string;
  publishedAt?: string;
  checkedAt: number;
  error?: string;
}

const STORAGE_KEY = "r2_update_info";

// Compare semver-ish strings (X.Y.Z). Returns negative/0/positive like compareFn.
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

export async function fetchVersionManifest(): Promise<VersionManifest> {
  // Cache-bust to make sure we never get a stale CDN copy.
  const url = `${VERSION_MANIFEST_URL}?t=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as VersionManifest;
}

// Run an update check and persist the result to chrome.storage.local.
// Safe to call from the service worker on an alarm tick or on demand from the
// popup. Never throws — failures are recorded inside UpdateInfo.error.
export async function runUpdateCheck(): Promise<UpdateInfo> {
  const current = chrome.runtime.getManifest().version;
  const checkedAt = Date.now();
  try {
    const m = await fetchVersionManifest();
    if (!m.version || typeof m.version !== "string") {
      throw new Error("Manifest missing version field");
    }
    const available = compareVersions(m.version, current) > 0;
    const info: UpdateInfo = {
      available,
      current,
      latest: m.version,
      zipUrl: m.zipUrl,
      downloadPage: m.downloadPage,
      releaseNotes: m.releaseNotes,
      publishedAt: m.publishedAt,
      checkedAt,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: info });
    // Reflect the state on the toolbar badge so users see "UP" without
    // having to open the popup.
    if (available) {
      await chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
      await chrome.action.setBadgeText({ text: "UP" });
    }
    return info;
  } catch (e) {
    const info: UpdateInfo = {
      available: false,
      current,
      checkedAt,
      error: e instanceof Error ? e.message : String(e),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: info });
    return info;
  }
}

export async function readUpdateInfo(): Promise<UpdateInfo | null> {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  const v = r[STORAGE_KEY];
  return v ? (v as UpdateInfo) : null;
}

// User has acknowledged the current update — hide the banner until a NEWER
// version is published.
export async function dismissUpdate(version: string): Promise<void> {
  await chrome.storage.local.set({ r2_update_dismissed: version });
}

export async function getDismissedVersion(): Promise<string | null> {
  const r = await chrome.storage.local.get("r2_update_dismissed");
  return (r["r2_update_dismissed"] as string | undefined) ?? null;
}
