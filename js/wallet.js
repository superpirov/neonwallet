/* ============================================================
   NeonWallet — wallet core (DOM-free)
   Key material handling built on ethers v6 + WebCrypto.
   Vault model: AES-256-GCM, key derived via PBKDF2-SHA-256
   (250k iterations). The vault never leaves localStorage.
   ============================================================ */
(function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function subtle() {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      throw new Error('WebCrypto unavailable. Open NeonWallet over HTTPS or localhost.');
    }
    return globalThis.crypto.subtle;
  }
  function randomBytes(n) {
    const b = new Uint8Array(n);
    globalThis.crypto.getRandomValues(b);
    return b;
  }
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  /* ---------- mnemonics & wallets ---------- */

  function generateMnemonic() {
    const w = ethers.HDNodeWallet.createRandom();
    return w.mnemonic.phrase.trim().split(/\s+/); // array of words
  }

  function normalizeMnemonic(text) {
    return String(text || '').toLowerCase().replace(/[\u00A0]/g, ' ').trim().split(/\s+/)
      .filter(Boolean).join(' ');
  }

  function looksLikePrivateKey(text) {
    return /^0x[0-9a-fA-F]{64}$/.test(String(text || '').trim());
  }

  function isMnemonicWordCount(text) {
    return [12, 15, 18, 21, 24].includes(normalizeMnemonic(text).split(' ').length);
  }

  function classifySecret(text) {
    const t = String(text || '').trim();
    if (looksLikePrivateKey(t)) return 'key';
    if (isMnemonicWordCount(t)) return 'phrase';
    return null;
  }

  function walletFromSecret(type, secret) {
    if (type === 'key') return new ethers.Wallet(secret.trim());
    return ethers.HDNodeWallet.fromPhrase(normalizeMnemonic(secret));
  }

  /* ---------- encrypted vault ---------- */

  async function deriveKey(password, saltU8) {
    const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey(
      { name: 'PBKDF2', salt: saltU8, iterations: 250000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a secret (mnemonic phrase or private key) into a storable blob.
   */
  async function encryptVault(type, secret, password, address) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveKey(password, salt);
    const ct = await subtle().encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(JSON.stringify({ type, secret }))
    );
    return {
      v: 1,
      kdf: 'PBKDF2-SHA256-250k',
      cipher: 'AES-256-GCM',
      salt: b64(salt),
      iv: b64(iv),
      ct: b64(new Uint8Array(ct)),
      type,
      addr: address
    };
  }

  /** Decrypt blob -> {type, secret}. Throws on wrong password / corruption. */
  async function decryptVault(blob, password) {
    const key = await deriveKey(password, unb64(blob.salt));
    let plain;
    try {
      plain = await subtle().decrypt(
        { name: 'AES-GCM', iv: unb64(blob.iv) },
        key,
        unb64(blob.ct)
      );
    } catch (e) {
      throw new Error('WRONG_PASSWORD');
    }
    return JSON.parse(dec.decode(plain));
  }

  /* ---------- providers & reads ---------- */

  const providerCache = new Map();

  function providerFor(net) {
    const cacheKey = net.chainId + '@' + net.rpc;
    if (!providerCache.has(cacheKey)) {
      providerCache.set(cacheKey, new ethers.JsonRpcProvider(
        net.rpc,
        new ethers.Network(net.name, net.chainId),
        { staticNetwork: true, batchMaxCount: 1 }
      ));
    }
    return providerCache.get(cacheKey);
  }

  async function fetchNativeBalance(net, address) {
    try {
      const bn = await providerFor(net).getBalance(address);
      return Number(ethers.formatEther(bn));
    } catch (e) {
      console.warn('[balance]', e && e.message);
      return null; // network error — UI shows dashes instead of fake zero
    }
  }

  const ERC20_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address owner) view returns (uint256)'
  ];

  async function readTokenInfo(net, address) {
    const c = new ethers.Contract(address, ERC20_ABI.slice(0, 2), providerFor(net));
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
    return { address, symbol, decimals: Number(decimals) };
  }

  async function fetchTokenBalance(net, token, owner) {
    const c = new ethers.Contract(token.address, ERC20_ABI, providerFor(net));
    const raw = await c.balanceOf(owner);
    return Number(ethers.formatUnits(raw, token.decimals));
  }

  /* ---------- fees & sending ---------- */

  /**
   * Estimate full cost of a native transfer.
   * Returns {gasLimit, total (bigint wei), feeFields} or throws.
   */
  async function estimateNativeTransfer(net, from, to, valueWei) {
    const provider = providerFor(net);
    const tx = Object.assign({ to, value: valueWei }, feeFieldsFrom(await provider.getFeeData()));
    const est = await provider.estimateGas(tx);
    const gasLimit = (est * 125n) / 100n; // +25% headroom
    return {
      gasLimit,
      total: gasLimit * (tx.maxFeePerGas || tx.gasPrice),
      feeFields: feeFieldsOf(tx)
    };
  }

  /**
   * Estimate cost of an arbitrary call object already containing fee fields
   * (used for tokens). Returns {gasLimit, total}.
   */
  async function estimateCall(net, from, callTx) {
    const provider = providerFor(net);
    const est = await provider.estimateGas(callTx, { from });
    const gasLimit = (est * 130n) / 100n;
    const unit = callTx.maxFeePerGas || callTx.gasPrice;
    return { gasLimit, total: gasLimit * unit };
  }

  function feeFieldsFrom(feeData) {
    if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
      return { maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas };
    }
    if (feeData.gasPrice != null) return { gasPrice: feeData.gasPrice };
    throw new Error('RPC did not provide gas price data');
  }
  function feeFieldsOf(tx) {
    return tx.maxFeePerGas
      ? { maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas }
      : { gasPrice: tx.gasPrice };
  }

  async function sendNative(signer, net, to, amountStr) {
    const value = ethers.parseEther(String(amountStr).replace(',', '.'));
    const est = await estimateNativeTransfer(net, signer.address, to, value);
    const tx = Object.assign({ to, value, gasLimit: est.gasLimit }, est.feeFields);
    return signer.connect(providerFor(net)).sendTransaction(tx);
  }

  async function sendToken(signer, net, token, to, amountStr) {
    const c = new ethers.Contract(token.address, [
      'function transfer(address to, uint256 amount) returns (bool)'
    ], signer.connect(providerFor(net)));
    const amount = ethers.parseUnits(amountStr.replace(',', '.'), token.decimals);
    return c.transfer(to, amount);
  }

  /** Poll until a transaction is mined. Resolves receipt or null on timeout. */
  async function waitForReceipt(net, hash, timeoutMs) {
    const provider = providerFor(net);
    const deadline = Date.now() + (timeoutMs || 5 * 60 * 1000);
    while (Date.now() < deadline) {
      try {
        const r = await provider.getTransactionReceipt(hash);
        if (r) return r;
      } catch (e) { /* transient rpc hiccup */ }
      await new Promise(res => setTimeout(res, 4000));
    }
    return null;
  }

  /* ---------- formatting helpers ---------- */

  function fmtAmount(num, maxDecimals) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    const d = maxDecimals === undefined ? 6 : maxDecimals;
    let s = num.toFixed(d);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '' ? '0' : s;
  }

  function shortAddr(addr, size) {
    if (!addr) return '';
    const n = size || 4;
    return addr.slice(0, 2 + n) + '…' + addr.slice(-n);
  }

  const W = {
    generateMnemonic, normalizeMnemonic, classifySecret, walletFromSecret,
    looksLikePrivateKey, isMnemonicWordCount,
    encryptVault, decryptVault,
    providerFor, fetchNativeBalance, readTokenInfo, fetchTokenBalance,
    estimateNativeTransfer, estimateCall, sendNative, sendToken, waitForReceipt,
    feeFieldsFrom, fmtAmount, shortAddr,
    parseEther: s => ethers.parseEther(s),
    parseUnits: (s, d) => ethers.parseUnits(s, d),
    formatEther: b => ethers.formatEther(b),
    formatUnits: (b, d) => ethers.formatUnits(b, d),
    isAddress: a => { try { return ethers.isAddress(a); } catch (e) { return false; } }
  };

  window.NW = window.NW || {};
  window.NW.W = W;

  if (typeof module !== 'undefined' && module.exports) module.exports = W;
})();
