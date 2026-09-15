/* ============================================================
   NeonWallet — non-EVM chain adapters (Tron, …)
   Address derivation reuses ethers (secp256k1 BIP-32 + keccak256
   + double sha256 base58check). Verified against tronweb's
   address.fromPrivateKey. Balances use each chain's public HTTP
   API. All client-side; on any network/CORS error we return null
   so the UI shows dashes instead of a fake zero.
   ============================================================ */
(function () {
  'use strict';

  const TRON_PATH = "m/44'/195'/0'/0/0"; // SLIP-0044 coin 195
  const SUN = 1e6;

  /* ---------- base58 / base58check (Tron uses double-sha256) ---------- */
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const B58_MAP = {};
  for (let i = 0; i < B58.length; i++) B58_MAP[B58[i]] = i;

  function hexToBytes(hex) {
    const h = hex.startsWith('0x') ? hex.slice(2) : hex;
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  function base58Encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let s = '';
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = B58[0] + s; else break; }
    return s;
  }
  function base58Decode(str) {
    let n = 0n;
    for (const ch of str) {
      const d = B58_MAP[ch];
      if (d === undefined) return null;
      n = n * 58n + BigInt(d);
    }
    const out = [];
    while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const ch of str) { if (ch === B58[0]) out.unshift(0); else break; }
    return new Uint8Array(out);
  }
  function sha256(bytes) { return hexToBytes(ethers.sha256(bytes)); }
  function base58CheckEncode(payload) {
    const c = sha256(sha256(payload));
    const merged = new Uint8Array(payload.length + 4);
    merged.set(payload); merged.set(c.subarray(0, 4), payload.length);
    return base58Encode(merged);
  }

  /* ---------- Tron addresses ---------- */

  function tronAddressFromPrivateKey(privKey) {
    const sk = new ethers.SigningKey(privKey);
    // keccak256 over the 64-byte pubkey body (drop the 0x04 prefix)
    const hash = ethers.keccak256('0x' + sk.publicKey.slice(4));
    const payload = new Uint8Array(21);
    payload[0] = 0x41;
    payload.set(hexToBytes('0x' + hash.slice(-40)), 1);
    return base58CheckEncode(payload);
  }

  function tronAddressFromMnemonic(phrase) {
    const node = ethers.HDNodeWallet.fromPhrase(phrase, undefined, TRON_PATH);
    return tronAddressFromPrivateKey(node.privateKey);
  }

  /** Base58Check + 0x41 prefix + length checks, used to validate recipients. */
  function isTronAddress(addr) {
    const s = String(addr || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{34}$/.test(s)) return false;
    const raw = base58Decode(s);
    if (!raw || raw.length !== 25) return false;
    if (raw[0] !== 0x41) return false;
    const body = raw.subarray(0, 21);
    const checksum = sha256(sha256(body));
    for (let i = 0; i < 4; i++) if (checksum[i] !== raw[21 + i]) return false;
    return true;
  }

  /* ---------- Tron balance (TronGrid HTTP API, CORS: *) ---------- */

  async function fetchTronBalance(net, address) {
    try {
      const r = await fetch(net.rpc.replace(/\/+$/, '') + '/v1/accounts/' + address, {
        headers: { 'Accept': 'application/json' }
      });
      if (!r.ok) throw new Error('Tron API ' + r.status);
      const j = await r.json();
      const acct = j && j.data && j.data[0];
      if (!acct) return 0; // address never used the network — genuinely empty
      return Number(acct.balance || 0) / SUN;
    } catch (e) {
      console.warn('[tron-balance]', e && e.message);
      return null; // unreachable / CORS — UI shows dashes, not a fake zero
    }
  }

  const Chains = {
    isNonEvm(net) { return !!net && !!net.type && net.type !== 'evm'; },
    isTron(net) { return !!net && net.type === 'tron'; },

    /**
     * Address of the currently imported secret on a given chain.
     * EVM chains reuse the signer address; Tron derives its own.
     * Returns null when the secret cannot yield an address.
     */
    addressFor(net, secret, secretType, evmAddress) {
      if (!net || !net.type || net.type === 'evm') return evmAddress;
      try {
        if (net.type === 'tron') {
          if (secretType === 'phrase') return tronAddressFromMnemonic(NW.W.normalizeMnemonic(secret));
          if (secretType === 'key') return tronAddressFromPrivateKey(String(secret).trim());
        }
      } catch (e) {
        console.warn('[' + net.type + '-addr]', e && e.message);
      }
      return null;
    },

    async fetchNativeBalance(net, address) {
      if (this.isTron(net)) return fetchTronBalance(net, address);
      return NW.W.fetchNativeBalance(net, address);
    },

    /** Address validation for recipient fields, per chain family. */
    isValidAddress(net, addr) {
      if (this.isTron(net)) return isTronAddress(addr);
      return NW.W.isAddress(addr);
    }
  };

  window.NW = window.NW || {};
  window.NW.Chains = Chains;

  if (typeof module !== 'undefined' && module.exports) module.exports = Chains;
})();