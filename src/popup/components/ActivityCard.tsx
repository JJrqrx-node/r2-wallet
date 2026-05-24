import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "./Spinner";
import { fmtAmountTrim } from "../../lib/format";

// Mirror of the HistoryEntry interface in service-worker.ts. Kept duplicated
// rather than imported to avoid pulling service-worker types into popup bundle.
interface HistoryEntry {
  id: string;
  blockNum: number;
  opType: number;
  direction: "in" | "out" | "self" | "other";
  fromId?: string;
  toId?: string;
  fromName?: string;
  toName?: string;
  amount?: string;
  assetId?: string;
  assetSymbol?: string;
  assetPrecision?: number;
  feeAmount?: string;
  feeAssetSymbol?: string;
  feeAssetPrecision?: number;
  memoHex?: string;
  // Trade enrichment for ops 54 / 57.
  payAmount?: string;
  payAssetSymbol?: string;
  payAssetPrecision?: number;
  receiveAmount?: string;
  receiveAssetSymbol?: string;
  receiveAssetPrecision?: number;
  tradeSide?: string;
  // Cancel order (op 55).
  orderId?: string;
}

// R-Squared blockchain operation type names. NOT the upstream BitShares
// Graphene enum — R-Squared remapped several op slots. Source of truth is
// the chain's operations.hpp; the ones we surface here are the user-visible
// happy-path ops (transfers, HTLCs, DEX activity).
const OP_NAMES: Record<number, string> = {
  0: "Transfer",
  49: "HTLC create",
  50: "HTLC redeem",
  51: "HTLC redeemed",
  52: "HTLC extend",
  53: "HTLC refund",
  54: "Limit order",
  55: "Cancel order",
  56: "Margin update",
  57: "Trade filled",
};

function opLabel(t: number): string {
  return OP_NAMES[t] ?? `Op #${t}`;
}

function shortBlock(n: number): string {
  // Compact display: 1.2M instead of 1,234,567 for older transfers.
  if (n >= 1_000_000) return `#${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `#${(n / 1_000).toFixed(1)}k`;
  return `#${n}`;
}

// Format a chain integer amount + precision into a human-readable string.
function fmtChain(
  amount: string | undefined,
  precision: number | undefined
): string | null {
  if (!amount || precision === undefined) return null;
  const num = Number(amount) / Math.pow(10, precision);
  return fmtAmountTrim(num, precision);
}

export function ActivityCard() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedOnce = useRef(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = (await chrome.runtime.sendMessage({
        type: "GET_HISTORY",
        limit: 25,
      })) as { entries?: HistoryEntry[]; error?: string };
      if (resp.error) {
        setError(resp.error);
      } else {
        setEntries(resp.entries ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch first time the card is opened, not on every toggle.
  useEffect(() => {
    if (open && !fetchedOnce.current) {
      fetchedOnce.current = true;
      void fetchHistory();
    }
  }, [open, fetchHistory]);

  return (
    <div className="card" style={{ padding: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          color: "var(--text, #ECECEC)",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        <span>Activity</span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            opacity: 0.7,
            fontWeight: 500,
          }}
        >
          {entries ? `${entries.length} item${entries.length === 1 ? "" : "s"}` : ""}
          <span
            aria-hidden="true"
            style={{
              display: "inline-block",
              transition: "transform 0.15s ease",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            ▸
          </span>
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 12px" }}>
          {loading && !entries ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <Spinner />
            </div>
          ) : error ? (
            <>
              <p className="error-text">{error}</p>
              <button
                className="btn btn-ghost"
                onClick={() => void fetchHistory()}
                style={{ fontSize: 12, padding: "4px 10px", marginTop: 6 }}
              >
                Retry
              </button>
            </>
          ) : entries && entries.length === 0 ? (
            <p className="muted-text" style={{ fontSize: 12 }}>
              No activity yet. Transfers and other on-chain operations will
              appear here.
            </p>
          ) : entries ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {entries.map((e) => (
                  <ActivityRow key={e.id} entry={e} />
                ))}
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => void fetchHistory()}
                disabled={loading}
                style={{ fontSize: 11, padding: "4px 10px", marginTop: 10 }}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface RowDisplay {
  headline: string;
  subtitle: string | null;
  // Right-column primary line (e.g. "−10 RQRX", "+0.001 RQETH"). Color hints
  // are emerald for inbound, red for outbound, neutral otherwise.
  primaryAmount: { text: string; color: "in" | "out" | "neutral" } | null;
  // Optional second line, e.g. for fill_order showing both legs of the trade.
  secondaryAmount: { text: string; color: "in" | "out" | "neutral" } | null;
}

// Build the row's display strings based on opType and direction. This is the
// single source of truth for activity row labeling — keep R-Squared op
// semantics in here, not scattered across markup.
function describe(entry: HistoryEntry): RowDisplay {
  const isOut = entry.direction === "out";
  const isIn = entry.direction === "in";

  // --- Transfer (op 0) ----------------------------------------------------
  if (entry.opType === 0) {
    const amountStr = fmtChain(entry.amount, entry.assetPrecision);
    const symbol = entry.assetSymbol ?? "";
    const counterparty = isOut
      ? entry.toName ?? entry.toId ?? "unknown"
      : isIn
        ? entry.fromName ?? entry.fromId ?? "unknown"
        : entry.direction === "self"
          ? "self"
          : null;
    return {
      headline:
        isOut ? "Sent" : isIn ? "Received" : entry.direction === "self" ? "Self transfer" : "Transfer",
      subtitle: counterparty
        ? `${isOut ? "to" : isIn ? "from" : ""} ${counterparty}`.trim()
        : null,
      primaryAmount: amountStr
        ? {
            text: `${isOut ? "−" : isIn ? "+" : ""}${amountStr} ${symbol}`.trim(),
            color: isOut ? "out" : isIn ? "in" : "neutral",
          }
        : null,
      secondaryAmount: null,
    };
  }

  // --- Limit order create (op 54) ----------------------------------------
  if (entry.opType === 54) {
    const sold = fmtChain(entry.payAmount, entry.payAssetPrecision);
    const want = fmtChain(entry.receiveAmount, entry.receiveAssetPrecision);
    const soldSym = entry.payAssetSymbol ?? "";
    const wantSym = entry.receiveAssetSymbol ?? "";
    const headline =
      sold && want
        ? `Sell ${soldSym} for ${wantSym}`
        : "Limit order placed";
    const subtitle =
      sold && want ? `${sold} ${soldSym} → ${want} ${wantSym}` : null;
    return {
      headline,
      subtitle,
      primaryAmount: sold
        ? { text: `−${sold} ${soldSym}`.trim(), color: "out" }
        : null,
      secondaryAmount: want
        ? { text: `+${want} ${wantSym} expected`.trim(), color: "neutral" }
        : null,
    };
  }

  // --- Limit order cancel (op 55) ----------------------------------------
  if (entry.opType === 55) {
    return {
      headline: "Order canceled",
      subtitle: entry.orderId ? `Order ${entry.orderId}` : null,
      primaryAmount: null,
      secondaryAmount: null,
    };
  }

  // --- Fill order (op 57) -------------------------------------------------
  if (entry.opType === 57) {
    const paid = fmtChain(entry.payAmount, entry.payAssetPrecision);
    const got = fmtChain(entry.receiveAmount, entry.receiveAssetPrecision);
    const paidSym = entry.payAssetSymbol ?? "";
    const gotSym = entry.receiveAssetSymbol ?? "";
    return {
      headline: "Trade filled",
      subtitle:
        paid && got ? `${paid} ${paidSym} → ${got} ${gotSym}` : null,
      primaryAmount: paid
        ? { text: `−${paid} ${paidSym}`.trim(), color: "out" }
        : null,
      secondaryAmount: got
        ? { text: `+${got} ${gotSym}`.trim(), color: "in" }
        : null,
    };
  }

  // --- HTLC ops (49–53) and anything else --------------------------------
  return {
    headline: opLabel(entry.opType),
    subtitle: null,
    primaryAmount: null,
    secondaryAmount: null,
  };
}

function amountColor(c: "in" | "out" | "neutral"): string {
  if (c === "out") return "#F87171";
  if (c === "in") return "var(--emerald, #10B981)";
  return "var(--text, #ECECEC)";
}

function ActivityRow({ entry }: { entry: HistoryEntry }) {
  const d = describe(entry);
  const feeStr = fmtChain(entry.feeAmount, entry.feeAssetPrecision);
  const feeSym = entry.feeAssetSymbol ?? "";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 10px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid var(--border, #2A2A2D)",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, color: "var(--text, #ECECEC)" }}>
          {d.headline}
        </div>
        {d.subtitle ? (
          <div
            style={{
              fontSize: 11,
              opacity: 0.7,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={d.subtitle}
          >
            {d.subtitle}
          </div>
        ) : null}
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 2 }}>
          Block {shortBlock(entry.blockNum)}
          {entry.memoHex ? " · memo" : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {d.primaryAmount ? (
          <div style={{ fontWeight: 600, color: amountColor(d.primaryAmount.color) }}>
            {d.primaryAmount.text}
          </div>
        ) : null}
        {d.secondaryAmount ? (
          <div
            style={{
              fontWeight: 500,
              color: amountColor(d.secondaryAmount.color),
              marginTop: 2,
              fontSize: 11,
            }}
          >
            {d.secondaryAmount.text}
          </div>
        ) : null}
        {feeStr ? (
          <div style={{ fontSize: 10, opacity: 0.55, marginTop: 2 }}>
            fee {feeStr} {feeSym}
          </div>
        ) : null}
      </div>
    </div>
  );
}
