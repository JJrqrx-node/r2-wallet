# Security Policy

## Scope

This policy covers the R2 Wallet Chrome extension (this repository) and the account registrar endpoint at https://r2dex.io/api/register.

In scope:
- Encrypted vault bypass or extraction of plaintext keys
- Service worker privilege escalation
- Content script injection or XSS leading to key exfiltration
- Registrar endpoint vulnerabilities (unauthorized account creation, key substitution)
- Unauthorized transaction signing without user approval
- `window.rsquared` provider spoofing or tampering

Out of scope:
- Social engineering attacks against users
- Attacks requiring physical access to the user's device
- Chrome browser bugs (report directly to Google)
- Third-party dApp vulnerabilities unrelated to the wallet itself

---

## Reporting a Vulnerability

Please report security vulnerabilities by email to:

**rqquack@outlook.com**

Do not file a public GitHub issue for security vulnerabilities.

Include in your report:
- A description of the vulnerability and its impact
- Steps to reproduce
- Affected version(s)
- Any proof-of-concept code (encrypted if sensitive)

---

## Response time

We aim to acknowledge reports within 48 hours and provide a resolution or mitigation timeline within 7 days. Critical vulnerabilities affecting key extraction or unauthorized signing will be prioritized and patched immediately.

---

## Disclosure policy

We follow coordinated disclosure. Please allow us 90 days to address reported vulnerabilities before public disclosure. We will credit researchers in the release notes unless they prefer to remain anonymous.

---

## Known design constraints

These are documented properties of the wallet, not vulnerabilities:

- **Owner, active, and memo keys derive from the same brain-key sequence.** This is required for brain-key portability with other R-Squared wallets (the chain expects this exact mapping to recover an account from a brain key alone). One consequence: anyone with the active key can decrypt incoming memos, since memo private key == active private key. Users who need separate roles should rotate to distinct keys via on-chain `account_update` after account creation.
- **`window.rsquared.getAccount(name)` is permissionless.** It looks up any public on-chain account by name. It never returns the wallet user's private data and is not gated on prior `requestAccounts()` approval. `getBalance()` and `signTransaction()` are gated on connection approval; `getAccount()` is not.
- **The extension key (`X-Extension-Key`) shipped in the extension bundle is not a secret.** It is a build-time constant that lets the registrar skip Turnstile for extension users. Abuse protection on the registrar is per-IP rate limiting plus a global daily ceiling, not the key value itself.
