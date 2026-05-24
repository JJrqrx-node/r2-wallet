import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Card } from "../components/Card";
import { CopyButton } from "../components/CopyButton";
import { RQRX_NODES } from "../../lib/chain";
import type { ConnectionEntry } from "../../lib/connections";

interface SettingsProps {
  accountName: string;
  activePubKey?: string;
  ownerPubKey?: string;
  currentNodeUrl?: string;
  onLock: () => void;
  onBack: () => void;
  onWipe: () => void;
}

export function Settings({
  accountName,
  activePubKey,
  ownerPubKey,
  currentNodeUrl,
  onLock,
  onBack,
  onWipe,
}: SettingsProps) {
  const [nodeUrl, setNodeUrl] = useState(currentNodeUrl ?? RQRX_NODES[0] ?? "");
  const [nodeSaving, setNodeSaving] = useState(false);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [nodeSaved, setNodeSaved] = useState(false);
  const [wipeConfirm, setWipeConfirm] = useState(false);

  // Show-brain-key flow: passphrase required, then auto-hide after 60s.
  const [showBrainKey, setShowBrainKey] = useState(false);
  const [brainKeyPass, setBrainKeyPass] = useState("");
  const [brainKeyVal, setBrainKeyVal] = useState<string | null>(null);
  const [brainKeyErr, setBrainKeyErr] = useState<string | null>(null);
  const [brainKeyLoading, setBrainKeyLoading] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  // Connected sites
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [connLoading, setConnLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  async function loadConnections() {
    setConnLoading(true);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "LIST_CONNECTIONS",
      })) as { connections?: ConnectionEntry[] };
      setConnections(res?.connections ?? []);
    } finally {
      setConnLoading(false);
    }
  }

  useEffect(() => {
    void loadConnections();
  }, []);

  async function handleDisconnect(origin: string) {
    setDisconnecting(origin);
    try {
      await chrome.runtime.sendMessage({ type: "DISCONNECT_ORIGIN", origin });
      await loadConnections();
    } finally {
      setDisconnecting(null);
    }
  }

  function formatConnectedAt(ts: number): string {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  async function handleRevealBrainKey() {
    if (!brainKeyPass) {
      setBrainKeyErr("Enter your passphrase to reveal the brain key.");
      return;
    }
    setBrainKeyLoading(true);
    setBrainKeyErr(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "REVEAL_BRAIN_KEY",
        passphrase: brainKeyPass,
      })) as { brainKey?: string; error?: string };
      if (res?.error) {
        setBrainKeyErr(res.error);
        setBrainKeyVal(null);
      } else if (res?.brainKey) {
        setBrainKeyVal(res.brainKey);
        setBrainKeyPass("");
        // Auto-hide after 60s for shoulder-surfing protection.
        if (hideTimerRef.current !== null) {
          window.clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = window.setTimeout(() => {
          setBrainKeyVal(null);
          setShowBrainKey(false);
        }, 60_000);
      }
    } catch (e) {
      setBrainKeyErr(e instanceof Error ? e.message : "Failed to reveal brain key.");
    } finally {
      setBrainKeyLoading(false);
    }
  }

  function hideBrainKey() {
    setBrainKeyVal(null);
    setBrainKeyPass("");
    setBrainKeyErr(null);
    setShowBrainKey(false);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }

  async function handleSaveNode() {
    if (!nodeUrl.startsWith("wss://")) {
      setNodeError("Node URL must start with wss://");
      return;
    }
    setNodeSaving(true);
    setNodeError(null);
    setNodeSaved(false);
    await chrome.runtime.sendMessage({ type: "SET_NODE", nodeUrl });
    setNodeSaving(false);
    setNodeSaved(true);
    setTimeout(() => setNodeSaved(false), 2000);
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="screen-header">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <h2 className="screen-title">Settings</h2>
        <div style={{ width: 48 }} />
      </div>

      <div className="screen">
        {/* Account */}
        <Card title="Account">
          <div className="balance-row">
            <span className="muted-text">Name</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{accountName}</span>
          </div>
        </Card>

        {/* Public keys */}
        <Card title="Public Keys">
          <p className="muted-text" style={{ marginBottom: 4 }}>
            Active key (safe to share)
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div
              className="input input-mono"
              style={{
                fontSize: 10,
                wordBreak: "break-all",
                flex: 1,
                cursor: "text",
                userSelect: "all",
              }}
            >
              {activePubKey ?? "Not available"}
            </div>
            <button
              className="btn btn-ghost"
              style={{ flexShrink: 0, fontSize: 11, padding: "6px 8px" }}
              onClick={() => copyToClipboard(activePubKey ?? "")}
              disabled={!activePubKey}
            >
              Copy
            </button>
          </div>

          <p className="muted-text" style={{ marginTop: 12, marginBottom: 4 }}>
            Owner key (safe to share)
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div
              className="input input-mono"
              style={{
                fontSize: 10,
                wordBreak: "break-all",
                flex: 1,
                cursor: "text",
                userSelect: "all",
              }}
            >
              {ownerPubKey ?? "Not available"}
            </div>
            <button
              className="btn btn-ghost"
              style={{ flexShrink: 0, fontSize: 11, padding: "6px 8px" }}
              onClick={() => copyToClipboard(ownerPubKey ?? "")}
              disabled={!ownerPubKey}
            >
              Copy
            </button>
          </div>

          <p className="info-box" style={{ marginTop: 12 }}>
            Never share your brain key, WIF, or passphrase with anyone. R2 Wallet
            will never ask for them outside of the unlock screen.
          </p>
        </Card>

        {/* Show brain key */}
        <Card title="Brain Key">
          <p className="muted-text" style={{ marginBottom: 8 }}>
            Your brain key is the master backup for this account. Anyone with
            it can drain your funds. Only reveal it somewhere private.
          </p>

          {!showBrainKey && (
            <Button variant="secondary" onClick={() => setShowBrainKey(true)}>
              Show brain key
            </Button>
          )}

          {showBrainKey && !brainKeyVal && (
            <>
              <Input
                id="brain-key-pass"
                label="Confirm passphrase"
                type="password"
                value={brainKeyPass}
                onChange={e => { setBrainKeyPass(e.target.value); setBrainKeyErr(null); }}
                error={brainKeyErr ?? undefined}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex-row" style={{ marginTop: 8 }}>
                <Button variant="secondary" onClick={hideBrainKey}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  loading={brainKeyLoading}
                  onClick={() => void handleRevealBrainKey()}
                >
                  Reveal
                </Button>
              </div>
            </>
          )}

          {brainKeyVal && (
            <>
              <div
                className="input input-mono"
                style={{
                  fontSize: 12,
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                  userSelect: "all",
                  cursor: "text",
                  lineHeight: 1.6,
                  padding: 10,
                }}
              >
                {brainKeyVal}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <CopyButton
                  text={brainKeyVal}
                  label="Copy brain key"
                  copiedLabel="Copied to clipboard"
                />
                <Button variant="secondary" onClick={hideBrainKey}>
                  Hide
                </Button>
              </div>
              <p className="muted-text" style={{ marginTop: 8, fontSize: 11 }}>
                This will auto-hide in 60 seconds.
              </p>
            </>
          )}
        </Card>

        {/* Node selection */}
        <Card title="Network Node">
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="node-select">Preset nodes</label>
            <select
              id="node-select"
              className="input"
              value={RQRX_NODES.includes(nodeUrl) ? nodeUrl : "custom"}
              onChange={e => {
                if (e.target.value !== "custom") {
                  setNodeUrl(e.target.value);
                  setNodeError(null);
                }
              }}
              style={{ cursor: "pointer" }}
            >
              {RQRX_NODES.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
              {!RQRX_NODES.includes(nodeUrl) && (
                <option value="custom">Custom</option>
              )}
            </select>
          </div>

          <Input
            id="node-url"
            label="Custom WSS URL"
            value={nodeUrl}
            onChange={e => { setNodeUrl(e.target.value); setNodeError(null); setNodeSaved(false); }}
            error={nodeError ?? undefined}
            placeholder="wss://node.example.com:8090"
            autoComplete="off"
            spellCheck={false}
          />
          {nodeSaved ? <p className="success-text">Node saved.</p> : null}
          <Button
            variant="secondary"
            loading={nodeSaving}
            onClick={() => void handleSaveNode()}
            style={{ marginTop: 8 }}
          >
            Save node
          </Button>
        </Card>

        {/* Connected Sites */}
        <Card title="Connected Sites">
          <p className="muted-text" style={{ marginBottom: 8 }}>
            Sites that can read your account name and active public key, and
            request transaction signatures (each signature still requires your
            explicit approval).
          </p>
          {connLoading ? (
            <p className="muted-text">Loading...</p>
          ) : connections.length === 0 ? (
            <p className="muted-text">No sites connected.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {connections.map((c) => (
                <div
                  key={c.origin}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "8px 10px",
                    border: "1px solid var(--border, #1f2937)",
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        wordBreak: "break-all",
                        flex: 1,
                      }}
                    >
                      {c.origin}
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        padding: "6px 10px",
                        color: "var(--danger, #DC2626)",
                      }}
                      disabled={disconnecting === c.origin}
                      onClick={() => void handleDisconnect(c.origin)}
                    >
                      {disconnecting === c.origin ? "..." : "Disconnect"}
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                    }}
                  >
                    <span className="muted-text">{c.accountName}</span>
                    <span className="muted-text">
                      {formatConnectedAt(c.connectedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* About */}
        <Card title="About">
          <div className="balance-row">
            <span className="muted-text">Version</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              v{chrome.runtime.getManifest().version}
            </span>
          </div>
          <div className="balance-row" style={{ marginTop: 6 }}>
            <span className="muted-text">Downloads</span>
            <a
              href="https://r2-wallet-download.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                color: "var(--emerald, #10B981)",
                textDecoration: "underline",
                wordBreak: "break-all",
              }}
            >
              r2-wallet-download.vercel.app
            </a>
          </div>
          <p className="muted-text" style={{ marginTop: 8, fontSize: 11 }}>
            All releases are hosted here. The wallet checks for updates every
            6 hours and shows a banner when a new version is available.
          </p>
        </Card>

        {/* Danger zone */}
        <Card title="Danger Zone">
          <Button variant="secondary" onClick={onLock} style={{ marginBottom: 8 }}>
            Lock wallet
          </Button>

          {!wipeConfirm ? (
            <Button variant="danger" onClick={() => setWipeConfirm(true)}>
              Delete wallet data
            </Button>
          ) : (
            <div className="flex-col">
              <p className="error-text">
                This will permanently delete the encrypted vault from this device.
                Your account can only be recovered with your brain key. Are you sure?
              </p>
              <div className="flex-row">
                <Button variant="secondary" onClick={() => setWipeConfirm(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={onWipe}>
                  Delete permanently
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
