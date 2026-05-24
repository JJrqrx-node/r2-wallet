import { useState, useEffect } from "react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { CopyButton } from "../components/CopyButton";
import {
  generateBrainKey,
  deriveFromBrainKey,
  validateAccountName,
  callRegistrar,
} from "../../lib/signup";
import type { DerivedKeys } from "../../lib/signup";

type Step = "brain-key" | "name" | "passphrase" | "registering";

interface CreateAccountProps {
  onSuccess: (accountName: string, keys: DerivedKeys, passphrase: string) => void;
  onBack: () => void;
  // True when rendered inside the side panel (no popup-close hazard there).
  wide?: boolean;
}

// Where we stash the in-progress brain key so the popup closing (e.g. when the
// user switches to a notes app to paste it) doesn't force them to start over
// with a brand-new brain key on reopen. Stored in chrome.storage.session so it
// is wiped on browser restart.
const DRAFT_KEY = "r2_create_account_draft";

interface CreateDraft {
  step: Step;
  brainKey: string;
  confirmed: boolean;
  accountName: string;
}

async function loadDraft(): Promise<CreateDraft | null> {
  try {
    const r = await chrome.storage.session.get(DRAFT_KEY);
    const v = r[DRAFT_KEY];
    if (v && typeof v === "object" && typeof v.brainKey === "string") {
      return v as CreateDraft;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function saveDraft(d: CreateDraft): Promise<void> {
  try { await chrome.storage.session.set({ [DRAFT_KEY]: d }); } catch { /* ignore */ }
}

async function clearDraft(): Promise<void> {
  try { await chrome.storage.session.remove(DRAFT_KEY); } catch { /* ignore */ }
}

export function CreateAccount({ onSuccess, onBack }: CreateAccountProps) {
  const [step, setStep] = useState<Step>("brain-key");
  const [brainKey, setBrainKey] = useState<string>(() => generateBrainKey());
  const [confirmed, setConfirmed] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseConfirm, setPassphraseConfirm] = useState("");
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // On mount, restore any prior draft so a closed popup doesn't lose the
  // brain key the user was about to copy.
  useEffect(() => {
    void (async () => {
      const d = await loadDraft();
      if (d) {
        setBrainKey(d.brainKey);
        setStep(d.step);
        setConfirmed(d.confirmed);
        setAccountName(d.accountName);
      }
      setDraftLoaded(true);
    })();
  }, []);

  // Persist the draft whenever it changes (only after initial load to avoid
  // overwriting a saved draft with an empty initial render).
  useEffect(() => {
    if (!draftLoaded) return;
    if (step === "registering") return; // don't persist transient states
    void saveDraft({ step, brainKey, confirmed, accountName });
  }, [step, brainKey, confirmed, accountName, draftLoaded]);

  function handleNameNext() {
    const err = validateAccountName(accountName);
    if (err) { setNameError(err); return; }
    setNameError(null);
    setStep("passphrase");
  }

  async function handleCreate() {
    if (passphrase.length < 8) {
      setPassphraseError("Passphrase must be at least 8 characters");
      return;
    }
    if (passphrase !== passphraseConfirm) {
      setPassphraseError("Passphrases do not match");
      return;
    }
    setPassphraseError(null);
    setStep("registering");
    setLoading(true);

    const keys = deriveFromBrainKey(brainKey);

    const result = await callRegistrar(accountName, keys);
    setLoading(false);

    if (!result.ok) {
      setError(result.error ?? "Registration failed");
      setStep("passphrase");
      return;
    }

    // Account created — wipe the draft so a fresh CreateAccount visit gets a
    // brand-new brain key.
    await clearDraft();
    onSuccess(accountName, keys, passphrase);
  }

  // --- Step: show brain key ---
  if (step === "brain-key") {
    return (
      <div className="screen">
        <div className="screen-header">
          <button className="btn btn-ghost" onClick={onBack}>Back</button>
          <h2 className="screen-title">Your Brain Key</h2>
          <div style={{ width: 48 }} />
        </div>

        <div className="warning-box">
          WRITE THIS DOWN. Your brain key is the only way to recover your
          account. R2 Wallet does not store it. If you lose it, your account is
          gone permanently.
        </div>

        <div>
          <p className="muted-text" style={{ marginBottom: 6 }}>
            Brain key (16 words):
          </p>
          <div className="brain-key-box" role="textbox" aria-readonly="true">
            {brainKey}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <CopyButton text={brainKey} label="Copy brain key" copiedLabel="Copied to clipboard" />
          </div>
        </div>

        <label className="flex-row" style={{ alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            style={{ marginTop: 2, accentColor: "var(--emerald)", flexShrink: 0 }}
          />
          <span style={{ fontSize: 13, color: "var(--text)" }}>
            I have securely written down my brain key offline and understand that
            R2 Wallet cannot recover it for me.
          </span>
        </label>

        <Button
          variant="primary"
          disabled={!confirmed}
          onClick={() => setStep("name")}
        >
          Continue
        </Button>
      </div>
    );
  }

  // --- Step: pick account name ---
  if (step === "name") {
    return (
      <div className="screen">
        <div className="screen-header">
          <button className="btn btn-ghost" onClick={() => setStep("brain-key")}>Back</button>
          <h2 className="screen-title">Account Name</h2>
          <div style={{ width: 48 }} />
        </div>

        <div className="info-box">
          Account names on R-Squared are permanent and public. They must contain
          a dash or digit (e.g. alice-1). 3-63 lowercase characters.
        </div>

        <Input
          id="account-name"
          label="Account name"
          placeholder="my-account-1"
          value={accountName}
          onChange={e => {
            setAccountName(e.target.value.toLowerCase());
            setNameError(null);
          }}
          error={nameError ?? undefined}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />

        <Button variant="primary" onClick={handleNameNext}>
          Continue
        </Button>
      </div>
    );
  }

  // --- Step: set passphrase ---
  if (step === "passphrase") {
    return (
      <div className="screen">
        <div className="screen-header">
          <button className="btn btn-ghost" onClick={() => setStep("name")}>Back</button>
          <h2 className="screen-title">Set Passphrase</h2>
          <div style={{ width: 48 }} />
        </div>

        <div className="info-box">
          Your passphrase encrypts the vault on this device. It is never sent
          anywhere. Choose something strong and memorable.
        </div>

        <Input
          id="passphrase"
          label="Passphrase"
          type="password"
          placeholder="At least 8 characters"
          value={passphrase}
          onChange={e => { setPassphrase(e.target.value); setPassphraseError(null); }}
          autoFocus
          autoComplete="new-password"
        />
        <Input
          id="passphrase-confirm"
          label="Confirm passphrase"
          type="password"
          placeholder="Repeat passphrase"
          value={passphraseConfirm}
          onChange={e => { setPassphraseConfirm(e.target.value); setPassphraseError(null); }}
          error={passphraseError ?? undefined}
          autoComplete="new-password"
        />

        {error ? <p className="error-text">{error}</p> : null}

        <Button variant="primary" onClick={handleCreate}>
          Create account
        </Button>
      </div>
    );
  }

  // --- Step: registering ---
  return (
    <div className="screen" style={{ justifyContent: "center", alignItems: "center", gap: 16 }}>
      <div className="spinner" style={{ width: 32, height: 32 }} />
      <p className="muted-text text-center">
        {loading ? "Registering account on-chain..." : "Setting up vault..."}
      </p>
      {error ? <p className="error-text text-center">{error}</p> : null}
    </div>
  );
}
