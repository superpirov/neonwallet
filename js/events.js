/* ============================================================
   NeonWallet — event wiring & bootstrap
   ============================================================ */
(function () {
  'use strict';

  const NW = window.NW || {};
  const { UI, App } = NW;
  const { $, $$ } = UI;

  function wire() {

    /* ---------- welcome ---------- */
    $('#btn-create').addEventListener('click', App.startCreate);
    $('#btn-import').addEventListener('click', App.startImport);

    // generic back buttons
    $$('[data-nav]').forEach(b =>
      b.addEventListener('click', () => UI.showScreen(b.dataset.nav)));

    /* ---------- password step ---------- */
    ['pass-new', 'pass-confirm'].forEach(id =>
      $('#' + id).addEventListener('input', App.onPasswordInput));
    $('#pass-ack').addEventListener('change', App.onPasswordInput);
    $('#btn-create-pass').addEventListener('click', App.finishPasswordStep);
    $('#pass-confirm').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !$('#btn-create-pass').disabled) App.finishPasswordStep();
    });

    /* ---------- seed reveal ---------- */
    $('#btn-copy-seed').addEventListener('click', () => {
      // words are only in memory during onboarding
      UI.copyText(NW.App.S.mnemonicWords.join(' '), 'Phrase copied — store it offline!');
    });
    $('#btn-seed-done').addEventListener('click', () => {
      App.startVerify();
      UI.showScreen('screen-verify');
    });

    /* ---------- verify ---------- */
    $('#btn-verify-reset').addEventListener('click', App.startVerify);
    $('#btn-verify-check').addEventListener('click', App.checkVerify);

    /* ---------- import ---------- */
    $('#import-input').addEventListener('input', App.onImportInput);
    $('#btn-import-next').addEventListener('click', App.finishPasswordStep);

    /* ---------- unlock ---------- */
    $('#btn-unlock').addEventListener('click', App.doUnlock);
    $('#unlock-pass').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.doUnlock();
    });
    $('#btn-forget').addEventListener('click', e => App.forgetWallet(e.currentTarget));

    /* ---------- main header ---------- */
    $('#account-pill').addEventListener('click', () => UI.copyText(NW.App.S.address, 'Address copied'));
    $('#balance-addr').addEventListener('click', () => UI.copyText(NW.App.S.address, 'Address copied'));
    $('#btn-settings').addEventListener('click', () => { App.loadCmcHint(); UI.openModal('modal-settings'); });

    /* ---------- networks ---------- */
    $('#btn-network').addEventListener('click', () => {
      App.renderNetworkList('');
      $('#net-search').value = '';
      UI.openModal('modal-networks');
    });
    $('#net-search').addEventListener('input', e => App.renderNetworkList(e.target.value));
    $('#btn-net-add').addEventListener('click', () => {
      ['an-rpc', 'an-chainid', 'an-name', 'an-symbol', 'an-explorer'].forEach(id => $('#' + id).value = '');
      UI.status($('#an-status'), '');
      UI.openModal('modal-addnet');
    });
    $('#btn-an-save').addEventListener('click', App.saveCustomNetwork);

    /* ---------- actions ---------- */
    $('#btn-receive').addEventListener('click', App.openReceive);
    $('#btn-send').addEventListener('click', () => App.openSend(null));
    $('#btn-copy-addr').addEventListener('click', () => UI.copyText(NW.App.S.address, 'Address copied'));

    /* ---------- send form ---------- */
    $('#send-to').addEventListener('input', App.updateReviewEnabled);
    $('#send-to').addEventListener('blur', App.updateSendFee);
    let feeTimer = null;
    $('#send-amount').addEventListener('input', () => {
      clearTimeout(feeTimer);
      feeTimer = setTimeout(App.updateSendFee, 650);
      App.updateReviewEnabled();
    });
    $('#btn-max').addEventListener('click', App.onMaxAmount);
    $('#btn-send-review').addEventListener('click', App.openReview);
    App.armHoldButton($('#btn-confirm-send'), App.executeSend);

    /* ---------- tabs ---------- */
    $$('.tabs:not(.tabs--seg) .tab').forEach(t => t.addEventListener('click', () => {
      $$('.tabs:not(.tabs--seg) .tab').forEach(x => x.classList.toggle('active', x === t));
      $('#tab-tokens').classList.toggle('active', t.dataset.tab === 'tokens');
      $('#tab-activity').classList.toggle('active', t.dataset.tab === 'activity');
      $('#tab-neon').classList.toggle('active', t.dataset.tab === 'neon');
      if (t.dataset.tab === 'activity') App.renderActivity();
      if (t.dataset.tab === 'neon') App.renderNeon();
    }));

    /* ---------- neon token (demo miner) ---------- */
    $('#btn-neon-upgrade').addEventListener('click', App.onNeonUpgrade);

    /* ---------- tokens ---------- */
    $('#btn-add-token').addEventListener('click', () => {
      $('#token-addr').value = '';
      $('#token-preview').hidden = true;
      UI.status($('#token-status'), '');
      UI.setDisabled($('#btn-token-save'), true);
      UI.openModal('modal-token');
      setTimeout(() => $('#token-addr').focus(), 250);
    });
    let tokenTimer = null;
    $('#token-addr').addEventListener('input', () => {
      clearTimeout(tokenTimer);
      tokenTimer = setTimeout(App.onTokenAddrInput, 500);
    });
    $('#btn-token-save').addEventListener('click', App.saveToken);

    /* ---------- export / backup ---------- */
    $$('#modal-export .tab[data-secret]').forEach(t => t.addEventListener('click', () => {
      $$('#modal-export .tab[data-secret]').forEach(x => x.classList.toggle('active', x === t));
      $('#export-out').hidden = true;
      $('#export-out').innerHTML = '';
      UI.status($('#export-status'), '');
    }));
    $('#btn-export-show').addEventListener('click', App.revealSecret);
    $('#export-pass').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.revealSecret();
    });

    /* ---------- settings ---------- */
    $('#ms-copy-addr').addEventListener('click', () => UI.copyText(App.displayAddr(), 'Address copied'));
    $('#ms-view-on-explorer').addEventListener('click', () => {
      const net = NW.Networks.selected();
      const url = NW.Networks.explorerAddr(net, App.displayAddr());
      if (url) window.open(url, '_blank', 'noopener');
      else UI.toast('This network has no explorer configured', 'err');
    });
    $('#ms-backup').addEventListener('click', () => UI.openModal('modal-export'));
    $('#ms-lock').addEventListener('click', App.lockWallet);
    $('#ms-delete').addEventListener('click', e => App.deleteWallet(e.currentTarget));
    $('#autolock-min').addEventListener('change', App.saveAutoLock);
    $('#btn-save-cmc').addEventListener('click', App.saveCmcKey);
    $('#btn-clear-cmc').addEventListener('click', App.clearCmcKey);
    $('#cmc-key').addEventListener('keydown', e => { if (e.key === 'Enter') App.saveCmcKey(); });
    $('#btn-save-proxy').addEventListener('click', App.saveCmcProxy);
    $('#btn-clear-proxy').addEventListener('click', App.clearCmcProxy);
    $('#cmc-proxy').addEventListener('keydown', e => { if (e.key === 'Enter') App.saveCmcProxy(); });

    /* ---------- backup banner ---------- */
    $('#btn-banner-backup').addEventListener('click', () => UI.openModal('modal-export'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      wire();
    } catch (e) {
      console.error('NeonWallet: event wiring failed', e);
      if (NW.UI && NW.UI.toast) NW.UI.toast('UI init error — see console', 'err');
    }
    NW.App.boot();
  });
})();