// Account creation for the R-Squared extension wallet.
//
// Flow:
//   1. Generate a fresh 16-word brain key (SDK suggest_brain_key).
//   2. Derive owner/active/memo public keys at sequence 0.
//   3. POST { name, owner_key, active_key, memo_key } to REGISTRAR_URL.
//      The registrar account pays the on-chain registration fee.
//   4. Poll the chain until the new account appears.
//   5. Return the brain key to the caller — it is NEVER stored in plaintext.
//
// The registrar WIF never lives in the extension.

import { key as keyUtils, PublicKey } from "@r-squared/rsquared-js";
import { ChainConfig } from "@r-squared/rsquared-js-ws";
import dictionary from "./dictionary_en.json";
import { getAccount } from "./chain";

// Force the RQRX prefix so every key string carries the right prefix + checksum.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ChainConfig as any).setPrefix("RQRX");
} catch {
  // ignore — best effort
}

// Absolute URL for the account registrar. CORS is open on the server side.
// The registrar signs with its own WIF — the extension never sees it.
export const REGISTRAR_URL: string =
  (import.meta.env["VITE_REGISTRAR_URL"] as string | undefined) ??
  "https://r2dex.io/api/register";

// Shared extension key. Sent as X-Extension-Key on registration requests so
// the server skips Turnstile for the extension (which can't run the widget).
// Compiled in at build time. Not a secret — see server-side comment.
export const EXTENSION_KEY: string =
  (import.meta.env["VITE_EXTENSION_KEY"] as string | undefined) ?? "";

// --- Account name validation ----------------------------------------------

export function validateAccountName(name: string): string | null {
  if (!name) return "Account name is required";
  if (name.length < 3) return "Account name must be at least 3 characters";
  if (name.length > 63) return "Account name must be at most 63 characters";
  if (!/^[a-z]/.test(name)) return "Account name must start with a letter";
  if (!/^[a-z0-9-]+$/.test(name)) {
    return "Lowercase letters, digits, and dashes only";
  }
  if (name.endsWith("-")) return "Account name cannot end with a dash";
  if (name.includes("--"))
    return "Account name cannot contain two dashes in a row";
  // Must have a digit or dash (premium pure-letter names are rejected by registrar).
  if (!/[0-9-]/.test(name)) {
    return "Account name must contain a dash or a digit (premium names are not free)";
  }
  return null;
}

// --- Brain-key generation -------------------------------------------------

export function generateBrainKey(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils: any = keyUtils;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dict: any = dictionary;
  return utils.suggest_brain_key(dict.en);
}

export interface DerivedKeys {
  brainkey: string;
  owner: { wif: string; pub: string };
  active: { wif: string; pub: string };
  memo: { wif: string; pub: string };
}

export function deriveFromBrainKey(brainkey: string): DerivedKeys {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils: any = keyUtils;
  const normalize = utils.normalize_brainKey || utils.normalize_brainkey;
  const norm =
    typeof normalize === "function" ? normalize(brainkey) : brainkey.trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner: any = utils.get_brainPrivateKey(norm, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active: any = utils.get_brainPrivateKey(norm, 0);
  // Re-encode public key with the RQRX prefix + valid checksum.
  const toRQRX = (p: unknown): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pk: any = p;
    const out = pk.toPublicKeyString("RQRX");
    if (out && typeof out === "string" && out.startsWith("RQRX")) return out;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reb: any = (PublicKey as any).fromBuffer(pk.toBuffer());
    return reb.toPublicKeyString("RQRX");
  };
  return {
    brainkey: norm,
    owner: {
      wif: owner.toWif(),
      pub: toRQRX(owner.toPublicKey()),
    },
    active: {
      wif: active.toWif(),
      pub: toRQRX(active.toPublicKey()),
    },
    memo: {
      wif: active.toWif(),
      pub: toRQRX(active.toPublicKey()),
    },
  };
}

// --- Registrar client -----------------------------------------------------

export interface RegistrarResult {
  ok: boolean;
  account_id?: string;
  tx_id?: string;
  error?: string;
}

// POST account creation to the r2dex.io registrar.
// The extension does NOT send a Turnstile token in v0.1.
// If the server requires Turnstile, a user-friendly error is returned.
export async function callRegistrar(
  accountName: string,
  keys: DerivedKeys
): Promise<RegistrarResult> {
  let res: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (EXTENSION_KEY) headers["X-Extension-Key"] = EXTENSION_KEY;
    res = await fetch(REGISTRAR_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: accountName,
        owner_key: keys.owner.pub,
        active_key: keys.active.pub,
        memo_key: keys.memo.pub,
        // Include in body too, in case middleware strips custom headers.
        ...(EXTENSION_KEY ? { extension_key: EXTENSION_KEY } : {}),
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        "Could not reach registrar: " +
        (e instanceof Error ? e.message : String(e)),
    };
  }
  let data: { ok?: boolean; account_id?: string; tx_id?: string; error?: string } = {};
  try {
    data = await res.json();
  } catch {
    // ignore body parse errors
  }
  if (res.ok && data.ok) {
    return { ok: true, account_id: data.account_id, tx_id: data.tx_id };
  }
  // Detect Turnstile requirement and give a helpful message.
  const err = data.error ?? `Registrar returned HTTP ${res.status}`;
  if (/turnstile|captcha|challenge/i.test(err)) {
    return {
      ok: false,
      error:
        "Account creation requires verification. Please visit r2dex.io/create to complete registration in your browser.",
    };
  }
  return { ok: false, error: err };
}

// Poll until the new account appears on chain (after registrar call).
export async function waitForAccount(
  name: string,
  timeoutMs = 30_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const acc = await getAccount(name);
      if (acc && acc.id) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// --- Backup text ----------------------------------------------------------

export function buildBackupText(
  accountName: string,
  keys: DerivedKeys
): string {
  const lines = [
    "R-Squared (RQRX) wallet backup",
    "Generated by R2 Wallet (r2dex.io)",
    "==============================================",
    "",
    "Account name: " + accountName,
    "",
    "BRAIN KEY (master secret -- keep offline):",
    keys.brainkey,
    "",
    "Public keys:",
    "  owner  " + keys.owner.pub,
    "  active " + keys.active.pub,
    "  memo   " + keys.memo.pub,
    "",
    "WIF private keys (do not share):",
    "  owner  " + keys.owner.wif,
    "  active " + keys.active.wif,
    "  memo   " + keys.memo.wif,
    "",
    "Notes:",
    " - The brain key is the master secret. Anyone who has it can control your account.",
    " - R2 Wallet does NOT store this. If you lose it, your account cannot be recovered.",
    " - You can import this account in any R-Squared compatible wallet using the brain key.",
    "",
  ];
  return lines.join("\n");
}
