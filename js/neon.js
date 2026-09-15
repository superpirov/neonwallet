/* ============================================================
   NeonWallet — Neon Token (demo, off-chain only)
   A local, purely illustrative token with tiered "mining".
   Nothing here touches any blockchain: balance, tier and the
   accrual timestamp live in localStorage. Rewards are credited
   per elapsed hour and catch up while the app is closed.
   ============================================================ */
(function () {
  'use strict';

  const K = {
    balance: 'nw.neon.balance',
    level: 'nw.neon.level',
    lastTs: 'nw.neon.lastAccrualTs',
    mined: 'nw.neon.totalMined'
  };

  const HOUR = 3600 * 1000;
  const SYMBOL = 'NEON';
  const MAX_LEVEL = 5;

  // Tier table. `perHour` is what the tier yields; `cost` is burned
  // to reach the tier, `min` documents the hold needed beforehand.
  const TIERS = [
    { level: 1, name: 'Starter', perHour: 0.005, cost: 0,    min: 0 },
    { level: 2, name: 'Bronze',  perHour: 0.01,  cost: 0.25, min: 0.25 },
    { level: 3, name: 'Silver',  perHour: 0.02,  cost: 0.7,  min: 0.7 },
    { level: 4, name: 'Gold',    perHour: 0.4,   cost: 1,    min: 1 },
    { level: 5, name: 'Diamond', perHour: 0.5,   cost: 2,    min: 2 }
  ];

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  // Money math uses whole thousandths to avoid float drift across
  // repeated hourly accruals.
  const milli = v => Math.round((Number(v) || 0) * 1000);
  const fromMilli = m => m / 1000;

  function getBalance() { return fromMilli(read(K.balance, 0)); }
  function getLevel() {
    const l = read(K.level, 1);
    return Math.min(MAX_LEVEL, Math.max(1, Number(l) || 1));
  }
  function getTotalMined() { return fromMilli(read(K.mined, 0)); }
  function tier(level) { return TIERS[Math.min(MAX_LEVEL, Math.max(1, level)) - 1]; }

  /**
   * Convert elapsed wall-clock time into tokens. Whole hours only:
   * a partial hour never pays out, which also makes offline catch-up
   * exact (the remainder keeps counting from the new timestamp).
   */
  function accrue() {
    const now = Date.now();
    let last = read(K.lastTs, null);
    if (last === null) { write(K.lastTs, now); return 0; }
    if (typeof last !== 'number' || last > now) { write(K.lastTs, now); return 0; }

    const hours = Math.floor((now - last) / HOUR);
    if (hours < 1) return 0;

    const rate = tier(getLevel()).perHour;
    const earned = fromMilli(milli(rate) * hours);
    write(K.balance, milli(getBalance()) + milli(earned));
    write(K.mined, milli(getTotalMined()) + milli(earned));
    // Keep the unclaimed remainder so progress is not silently reset.
    write(K.lastTs, last + hours * HOUR);
    return earned;
  }

  function nextTier() {
    const l = getLevel();
    return l >= MAX_LEVEL ? null : TIERS[l];
  }

  /** Upgrade descriptor consumed by the UI, incl. whether it is payable. */
  function upgradeInfo() {
    const l = getLevel();
    const next = nextTier();
    if (!next) return { maxed: true, level: l };
    const bal = getBalance();
    return {
      maxed: false,
      level: l,
      current: tier(l),
      next,
      cost: next.cost,
      affordable: bal >= next.cost
    };
  }

  /** Burning `cost` moves to the next tier; the fee never returns. */
  function upgrade() {
    const info = upgradeInfo();
    if (info.maxed) return { ok: false, reason: 'You already reached the top tier.' };
    if (!info.affordable) {
      return { ok: false, reason: `Need ${info.cost} ${SYMBOL} to unlock ${info.next.name}.` };
    }
    const bal = milli(getBalance()) - milli(info.cost);
    if (bal < 0) return { ok: false, reason: 'Insufficient balance.' };
    write(K.balance, bal);
    write(K.level, info.next.level);
    write(K.lastTs, Date.now()); // new rate starts now, no retroactive boost
    return { ok: true, level: info.next.level, name: info.next.name, burned: info.cost };
  }

  function stats() {
    const l = getLevel();
    const t = tier(l);
    return {
      balance: getBalance(),
      totalMined: getTotalMined(),
      level: l,
      tier: t,
      perHour: t.perHour,
      perDay: +(t.perHour * 24).toFixed(3),
      next: upgradeInfo(),
      symbol: SYMBOL
    };
  }

  // Full reset is used by the settings wipe and by selftest.
  function reset() {
    [K.balance, K.level, K.lastTs, K.mined].forEach(k => {
      try { localStorage.removeItem(k); } catch (e) { /* noop */ }
    });
  }

  const Neon = {
    SYMBOL, MAX_LEVEL, TIERS, HOUR,
    accrue, stats, upgrade, upgradeInfo, tier, nextTier,
    getBalance, getLevel, getTotalMined, reset
  };

  window.NW = window.NW || {};
  window.NW.Neon = Neon;

  if (typeof module !== 'undefined' && module.exports) module.exports = Neon;
})();
