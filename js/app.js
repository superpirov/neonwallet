/* ============================================================
   NeonWallet — application flows (state + business logic)
   ============================================================ */
(function () {
  'use strict';

  // Defer module initialization until boot() is called to ensure
  // all dependencies are loaded.
  let initialized = false;
  let UI, Prices, W, Store, Networks, Chains, Neon, $, $$;

  function init() {
    if (initialized) return;
    const NW = window.NW || {};
    UI = NW.UI;
    Prices = NW.Prices || null;
    W = NW.W;
    Store = NW.Store;
    Networks = NW.Networks;
    Chains = NW.Chains;
    Neon = NW.Neon || null;

    if (!UI || !W || !Store || !Networks || !Chains) {
      console.error('NeonWallet: required modules not loaded', { UI, W, Store, Networks, Chains });
      return;
    }
    ($ = UI.$), ($$ = UI.$$);
    initialized = true;
  }

  /* ================= state (memory only) ================= */
  const S = {
    signer: null,          // decrypted signer lives here only while unlocked
    address: null,
    tronAddress: null,     // public non-EVM sibling address (derived at unlock)
    net: null,
    mode: null,            // 'create' | 'import'
    tempPass: null,
    mnemonicWords: [],
    importType: null,
    importSecret: null,
    sendTokenCtx: null,    // null => native coin
    tokenPreview: null,
    verifyPicks: [],
    pollTimer: null,
    neonTimer: null,
    idleTimer: null,
    lastActivity: Date.now(),
    holdRAF: null
  };

  /* ================= boot ================= */

  function boot() {
    // init() is now called from events.js before wiring
    if (!initialized) {
      console.error('NeonWallet: failed to initialize modules');
      return;
    }
    if (typeof ethers === 'undefined') {
      bootFail('ethers.js failed to load. Check your internet connection and reload.');
      return;
    }
    // Demo token rewards keep counting while the app is closed, so the
    // catch-up runs before any screen renders a balance.
    if (Neon) { try { Neon.accrue(); } catch (e) { /* storage disabled */ } }
    const sel = $('#autolock-min');
    if (sel) sel.value = String(Store.getAutoLockMin());
    if (Store.hasVault()) {
      $('#unlock-addr').textContent = Store.getAddress() || '';
      UI.showScreen('screen-unlock');
    } else {
      UI.showScreen('screen-welcome');
    }
  }

  function bootFail(msg) {
    const el = $('#boot-error');
    el.hidden = false;
    el.textContent = '⚠ ' + msg;
  }

  /* ================= helpers ================= */

  function currentNet() { return S.net || (S.net = Networks.selected()); }

  function applyNetTheme() {
    const net = currentNet();
    $('#net-name').textContent = net.name;
    $('#net-dot').style.background = net.color;
    $('#balance-net').textContent = net.name;
    $('#balance-symbol').textContent = net.symbol;
    // Non-EVM chains are read-only in this build: sending needs a different
    // signing scheme, so the action is disabled instead of silently failing.
    const readOnly = Chains.isNonEvm(net);
    UI.setDisabled($('#btn-send'), readOnly);
    $('#btn-send').title = readOnly
      ? net.name + ' is receive-only in this build'
      : '';
    const tok = $('#btn-add-token');
    if (tok) UI.setDisabled(tok, readOnly);
  }

  /**
   * Address that belongs to the *selected* network. EVM networks share the
   * signer address; Tron derives its own from the same secret.
   */
  function displayAddr() {
    const net = currentNet();
    return Chains.isNonEvm(net) ? S.tronAddress : S.address;
  }

  /**
   * Non-EVM sibling addresses come from the same secret, so they are derived
   * once while the secret is briefly in scope and then persisted. Only the
   * public address is kept afterwards — the secret itself is never stored on
   * state and is zeroed by the caller.
   */
  function deriveChainAddresses(type, secret) {
    S.tronAddress = Chains.addressFor({ type: 'tron' }, secret, type, S.address);
    if (S.tronAddress) Store.setTronAddress(S.tronAddress);
  }

  function avatarHue(addr) {
    let h = 0;
    for (let i = 2; i < addr.length; i += 3) h = (h * 31 + addr.charCodeAt(i)) % 360;
    return h;
  }

  function renderAccount() {
    const shown = displayAddr() || S.address;
    $('#addr-short').textContent = W.shortAddr(shown);
    $('#balance-addr').textContent = W.shortAddr(shown, 6);
    $('#avatar').style.filter = `hue-rotate(${avatarHue(S.address)}deg)`;
  }

  async function refreshBalance(silent) {
    const net = currentNet();
    if (!silent) {
      $('#balance-value').textContent = '…';
      $('#balance-fiat').textContent = '';
    }
    const bal = await Chains.fetchNativeBalance(net, displayAddr());
    $('#balance-value').textContent = bal === null ? '—' : W.fmtAmount(bal);
    // fiat value for native
    try {
      if (bal != null && Prices) {
        await window.Prices.ensureForNet(net, Store.getTokens(net.chainId));
        const price = Prices.getNativePrice(net.symbol);
        if (price != null) {
          const fiat = bal * price;
          $('#balance-fiat').innerHTML = Prices.formatFiat(fiat) + ' <span class="muted">@ ' + Prices.formatFiat(price) + '</span>';
          $('#balance-fiat').classList.add('ok');
        } else {
          $('#balance-fiat').textContent = '';
        }
      }
    } catch(e){ /* price optional */ }
    return bal;
  }

  /* ================= entry / lock ================= */

  async function enterMain() {
    S.address = S.signer.address;
    if (!S.tronAddress) S.tronAddress = Store.getTronAddress();
    Store.setAddress(S.address);
    S.net = Networks.selected();
    UI.showScreen('screen-main');
    renderAccount();
    applyNetTheme();
    $('#banner-backup').hidden = Store.isBackedUp();
    UI.closeModal();
    if (Neon) Neon.accrue();
    await Promise.all([refreshBalance(), renderTokens()]);
    renderActivity();
    renderNeon();
    startPolling();
    startIdleWatch();
  }

  function lockWallet() {
    S.signer = null;
    S.tempPass = null;
    S.importSecret = null;
    S.tronAddress = null;
    stopPolling();
    stopIdleWatch();
    UI.closeModal();
    $('#unlock-pass').value = '';
    $('#unlock-addr').textContent = Store.getAddress() || '';
    UI.showScreen('screen-unlock');
  }

  function startPolling() {
    stopPolling();
    S.pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshBalance(true);
      if (Neon) { Neon.accrue(); renderNeon(); }
      if (Prices) {
        Prices.refresh(currentNet(), Store.getTokens(currentNet().chainId))
          .then(() => { refreshBalance(true); renderTokens(); })
          .catch(() => {});
      }
    }, 45000);
  }
  function stopPolling() {
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = null;
  }

  /* ================= idle auto-lock =================
     The wallet holds a live signer in memory, so walking away leaves it
     usable. Any real interaction pushes the deadline forward; leaving the
     tab (switched app, locked phone, closed tab) locks immediately.
     iOS Safari fires visibilitychange unreliably, hence pagehide as well. */

  const IDLE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll'];
  // Grace period while the tab is hidden: a quick glance at another tab or
  // the explorer should not force a re-unlock, but walking away must.
  const AWAY_MS = 60 * 1000;
  let idleHandlerBound = false;
  let awayTimer = null;

  function idleMs() {
    const min = Store.getAutoLockMin();
    return min > 0 ? min * 60 * 1000 : 0; // 0 = never auto-lock
  }

  function resetIdleTimer() {
    if (S.idleTimer) clearTimeout(S.idleTimer);
    S.idleTimer = null;
    const ms = idleMs();
    if (!ms) return;
    S.idleTimer = setTimeout(() => {
      if (UI.currentScreen() === 'screen-main') {
        lockWallet();
        UI.toast('Locked after inactivity', 'info');
      }
    }, ms);
  }

  function lockNow() {
    if (UI.currentScreen() !== 'screen-main') return;
    lockWallet(); // no toast: the user is already gone
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      if (awayTimer) clearTimeout(awayTimer);
      awayTimer = setTimeout(lockNow, AWAY_MS);
    } else if (awayTimer) {
      clearTimeout(awayTimer);
      awayTimer = null;
      resetIdleTimer();
    }
  }

  function startIdleWatch() {
    if (!idleHandlerBound) {
      IDLE_EVENTS.forEach(ev =>
        document.addEventListener(ev, resetIdleTimer, { passive: true, capture: true }));
      document.addEventListener('visibilitychange', onVisibilityChange);
      // Closing or suspending the page: visibilitychange is unreliable on
      // iOS Safari, pagehide always fires.
      window.addEventListener('pagehide', lockNow);
      idleHandlerBound = true;
    }
    resetIdleTimer();
  }

  function saveAutoLock() {
    const min = Number($('#autolock-min').value);
    Store.setAutoLockMin(min);
    if (UI.currentScreen() === 'screen-main') resetIdleTimer();
    UI.toast(min > 0 ? 'Auto-lock set to ' + min + ' min' : 'Auto-lock disabled', 'ok');
  }

  function stopIdleWatch() {
    if (S.idleTimer) clearTimeout(S.idleTimer);
    S.idleTimer = null;
  }

  /* ================= create flow ================= */

  function startCreate() {
    S.mode = 'create';
    S.mnemonicWords = W.generateMnemonic();
    resetPasswordForm();
    UI.showScreen('screen-create-pass');
  }

  function resetPasswordForm() {
    $('#pass-new').value = '';
    $('#pass-confirm').value = '';
    $('#pass-ack').checked = false;
    $('#pass-strength').textContent = '';
    UI.setDisabled($('#btn-create-pass'), true);
    document.querySelector('#screen-create-pass h2').textContent =
      S.mode === 'import' ? 'Set a password' : 'Create password';
  }

  function passStrength(p) {
    let score = 0;
    if (p.length >= 8) score++;
    if (p.length >= 12) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    return ['Too weak', 'Weak', 'Okay', 'Good', 'Strong', 'Excellent'][Math.min(score, 5)];
  }

  function onPasswordInput() {
    const p1 = $('#pass-new').value;
    const p2 = $('#pass-confirm').value;
    $('#pass-strength').textContent = p1 ? 'Strength: ' + passStrength(p1) : '';
    UI.setDisabled($('#btn-create-pass'), !(p1.length >= 8 && p1 === p2 && $('#pass-ack').checked));
  }

  async function finishPasswordStep() {
    S.tempPass = $('#pass-new').value;
    if (S.mode === 'create') {
      renderSeedGrid();
      UI.showScreen('screen-seed');
      return;
    }
    UI.loading(true, 'Encrypting wallet…');
    try {
      const wallet = W.walletFromSecret(S.importType, S.importSecret);
      const blob = await W.encryptVault(S.importType, S.importSecret.trim(), S.tempPass, wallet.address);
      Store.setVault(blob);
      Store.setAddress(wallet.address);
      S.signer = wallet;
      S.address = wallet.address;
      deriveChainAddresses(S.importType, S.importSecret.trim());
      S.importSecret = null;
      UI.loading(false);
      await enterMain();
      UI.toast('Wallet imported', 'ok');
    } catch (e) {
      UI.loading(false);
      UI.toast('Import failed: ' + shortenErr(e), 'err');
    }
  }

  function renderSeedGrid() {
    const grid = $('#seed-grid');
    grid.innerHTML = '';
    S.mnemonicWords.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      grid.appendChild(li);
    });
  }

  /* ---------- seed verification ---------- */

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startVerify() {
    S.verifyPicks = [];
    const bank = $('#verify-bank');
    const slots = $('#verify-slots');
    bank.innerHTML = '';
    slots.innerHTML = '';
    shuffled(S.mnemonicWords.map((w, idx) => ({ w, idx }))).forEach(item => {
      const b = document.createElement('button');
      b.className = 'verify-chip';
      b.type = 'button';
      b.textContent = item.w;
      b.dataset.idx = item.idx;
      b.addEventListener('click', () => pickWord(b));
      bank.appendChild(b);
    });
    for (let i = 0; i < S.mnemonicWords.length; i++) {
      const d = document.createElement('div');
      d.className = 'verify-slot';
      slots.appendChild(d);
    }
    updateVerifyUI('');
  }

  function pickWord(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    S.verifyPicks.push(Number(btn.dataset.idx));
    updateVerifyUI('');
  }

  function unpick(slotPos) {
    const idx = S.verifyPicks[slotPos];
    S.verifyPicks.splice(slotPos, 1);
    const chip = $(`#verify-bank .verify-chip[data-idx="${idx}"]`);
    if (chip) chip.disabled = false;
    updateVerifyUI('');
  }

  function updateVerifyUI(msg, kind) {
    $$('#verify-slots .verify-slot').forEach((s, i) => {
      s.className = 'verify-slot' + (i < S.verifyPicks.length ? ' filled' : '');
      s.textContent = i < S.verifyPicks.length ? S.mnemonicWords[S.verifyPicks[i]] : String(i + 1);
      s.onclick = i < S.verifyPicks.length ? () => unpick(i) : null;
      s.style.cursor = i < S.verifyPicks.length ? 'pointer' : 'default';
    });
    const el = $('#verify-msg');
    el.textContent = msg || '';
    el.className = 'verify-msg' + (kind ? ' ' + kind : '');
    UI.setDisabled($('#btn-verify-check'), S.verifyPicks.length !== S.mnemonicWords.length);
  }

  async function checkVerify() {
    const attempt = S.verifyPicks.map(i => S.mnemonicWords[i]).join(' ');
    if (attempt === S.mnemonicWords.join(' ')) {
      updateVerifyUI('Verified ✓', 'ok');
      await finalizeCreate();
    } else {
      $$('#verify-slots .verify-slot').forEach(s => s.classList.add('bad'));
      updateVerifyUI("Doesn't match — check the word order.", 'err');
      setTimeout(() => startVerify(), 1100);
    }
  }

  async function finalizeCreate() {
    UI.loading(true, 'Encrypting your wallet…');
    try {
      const secret = S.mnemonicWords.join(' ');
      const wallet = W.walletFromSecret('phrase', secret);
      const blob = await W.encryptVault('phrase', secret, S.tempPass, wallet.address);
      Store.setVault(blob);
      Store.setAddress(wallet.address);
      Store.setBackedUp();               // user has just verified the phrase
      S.signer = wallet;
      S.address = wallet.address;
      deriveChainAddresses('phrase', secret);
      S.tempPass = null;
      S.mnemonicWords = [];
      UI.loading(false);
      await enterMain();
      UI.toast('Wallet created — welcome ✨', 'ok');
    } catch (e) {
      UI.loading(false);
      bootFail('Failed to save wallet: ' + shortenErr(e));
    }
  }

  /* ================= import flow ================= */

  function startImport() {
    S.mode = 'import';
    S.importType = null;
    S.importSecret = null;
    $('#import-input').value = '';
    setImportStatus('', '');
    UI.setDisabled($('#btn-import-next'), true);
    UI.showScreen('screen-import');
    setTimeout(() => $('#import-input').focus(), 250);
  }

  function onImportInput() {
    const text = $('#import-input').value.trim();
    if (!text) { S.importType = null; setImportStatus('', ''); UI.setDisabled($('#btn-import-next'), true); return; }
    const type = W.classifySecret(text);
    if (!type) {
      S.importType = null;
      setImportStatus('Not a valid recovery phrase or private key', 'err');
      UI.setDisabled($('#btn-import-next'), true);
      return;
    }
    try {
      const words = type === 'phrase' ? W.normalizeMnemonic(text).split(' ').length : 0;
      S.importType = type;
      S.importSecret = text;
      setImportStatus(type === 'phrase'
        ? `Valid recovery phrase · ${words} words`
        : 'Private key detected', 'ok');
      UI.setDisabled($('#btn-import-next'), false);
    } catch (e) {
      S.importType = null;
      setImportStatus('Invalid secret', 'err');
      UI.setDisabled($('#btn-import-next'), true);
    }
  }

  function setImportStatus(msg, kind) {
    const el = $('#import-status');
    el.textContent = msg;
    el.className = 'import-status' + (kind ? ' ' + kind : '');
  }

  /* ================= unlock ================= */

  async function doUnlock() {
    const pass = $('#unlock-pass').value;
    if (!pass) return;
    const blob = Store.getVault();
    UI.loading(true, 'Decrypting…');
    try {
      const { type, secret } = await W.decryptVault(blob, pass);
      S.signer = W.walletFromSecret(type, secret);
      S.address = S.signer.address;
      deriveChainAddresses(type, secret);
      UI.loading(false);
      $('#unlock-pass').value = '';
      await enterMain();
    } catch (e) {
      UI.loading(false);
      $('#unlock-pass').value = '';
      $('#unlock-pass').focus();
      UI.toast(e.message === 'WRONG_PASSWORD' ? 'Wrong password' : 'Unlock failed', 'err');
    }
  }

  function forgetWallet(btn) {
    if (btn.dataset.armed === '1') {
      Store.wipeAll();
      location.reload();
      return;
    }
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again to erase this wallet';
    setTimeout(() => {
      btn.dataset.armed = '0';
      btn.textContent = 'Use a different wallet';
    }, 4000);
  }

  /* ================= networks ================= */

  function renderNetworkList(filter) {
    const list = $('#net-list');
    list.innerHTML = '';
    const q = (filter || '').toLowerCase().trim();
    const nets = Networks.all().filter(n =>
      !q || n.name.toLowerCase().includes(q) || n.symbol.toLowerCase().includes(q));

    const group = (label, arr) => {
      if (!arr.length) return;
      const l = document.createElement('div');
      l.className = 'net-group-label';
      l.textContent = label;
      list.appendChild(l);
      arr.forEach(net => {
        const sel = net.chainId === currentNet().chainId;
        const li = document.createElement('button');
        li.className = 'net-item' + (sel ? ' selected' : '');
        li.innerHTML =
          `<i class="net-logo" style="--nc:${net.color}">${net.name.charAt(0).toUpperCase()}</i>` +
          `<span class="net-info"><span class="net-nm"></span><br>` +
          `<span class="net-sym">${net.symbol} · ${net.chainId}</span></span>`;
        li.querySelector('.net-nm').textContent = net.name;
        if (sel) {
          const c = document.createElement('span');
          c.className = 'net-check';
          c.textContent = '✓';
          li.appendChild(c);
        }
        if (net.custom) li.appendChild(deleteNetBtn(net));
        li.addEventListener('click', () => switchNet(net.chainId));
        list.appendChild(li);
      });
    };

    group('Custom networks', nets.filter(n => n.custom));
    group('Mainnets', nets.filter(n => !n.custom && !n.testnet));
    group('Testnets', nets.filter(n => !n.custom && n.testnet));

    if (!nets.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'No networks match your search.';
      list.appendChild(e);
    }
  }

  function deleteNetBtn(net) {
    const del = document.createElement('button');
    del.className = 'net-del';
    del.title = 'Remove network';
    del.innerHTML = '&#128465;';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      if (del.dataset.armed === '1') {
        Store.removeCustomNetwork(net.chainId);
        if (currentNet().chainId === net.chainId) switchNet(Networks.defaultChainId);
        renderNetworkList($('#net-search').value);
      } else {
        del.dataset.armed = '1';
        del.innerHTML = '&#10005;';
        del.title = 'Tap again to confirm';
        setTimeout(() => { del.dataset.armed = ''; del.innerHTML = '&#128465;'; }, 3000);
      }
    });
    return del;
  }

  function switchNet(chainId) {
    const net = Networks.byId(chainId);
    if (!net) return;
    Store.setSelectedChain(chainId);
    S.net = net;
    applyNetTheme();
    UI.closeModal();
    $('#net-search').value = '';
    renderAccount();
    refreshBalance();
    renderTokens();
    renderActivity();
  }

  async function saveCustomNetwork() {
    const rpc = $('#an-rpc').value.trim();
    const chainRaw = $('#an-chainid').value.trim();
    const name = $('#an-name').value.trim();
    const symbol = $('#an-symbol').value.trim().toUpperCase();
    const explorer = $('#an-explorer').value.trim();
    const st = $('#an-status');

    const fail = m => UI.status(st, m, 'err');
    if (!/^https?:\/\//i.test(rpc)) return fail('RPC URL must start with http(s)://');
    if (!name) return fail('Name is required');
    if (!symbol) return fail('Currency symbol is required');
    const chainId = /^0x[0-9a-fA-F]+$/.test(chainRaw) ? parseInt(chainRaw, 16) : Number(chainRaw);
    if (!Number.isInteger(chainId) || chainId <= 0) return fail('Chain ID must be a positive integer (or 0x… hex)');
    const existing = Networks.byId(chainId);
    if (existing && !existing.custom) return fail('This Chain ID already exists in presets');
    if (explorer && !/^https?:\/\//i.test(explorer)) return fail('Explorer URL must start with http(s)://');

    UI.status(st, 'Testing RPC connection…');
    UI.setDisabled($('#btn-an-save'), true);
    try {
      const prov = W.providerFor({ chainId, rpc, name });
      await prov.getBlockNumber();
    } catch (e) {
      UI.setDisabled($('#btn-an-save'), false);
      return fail('RPC test failed: ' + shortenErr(e));
    }
    UI.setDisabled($('#btn-an-save'), false);

    Store.saveCustomNetwork({ chainId, name, symbol, rpc, explorer: explorer || '', color: '#8f9bb8', custom: true });
    UI.status(st, '');
    ['an-rpc', 'an-chainid', 'an-name', 'an-symbol', 'an-explorer'].forEach(id => $('#' + id).value = '');
    UI.closeModal();
    switchNet(chainId);
    UI.toast(name + ' added', 'ok');
  }

  /* ================= Neon Token (demo) ================= */

  function renderNeon() {
    if (!Neon) return;
    const s = Neon.stats();
    const f = v => Number(v).toFixed(v >= 1 ? 2 : 3).replace(/\.?0+$/, '') || '0';

    $('#neon-balance').textContent = f(s.balance);
    $('#neon-tier-name').textContent = s.tier.name;
    $('#neon-rate').textContent = '+' + f(s.perHour) + ' / hour';
    $('#neon-mined').textContent = f(s.totalMined) + ' mined in total';
    $('#neon-cur-tier').textContent = s.tier.name + ' · L' + s.level;
    $('#neon-cur-rate').textContent = f(s.perHour) + ' / hour';
    $('#neon-per-day').textContent = f(s.perDay) + ' / day';

    const upgradeBtn = $('#btn-neon-upgrade');
    const bar = $('#neon-progress-bar');
    const hint = $('#neon-progress-hint');

    if (s.next.maxed) {
      $('#neon-next-name').textContent = '—';
      $('#neon-next-cost').textContent = '—';
      $('#neon-next-rate').textContent = '—';
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Top tier reached';
      bar.style.width = '100%';
      hint.textContent = 'Diamond is the highest tier — you are mining at the best rate.';
    } else {
      const n = s.next;
      $('#neon-next-name').textContent = n.next.name + ' · L' + n.next.level;
      $('#neon-next-cost').textContent = f(n.cost) + ' NEON (burned)';
      $('#neon-next-rate').textContent = f(n.next.perHour) + ' / hour';
      upgradeBtn.disabled = !n.affordable;
      upgradeBtn.textContent = n.affordable
        ? 'Upgrade to ' + n.next.name
        : 'Need ' + f(n.cost - s.balance) + ' more NEON';
      bar.style.width = Math.min(100, (s.balance / n.cost) * 100).toFixed(1) + '%';
      hint.textContent = n.affordable
        ? 'Ready to upgrade — ' + f(n.cost) + ' NEON will be burned.'
        : 'Earn ' + f(n.cost) + ' NEON to unlock ' + n.next.name + '.';
    }

    const list = $('#neon-tiers-list');
    list.innerHTML = '';
    Neon.TIERS.forEach(t => {
      const li = document.createElement('li');
      li.className = 'token-row neon-tier-row' + (t.level === s.level ? ' is-current' : '')
        + (t.level < s.level ? ' is-done' : '');
      li.innerHTML =
        `<i class="token-ic neon-tier-ic">L${t.level}</i>` +
        `<span class="token-meta"><span class="token-name">${t.name}</span><br>` +
        `<span class="token-sub">${f(t.perHour)} / hour${t.cost ? ' · unlock ' + f(t.cost) : ''}</span></span>` +
        `<span class="token-state">${t.level === s.level ? 'active' : t.level < s.level ? 'done' : 'locked'}</span>`;
      list.appendChild(li);
    });
  }

  function onNeonUpgrade() {
    const res = Neon.upgrade();
    if (!res.ok) { UI.toast(res.reason, 'err'); renderNeon(); return; }
    renderNeon();
    UI.toast(`Tier ${res.level} unlocked — ${res.name}. ${res.burned} NEON burned.`, 'ok');
  }

  /* ================= tokens ================= */

  async function renderTokens() {
    const net = currentNet();
    const readOnly = Chains.isNonEvm(net);
    const ul = $('#token-list');
    ul.innerHTML = '';

    const netBalEl = tokenRowEl({
      iconBg: `linear-gradient(135deg, ${net.color}, rgba(255,255,255,.35))`,
      name: net.symbol,
      sub: net.name + ' · native',
      amount: undefined,
      symbol: net.symbol,
      loading: true,
      onClickSend: () => openSend(null)
    });
    ul.appendChild(netBalEl);
    (async () => {
      const bal = await Chains.fetchNativeBalance(net, displayAddr());
      const vEl = netBalEl.querySelector('.ta-v');
      if (vEl) vEl.textContent = bal === null ? '—' : W.fmtAmount(bal);
      // fiat for native row
      try {
        if (bal != null && Prices) {
          await window.Prices.ensureForNet(net, Store.getTokens(net.chainId));
          const price = Prices.getNativePrice(net.symbol);
          const fiatEl = netBalEl.querySelector('.token-fiat');
          if (fiatEl && price != null) {
            fiatEl.textContent = Prices.formatFiat(bal * price) + ' @ ' + Prices.formatFiat(price);
            fiatEl.classList.add('ok');
          }
        }
      } catch(e){}
    })();

    if (readOnly) {
      // Token balances on non-EVM chains need a different contract reader,
      // so only the native coin is listed there.
      const note = document.createElement('li');
      note.className = 'hint token-note';
      note.textContent = net.name + ' shows the native coin only in this build.';
      ul.appendChild(note);
      return;
    }

    const tokens = Store.getTokens(net.chainId);
    // ensure prices for tokens are fetched in parallel with balances
    const pricePromise = Prices ? Prices.ensureForNet(net, tokens).catch(()=>null) : null;
    await Promise.all(tokens.map(async t => {
      let bal = null;
      try { bal = await W.fetchTokenBalance(net, t, S.address); }
      catch (e) { console.warn('[token]', t.symbol, e.message); }
      const row = tokenRowEl({
        iconBg: 'linear-gradient(135deg,#ab90ff,#7fb2ff)',
        name: t.symbol,
        sub: W.shortAddr(t.address, 6) + ' · ERC-20',
        amount: bal,
        symbol: t.symbol,
        decimals: Math.min(t.decimals, 6),
        onClickSend: () => openSend(t),
        removable: true,
        onRemove: () => {
          Store.removeToken(net.chainId, t.address);
          renderTokens();
          UI.toast(t.symbol + ' removed', 'ok');
        }
      });
      ul.appendChild(row);
      // fiat for ERC-20
      (async () => {
        try {
          if (pricePromise) await pricePromise;
          if (bal != null && Prices) {
            const price = Prices.getTokenPrice(net.chainId, t.address);
            // fallback: token symbol price (native mapping) — e.g., USDT on ETH uses its own price
            const effPrice = price != null ? price : Prices.getNativePrice(t.symbol);
            const fiatEl = row.querySelector('.token-fiat');
            if (fiatEl && effPrice != null) {
              fiatEl.textContent = Prices.formatFiat(bal * effPrice) + ' @ ' + Prices.formatFiat(effPrice);
              fiatEl.classList.add('ok');
            }
          }
        } catch(e){}
      })();
    }));
  }

  function tokenRowEl(o) {
    const li = document.createElement('li');
    li.className = 'token-row';
    li.innerHTML =
      `<i class="token-ic" style="background:${o.iconBg}">${o.name.slice(0, 2).toUpperCase()}</i>` +
      `<span class="token-meta"><span class="token-name"></span><br><span class="token-sub"></span></span>` +
      `<span class="token-amt"><span class="ta-v">${o.loading ? '…' : '—'}</span><small>${o.symbol}</small><span class="token-fiat"></span></span>` +
      `<button class="token-send" title="Send">&#8593;</button>`;
    li.querySelector('.token-name').textContent = o.name;
    li.querySelector('.token-sub').textContent = o.sub;
    if (o.amount !== undefined && !o.loading) {
      li.querySelector('.ta-v').textContent = o.amount === null ? '—' : W.fmtAmount(o.amount, o.decimals);
    }
    li.querySelector('.token-send').addEventListener('click', o.onClickSend);
    if (o.removable) li.addEventListener('contextmenu', e => { e.preventDefault(); o.onRemove(); });
    return li;
  }

  /* ---------- add token ---------- */

  async function onTokenAddrInput() {
    const addr = $('#token-addr').value.trim();
    const st = $('#token-status');
    const prev = $('#token-preview');
    S.tokenPreview = null;
    UI.setDisabled($('#btn-token-save'), true);
    prev.hidden = true;
    UI.status(st, '');
    if (!addr) return;
    if (!W.isAddress(addr)) return UI.status(st, 'Not a valid contract address', 'err');

    UI.status(st, 'Reading token metadata…');
    try {
      const info = await W.readTokenInfo(currentNet(), addr);
      let bal = null;
      try { bal = await W.fetchTokenBalance(currentNet(), info, S.address); } catch (e) { /* ignore */ }
      $('#tp-symbol').textContent = info.symbol;
      $('#tp-decimals').textContent = String(info.decimals);
      $('#tp-balance').textContent = bal === null ? '—' : W.fmtAmount(bal);
      prev.hidden = false;
      UI.status(st, '');
      S.tokenPreview = info;
      UI.setDisabled($('#btn-token-save'), false);
    } catch (e) {
      UI.status(st, 'No ERC-20 contract found here on ' + currentNet().name, 'err');
    }
  }

  function saveToken() {
    if (!S.tokenPreview) return;
    Store.saveToken(currentNet().chainId, S.tokenPreview);
    const sym = S.tokenPreview.symbol;
    UI.closeModal();
    $('#token-addr').value = '';
    S.tokenPreview = null;
    renderTokens();
    UI.toast(sym + ' added', 'ok');
  }

  /* ================= activity ================= */

  function renderActivity() {
    const ul = $('#tx-list');
    const hist = Store.getHistory(S.address, currentNet().chainId);
    ul.innerHTML = '';
    $('#tx-empty').style.display = hist.length ? 'none' : '';
    // Non-EVM chains cannot broadcast in this build, so there is nothing to
    // track and no EVM receipt to poll for.
    if (Chains.isNonEvm(currentNet())) return;

    hist.forEach(tx => {
      const li = document.createElement('li');
      li.className = 'tx-row';
      const d = new Date(tx.ts);
      const when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      li.innerHTML =
        `<i class="tx-dir out">&#8599;</i>` +
        `<span class="tx-meta"><span class="tx-title"></span><br><span class="tx-sub mono"></span></span>` +
        `<span class="tx-right"><span class="tx-amt out"></span><br><span class="tx-state ${tx.status}"></span></span>`;
      li.querySelector('.tx-title').textContent = 'Sent ' + (tx.symbol || '');
      li.querySelector('.tx-sub').textContent = W.shortAddr(tx.to) + ' · ' + when;
      li.querySelector('.tx-amt').textContent = '−' + W.fmtAmount(Number(tx.value), 6);
      li.querySelector('.tx-state').textContent =
        tx.status === 'pending' ? 'Pending' : tx.status === 'failed' ? 'Failed' : 'Confirmed';
      li.style.cursor = 'pointer';
      li.title = 'View transaction';
      li.addEventListener('click', () => {
        const url = Networks.explorerTx(currentNet(), tx.hash);
        if (url) window.open(url, '_blank', 'noopener');
        else UI.copyText(tx.hash, 'Transaction hash copied');
      });
      ul.appendChild(li);
    });

    // opportunistically resolve pending statuses
    hist.filter(t => t.status === 'pending').slice(0, 6).forEach(t => {
      W.waitForReceipt(currentNet(), t.hash, 15000).then(r => {
        if (r) {
          Store.updateTx(S.address, currentNet().chainId, t.hash,
            { status: r.status === 1 ? 'confirmed' : 'failed' });
          renderActivity();
        }
      });
    });
  }

  /* ================= receive ================= */

  function openReceive() {
    const addr = displayAddr();
    $('#receive-net').textContent = currentNet().name;
    $('#recv-addr').textContent = addr || '—';
    UI.openModal('modal-receive');
    if (addr) UI.renderQR($('#qr-box'), addr);
    else $('#qr-box').innerHTML = '<p class="hint">No address for this network.</p>';
  }

  /* ================= send ================= */

  function activeAsset() {
    return S.sendTokenCtx
      ? { symbol: S.sendTokenCtx.symbol, decimals: S.sendTokenCtx.decimals }
      : { symbol: currentNet().symbol, decimals: 18 };
  }

  function openSend(token) {
    const net = currentNet();
    if (Chains.isNonEvm(net)) {
      UI.toast(net.name + ' is receive-only in this build', 'err');
      return;
    }
    S.sendTokenCtx = token;
    $('#send-to').value = '';
    $('#send-amount').value = '';
    UI.status($('#send-status'), '');
    UI.status($('#rev-status'), '');
    UI.setDisabled($('#btn-send-review'), true);
    $('#send-title').textContent = token ? 'Send ' + token.symbol : 'Send';
    const a = activeAsset();
    const iconStyle = token ? '' : ` style="background:linear-gradient(135deg,${currentNet().color},rgba(255,255,255,.35))"`;
    $('#send-asset').innerHTML =
      `<i class="token-ic"${iconStyle}>${a.symbol.slice(0, 2)}</i><b>${a.symbol}</b><small>on ${currentNet().name}</small>`;
    $('#send-fee').textContent = '—';
    UI.openModal('modal-send');
    setTimeout(() => $('#send-to').focus(), 250);
  }

  async function updateSendFee() {
    const to = $('#send-to').value.trim();
    const amount = $('#send-amount').value.replace(',', '.');
    const feeEl = $('#send-fee');
    if (!W.isAddress(to) || !(Number(amount) > 0)) { feeEl.textContent = '—'; return; }
    feeEl.textContent = 'estimating…';
    try {
      const net = currentNet();
      let totalWei;
      if (S.sendTokenCtx) {
        const iface = new ethers.Interface(['function transfer(address to, uint256 amount) returns (bool)']);
        const data = iface.encodeFunctionData('transfer', [to, W.parseUnits(amount, S.sendTokenCtx.decimals)]);
        const callTx = Object.assign(
          { to: S.sendTokenCtx.address, data },
          W.feeFieldsFrom(await W.providerFor(net).getFeeData())
        );
        const est = await W.estimateCall(net, S.address, callTx);
        totalWei = est.total;
      } else {
        const est = await W.estimateNativeTransfer(net, S.address, to, W.parseEther(amount));
        totalWei = est.total;
      }
      feeEl.textContent = '~' + W.fmtAmount(Number(W.formatEther(totalWei))) + ' ' + net.symbol;
    } catch (e) {
      feeEl.textContent = 'unavailable';
      console.warn('[fee]', e.message);
    }
  }

  async function onMaxAmount() {
    const a = activeAsset();
    try {
      if (S.sendTokenCtx) {
        const bal = await W.fetchTokenBalance(currentNet(), S.sendTokenCtx, S.address);
        $('#send-amount').value = W.fmtAmount(bal, a.decimals);
      } else {
        const bal = await W.fetchNativeBalance(currentNet(), S.address);
        if (bal === null) return;
        let reserve = 0;
        try {
          const est = await W.estimateNativeTransfer(currentNet(), S.address, S.address, 0n);
          reserve = Number(W.formatEther(est.total));
        } catch (e) { /* keep full balance */ }
        $('#send-amount').value = W.fmtAmount(Math.max(0, bal - reserve));
      }
      updateReviewEnabled();
      updateSendFee();
    } catch (e) {
      UI.toast('Could not fetch balance', 'err');
    }
  }

  function updateReviewEnabled() {
    const to = $('#send-to').value.trim();
    const amount = Number($('#send-amount').value.replace(',', '.'));
    UI.setDisabled($('#btn-send-review'), !(W.isAddress(to) && amount > 0));
  }

  function openReview() {
    const a = activeAsset();
    const to = $('#send-to').value.trim();
    $('#rev-amount').textContent = W.fmtAmount(Number($('#send-amount').value.replace(',', '.')), a.decimals);
    $('#rev-asset').textContent = a.symbol;
    $('#rev-to').textContent = to;
    $('#rev-net').textContent = currentNet().name + ' · #' + currentNet().chainId;
    $('#rev-fee').textContent = $('#send-fee').textContent || '—';
    UI.status($('#rev-status'), '');
    UI.openModal('modal-review');
  }

  async function executeSend() {
    const btn = $('#btn-confirm-send');
    const to = $('#send-to').value.trim();
    const amountStr = $('#send-amount').value.replace(',', '.');
    const net = currentNet();
    const a = activeAsset();

    btn.disabled = true;
    btn.textContent = 'Signing…';
    UI.loading(true, 'Sending transaction…');

    let txResp = null;
    try {
      txResp = S.sendTokenCtx
        ? await W.sendToken(S.signer, net, S.sendTokenCtx, to, amountStr)
        : await W.sendNative(S.signer, net, to, amountStr);
    } catch (e) {
      UI.loading(false);
      btn.disabled = false;
      btn.textContent = 'Hold to send';
      UI.status($('#rev-status'), 'Rejected: ' + shortenErr(e), 'err');
      return;
    }

    Store.pushTx(S.address, net.chainId, {
      hash: txResp.hash, to, value: amountStr, symbol: a.symbol, ts: Date.now(), status: 'pending'
    });

    UI.loading(false);
    UI.closeModal();
    UI.toastWithLink('Transaction sent', Networks.explorerTx(net, txResp.hash) || '#', 'ok');
    renderActivity();

    btn.disabled = false;
    btn.textContent = 'Hold to send';

    const r = await W.waitForReceipt(net, txResp.hash, 10 * 60 * 1000);
    if (r) {
      Store.updateTx(S.address, net.chainId, txResp.hash,
        { status: r.status === 1 ? 'confirmed' : 'failed' });
      UI.toastWithLink(
        r.status === 1 ? 'Transaction confirmed ✓' : 'Transaction failed',
        Networks.explorerTx(net, txResp.hash) || '#',
        r.status === 1 ? 'ok' : 'err');
      refreshBalance();
      renderTokens();
    } else {
      UI.toast('Still pending — check the explorer later', '', { ttl: 5000 });
    }
    renderActivity();
  }

  function shortenErr(e) {
    return String((e && (e.shortMessage || e.message)) || e).slice(0, 140);
  }

  /* ================= hold-to-send ================= */

  function armHoldButton(btn, onFire) {
    const DURATION = 1150;
    const fill = document.createElement('i');
    fill.className = 'hold-fill';
    btn.appendChild(fill);

    function tick() {
      const p = Math.min(1, (performance.now() - S.holdStart) / DURATION);
      fill.style.width = (p * 100) + '%';
      if (p >= 1) { release(); resetFill(true); onFire(); }
      else S.holdRAF = requestAnimationFrame(tick);
    }
    function begin(ev) {
      if (btn.disabled) return;
      ev.preventDefault();
      S.holdStart = performance.now();
      fill.style.transition = '';
      S.holdRAF = requestAnimationFrame(tick);
    }
    function release() { cancelAnimationFrame(S.holdRAF); }
    function resetFill(done) {
      fill.style.transition = 'width .2s ease';
      fill.style.width = done ? '100%' : '0';
      setTimeout(() => { fill.style.transition = ''; }, 220);
    }

    btn.addEventListener('pointerdown', begin);
    ['pointerup', 'pointerleave'].forEach(evName => btn.addEventListener(evName, release));
  }

  /* ================= export secrets ================= */

  async function revealSecret() {
    const pass = $('#export-pass').value;
    const st = $('#export-status');
    if (!pass) return UI.status(st, 'Enter your password', 'err');
    const wantKey = document.querySelector('#modal-export .tab.active').dataset.secret === 'key';
    UI.loading(true, 'Decrypting…');
    try {
      const { type, secret } = await W.decryptVault(Store.getVault(), pass);
      const out = $('#export-out');
      out.hidden = false;
      out.innerHTML = '';
      out.className = 'secret-out';

      if (wantKey) {
        const w = W.walletFromSecret(type, secret);
        out.textContent = (type === 'key' ? secret.trim() : w.privateKey);
      } else {
        if (type === 'key') {
          UI.loading(false);
          out.hidden = true;
          return UI.status(st, 'This wallet was imported via private key and has no seed phrase.', 'err');
        }
        out.classList.add('words');
        W.normalizeMnemonic(secret).split(' ').forEach(word => {
          const sp = document.createElement('span');
          sp.textContent = word;
          out.appendChild(sp);
        });
      }
      UI.loading(false);
      UI.status(st, '');
      UI.copyText(out.textContent, 'Copied — store it safely');
    } catch (e) {
      UI.loading(false);
      out_hidden_guard();
      UI.status(st, e.message === 'WRONG_PASSWORD' ? 'Wrong password' : 'Decryption failed', 'err');
    }

    function out_hidden_guard() { $('#export-out').hidden = true; }
  }

  /* ================= settings actions ================= */

  function loadCmcHint() {
    if (!Prices) return;
    const k = Prices.getCmcKey();
    const proxy = Prices.getCmcProxy();
    const hint = $('#cmc-hint');
    const input = $('#cmc-key');
    const proxyInput = $('#cmc-proxy');
    if (!hint || !input) return;
    if (proxyInput) proxyInput.value = proxy || '';
    if (k) {
      hint.textContent = 'Using CoinMarketCap · ' + k.slice(0,4) + '…' + k.slice(-4) + (proxy ? ' via proxy' : ' (direct, may be CORS-blocked)') + ' · refresh 90s';
      input.value = k;
    } else {
      hint.textContent = 'Using CoinGecko (free, no key needed) — add your CMC key above to switch';
      input.value = '';
    }
    UI.status($('#cmc-status'), '');
    UI.status($('#cmc-proxy-status'), '');
  }
  function saveCmcKey() {
    if (!Prices) return;
    const v = $('#cmc-key').value.trim();
    if (!v) return UI.status($('#cmc-status'), 'Paste a key first', 'err');
    Prices.setCmcKey(v);
    UI.status($('#cmc-status'), 'Key saved — fetching prices…', 'ok');
    loadCmcHint();
    Prices.refresh(currentNet(), Store.getTokens(currentNet().chainId))
      .then(() => { refreshBalance(true); renderTokens(); UI.toast('Prices updated via CoinMarketCap','ok'); })
      .catch(e => UI.toast('CMC failed, using CoinGecko: ' + shortenErr(e), 'err'));
  }
  function clearCmcKey() {
    if (!Prices) return;
    Prices.clearCmcKey();
    $('#cmc-key').value = '';
    UI.status($('#cmc-status'), 'Key removed — switched to CoinGecko', 'ok');
    loadCmcHint();
    Prices.refresh(currentNet(), Store.getTokens(currentNet().chainId))
      .then(() => { refreshBalance(true); renderTokens(); })
      .catch(() => {});
  }
  function saveCmcProxy() {
    if (!Prices) return;
    const v = $('#cmc-proxy').value.trim();
    if (!v) return UI.status($('#cmc-proxy-status'), 'Paste a proxy URL first', 'err');
    if (!/^https:\/\//i.test(v)) return UI.status($('#cmc-proxy-status'), 'Proxy URL must start with https://', 'err');
    Prices.setCmcProxy(v);
    UI.status($('#cmc-proxy-status'), 'Proxy saved', 'ok');
    loadCmcHint();
    if (Prices.getCmcKey()) {
      Prices.refresh(currentNet(), Store.getTokens(currentNet().chainId))
        .then(() => { refreshBalance(true); renderTokens(); UI.toast('Proxy prices loaded','ok'); })
        .catch(e => UI.toast('Proxy failed: ' + shortenErr(e), 'err'));
    }
  }
  function clearCmcProxy() {
    if (!Prices) return;
    localStorage.removeItem('nw.cmcProxy');
    $('#cmc-proxy').value = '';
    UI.status($('#cmc-proxy-status'), 'Proxy removed', 'ok');
    loadCmcHint();
  }

  function deleteWallet(btn) {
    if (btn.dataset.armed === '1') {
      Store.wipeAll();
      location.reload();
      return;
    }
    btn.dataset.armed = '1';
    btn.textContent = 'Tap again — this cannot be undone';
    setTimeout(() => {
      btn.dataset.armed = '';
      btn.textContent = 'Delete wallet from this device';
    }, 4000);
  }

  /* ================= exports ================= */

  const App = {
    S, init, boot, bootFail, displayAddr, currentNet,
    startCreate, startImport, finishPasswordStep, onPasswordInput,
    onImportInput, doUnlock, forgetWallet, lockWallet,
    checkVerify, startVerify,
    renderNetworkList, switchNet, saveCustomNetwork,
    renderTokens, onTokenAddrInput, saveToken, renderActivity,
    renderNeon, onNeonUpgrade,
    openReceive, openSend, updateSendFee, onMaxAmount, updateReviewEnabled,
    openReview, executeSend, armHoldButton, revealSecret, deleteWallet,
    refreshBalance, loadCmcHint, saveCmcKey, clearCmcKey, saveCmcProxy, clearCmcProxy,
    saveAutoLock
  };

  window.NW = window.NW || {};
  window.NW.App = App;
})();
