/* ============================================================
   NeonWallet — Trust Wallet assets (logos + token metadata)
   Logos and marketing data are pulled from the public
   trustwallet/assets repo (same source the Trust Wallet app uses):
     https://github.com/trustwallet/assets (master branch)
   Primary host is Trust Wallet's CDN, raw.githubusercontent.com
   is the automatic fallback. Anything missing there falls back
   to the built-in letter avatars — the wallet never breaks when
   an image is absent.
   URL scheme (verified):
     native coin:  blockchains/<chain>/info/logo.png
     EVM token:    blockchains/<chain>/assets/<EIP-55>/logo.png
     TRC-10/20:    blockchains/tron/assets/<T-address>/logo.png
     metadata:     .../assets/<address>/info.json
   ============================================================ */
(function () {
  'use strict';

  const CDN = 'https://assets-cdn.trustwallet.com/blockchains';
  const RAW = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';

  // chainId -> Trust Wallet assets folder. Custom networks and chains
  // missing here simply get no logo (letter avatar fallback).
  const BY_CHAIN = {
    728126428: 'tron',
    1: 'ethereum',
    56: 'smartchain',
    137: 'polygon',
    42161: 'arbitrum',
    10: 'optimism',
    8453: 'base',
    43114: 'avalanchec',
    324: 'zksync',
    59144: 'linea',
    534352: 'scroll',
    1101: 'polygonzkevm',
    5000: 'mantle',
    81457: 'blast',
    250: 'fantom',
    100: 'xdai',          // Gnosis Chain lives under its legacy name
    146: 'sonic',
    25: 'cronos',
    42220: 'celo',
    1284: 'moonbeam',
    1285: 'moonriver',
    1313161554: 'aurora',
    1666600000: 'harmony',
    8217: 'klaytn',       // Kaia (rebranded Klaytn)
    1088: 'metis',
    11155111: 'sepolia',
    97: 'bnbt',           // BSC testnet
    43113: 'avalanchecfuji'
  };

  function folderFor(net) {
    if (!net) return null;
    if (net.tw) return net.tw; // custom networks may opt in
    return BY_CHAIN[Number(net.chainId)] || null;
  }

  function checksumEvm(addr) {
    try {
      if (typeof ethers === 'undefined' || !ethers.getAddress) return null;
      return ethers.getAddress(addr);
    } catch (e) { return null; }
  }

  /**
   * Address segment for the assets path: EIP-55 for EVM chains,
   * raw base58 for Tron. Null when the address is unusable.
   */
  function pathAddress(net, address) {
    const s = String(address || '').trim();
    if (!s) return null;
    if (net && net.type === 'tron') {
      return /^[1-9A-HJ-NP-Za-km-z]{34}$/.test(s) ? s : null;
    }
    return checksumEvm(s);
  }

  /** Logo URLs (CDN first, raw GitHub fallback) for the native coin. */
  function nativeLogos(net) {
    const f = folderFor(net);
    if (!f) return [];
    return [CDN + '/' + f + '/info/logo.png', RAW + '/' + f + '/info/logo.png'];
  }

  /** Logo URLs (CDN first, raw GitHub fallback) for an ERC-20 / TRC-20 token. */
  function tokenLogos(net, address) {
    const f = folderFor(net);
    const a = pathAddress(net, address);
    if (!f || !a) return [];
    return [CDN + '/' + f + '/assets/' + a + '/logo.png', RAW + '/' + f + '/assets/' + a + '/logo.png'];
  }

  /** Marketing metadata URL (name, website, description, links). */
  function tokenInfoUrl(net, address) {
    const f = folderFor(net);
    const a = pathAddress(net, address);
    if (!f || !a) return null;
    return CDN + '/' + f + '/assets/' + a + '/info.json';
  }

  /**
   * Fetch Trust Wallet metadata for a token. Returns the parsed
   * info.json or null (unknown token / offline). Never throws.
   */
  async function fetchTokenInfo(net, address) {
    const url = tokenInfoUrl(net, address);
    if (!url) return null;
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) return null;
      const j = await r.json();
      return (j && typeof j.symbol === 'string') ? j : null;
    } catch (e) { return null; }
  }

  /**
   * Build an icon element: letter avatar with the logo layered on top.
   * If every URL fails, the <img> removes itself and the letters stay.
   */
  function createIcon(o) {
    o = o || {};
    const wrap = document.createElement('i');
    wrap.className = o.cls || 'token-ic';
    if (o.style) wrap.setAttribute('style', o.style);
    const letters = document.createElement('span');
    letters.className = 'ic-letters';
    letters.textContent = o.letters || '?';
    wrap.appendChild(letters);
    const list = (o.urls || []).filter(Boolean);
    if (list.length) {
      const img = document.createElement('img');
      img.className = 'ic-img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      let i = 0;
      img.onerror = () => {
        i++;
        if (i < list.length) img.src = list[i];
        else img.remove();
      };
      img.src = list[0];
      wrap.appendChild(img);
    }
    return wrap;
  }

  const Icons = {
    CDN, RAW,
    folderFor, pathAddress, nativeLogos, tokenLogos,
    tokenInfoUrl, fetchTokenInfo, createIcon
  };

  window.NW = window.NW || {};
  window.NW.Icons = Icons;

  if (typeof module !== 'undefined' && module.exports) module.exports = Icons;
})();
