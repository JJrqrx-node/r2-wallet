import { useState } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import {
  deriveFromBrainKey,
  validateAccountName,
  callRegistrar,
  waitForAccount,
} from "../../lib/signup";
import type { DerivedKeys } from "../../lib/signup";
import { connect, getAccountByPublicKey } from "../../lib/chain";

interface ImportAccountProps {
  onSuccess: (accountName: string, keys: DerivedKeys, passphrase: string) => void;
  onBack: () => void;
}

type Stage = "brainkey" | "register" | "passphrase";

export function ImportAccount({ onSuccess, onBack }: ImportAccountProps) {
  const [stage, setStage] = useState<Stage>("brainkey");

  // Stage 1: brain key
  const [brainKey, setBrainKey] = useState("");
  const [keys, setKeys] = useState<DerivedKeys | null>(null);
  const [foundName, setFoundName] = useState<string | null>(null);

  // Stage 2: register-new-name (only when no account references the key)
  const [newAccountName, setNewAccountName] = useState("");

  // Stage 3: passphrase
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function handleLookup() {
    setError(null);
    setInfo(null);
    const trimmed = brainKey.trim();
    if (!trimmed) { setError("Brain key is required"); return; }
    const words = trimmed.split(/\s+/);
    if (words.length < 12) {
      setError("Brain key must be at least 12 words");
      return;
    }

    setLoading(true);
    try {
      const derived = deriveFromBrainKey(trimmed);
      setKeys(derived);

      // Look up the active key on chain.
      await connect();
      const acc = await getAccountByPublicKey(derived.active.pub);

      if (acc) {
        // Existing account — go straight to passphrase stage.
        setFoundName(acc.name);
        setStage("passphrase");
      } else {
        // No account on chain — offer to register a new one via jj-r2.
        setFoundName(null);
        setStage("register");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to derive keys from brain key");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setError(null);
    setInfo(null);
    if (!keys) { setError("Internal error: no derived keys"); return; }
    const nameErr = validateAccountName(newAccountName);
    if (nameErr) { setError(nameErr); return; }

    setLoading(true);
    try {
      setInfo("Registering " + newAccountName + " with jj-r2 registrar...");
      const result = await callRegistrar(newAccountName, keys);
      if (!result.ok) {
        setError(result.error || "Registration failed");
        setInfo(null);
        return;
      }
      setInfo("Waiting for account to appear on chain...");
      const ok = await waitForAccount(newAccountName);
      if (!ok) {
        setError("Account was registered but did not appear on chain in time. Try unlocking again later.");
        setInfo(null);
        return;
      }
      setFoundName(newAccountName);
      setStage("passphrase");
      setInfo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  function handleFinish() {
    setError(null);
    if (!keys || !foundName) { setError("Internal error"); return; }
    if (passphrase.length < 8) {
      setError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setError("Passphrases do not match");
      return;
    }
    onSuccess(foundName, keys, passphrase);
  }

  // --- Render ---

  return (
    <div className="screen">
      <div className="screen-header">
        <button className="btn btn-ghost" onClick={onBack}>Back</button>
        <h2 className="screen-title">Import Account</h2>
        <div style={{ width: 48 }} />
      </div>

      {stage === "brainkey" && (
        <>
          <div className="info-box">
            Enter your existing brain key. We will look up your account on chain
            automatically. Your keys never leave the extension.
          </div>

          <div className="field">
            <label htmlFor="brain-key-input">Brain key</label>
            <textarea
              id="brain-key-input"
              className="input input-mono"
              style={{ height: 80, resize: "none" }}
              placeholder="word1 word2 word3 ... (12-16 words)"
              value={brainKey}
              onChange={e => { setBrainKey(e.target.value); setError(null); }}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          <Button variant="primary" loading={loading} onClick={handleLookup}>
            Look up account
          </Button>
        </>
      )}

      {stage === "register" && (
        <>
          <div className="info-box">
            No on-chain account references this brain key. Register a new account
            name with the jj-r2 registrar to use it. Lowercase letters, digits, and
            dashes only — must contain a digit or a dash.
          </div>

          <Input
            id="new-account-name"
            label="New account name"
            placeholder="my-account-1"
            value={newAccountName}
            onChange={e => { setNewAccountName(e.target.value.toLowerCase()); setError(null); }}
            autoComplete="off"
            spellCheck={false}
          />

          {info ? <p className="muted-text">{info}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          <Button variant="primary" loading={loading} onClick={handleRegister}>
            Register with jj-r2
          </Button>
          <button
            className="btn btn-ghost"
            onClick={() => { setStage("brainkey"); setError(null); setInfo(null); }}
          >
            Use a different brain key
          </button>
        </>
      )}

      {stage === "passphrase" && foundName && (
        <>
          <div className="info-box">
            Found account <strong>{foundName}</strong> on chain. Set a passphrase
            to encrypt your vault on this device.
          </div>

          <Input
            id="passphrase"
            label="New passphrase"
            type="password"
            placeholder="At least 8 characters"
            value={passphrase}
            onChange={e => { setPassphrase(e.target.value); setError(null); }}
            autoComplete="new-password"
          />

          <Input
            id="passphrase-confirm"
            label="Confirm passphrase"
            type="password"
            placeholder="Repeat passphrase"
            value={passphraseConfirm}
            onChange={e => { setPassphraseConfirm(e.target.value); setError(null); }}
            autoComplete="new-password"
          />

          {error ? <p className="error-text">{error}</p> : null}

          <Button variant="primary" onClick={handleFinish}>
            Finish import
          </Button>
        </>
      )}
    </div>
  );
}
