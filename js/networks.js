/* ============================================================
   NeonWallet — network catalog (EVM)
   Presets use public RPC endpoints; users can add any custom
   EVM network from the UI. All values client-side only.
   ============================================================ */
(function () {
  'use strict';

  const PRESETS = [
    // ---------- mainnets ----------
    { chainId: 1,          name: 'Ethereum',           symbol: 'ETH',   rpc: 'https://ethereum-rpc.publicnode.com',            explorer: 'https://etherscan.io',                 color: '#7f9cf5' },
    { chainId: 56,         name: 'BNB Smart Chain',    symbol: 'BNB',   rpc: 'https://bsc-rpc.publicnode.com',                 explorer: 'https://bscscan.com',                  color: '#f3ba2f' },
    { chainId: 137,        name: 'Polygon',            symbol: 'POL',   rpc: 'https://polygon-bor-rpc.publicnode.com',         explorer: 'https://polygonscan.com',              color: '#a277ff' },
    { chainId: 42161,      name: 'Arbitrum One',       symbol: 'ETH',   rpc: 'https://arbitrum-one-rpc.publicnode.com',        explorer: 'https://arbiscan.io',                  color: '#4fc3f7' },
    { chainId: 10,         name: 'OP Mainnet',         symbol: 'ETH',   rpc: 'https://optimism-rpc.publicnode.com',            explorer: 'https://optimistic.etherscan.io',      color: '#ff5c72' },
    { chainId: 8453,       name: 'Base',               symbol: 'ETH',   rpc: 'https://base-rpc.publicnode.com',                explorer: 'https://basescan.org',                 color: '#4d8dff' },
    { chainId: 43114,      name: 'Avalanche C-Chain',  symbol: 'AVAX',  rpc: 'https://avalanche-c-chain-rpc.publicnode.com',   explorer: 'https://snowtrace.io',                 color: '#ff7070' },
    { chainId: 324,        name: 'zkSync Era',         symbol: 'ETH',   rpc: 'https://mainnet.era.zksync.io',                  explorer: 'https://era.zksync.network',           color: '#8fa0ff' },
    { chainId: 59144,      name: 'Linea',              symbol: 'ETH',   rpc: 'https://rpc.linea.build',                        explorer: 'https://lineascan.build',              color: '#67e0ff' },
    { chainId: 534352,     name: 'Scroll',             symbol: 'ETH',   rpc: 'https://rpc.scroll.io',                          explorer: 'https://scrollscan.com',               color: '#ffe0a3' },
    { chainId: 1101,       name: 'Polygon zkEVM',      symbol: 'ETH',   rpc: 'https://zkevm-rpc.com',                          explorer: 'https://zkevm.polygonscan.com',        color: '#b388ff' },
    { chainId: 5000,       name: 'Mantle',             symbol: 'MNT',   rpc: 'https://rpc.mantle.xyz',                         explorer: 'https://mantlescan.xyz',               color: '#66d9cf' },
    { chainId: 81457,      name: 'Blast',              symbol: 'ETH',   rpc: 'https://rpc.blast.io',                           explorer: 'https://blastscan.io',                 color: '#f5e663' },
    { chainId: 250,        name: 'Fantom',             symbol: 'FTM',   rpc: 'https://fantom-rpc.publicnode.com',              explorer: 'https://ftmscan.com',                  color: '#5b9cf9' },
    { chainId: 100,        name: 'Gnosis Chain',       symbol: 'XDAI',  rpc: 'https://gnosis-rpc.publicnode.com',              explorer: 'https://gnosisscan.io',                color: '#48c9a9' },
    { chainId: 146,        name: 'Sonic',              symbol: 'S',     rpc: 'https://rpc.soniclabs.com',                      explorer: 'https://sonicscan.org',                color: '#9db4ff' },
    { chainId: 25,         name: 'Cronos',             symbol: 'CRO',   rpc: 'https://evm.cronos.org',                         explorer: 'https://cronoscan.com',                color: '#6aa6ff' },
    { chainId: 42220,      name: 'Celo',               symbol: 'CELO',  rpc: 'https://celo-rpc.publicnode.com',                explorer: 'https://celoscan.io',                  color: '#ffd166' },
    { chainId: 1284,       name: 'Moonbeam',           symbol: 'GLMR',  rpc: 'https://rpc.api.moonbeam.network',               explorer: 'https://moonbeam.moonscan.io',         color: '#53cbc9' },
    { chainId: 1285,       name: 'Moonriver',          symbol: 'MOVR',  rpc: 'https://rpc.api.moonriver.moonbeam.network',     explorer: 'https://moonriver.moonscan.io',        color: '#f2bf60' },
    { chainId: 1313161554, name: 'Aurora',             symbol: 'ETH',   rpc: 'https://mainnet.aurora.dev',                     explorer: 'https://explorer.aurora.dev',          color: '#58dfa6' },
    { chainId: 1666600000, name: 'Harmony',            symbol: 'ONE',   rpc: 'https://api.harmony.one',                        explorer: 'https://explorer.harmony.one',         color: '#46d4ff' },
    { chainId: 8217,       name: 'Kaia',               symbol: 'KLAY',  rpc: 'https://public-en.node.klaytn.net',              explorer: 'https://klaytnscope.com',              color: '#ff7a45' },
    { chainId: 1088,       name: 'Metis',              symbol: 'METIS', rpc: 'https://andromeda.metis.io/?owner=1088',         explorer: 'https://explorer.metis.io',            color: '#35d0c5' },
    { chainId: 1116,       name: 'Core',               symbol: 'CORE',  rpc: 'https://rpc.coredao.org',                        explorer: 'https://scan.coredao.org',             color: '#ffb84d' },
    { chainId: 369,        name: 'PulseChain',         symbol: 'PLS',   rpc: 'https://rpc.pulsechain.com',                     explorer: 'https://scan.pulsechain.com',          color: '#ff9ecf' },
    { chainId: 7777777,    name: 'Zora',               symbol: 'ETH',   rpc: 'https://rpc.zora.energy',                        explorer: 'https://explorer.zora.energy',         color: '#6c7bff' },
    { chainId: 167000,     name: 'Taiko',              symbol: 'ETH',   rpc: 'https://rpc.mainnet.taiko.xyz',                  explorer: 'https://taikoscan.io',                 color: '#ff7ab8' },

    // ---------- testnets ----------
    { chainId: 11155111,   name: 'Sepolia',            symbol: 'ETH',   rpc: 'https://ethereum-sepolia-rpc.publicnode.com',    explorer: 'https://sepolia.etherscan.io',         color: '#7f9cf5', testnet: true },
    { chainId: 97,         name: 'BSC Testnet',        symbol: 'tBNB',  rpc: 'https://bsc-testnet-rpc.publicnode.com',         explorer: 'https://testnet.bscscan.com',          color: '#f3ba2f', testnet: true },
    { chainId: 80002,      name: 'Polygon Amoy',       symbol: 'POL',   rpc: 'https://rpc-amoy.polygon.technology',            explorer: 'https://amoy.polygonscan.com',         color: '#a277ff', testnet: true },
    { chainId: 421614,     name: 'Arbitrum Sepolia',   symbol: 'ETH',   rpc: 'https://arbitrum-sepolia-rpc.publicnode.com',    explorer: 'https://sepolia.arbiscan.io',          color: '#4fc3f7', testnet: true },
    { chainId: 11155420,   name: 'OP Sepolia',         symbol: 'ETH',   rpc: 'https://optimism-sepolia-rpc.publicnode.com',    explorer: 'https://sepolia-optimism.etherscan.io',color: '#ff5c72', testnet: true },
    { chainId: 84532,      name: 'Base Sepolia',       symbol: 'ETH',   rpc: 'https://base-sepolia-rpc.publicnode.com',        explorer: 'https://sepolia.basescan.org',         color: '#4d8dff', testnet: true },
    { chainId: 43113,      name: 'Avalanche Fuji',     symbol: 'AVAX',  rpc: 'https://avalanche-fuji-c-chain-rpc.publicnode.com', explorer: 'https://testnet.snowtrace.io',     color: '#ff7070', testnet: true }
  ];

  const DEFAULT_CHAIN_ID = 1;

  const Networks = {
    presets: PRESETS.slice(),
    defaultChainId: DEFAULT_CHAIN_ID,

    all() {
      return this.presets.concat(NW.Store ? NW.Store.getCustomNetworks() : []);
    },

    byId(chainId) {
      const id = Number(chainId);
      return this.all().find(n => n.chainId === id) || null;
    },

    selected() {
      const saved = NW.Store ? NW.Store.getSelectedChain() : null;
      return this.byId(saved) || this.byId(DEFAULT_CHAIN_ID);
    },

    explorerAddr(net, addr) {
      return net.explorer ? net.explorer.replace(/\/+$/, '') + '/address/' + addr : null;
    },
    explorerTx(net, hash) {
      return net.explorer ? net.explorer.replace(/\/+$/, '') + '/tx/' + hash : null;
    }
  };

  window.NW = window.NW || {};
  window.NW.Networks = Networks;

  if (typeof module !== 'undefined' && module.exports) module.exports = Networks;
})();
