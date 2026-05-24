import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { toChainUnits, fromChainUnits } from "../../lib/tx";
import { fmtAmountTrim } from "../../lib/format";
import BigNumber from "bignumber.js";

interface SendProps {
  accountName: string;
  onSuccess: (txId: string | null) => void;
  onBack: () => void;
}

interface AssetMeta {
  asset_id: string;
  symbol: string;
  precision: number;
  balance: string; // chain units; "0" if not held
}

// Fallback when the chain lookup hasn't returned yet.
const DEFAULT_ASSETS: AssetMeta[] = [
  { asset_id: "1.3.0", symbol: "RQRX", precision: 5, balance: "0" },
  { asset_id: "1.3.1", symbol: "RQETH", precision: 8, balance: "0" },
];

type RecipientStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; accountId: string }
  | { kind: "not_found" }
  | { kind: "invalid" }
  | { kind: "lookup_error"; message: string };

export function Send({ accountName, onBack, onSuccess }: SendProps) {
  const [recipient, setRecipient] = useState("");
  const [asset, setAsset] = useState("1.3.0"); // RQRX core asset
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<AssetMeta[]>(DEFAULT_ASSETS);
  const [feeChainUnits, setFeeChainUnits] = useState<string | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [recipientStatus, setRecipientStatus] =
    useState<RecipientStatus>({ kind: "idle" });

  // Pull live asset metadata (symbol + precision) from the user's balances.
  useEffect(() => {
    void (async () => {
      try {
        const resp = await chrome.runtime.sendMessage({ type: "GET_BALANCES" }) as
          | {
              balances: Array<{
                asset_id: string;
                amount: string;
                symbol?: string;
                precision?: number;
              }>;
            }
          | { error: string };
        if ("error" in resp) return;
        // Merge known defaults with anything new from the account.
        const merged = new Map<string, AssetMeta>();
        for (const d of DEFAULT_ASSETS) merged.set(d.asset_id, d);
        for (const b of resp.balances) {
          if (b.symbol && typeof b.precision === "number") {
            merged.set(b.asset_id, {
              asset_id: b.asset_id,
              symbol: b.symbol,
              precision: b.precision,
              balance: b.amount ?? "0",
            });
          } else {
            // Asset metadata not enriched yet — still keep the balance.
            const existing = merged.get(b.asset_id);
            if (existing) existing.balance = b.amount ?? "0";
          }
        }
        setAssets(Array.from(merged.values()));
      } catch {
        // Keep defaults.
      }
    })();
  }, []);

  // Non-null: DEFAULT_ASSETS is a non-empty literal, so the fallback always
  // returns a valid AssetMeta. The TS narrower can't prove that on its own.
  const selectedAsset =
    assets.find((a) => a.asset_id === asset) ?? (DEFAULT_ASSETS[0] as AssetMeta);

  // Debounced recipient existence check. We hit the chain via the SW
  // (RESOLVE_ACCOUNT) any time the user pauses typing for 350ms. If the
  // account doesn't exist on-chain, surface a flag immediately so the user
  // doesn't waste a fee on a doomed transfer. We also short-circuit on the
  // user's own name (always valid) and on syntactically invalid names.
  useEffect(() => {
    const trimmed = recipient.trim();
    if (!trimmed) {
      setRecipientStatus({ kind: "idle" });
      return;
    }
    // R-Squared account-name rules: lowercase, digits, dot, dash; 3–63
    // chars; must start with a letter.
    if (!/^[a-z][a-z0-9.-]{2,62}$/.test(trimmed)) {
      setRecipientStatus({ kind: "invalid" });
      return;
    }
    // Self-send: skip the network round-trip.
    if (trimmed === accountName) {
      setRecipientStatus({ kind: "ok", accountId: "self" });
      return;
    }

    setRecipientStatus({ kind: "checking" });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const resp = (await chrome.runtime.sendMessage({
            type: "RESOLVE_ACCOUNT",
            name: trimmed,
          })) as
            | { exists: true; accountId: string; accountName: string }
            | { exists: false }
            | { error: string };
          if (cancelled) return;
          if ("error" in resp) {
            setRecipientStatus({
              kind: "lookup_error",
              message: resp.error,
            });
          } else if (resp.exists) {
            setRecipientStatus({ kind: "ok", accountId: resp.accountId });
          } else {
            setRecipientStatus({ kind: "not_found" });
          }
        } catch (e) {
          if (!cancelled) {
            setRecipientStatus({
              kind: "lookup_error",
              message: e instanceof Error ? e.message : "Lookup failed.",
            });
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [recipient, accountName]);

  // Ask the SW for a real on-chain fee estimate whenever the asset changes
  // (or on mount). The fee is paid in the same asset that's being sent so
  // users don't need to keep RQRX on hand to pay fees in another asset.
  useEffect(() => {
    let cancelled = false;
    setFeeLoading(true);
    setFeeError(null);
    void (async () => {
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "GET_TRANSFER_FEE",
          toAccountName: recipient.trim() || "",
          assetId: asset,
          amount: toChainUnits("1", selectedAsset.precision),
          feeAssetId: asset,
        }) as { fee: { amount: string; asset_id: string } } | { error: string };
        if (cancelled) return;
        if ("error" in resp) {
          setFeeError(resp.error);
          setFeeChainUnits(null);
        } else {
          setFeeChainUnits(resp.fee.amount);
        }
      } catch {
        if (!cancelled) setFeeError("Could not load fee estimate.");
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [asset, selectedAsset.precision, recipient]);

  const feeDisplay: string | null = feeChainUnits
    ? `${fmtAmountTrim(fromChainUnits(feeChainUnits, selectedAsset.precision), selectedAsset.precision)} ${selectedAsset.symbol}`
    : null;

  // Available balance display (trimmed of trailing zeros).
  const balanceDisplay = fmtAmountTrim(
    fromChainUnits(selectedAsset.balance, selectedAsset.precision),
    selectedAsset.precision
  );

  // Send Max: amount = balance - fee, in chain units, then convert back to
  // human units for the input. Fee is paid in the same asset so we subtract
  // directly. If fee hasn't loaded yet, fall back to balance (the chain will
  // reject if it's truly over-budget). Never sets a negative amount.
  function handleMax() {
    const bal = new BigNumber(selectedAsset.balance || "0");
    const fee = new BigNumber(feeChainUnits || "0");
    let maxUnits = bal.minus(fee);
    if (maxUnits.lt(0)) maxUnits = new BigNumber(0);
    const human = fromChainUnits(maxUnits.toFixed(0), selectedAsset.precision);
    setAmount(human);
    setError(null);
  }

  const maxDisabled =
    feeLoading ||
    new BigNumber(selectedAsset.balance || "0")
      .minus(new BigNumber(feeChainUnits || "0"))
      .lte(0);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!recipient.trim()) { setError("Recipient account name is required"); return; }
    if (recipientStatus.kind === "invalid") {
      setError("Recipient name is not a valid R-Squared account format.");
      return;
    }
    if (recipientStatus.kind === "not_found") {
      setError(
        `"${recipient.trim()}" is not a registered R-Squared account. Double-check the name before sending.`
      );
      return;
    }
    if (recipientStatus.kind === "checking") {
      setError("Still verifying recipient. Try again in a moment.");
      return;
    }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError("Enter a valid amount");
      return;
    }

    setLoading(true);
    try {
      // Use the chain-reported precision for the selected asset so amounts
      // like 0.0003 RQETH (precision 8) convert correctly to chain units.
      const chainAmount = toChainUnits(amount, selectedAsset.precision);
      const resp = await chrome.runtime.sendMessage({
        type: "SEND_TRANSFER",
        toAccountName: recipient.trim(),
        assetId: asset,
        amount: chainAmount,
        // Pay fee in the same asset that's being sent.
        feeAssetId: asset,
      }) as { txId?: string | null; toAccountId?: string } | { error: string };

      if ("error" in resp) {
        setError(resp.error);
        return;
      }

      onSuccess(resp.txId ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <h2 className="screen-title">Send</h2>
        <div style={{ width: 48 }} />
      </div>

      <form onSubmit={(e) => void handleSend(e)} className="flex-col">
        <Input
          id="recipient"
          label="Recipient account name"
          placeholder="account-name-1"
          value={recipient}
          onChange={e => { setRecipient(e.target.value); setError(null); }}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
        {recipientStatus.kind !== "idle" ? (
          <div
            style={{
              fontSize: 11,
              marginTop: -8,
              marginBottom: 8,
              color:
                recipientStatus.kind === "ok"
                  ? "var(--accent, #10B981)"
                  : recipientStatus.kind === "checking"
                    ? "var(--text-muted, #8B8B8E)"
                    : "#F87171",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {recipientStatus.kind === "checking" && (
              <>Checking on-chain…</>
            )}
            {recipientStatus.kind === "ok" && (
              <>Registered R-Squared account</>
            )}
            {recipientStatus.kind === "not_found" && (
              <>
                <span aria-hidden="true" style={{ fontWeight: 700 }}>!</span>
                Not a registered R-Squared account.
              </>
            )}
            {recipientStatus.kind === "invalid" && (
              <>
                <span aria-hidden="true" style={{ fontWeight: 700 }}>!</span>
                Invalid account-name format.
              </>
            )}
            {recipientStatus.kind === "lookup_error" && (
              <>Could not verify recipient: {recipientStatus.message}</>
            )}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="asset-select">Asset</label>
          <select
            id="asset-select"
            className="input"
            value={asset}
            onChange={e => { setAsset(e.target.value); setError(null); }}
            style={{ cursor: "pointer" }}
          >
            {assets.map((a) => (
              <option key={a.asset_id} value={a.asset_id}>
                {a.symbol}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 4,
            }}
          >
            <label htmlFor="amount">Amount ({selectedAsset.symbol})</label>
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              Available: {balanceDisplay} {selectedAsset.symbol}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              id="amount"
              className="input"
              type="number"
              placeholder={"0." + "0".repeat(selectedAsset.precision)}
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(null); }}
              min="0"
              step={"0." + "0".repeat(Math.max(0, selectedAsset.precision - 1)) + "1"}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleMax}
              disabled={maxDisabled}
              style={{
                fontSize: 12,
                padding: "0 12px",
                border: "1px solid var(--border, #2A2A2D)",
                borderRadius: 6,
                color: maxDisabled ? "var(--text-faint, #5A5A5D)" : "var(--accent, #10B981)",
                fontWeight: 600,
                cursor: maxDisabled ? "not-allowed" : "pointer",
              }}
              title="Send entire balance minus network fee"
            >
              Max
            </button>
          </div>
        </div>

        <div
          className="field"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "8px 10px",
            border: "1px solid var(--border, #1f2937)",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <span style={{ opacity: 0.7 }}>Network fee</span>
          <span style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
            {feeLoading ? "Loading…" : feeError ? "—" : feeDisplay ?? "—"}
          </span>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          disabled={
            recipientStatus.kind === "not_found" ||
            recipientStatus.kind === "invalid" ||
            recipientStatus.kind === "checking"
          }
        >
          Send
        </Button>
      </form>
    </div>
  );
}
