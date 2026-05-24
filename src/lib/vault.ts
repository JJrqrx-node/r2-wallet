// chrome.storage.local wrapper for the encrypted vault.
// Never stores plaintext keys — only the EncryptedVault object.

import type { EncryptedVault } from "./crypto";

const VAULT_KEY = "r2_vault";

export async function saveVault(encrypted: EncryptedVault): Promise<void> {
  await chrome.storage.local.set({ [VAULT_KEY]: encrypted });
}

export async function loadVault(): Promise<EncryptedVault | null> {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return (result[VAULT_KEY] as EncryptedVault) ?? null;
}

export async function hasVault(): Promise<boolean> {
  const result = await chrome.storage.local.get(VAULT_KEY);
  return VAULT_KEY in result;
}

export async function wipeVault(): Promise<void> {
  await chrome.storage.local.remove(VAULT_KEY);
}
