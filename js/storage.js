/* ============================================================
   NeonWallet — localStorage persistence layer
   Everything stays on-device. No remote calls here.
   ============================================================ */
(function () {
  'use strict';

  const K = {
    vault: 'nw.vault',            // encrypted wallet blob {v, kdf, salt, iv, ct, type, addr}
    address: 'nw.address',        // plain address for pre-unlock display
    backedUp: 'nw.backedUp',      // '1' once user passed seed verification
    selected: 'nw.selectedChain', // chainId number as string
    customNets: 'nw.customNets',  // JSON array of networks
    tokens: 'nw.tokens',          // map chainId -> [{address,symbol,decimals}]
    history: 'nw.history'         // map `${addr}:${chainId}` -> [tx]
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      if (NW.UI && NW.UI.toast) NW.UI.toast('Storage unavailable — private mode?', 'err');
      return false;
    }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  const Store = {
    // ---- vault ----
    getVault()   { return read(K.vault, null); },
    setVault(v)  { write(K.vault, v); },
    hasVault()   { try { return localStorage.getItem(K.vault) !== null; } catch (e) { return false; } },

    getAddress()        { return read(K.address, null); },
    setAddress(addr)    { write(K.address, addr); },

    isBackedUp()     { return read(K.backedUp, false); },
    setBackedUp()    { write(K.backedUp, true); },

    // ---- network selection ----
    getSelectedChain() { const v = read(K.selected, null); return v === null ? null : Number(v); },
    setSelectedChain(id) { write(K.selected, id); },

    // ---- custom networks ----
    getCustomNetworks() { return read(K.customNets, []); },
    saveCustomNetwork(net) {
      const list = this.getCustomNetworks().filter(n => n.chainId !== net.chainId);
      list.push(net);
      write(K.customNets, list);
    },
    removeCustomNetwork(chainId) {
      write(K.customNets, this.getCustomNetworks().filter(n => n.chainId !== Number(chainId)));
    },

    // ---- erc20 token registry (per chain) ----
    getTokens(chainId) { return read(K.tokens + '.' + chainId, []); },
    saveToken(chainId, token) {
      const list = this.getTokens(chainId).filter(t => t.address.toLowerCase() !== token.address.toLowerCase());
      list.push(token);
      write(K.tokens + '.' + chainId, list);
    },
    removeToken(chainId, address) {
      write(K.tokens + '.' + chainId,
        this.getTokens(chainId).filter(t => t.address.toLowerCase() !== address.toLowerCase()));
    },

    // ---- local tx history (per address+chain) ----
    histKey(addr, chainId) { return K.history + '.' + String(addr).toLowerCase() + ':' + chainId; },
    getHistory(addr, chainId) { return read(this.histKey(addr, chainId), []); },
    pushTx(addr, chainId, tx) {
      const list = this.getHistory(addr, chainId);
      list.unshift(tx);
      write(this.histKey(addr, chainId), list.slice(0, 100));
      return list;
    },
    updateTx(addr, chainId, hash, patch) {
      const list = this.getHistory(addr, chainId);
      const i = list.findIndex(t => t.hash === hash);
      if (i !== -1) {
        Object.assign(list[i], patch);
        write(this.histKey(addr, chainId), list);
      }
      return list;
    },

    // ---- wipe everything ----
    wipeAll() {
      Object.values(K).forEach(remove);
      // also per-chain token/history keys
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('nw.'))
          .forEach(k => localStorage.removeItem(k));
      } catch (e) { /* noop */ }
    }
  };

  window.NW = window.NW || {};
  window.NW.Store = Store;

  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})();
