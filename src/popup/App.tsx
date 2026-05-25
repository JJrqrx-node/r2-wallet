import { useState, useEffect, useCallback } from "react";
import { Welcome } from "./routes/Welcome";
import { CreateAccount } from "./routes/CreateAccount";
import { ImportAccount } from "./routes/ImportAccount";
import { Unlock } from "./routes/Unlock";
import { Home } from "./routes/Home";
import { Send } from "./routes/Send";
import { Approval } from "./routes/Approval";
import { Settings } from "./routes/Settings";
import { Spinner } from "./components/Spinner";
import type { StateResponse, PendingApproval } from "../lib/messages";
import type { DerivedKeys } from "../lib/signup";
import "./styles.css";

type Route =
  | "loading"
  | "welcome"
  | "create"
  | "import"
  | "unlock"
  | "home"
  | "send"
  | "approval"
  | "settings";

interface AppProps {
  wide?: boolean; // true in side panel
}

export function App({ wide = false }: AppProps) {
  const [route, setRoute] = useState<Route>("loading");
  const [walletState, setWalletState] = useState<StateResponse | null>(null);
  const [hasPendingApproval, setHasPendingApproval] = useState(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const state = await chrome.runtime.sendMessage({
        type: "GET_STATE",
      }) as StateResponse;
      setWalletState(state);

      if (!state.hasVault) {
        setRoute("welcome");
      } else if (state.locked) {
        setRoute("unlock");
      } else {
        setRoute("home");
      }

      // Check for pending approvals.
      chrome.runtime.sendMessage(
        { type: "GET_PENDING_APPROVALS" },
        (resp: unknown) => {
          const r = resp as { approvals?: PendingApproval[] } | undefined;
          setHasPendingApproval((r?.approvals?.length ?? 0) > 0);
        }
      );
    } catch {
      setRoute("welcome");
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Poll for new pending approvals every second so dApp connect/sign requests
  // surface immediately even if the popup or side panel was already open
  // before the request was queued. Without this, the user has to manually
  // close and reopen the wallet UI to see the Approval button appear.
  useEffect(() => {
    const interval = window.setInterval(() => {
      try {
        chrome.runtime.sendMessage(
          { type: "GET_PENDING_APPROVALS" },
          (resp: unknown) => {
            if (chrome.runtime.lastError) return;
            const r = resp as { approvals?: PendingApproval[] } | undefined;
            setHasPendingApproval((r?.approvals?.length ?? 0) > 0);
          }
        );
      } catch {
        // ignore — SW may be transitioning
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  // --- Account creation / import callback ---------------------------------

  async function handleAccountReady(
    accountName: string,
    keys: DerivedKeys,
    passphrase: string
  ) {
    const resp = await chrome.runtime.sendMessage({
      type: "CREATE_ACCOUNT",
      accountName,
      brainKey: keys.brainkey,
      ownerPubKey: keys.owner.pub,
      activePubKey: keys.active.pub,
      memoPubKey: keys.memo.pub,
      passphrase,
    }) as { ok?: true } | { error: string };

    if ("ok" in resp) {
      await loadState();
    }
  }

  // --- Unlock callback -----------------------------------------------------

  async function handleUnlock(passphrase: string): Promise<string | null> {
    const resp = await chrome.runtime.sendMessage({
      type: "UNLOCK",
      passphrase,
    }) as StateResponse | { error: string };

    if ("error" in resp) return resp.error;

    setWalletState(resp as StateResponse);
    setRoute("home");
    return null;
  }

  // --- Lock / wipe ---------------------------------------------------------

  async function handleLock() {
    await chrome.runtime.sendMessage({ type: "LOCK" });
    setRoute("unlock");
  }

  async function handleWipe() {
    await chrome.runtime.sendMessage({ type: "LOCK" });
    // Wipe vault via SW (the SW exports wipeVault but we trigger via a special message).
    // For now: direct storage wipe from popup context. Also clear the per-origin
    // connection registry so any previously-connected dApps must re-authorize
    // the next account that gets imported on this device.
    await chrome.storage.local.remove(["r2_vault", "r2_connections"]);
    setWalletState(null);
    setRoute("welcome");
  }

  // --- Container class based on wide mode ----------------------------------
  const containerClass = wide ? "wallet-panel" : "wallet-popup";

  // --- Loading state -------------------------------------------------------
  if (route === "loading") {
    return (
      <div className={containerClass} style={{ justifyContent: "center", alignItems: "center" }}>
        <Spinner size={32} />
      </div>
    );
  }

  // --- Send success overlay ------------------------------------------------
  if (sendSuccess !== null) {
    return (
      <div className={containerClass}>
        <div className="screen" style={{ justifyContent: "center", alignItems: "center", gap: 12 }}>
          <p className="success-text" style={{ fontSize: 18, fontWeight: 700 }}>
            Transaction sent
          </p>
          {sendSuccess ? (
            <p className="muted-text text-center" style={{ fontSize: 11, wordBreak: "break-all" }}>
              TX ID: {sendSuccess}
            </p>
          ) : null}
          <button
            className="btn btn-primary"
            onClick={() => { setSendSuccess(null); setRoute("home"); }}
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {route === "welcome" && (
        <Welcome
          onCreate={() => setRoute("create")}
          onImport={() => setRoute("import")}
        />
      )}

      {route === "create" && (
        <CreateAccount
          onSuccess={(name, keys, pass) => void handleAccountReady(name, keys, pass)}
          onBack={() => setRoute("welcome")}
        />
      )}

      {route === "import" && (
        <ImportAccount
          onSuccess={(name, keys, pass) => void handleAccountReady(name, keys, pass)}
          onBack={() => setRoute("welcome")}
        />
      )}

      {route === "unlock" && (
        <Unlock onUnlock={handleUnlock} />
      )}

      {route === "home" && walletState?.accountName && (
        <Home
          accountName={walletState.accountName}
          hasPendingApproval={hasPendingApproval}
          onSend={() => setRoute("send")}
          onSettings={() => setRoute("settings")}
          onLock={() => void handleLock()}
          onApproval={() => setRoute("approval")}
        />
      )}

      {route === "send" && walletState?.accountName && (
        <Send
          accountName={walletState.accountName}
          onSuccess={(txId) => setSendSuccess(txId ?? "")}
          onBack={() => setRoute("home")}
        />
      )}

      {route === "approval" && (
        <Approval onBack={() => setRoute("home")} />
      )}

      {route === "settings" && walletState?.accountName && (
        <Settings
          accountName={walletState.accountName}
          activePubKey={walletState.activePubKey}
          ownerPubKey={walletState.ownerPubKey}
          currentNodeUrl={walletState.nodeUrl}
          onLock={() => void handleLock()}
          onBack={() => setRoute("home")}
          onWipe={() => void handleWipe()}
        />
      )}
    </div>
  );
}
