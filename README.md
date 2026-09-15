# NeonWallet 💎

**Soft-neon non-custodial multichain crypto wallet.** Runs fully client-side — perfect for GitHub Pages today and easy to wrap into a browser extension tomorrow.

> 🔐 Your keys are encrypted with **AES-256-GCM** (PBKDF2-SHA-256, 250 000 iterations) and never leave your device. No servers, no tracking, no analytics.

## ✨ Features

- **Create wallet** — standard flow: password → 12-word BIP-39 seed phrase → tap-to-verify backup
- **Import wallet** — paste any 12–24 word recovery phrase *or* a private key
- **30+ built-in networks** — Ethereum, BNB Chain, Polygon, Arbitrum, Optimism, Base, zkSync Era, Linea, Scroll, Avalanche, Fantom, Gnosis, Sonic, Celo, Cronos, Moonbeam, Kaia, Metis, Core, PulseChain, Zora, Taiko + popular testnets
- **Add any custom EVM network** — RPC URL is tested live before saving; custom networks can be removed anytime
- **Native transfers & ERC-20 tokens** — add custom tokens by contract address, balances per network
- **Send flow done right** — fee estimation before signing, hold-to-send confirmation, explorer links, local activity history with pending → confirmed status
- **Receive** — scannable QR code + copyable address
- **Tron network (read-only)** — the Tron address is derived from the same seed on the `m/44'/195'/0'/0/0` path, balance is read live from TronGrid. Receiving works; sending is disabled in this build.
- **Neon Token (demo)** — a purely local, off-chain rewards token with 5 mining tiers (Starter → Bronze → Silver → Gold → Diamond). Rewards accrue once per full hour, even while the app is closed; upgrading burns NEON and instantly raises the hourly rate. No contract, no network, no real value.
- **Auto-lock** — wallet locks after a configurable period of inactivity (default 5 min, "Never" available in Settings), and immediately when the tab is closed or left hidden for a minute. Works on mobile.
- **Lock screen** — wallet re-encrypts at rest; unlocking requires your password

## 🚀 Run locally

Any static file server works:

```bash
python -m http.server 8080
# open http://localhost:8080
```

> WebCrypto requires HTTPS or `localhost` — both GitHub Pages (`https://superpirov.github.io/neonwallet/`) and localhost work out of the box.

Smoke test of the crypto core (mnemonic vector, vault encryption, network catalog, Tron address vector, Neon Token math) is available at `/selftest.html`.

## 🌐 Deploy to GitHub Pages

Repo → **Settings → Pages → Source: `main` branch, `/` root**. Done.

## 🗺 Roadmap

- [ ] Browser extension (Manifest V3) — same codebase, wrapped as a popup
- [ ] Swap aggregator integration
- [ ] Incoming-transfer detection & full chain history via indexers
- [ ] Non-EVM chains (Solana, Tron, Bitcoin)
- [ ] Fiat on-ramp
- [ ] NFT gallery

## 🧱 Tech

| | |
|---|---|
| Stack | Vanilla HTML/CSS/JS — zero build step |
| Crypto core | [ethers v6](https://ethers.org) + WebCrypto |
| Storage | `localStorage` only (encrypted vault) |
| Design | Soft neon: deep indigo glassmorphism, mint/violet glows |

## ⚠️ Disclaimer

This is early software. Test with small amounts first. A crypto wallet is only as safe as the device it runs on — keep your seed phrase offline and never share it.
