import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import type { PendingApproval, StateResponse } from "../../lib/messages";

function opLabel(opName: string): string {
  switch (opName) {
    case "transfer":
      return "Transfer";
    case "limit_order_create":
      return "Place limit order";
    case "limit_order_cancel":
      return "Cancel limit order";
    case "htlc_create":
      return "Create HTLC";
    case "htlc_redeem":
      return "Redeem HTLC";
    default:
      return opName;
  }
}

function renderOperationSummary(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const env = payload as { operations?: unknown; feeAssetId?: unknown };
  if (!Array.isArray(env.operations) || env.operations.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <p className="muted-text" style={{ marginBottom: 4 }}>
        Operations ({env.operations.length})
      </p>
      <ul
        style={{
          fontSize: 12,
          marginBottom: 8,
          paddingLeft: 18,
          color: "var(--text-muted, #94A3B8)",
          lineHeight: 1.6,
        }}
      >
        {env.operations.map((op, i) => {
          const o = op as { op_name?: unknown };
          const name = typeof o.op_name === "string" ? o.op_name : "unknown";
          return <li key={i}>{opLabel(name)}</li>;
        })}
      </ul>
    </div>
  );
}

interface ApprovalProps {
  onBack: () => void;
}

export function Approval({ onBack }: ApprovalProps) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string>("");
  const [activePubKey, setActivePubKey] = useState<string>("");

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_PENDING_APPROVALS" }, (resp: unknown) => {
      const r = resp as { approvals?: PendingApproval[] } | undefined;
      setApprovals(r?.approvals ?? []);
      setLoading(false);
    });
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (resp: unknown) => {
      const s = resp as StateResponse | undefined;
      setAccountName(s?.accountName ?? "");
      setActivePubKey(s?.activePubKey ?? "");
    });
  }, []);

  async function handleApprove(requestId: string) {
    setProcessing(requestId);
    setError(null);
    const resp = await chrome.runtime.sendMessage({
      type: "APPROVE_REQUEST",
      requestId,
    }) as { ok?: true } | { error: string };
    setProcessing(null);
    if ("error" in resp) {
      setError(resp.error);
      return;
    }
    setApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
    if (approvals.length <= 1) onBack();
  }

  async function handleReject(requestId: string) {
    setProcessing(requestId);
    setError(null);
    await chrome.runtime.sendMessage({ type: "REJECT_REQUEST", requestId });
    setProcessing(null);
    setApprovals((prev) => prev.filter((a) => a.requestId !== requestId));
    if (approvals.length <= 1) onBack();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="screen-header">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <h2 className="screen-title">Approval Required</h2>
        <div style={{ width: 48 }} />
      </div>

      <div className="screen">
        {loading ? (
          <div style={{ textAlign: "center" }}>
            <div className="spinner" />
          </div>
        ) : approvals.length === 0 ? (
          <p className="muted-text text-center">No pending approvals.</p>
        ) : (
          approvals.map((approval) => {
            const isConnect = approval.type === "requestAccounts";
            return (
              <Card key={approval.requestId}>
                <p className="card-title">
                  {isConnect ? "Connect to site" : "Sign transaction"}
                </p>

                <div style={{ marginBottom: 12 }}>
                  <p className="muted-text" style={{ marginBottom: 4 }}>
                    Site
                  </p>
                  <span className="approval-origin">{approval.origin}</span>
                </div>

                {isConnect ? (
                  <>
                    <p
                      className="muted-text"
                      style={{ marginBottom: 8, fontSize: 12 }}
                    >
                      This site is requesting to connect to your wallet. If you
                      allow, it will be able to:
                    </p>
                    <ul
                      style={{
                        fontSize: 12,
                        marginBottom: 12,
                        paddingLeft: 18,
                        color: "var(--text-muted, #94A3B8)",
                        lineHeight: 1.6,
                      }}
                    >
                      <li>See your account name and active public key</li>
                      <li>Ask for transaction signatures (still requires your approval each time)</li>
                    </ul>
                    <p
                      className="muted-text"
                      style={{ marginBottom: 4, fontSize: 11 }}
                    >
                      Account
                    </p>
                    <div
                      className="input input-mono"
                      style={{
                        fontSize: 12,
                        wordBreak: "break-all",
                        userSelect: "all",
                        marginBottom: 8,
                      }}
                    >
                      {accountName || "Unknown"}
                    </div>
                    {activePubKey ? (
                      <>
                        <p
                          className="muted-text"
                          style={{ marginBottom: 4, fontSize: 11 }}
                        >
                          Active public key
                        </p>
                        <div
                          className="input input-mono"
                          style={{
                            fontSize: 10,
                            wordBreak: "break-all",
                            userSelect: "all",
                            marginBottom: 12,
                          }}
                        >
                          {activePubKey}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : approval.payload ? (
                  <div style={{ marginBottom: 12 }}>
                    {renderOperationSummary(approval.payload)}
                    <p className="muted-text" style={{ marginBottom: 4 }}>
                      Raw transaction
                    </p>
                    <pre
                      className="input input-mono"
                      style={{
                        height: 80,
                        overflow: "auto",
                        fontSize: 11,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {JSON.stringify(approval.payload, null, 2)}
                    </pre>
                  </div>
                ) : null}

                {error ? <p className="error-text" style={{ marginBottom: 8 }}>{error}</p> : null}

                <div className="flex-row">
                  <Button
                    variant="danger"
                    loading={processing === approval.requestId}
                    onClick={() => void handleReject(approval.requestId)}
                  >
                    {isConnect ? "Deny" : "Reject"}
                  </Button>
                  <Button
                    variant="primary"
                    loading={processing === approval.requestId}
                    onClick={() => void handleApprove(approval.requestId)}
                  >
                    {isConnect ? "Allow" : "Approve"}
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
