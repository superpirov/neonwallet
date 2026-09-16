/* ============================================================
   NeonWallet — Neon Token (demo, off-chain only)
   A local, purely illustrative token with tiered "mining".
   Nothing here touches any blockchain: balance, tier and the
   mining-cycle timestamp live in localStorage.

   Claim model: rewards "drip" continuously at the tier's hourly
   rate, but only up to one claim cycle (cap = perHour * claimHours).
   Once the cycle is full, dripping PAUSES until the user presses
   Claim. Claiming moves the pending amount to the balance and
   starts a new cycle. Works while the app is closed: the pending
   amount is derived from the cycle start timestamp.
   ============================================================ */
(function () {
  'use strict';

  const K = {
    balance: 'nw.neon.balance',
    level: 'nw.neon.level',
    mined: 'nw.neon.totalMined',
    cycleStart: 'nw.neon.cycleStart',
    // legacy key from the pre-claim model (whole hours credited
    // straight to balance); consumed once by migrate(), then removed.
    lastTs: 'nw.neon.lastAccrualTs'
  };

  const HOUR = 3600 * 1000;
  const SYMBOL = 'NEON';
  const MAX_LEVEL = 5;
  // Ready epsilon: float dust must not block a claim that is full.
  const EPS = 1e-9;

  // Tier table. `perHour` is what the tier yields; `cost` is burned
  // to reach the tier; `claimHours` is how long one claim cycle lasts
  // (L1 every hour, L2 every 3h, L3 every 6h, L4 every 12h, L5 daily).
  const TIERS = [
    { level: 1, name: 'Starter', perHour: 0.005, cost: 0,    min: 0,    claimHours: 1 },
    { level: 2, name: 'Bronze',  perHour: 0.01,  cost: 0.25, min: 0.25, claimHours: 3 },
    { level: 3, name: 'Silver',  perHour: 0.02,  cost: 0.7,  min: 0.7,  claimHours: 6 },
    { level: 4, name: 'Gold',    perHour: 0.4,   cost: 1,    min: 1,    claimHours: 12 },
    { level: 5, name: 'Diamond', perHour: 0.5,   cost: 2,    min: 2,    claimHours: 24 }
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
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* noop */ }
  }
  // Money math uses whole thousandths to avoid float drift.
  const milli = v => Math.round((Number(v) || 0) * 1000);
  const fromMilli = m => m / 1000;

  function getBalance() { return fromMilli(read(K.balance, 0)); }
  function getLevel() {
    const l = read(K.level, 1);
    return Math.min(MAX_LEVEL, Math.max(1, Number(l) || 1));
  }
  function getTotalMined() { return fromMilli(read(K.mined, 0)); }
  function tier(level) { return TIERS[Math.min(MAX_LEVEL, Math.max(1, level)) - 1]; }

  /** Max pending per claim cycle at the given level. */
  function capFor(level) {
    const t = tier(level);
    return t.perHour * t.claimHours;
  }

  /**
   * One-time migration from the pre-claim model: any whole hours
   * earned under the old rules are flushed to the balance, then a
   * fresh claim cycle starts. Balances are preserved.
   */
  function migrate(now) {
    const legacy = read(K.lastTs, null);
    if (legacy !== null) {
      if (typeof legacy === 'number' && legacy <= now) {
        const hours = Math.floor((now - legacy) / HOUR);
        if (hours >= 1) {
          const rate = tier(getLevel()).perHour;
          const earned = fromMilli(milli(rate) * hours);
          write(K.balance, milli(getBalance()) + milli(earned));
          write(K.mined, milli(getTotalMined()) + milli(earned));
        }
      }
      remove(K.lastTs);
    }
    if (typeof read(K.cycleStart, null) !== 'number') {
      write(K.cycleStart, now);
    }
  }

  function cycleStart() {
    const now = Date.now();
    let start = read(K.cycleStart, null);
    if (typeof start !== 'number' || start > now) {
      // First run, legacy store, or clock moved backwards:
      // flush legacy hours (if any) and (re)start the cycle.
      migrate(now);
      start = read(K.cycleStart, now);
    }
    return start;
  }

  /**
   * Pending (dripping, not yet claimable-in-balance) amount right now.
   * Derived from the cycle start timestamp, so it is exact across
   * restarts and while the app is closed. Capped: past the cap the
   * dripping pauses until Claim.
   */
  function pendingAt(now) {
    const t = typeof now === 'number' ? now : Date.now();
    const start = cycleStart();
    const cur = tier(getLevel());
    const elapsed = Math.max(0, t - start);
    const raw = (elapsed / HOUR) * cur.perHour;
    const cap = capFor(getLevel());
    return Math.min(cap, raw);
  }

  function getPending() { return pendingAt(Date.now()); }

  /**
   * Kept for callers: ensures the cycle exists (runs migration) and
   * returns the current pending amount. Never moves tokens by itself —
   * only Claim does that now.
   */
  function accrue() {
    cycleStart();
    return getPending();
  }

  function isReady() {
    return getPending() >= capFor(getLevel()) - EPS;
  }

  /** Move the full cycle reward to the balance and start a new cycle. */
  function claim() {
    const cap = capFor(getLevel());
    const p = getPending();
    if (p < cap - EPS) {
      return { ok: false, reason: `Not ready yet — claim every ${tier(getLevel()).claimHours}h.` };
    }
    const amt = fromMilli(milli(p));
    write(K.balance, milli(getBalance()) + milli(amt));
    write(K.mined, milli(getTotalMined()) + milli(amt));
    write(K.cycleStart, Date.now());
    return { ok: true, claimed: amt };
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
    // Dripping-but-unclaimed tokens count towards the upgrade cost:
    // claiming them first is not required.
    const bal = getBalance() + getPending();
    return {
      maxed: false,
      level: l,
      current: tier(l),
      next,
      cost: next.cost,
      affordable: bal >= next.cost
    };
  }

  /**
   * Burning `cost` moves to the next tier; the fee never returns.
   * Any dripping pending amount is auto-credited first, then the cost
   * is burned and a fresh cycle starts at the new rate.
   */
  function upgrade() {
    const info = upgradeInfo();
    if (info.maxed) return { ok: false, reason: 'You already reached the top tier.' };
    const effMilli = milli(getBalance()) + milli(getPending());
    if (effMilli < milli(info.cost)) {
      return { ok: false, reason: `Need ${info.cost} ${SYMBOL} to unlock ${info.next.name}.` };
    }
    const pendingMilli = milli(getPending());
    write(K.balance, effMilli - milli(info.cost));
    write(K.mined, milli(getTotalMined()) + pendingMilli);
    write(K.level, info.next.level);
    write(K.cycleStart, Date.now()); // new rate starts now, no retroactive boost
    return { ok: true, level: info.next.level, name: info.next.name, burned: info.cost };
  }

  function stats(now) {
    const t = typeof now === 'number' ? now : Date.now();
    const l = getLevel();
    const cur = tier(l);
    const cap = capFor(l);
    const pending = pendingAt(t);
    const ready = pending >= cap - EPS;
    const cycleMs = cur.claimHours * HOUR;
    const elapsed = Math.max(0, t - cycleStart());
    return {
      balance: getBalance(),
      totalMined: getTotalMined(),
      pending,
      ready,
      progress: Math.min(1, cap > 0 ? pending / cap : 1),
      msLeft: ready ? 0 : Math.max(0, cycleMs - elapsed),
      capPerClaim: cap,
      claimHours: cur.claimHours,
      level: l,
      tier: cur,
      perHour: cur.perHour,
      perDay: +(cur.perHour * 24).toFixed(3),
      next: upgradeInfo(),
      symbol: SYMBOL
    };
  }

  // Full reset is used by the settings wipe and by selftest.
  function reset() {
    Object.values(K).forEach(remove);
  }

  const Neon = {
    SYMBOL, MAX_LEVEL, TIERS, HOUR,
    accrue, stats, claim, isReady, getPending, pendingAt, capFor,
    upgrade, upgradeInfo, tier, nextTier,
    getBalance, getLevel, getTotalMined, reset
  };

  window.NW = window.NW || {};
  window.NW.Neon = Neon;

  if (typeof module !== 'undefined' && module.exports) module.exports = Neon;
})();
