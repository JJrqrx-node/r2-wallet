import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";

interface UnlockProps {
  onUnlock: (passphrase: string) => Promise<string | null>;
}

export function Unlock({ onUnlock }: UnlockProps) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) { setError("Passphrase is required"); return; }
    setLoading(true);
    setError(null);
    const err = await onUnlock(passphrase);
    setLoading(false);
    if (err) setError(err);
  }

  return (
    <div className="screen" style={{ justifyContent: "center" }}>
      <div className="welcome-hero" style={{ paddingTop: 24 }}>
        <div className="welcome-logo-mark" aria-hidden="true">R2</div>
        <h1 className="welcome-title">R2 Wallet</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex-col" style={{ marginTop: 16 }}>
        <Input
          id="unlock-passphrase"
          label="Passphrase"
          type="password"
          placeholder="Enter your passphrase"
          value={passphrase}
          onChange={e => { setPassphrase(e.target.value); setError(null); }}
          autoFocus
          autoComplete="current-password"
        />

        {error ? <p className="error-text">{error}</p> : null}

        <Button type="submit" variant="primary" loading={loading}>
          Unlock
        </Button>
      </form>
    </div>
  );
}
