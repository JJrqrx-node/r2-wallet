import { Button } from "../components/Button";

interface WelcomeProps {
  onCreate: () => void;
  onImport: () => void;
}

export function Welcome({ onCreate, onImport }: WelcomeProps) {
  return (
    <div className="screen" style={{ justifyContent: "center", alignItems: "center" }}>
      <div className="welcome-hero">
        <div className="welcome-logo-mark" aria-hidden="true">R2</div>
        <h1 className="welcome-title">R2 Wallet</h1>
        <p className="welcome-subtitle">
          Non-custodial wallet for the R-Squared blockchain.
        </p>
      </div>

      <div className="flex-col" style={{ width: "100%", marginTop: 8 }}>
        <Button variant="primary" onClick={onCreate}>
          Create new account
        </Button>
        <Button variant="secondary" onClick={onImport}>
          Import existing account
        </Button>
      </div>

      <p className="muted-text text-center" style={{ marginTop: "auto", fontSize: 11 }}>
        r2dex.io
      </p>
    </div>
  );
}
