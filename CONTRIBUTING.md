# Contributing to R2 Wallet

Thanks for your interest in improving R2 Wallet. This is an early-stage, non-custodial wallet for the R-Squared blockchain, and contributions are welcome.

---

## Reporting bugs

Open a GitHub Issue with:

- The version of R2 Wallet (`Settings > About` inside the extension)
- The browser version (`chrome://version`)
- Steps to reproduce
- Expected vs. actual behavior
- Any errors from the extension service worker console (`chrome://extensions` > R2 Wallet > "Service worker" link)

Do **not** include brain keys, WIF private keys, passphrases, or screenshots of them in bug reports.

---

## Reporting security vulnerabilities

Do **not** open a public GitHub Issue. Email **rqquack@outlook.com** instead. See [SECURITY.md](./SECURITY.md) for scope, response times, and disclosure policy.

---

## Pull requests

We welcome pull requests, but please open an issue first for anything beyond a small fix so we can align on direction before you invest time.

Before submitting a PR:

1. Run `npm run typecheck` and `npm run lint` — both must pass.
2. Run `npm run build` and confirm the extension still loads in Chrome (`chrome://extensions` > "Load unpacked" > `dist/`).
3. If you touched crypto, the vault format, the dApp bridge, or message types, include a brief explanation in the PR description of what changed and why.

We prefer small, focused PRs. Sweeping refactors are unlikely to be merged without prior discussion.

---

## Code style

- TypeScript with strict mode. No `any` outside of clearly-scoped SDK interop boundaries.
- No `console.log` in shipped code paths.
- Imports should be relative within `src/`; no path aliases beyond what already exists in `vite.config.ts`.
- Match the existing formatting (Prettier defaults).

---

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

To test the dApp provider against a local site, temporarily add `http://localhost:5173/*` (or whichever local origin you're using) to the `content_scripts` matches in `manifest.config.ts`. **Do not commit that change.** The shipped extension only injects on `https://r2dex.io/*`.

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](./LICENSE)).
