// Vault encryption using the Web Crypto API.
// PBKDF2-HMAC-SHA-256 derives a 256-bit key from the user's passphrase + a
// random 16-byte salt. AES-GCM with a 12-byte random IV encrypts the
// plaintext vault payload.
//
// Envelope versioning:
//   v: 1 — legacy. 250,000 iterations (hardcoded in older builds).
//   v: 2 — current. Iteration count is stored in the envelope as kdf.iter so
//          future bumps don't break compat. Encryptor always writes v:2 at
//          PBKDF2_ITER_CURRENT iterations. Decryptor reads kdf.iter (default
//          250,000 for v:1 envelopes) so existing v:1 vaults still unlock.
//
// Plaintext payload schema: { accountName, brainKey, ownerPubKey, activePubKey, memoPubKey }

export interface VaultPayload {
  accountName: string;
  brainKey: string;
  ownerPubKey: string;
  activePubKey: string;
  memoPubKey: string;
}

export interface EncryptedVaultV1 {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
}

export interface EncryptedVaultV2 {
  v: 2;
  kdf: { iter: number };
  salt: string;
  iv: string;
  ct: string;
}

export type EncryptedVault = EncryptedVaultV1 | EncryptedVaultV2;

// OWASP 2023 recommendation for PBKDF2-HMAC-SHA-256.
export const PBKDF2_ITER_CURRENT = 600_000;
const PBKDF2_ITER_V1 = 250_000;

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(s: string): ArrayBuffer {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

async function deriveKey(
  passphrase: string,
  saltBuf: ArrayBuffer,
  iterations: number
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuf,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptVault(
  payload: VaultPayload,
  passphrase: string
): Promise<EncryptedVaultV2> {
  const saltArr = crypto.getRandomValues(new Uint8Array(16));
  const ivArr = crypto.getRandomValues(new Uint8Array(12));
  const saltBuf = saltArr.buffer as ArrayBuffer;
  const ivBuf = ivArr.buffer as ArrayBuffer;

  const key = await deriveKey(passphrase, saltBuf, PBKDF2_ITER_CURRENT);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    plaintext
  );

  return {
    v: 2,
    kdf: { iter: PBKDF2_ITER_CURRENT },
    salt: toBase64(saltBuf),
    iv: toBase64(ivBuf),
    ct: toBase64(ciphertext),
  };
}

function envelopeIterations(encrypted: EncryptedVault): number {
  if (encrypted.v === 2) {
    const n = encrypted.kdf?.iter;
    if (typeof n === "number" && n >= 1) return n;
    return PBKDF2_ITER_CURRENT;
  }
  return PBKDF2_ITER_V1;
}

export async function decryptVault(
  encrypted: EncryptedVault,
  passphrase: string
): Promise<VaultPayload> {
  const saltBuf = fromBase64(encrypted.salt);
  const ivBuf = fromBase64(encrypted.iv);
  const ct = fromBase64(encrypted.ct);
  const iterations = envelopeIterations(encrypted);

  const key = await deriveKey(passphrase, saltBuf, iterations);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuf },
      key,
      ct
    );
  } catch {
    throw new Error("Incorrect passphrase or corrupted vault");
  }

  const text = new TextDecoder().decode(plaintext);
  return JSON.parse(text) as VaultPayload;
}

// Returns true if the vault should be re-encrypted with the current envelope
// version + iteration count. Used by the SW to opportunistically migrate
// legacy v1 (or weaker v2) vaults on successful unlock.
export function needsReEncrypt(encrypted: EncryptedVault): boolean {
  if (encrypted.v !== 2) return true;
  const iter = encrypted.kdf?.iter ?? 0;
  return iter < PBKDF2_ITER_CURRENT;
}
