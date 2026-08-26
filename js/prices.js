/* ============================================================
   NeonWallet — prices (CoinGecko free + CoinMarketCap optional)
   - CoinGecko is default (CORS allowed, no key)
   - If user stores a CMC Pro API key in Settings, CMC is tried
     first for native symbols. CMC direct fetch is often blocked
     by CORS, so we fall back to CG and via corsproxy.io.
   Cache 90s. All prices stored locally only.
   ============================================================ */
(function () {
  'use strict';

  const CG_BASE = 'https://api.coingecko.com/api/v3';
  const CMC_BASE = 'https://pro-api.coinmarketcap.com';
  const CACHE_MS = 90 * 1000;

  // symbol -> CoinGecko id (canonical)
  const NATIVE_GECKO_IDS = {
    'ETH':   'ethereum',
    'BNB':   'binancecoin',
    'POL':   'polygon-ecosystem-token',
    'MATIC': 'polygon-ecosystem-token',
    'AVAX':  'avalanche-2',
    'FTM':   'fantom',
    'XDAI':  'xdai',
    'CRO':   'crypto-com-chain',
    'CELO':  'celo',
    'GLMR':  'moonbeam',
    'MOVR':  'moonriver',
    'ONE':   'harmony',
    'KLAY':  'klay-token',
    'METIS': 'metis-token',
    'CORE':  'coredaoorg',
    'PLS':   'pulsechain',
    'S':     'sonic-3',
    'MNT':   'mantle',
    'tBNB':  null, // testnets — no price
    'AVAXTEST': null
  };

  // chainId -> CoinGecko platform id for token_price endpoint
  const PLATFORM_BY_CHAIN = {
    1: 'ethereum',
    56: 'binance-smart-chain',
    137: 'polygon-pos',
    42161: 'arbitrum-one',
    10: 'optimistic-ethereum',
    8453: 'base',
    43114: 'avalanche',
    250: 'fantom',
    100: 'xdai',
    146: 'sonic',
    25: 'cronos',
    42220: 'celo',
    1284: 'moonbeam',
    1285: 'moonriver',
    1313161554: 'aurora',
    1666600000: 'harmony-shard-0',
    8217: 'klay-token',
    1088: 'metis-andromeda',
    1116: 'core',
    369: 'pulsechain',
    7777777: 'zora',
    167000: 'taiko',
    1101: 'polygon-zkevm',
    324: 'zksync',
    59144: 'linea',
    534352: 'scroll',
    5000: 'mantle',
    81457: 'blast'
  };

  // CMC symbol overrides (CMC still uses MATIC for POL)
  function cmcSymbol(symbol) {
    if (symbol === 'POL') return 'MATIC';
    return symbol;
  }

  const Prices = {
    _cache: { ts: 0, native: {}, tokens: {} }, // native: symbol->price, tokens: chainId:addr->price
    _geckoIdsForSymbols(symbols) {
      const ids = [];
      const idToSymbols = {};
      symbols.forEach(sym => {
        const id = NATIVE_GECKO_IDS[sym];
        if (!id) return;
        if (!idToSymbols[id]) { idToSymbols[id] = []; ids.push(id); }
        idToSymbols[id].push(sym);
      });
      return { ids, idToSymbols };
    },

    getCmcKey() {
      try { return JSON.parse(localStorage.getItem('nw.cmcKey') || 'null'); } catch(e){ return null; }
    },
    setCmcKey(k) {
      localStorage.setItem('nw.cmcKey', JSON.stringify(k));
    },
    clearCmcKey() {
      localStorage.removeItem('nw.cmcKey');
    },
    getCmcProxy() {
      try { return JSON.parse(localStorage.getItem('nw.cmcProxy') || 'null'); } catch(e){ return null; }
    },
    setCmcProxy(u) {
      localStorage.setItem('nw.cmcProxy', JSON.stringify(u));
    },

    // ---- CoinGecko native ----
    async fetchGeckoNative(symbols) {
      const { ids, idToSymbols } = this._geckoIdsForSymbols(symbols);
      if (!ids.length) return {};
      const url = `${CG_BASE}/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('CoinGecko ' + r.status);
      const data = await r.json();
      const out = {};
      // data = { ethereum: {usd: 3400}, binancecoin:{usd:600} }
      for (const [id, obj] of Object.entries(data)) {
        const price = obj && obj.usd;
        if (price == null) continue;
        const syms = idToSymbols[id] || [];
        syms.forEach(s => out[s] = price);
        // also map canonical: for ETH we may have multiple symbols sharing id
        // keep original id mapping for reference
      }
      // fallback MATIC id alias
      if (out['POL'] == null && out['MATIC'] != null) out['POL'] = out['MATIC'];
      return out;
    },

    async fetchGeckoTokens(chainId, addresses) {
      const platform = PLATFORM_BY_CHAIN[Number(chainId)];
      if (!platform || !addresses.length) return {};
      // CoinGecko expects lowercased addresses
      const addrs = addresses.map(a => a.toLowerCase()).join(',');
      const url = `${CG_BASE}/simple/token_price/${platform}?contract_addresses=${addrs}&vs_currencies=usd`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('CG token ' + r.status);
      const data = await r.json();
      const out = {};
      for (const [addr, obj] of Object.entries(data)) {
        if (obj && obj.usd != null) out[addr.toLowerCase()] = obj.usd;
      }
      return out;
    },

    // ---- CoinMarketCap native (optional) ----
    // NOTE: browsers block direct CMC calls (CORS). If a proxy is set
    // in Settings, we use it; otherwise we try direct and fall back
    // to CoinGecko on CORS failure.
    async fetchCmcNative(symbols, apiKey) {
      if (!apiKey) return {};
      const cmcSyms = symbols.map(cmcSymbol).join(',');
      const proxy = this.getCmcProxy();
      if (proxy) {
        // proxy expected to be a Worker URL like https://xxx.workers.dev/?symbol=ETH,BNB
        // we pass symbols and let the worker add the key server-side
        const sep = proxy.includes('?') ? '&' : '?';
        const url = `${proxy}${sep}symbol=${encodeURIComponent(cmcSyms)}&convert=USD`;
        const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!r.ok) throw new Error('CMC proxy ' + r.status);
        const j = await r.json();
        const out = {};
        const data = j.data || j;
        const src = data.data || data;
        for (const sym of symbols) {
          const cSym = cmcSymbol(sym);
          const entry = src[cSym];
          const price = entry && entry.quote && entry.quote.USD && entry.quote.USD.price;
          if (price != null) out[sym] = price;
        }
        return out;
      }
      // direct (will be CORS-blocked in most browsers) — try once
      const url = `${CMC_BASE}/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(cmcSyms)}&convert=USD&CMC_PRO_API_KEY=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) throw new Error('CMC ' + r.status);
      const j = await r.json();
      const out = {};
      const data = j.data || {};
      for (const sym of symbols) {
        const cSym = cmcSymbol(sym);
        const entry = data[cSym];
        const price = entry && entry.quote && entry.quote.USD && entry.quote.USD.price;
        if (price != null) out[sym] = price;
      }
      return out;
    },

    getNativePrice(symbol) {
      return this._cache.native[symbol] ?? null;
    },
    getTokenPrice(chainId, addr) {
      const k = `${chainId}:${addr.toLowerCase()}`;
      return this._cache.tokens[k] ?? null;
    },

    formatFiat(n) {
      if (n == null || isNaN(n)) return '—';
      if (n >= 1000000) return '$' + (n/1000000).toFixed(2) + 'M';
      if (n >= 1000) return '$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
      if (n >= 1) return '$' + n.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
      if (n >= 0.01) return '$' + n.toFixed(4);
      return '$' + n.toFixed(6);
    },

    async refresh(net, tokens, balances) {
      // balances is not used for fetching but for context; tokens is array of {address,symbol}
      const now = Date.now();
      if (now - this._cache.ts < CACHE_MS && Object.keys(this._cache.native).length) {
        return this._cache;
      }
      const symbols = new Set([net.symbol]);
      tokens.forEach(t => symbols.add(t.symbol)); // also fetch token symbols via CMC? native only via CMC
      const uniqSyms = Array.from(symbols).filter(s => NATIVE_GECKO_IDS[s] !== null);

      let nativePrices = {};
      const cmcKey = this.getCmcKey();
      if (cmcKey) {
        try { nativePrices = await this.fetchCmcNative(uniqSyms, cmcKey); } catch(e){ /* fallback below */ }
      }
      // fill gaps with CoinGecko
      const missing = uniqSyms.filter(s => nativePrices[s] == null);
      if (missing.length) {
        try {
          const gecko = await this.fetchGeckoNative(missing);
          Object.assign(nativePrices, gecko);
        } catch(e){ console.warn('[prices] gecko native failed', e.message); }
      }

      // token prices (via Gecko only)
      const tokenPrices = {};
      // group by chain (currently single net, but future multi)
      const byChain = {};
      tokens.forEach(t => {
        const c = net.chainId;
        if (!byChain[c]) byChain[c] = [];
        byChain[c].push(t.address);
      });
      for (const [cid, addrs] of Object.entries(byChain)) {
        try {
          const m = await this.fetchGeckoTokens(cid, addrs);
          for (const [addr, price] of Object.entries(m)) {
            tokenPrices[`${cid}:${addr}`] = price;
          }
        } catch(e){ console.warn('[prices] gecko token', cid, e.message); }
      }

      this._cache = { ts: now, native: nativePrices, tokens: Object.assign({}, this._cache.tokens, tokenPrices) };
      // keep old token prices if refresh skipped some
      return this._cache;
    },

    // legacy: simple price for a symbol (used by UI)
    async ensureForNet(net, tokens) {
      try { await this.refresh(net, tokens || []); } catch(e){ console.warn('[prices] ensure', e.message); }
      return this._cache;
    }
  };

  window.NW = window.NW || {};
  window.NW.Prices = Prices;
})();
