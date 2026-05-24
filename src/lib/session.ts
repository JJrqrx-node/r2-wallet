// chrome.storage.session wrapper for unlocked in-memory keys.
// chrome.storage.session is cleared automatically when the browser session ends
// (browser close / profile sign-out), so unlocked keys auto-wipe.
// This module ONLY lives in the service worker context.

export interface UnlockedKeys {
  accountName: string;
  accountId: string;
  brainKey: string;
  activeWif: string;
  ownerPubKey: string;
  activePubKey: string;
  memoPubKey: string;
}

const SESSION_KEY = "r2_unlocked";

export async function setUnlockedKeys(keys: UnlockedKeys): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: keys });
}

export async function getUnlockedKeys(): Promise<UnlockedKeys | null> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (result[SESSION_KEY] as UnlockedKeys) ?? null;
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}
