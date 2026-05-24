import { useState, useEffect, useCallback } from "react";
import { Button } from "../components/Button";
import { AccountBadge } from "../components/AccountBadge";
import { Card } from "../components/Card";
import { ActivityCard } from "../components/ActivityCard";
import { Spinner } from "../components/Spinner";
import { UpdateBanner } from "../components/UpdateBanner";
import { fmtAmountTrim } from "../../lib/format";
import { fromChainUnits } from "../../lib/tx";

interface BalanceEntry {
  asset_id: string;
  amount: string;
  symbol?: string;
  precision?: number;
}

interface HomeProps {
  accountName: string;
  onSend: () => void;
  onSettings: () => void;
  onLock: () => void;
  onApproval: () => void;
  hasPendingApproval: boolean;
}

export function Home({
  accountName,
  onSend,
  onSettings,
  onLock,
  onApproval,
  hasPendingApproval,
}: HomeProps) {
  const [balances, setBalances] = useState<BalanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    setError(null);
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

      if ("error" in resp) {
        setError(resp.error);
        return;
      }

      // Service worker enriches each balance with symbol + precision via
      // get_assets. Fall back to raw asset_id / precision=5 if missing.
      setBalances(
        resp.balances.map((b) => ({
          asset_id: b.asset_id,
          amount: b.amount,
          symbol: b.symbol ?? b.asset_id,
          precision: b.precision ?? 5,
        }))
      );
    } catch {
      setError("Could not load balances. Check your network connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBalances();
  }, [fetchBalances]);

  const displayAmount = (b: BalanceEntry): string => {
    const precision = b.precision ?? 5;
    const human = fromChainUnits(b.amount, precision);
    // Trim trailing zeros so e.g. 0.30000 RQRX displays as 0.3 and
    // 0.00030000 RQETH displays as 0.0003.
    return fmtAmountTrim(human, precision);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div className="screen-header">
        <div className="logo">
          <div className="logo-mark" aria-hidden="true">R2</div>
          <span className="logo-text">R2 Wallet</span>
        </div>
        <div className="flex-row" style={{ gap: 4 }}>
          {hasPendingApproval ? (
            <button
              className="btn btn-ghost"
              onClick={onApproval}
              style={{ color: "var(--red)", fontWeight: 600 }}
            >
              Approval
            </button>
          ) : null}
          <button className="btn btn-ghost" onClick={onSettings}>
            Settings
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="screen" style={{ paddingTop: 12 }}>
        <UpdateBanner />
        <AccountBadge name={accountName} />

        <Card title="Balances">
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              <Spinner />
            </div>
          ) : error ? (
            <p className="error-text">{error}</p>
          ) : balances.length === 0 ? (
            <p className="muted-text">No balances found.</p>
          ) : (
            balances.map((b) => (
              <div className="balance-row" key={b.asset_id}>
                <span className="balance-asset">{b.symbol ?? b.asset_id}</span>
                <span className="balance-amount">{displayAmount(b)}</span>
              </div>
            ))
          )}
        </Card>

        <Button
          variant="secondary"
          onClick={() => void fetchBalances()}
          style={{ fontSize: 12 }}
        >
          Refresh
        </Button>

        <ActivityCard />

        <div className="mt-auto flex-col">
          <Button variant="primary" onClick={onSend}>
            Send
          </Button>
          <Button variant="secondary" onClick={onLock}>
            Lock wallet
          </Button>
        </div>
      </div>
    </div>
  );
}
