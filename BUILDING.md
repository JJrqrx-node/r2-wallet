# Building R2 Wallet

Comprehensive guide for local builds, loading unpacked, and Chrome Web Store submission.

---

## Prerequisites

| Requirement | Minimum version |
|-------------|----------------|
| Node.js | 20.0.0 |
| npm | 10.0.0 |
| Chrome | 114+ (side panel API) |

---

## Environment setup

```bash
cp .env.example .env
```

`.env` variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_REGISTRAR_URL` | `https://r2dex.io/api/register` | Account registrar endpoint |
| `VITE_DEFAULT_WSS_NODE` | `wss://node01.rsquared.digital:8090` | Default WSS node |

---

## Development build (watch mode)

```bash
npm install
npm run dev
```

Vite rebuilds on every file save. Reload the extension in Chrome after each rebuild:

1. `chrome://extensions`
2. Click the refresh icon on the R2 Wallet card.

### Testing the dApp provider against a local site

The shipped extension only injects `window.rsquared` on `https://r2dex.io/*`. If you are developing a dApp locally and need to test the provider, temporarily add your dev origin to **both** content_scripts entries in `manifest.config.ts`:

```ts
matches: ["https://r2dex.io/*", "http://localhost:5173/*"],
```

Do not commit that change. The public release ships with `r2dex.io` only to keep the surface area minimal for the Chrome Web Store listing.

---

## Production build

```bash
npm run build
```

The `dist/` directory contains the complete extension ready to load or submit.

### Icon generation

Icons are auto-generated during `npm install` and `npm run build` via `scripts/gen-icons.mjs`. The script uses `sharp` if installed (preferred) and falls back to a native zlib-based PNG encoder if sharp is unavailable. To regenerate manually:

```bash
node scripts/gen-icons.mjs
```

---

## Load unpacked in Chrome

1. Run `npm run build`
2. Open `chrome://extensions`
3. Enable "Developer mode" (toggle top-right)
4. Click "Load unpacked"
5. Select the `dist/` folder

The extension icon appears in the toolbar. Click it to open the popup.

To use the side panel:
1. Right-click the extension icon > "Open side panel"
2. Or: click the side panel icon in the Chrome toolbar

---

## Zip for distribution

```bash
npm run zip
```

Produces `r2-wallet-0.1.0.zip` at the project root (not tracked in git).

---

## Chrome Web Store submission

**Requirements:**
- A Google developer account ($5 one-time registration fee)
- Extension zip (produced by `npm run zip`)
- Screenshots: 1280x800 or 640x400
- Promotional tile: 440x280
- Privacy policy URL

**Steps:**
1. Log in at https://chrome.google.com/webstore/devconsole
2. Click "New Item" and upload the zip
3. Fill in the store listing (name, description, screenshots)
4. Set category: "Productivity" or "Finance"
5. Set distribution: Public or Unlisted
6. Submit for review (typically 1-7 business days)

**Store link (placeholder):** TBD after submission

---

## Turnstile / CAPTCHA note

The registrar endpoint at `https://r2dex.io/api/register` conditionally requires a Cloudflare Turnstile token when `TURNSTILE_SECRET` is set server-side. R2 Wallet v0.1 does NOT send a Turnstile token.

If you receive an error indicating a challenge is required:
- The user will see a message: "Account creation requires verification. Please visit r2dex.io/create to complete registration in your browser."
- The user completes registration at https://r2dex.io/create, then imports the resulting brain key into R2 Wallet.

Future versions will embed a Turnstile widget in the popup when `VITE_TURNSTILE_SITE_KEY` is provided.

---

## Security notes

- Plaintext brain keys, WIFs, and passphrases never leave the extension.
- AES-GCM-256 encryption with PBKDF2 key derivation (600,000 iterations per OWASP 2023, SHA-256, 16-byte random salt, 12-byte random IV). Vaults from older builds (250,000 iterations) are transparently re-encrypted on the next successful unlock.
- `chrome.storage.session` is used for unlocked keys -- it clears automatically on browser close.
- `chrome.storage.local` holds only the encrypted vault blob.
- dApp signing requires explicit approval for every transaction.
- The MV3 service worker keepalive alarm fires every 24 seconds to maintain the WSS connection and session state.

---

## Automated CI

GitHub Actions runs on every push and PR:
- `npm run typecheck`
- `npm run lint`
- `npm run build`

See `.github/workflows/ci.yml`.
