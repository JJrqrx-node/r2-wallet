import { useEffect, useState } from "react";
import type { UpdateInfo } from "../../lib/update-check";

const DOWNLOAD_FALLBACK = "https://r2-wallet-download.vercel.app";

type Stage = "idle" | "downloading" | "guide" | "error";

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const resp = (await chrome.runtime.sendMessage({
          type: "GET_UPDATE_INFO",
        })) as { info: UpdateInfo | null } | { error: string };
        if ("info" in resp) setInfo(resp.info);
      } catch {
        /* ignore */
      }
      try {
        const r = await chrome.storage.local.get("r2_update_dismissed");
        setDismissed((r["r2_update_dismissed"] as string | undefined) ?? null);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  if (!info || !info.available || !info.latest) return null;
  if (dismissed === info.latest) return null;

  // One-click guided update:
  //   1. Trigger chrome.downloads.download() with the zip URL.
  //   2. Open chrome://extensions in a new tab.
  //   3. Show step-by-step instructions inline in the banner.
  // Chrome's security model does NOT allow programmatic install of an
  // unpacked extension, so this is the smoothest possible flow until the
  // wallet is on the Chrome Web Store.
  async function handleUpdate() {
    setErrMsg(null);
    setStage("downloading");
    const zipUrl = info?.zipUrl ?? `${DOWNLOAD_FALLBACK}/r2-wallet-${info?.latest}.zip`;
    try {
      // Trigger the download. saveAs=true prompts the user to pick a
      // location, which makes the file easy to find for drag-drop.
      await chrome.downloads.download({
        url: zipUrl,
        filename: `r2-wallet-${info?.latest}.zip`,
        saveAs: true,
      });
    } catch (e) {
      // If downloads.download() fails (permission revoked, etc.), fall
      // back to opening the download page in a new tab.
      setErrMsg(e instanceof Error ? e.message : "Download failed.");
      try {
        await chrome.tabs.create({
          url: info?.downloadPage ?? DOWNLOAD_FALLBACK,
        });
      } catch {
        window.open(info?.downloadPage ?? DOWNLOAD_FALLBACK, "_blank");
      }
      setStage("error");
      return;
    }

    // Open chrome://extensions so the user can drag-drop the new zip.
    try {
      await chrome.tabs.create({ url: "chrome://extensions" });
    } catch {
      // Some Chromium forks block chrome:// from tabs.create; show guide
      // anyway and let the user navigate manually.
    }
    setStage("guide");
  }

  async function handleDismiss() {
    if (!info?.latest) return;
    await chrome.storage.local.set({ r2_update_dismissed: info.latest });
    setDismissed(info.latest);
  }

  async function handleCheckAgain() {
    setChecking(true);
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: "CHECK_FOR_UPDATE",
      })) as { info: UpdateInfo | null } | { error: string };
      if ("info" in resp) setInfo(resp.info);
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }

  // --- Guided steps shown after one-click ---------------------------------
  if (stage === "guide") {
    return (
      <div
        style={{
          border: "1px solid var(--emerald, #10B981)",
          background: "rgba(16, 185, 129, 0.08)",
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 12,
          fontSize: 12,
        }}
      >
        <strong style={{ color: "var(--emerald, #10B981)", display: "block", marginBottom: 8 }}>
          Finish installing v{info.latest}
        </strong>
        <ol style={{ margin: "0 0 8px 18px", padding: 0, lineHeight: 1.7 }}>
          <li>
            The new zip is downloading to your computer. The
            <strong> chrome://extensions </strong> page just opened.
          </li>
          <li>
            Toggle <strong>Developer mode</strong> on (top-right) if it isn&apos;t already.
          </li>
          <li>
            <strong>Drag the new zip file</strong> onto the chrome://extensions page,
            or click <strong>Load unpacked</strong> after unzipping.
          </li>
          <li>Remove the old R2 Wallet card so only the new one remains.</li>
          <li>Re-open the side panel. You&apos;re on v{info.latest}.</li>
        </ol>
        <p style={{ margin: "0 0 8px", fontSize: 11, opacity: 0.65 }}>
          We&apos;re publishing to the Chrome Web Store soon — after that, future
          updates will install themselves automatically.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => setStage("idle")}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Close
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => void chrome.tabs.create({ url: "chrome://extensions" })}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Open chrome://extensions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--emerald, #10B981)",
        background: "rgba(16, 185, 129, 0.08)",
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 12,
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <strong style={{ color: "var(--emerald, #10B981)" }}>
          Update available — v{info.latest}
        </strong>
        <span style={{ opacity: 0.6 }}>Installed: v{info.current}</span>
      </div>
      {info.releaseNotes ? (
        <p style={{ margin: "6px 0 8px", opacity: 0.85 }}>{info.releaseNotes}</p>
      ) : null}
      {errMsg ? (
        <p style={{ margin: "6px 0 8px", color: "#F87171", fontSize: 11 }}>
          {errMsg} Opening the download page instead.
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          onClick={() => void handleUpdate()}
          disabled={stage === "downloading"}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          {stage === "downloading" ? "Downloading…" : `Update to v${info.latest}`}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => void handleCheckAgain()}
          style={{ fontSize: 12, padding: "4px 10px" }}
          disabled={checking}
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => void handleDismiss()}
          style={{ fontSize: 12, padding: "4px 10px", marginLeft: "auto", opacity: 0.7 }}
          title="Hide until next version"
        >
          Dismiss
        </button>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 11, opacity: 0.55 }}>
        One click downloads the zip and walks you through the drag-drop. Or grab
        any version manually at{" "}
        <a
          href={DOWNLOAD_FALLBACK}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--emerald, #10B981)", textDecoration: "underline" }}
        >
          r2-wallet-download.vercel.app
        </a>
        . Chrome Web Store version is coming — that one will auto-install.
      </p>
    </div>
  );
}
