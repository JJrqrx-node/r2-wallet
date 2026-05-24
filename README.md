# R2 Wallet

Non-custodial Chrome extension wallet for the R-Squared blockchain (r2dex.io).

Official r2dex.io project. MIT licensed.

---

## Overview

R2 Wallet is a Manifest V3 Chrome extension that lets users:

- Create R-Squared accounts via the r2dex.io registrar (registrar WIF never touches the extension)
- Import existing accounts with a brain key
- View balances and send RQRX / RQETH transfers
- Connect to R-Squared dApps via the `window.rsquared` provider
- Sign and broadcast transactions with explicit user approval

Keys are encrypted at rest using AES-GCM-256 + PBKDF2-HMAC-SHA-256 (600,000 iterations, OWASP 2023 recommendation). Plaintext keys only exist in service worker memory while the wallet is unlocked, and are wiped automatically when the browser session ends.

---

## Prerequisites

- Node 20+
- npm 10+
- Chrome 114+ (for side panel support)

---

## Development

```bash
git clone <repo>
cd r2-wallet
npm install        # installs deps + generates icons
cp .env.example .env
npm run dev        # builds with Vite in watch mode
```

Load the extension in Chrome:
1. Open `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `dist/` directory

The popup opens when you click the extension icon. The side panel opens via the browser's side panel button (Chrome 114+).

---

## Build

```bash
npm run build
```

Output is in `dist/`. To create a distributable zip:

```bash
npm run zip
```

This produces `r2-wallet-<version>.zip` (e.g. `r2-wallet-0.1.14.zip`) at the project root.

---

## Type checking and lint

```bash
npm run typecheck
npm run lint
```

---

## Security model

- Brain keys and WIFs never leave the extension process.
- All keys are encrypted at rest using AES-GCM-256. The encryption key is derived from the user's passphrase via PBKDF2 (600,000 iterations, SHA-256, 16-byte random salt). Legacy vaults from earlier builds (250,000 iterations) are transparently upgraded on the next successful unlock.
- Plaintext keys are stored in `chrome.storage.session` only while the wallet is unlocked. Session storage is cleared automatically when the browser closes.
- The registrar WIF never exists in the extension. Account creation posts only the three public keys (owner, active, memo) to `https://r2dex.io/api/register`.
- dApp signing requires explicit user approval in the popup for every transaction.

## Backing up your account

Your account can be recovered from any R-Squared compatible wallet using only your brain key. There is no other recovery path. Write your brain key on paper and store it offline.

To export public keys: open the wallet, go to Settings, and copy the active and owner keys. These are safe to share and useful for receiving funds or verifying identity.

## Resetting the wallet

To remove the wallet from this device:
- `chrome://extensions` > R2 Wallet > Details > Extension storage > Clear data
- Or: Settings > Delete wallet data (inside the extension)

This only removes the encrypted vault from this device. Your on-chain account is unaffected and can be recovered with the brain key.

---

## Production install

Chrome Web Store: TBD (submission pending review)

---

## License

MIT -- Copyright 2026 r2dex.io
