/* ============================================================
   NeonWallet — UI primitives
   Screens, modals, toasts, loader, QR.
   ============================================================ */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* ---------- screens ---------- */
  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    window.scrollTo({ top: 0 });
  }

  /* ---------- modals ---------- */
  let openedModal = null;

  function openModal(id) {
    closeModal();
    const el = document.getElementById(id);
    if (!el) return null;
    el.classList.add('open');
    openedModal = el;
    document.body.style.overflow = 'hidden';
    return el;
  }

  function closeModal() {
    if (!openedModal) return;
    openedModal.classList.remove('open');
    openedModal = null;
    document.body.style.overflow = '';
  }

  document.addEventListener('click', e => {
    // close button or backdrop click
    const closer = e.target.closest('.modal-close');
    if (closer) { closeModal(); return; }
    if (openedModal && e.target.classList && e.target.classList.contains('modal-backdrop')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  /* ---------- toasts ---------- */
  function toast(msg, kind, opts) {
    const root = $('#toasts');
    if (!root) return alert(msg);
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    if (typeof msg === 'string') {
      t.textContent = msg;
    } else {
      t.appendChild(msg);
    }
    root.appendChild(t);
    const ttl = (opts && opts.ttl) || 3800;
    setTimeout(() => {
      t.classList.add('hide');
      setTimeout(() => t.remove(), 350);
    }, ttl);
  }

  function toastWithLink(text, url, kind) {
    const wrap = document.createElement('div');
    wrap.append(text + ' ');
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'View ↗';
    wrap.appendChild(a);
    toast(wrap, kind, { ttl: 9000 });
  }

  /* ---------- loader ---------- */
  function loading(on, text) {
    const ov = $('#overlay-loading');
    if (!ov) return;
    $('#loading-text').textContent = text || 'Working…';
    ov.hidden = !on;
  }

  /* ---------- clipboard ---------- */
  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || 'Copied to clipboard', 'ok', { ttl: 1800 });
    } catch (e) {
      // fallback for older browsers / insecure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg || 'Copied', 'ok', { ttl: 1800 }); }
      catch (err) { toast('Copy failed — select manually', 'err'); }
      ta.remove();
    }
  }

  /* ---------- QR ---------- */
  function renderQR(container, text) {
    container.innerHTML = '';
    // eslint-disable-next-line no-undef
    new QRCode(container, {
      text,
      width: 196,
      height: 196,
      colorDark: '#0a0c18',
      colorLight: '#f4f7fb',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  /* ---------- misc dom helpers ---------- */
  function setDisabled(el, disabled) { el.disabled = !!disabled; }
  function val(sel) { const el = typeof sel === 'string' ? $(sel) : sel; return el ? el.value.trim() : ''; }
  function status(el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'op-status' + (kind ? ' ' + kind : '');
  }

  const UI = {
    $, $$, showScreen, openModal, closeModal, toast, toastWithLink,
    loading, copyText, renderQR, setDisabled, val, status
  };

  window.NW = window.NW || {};
  window.NW.UI = UI;
})();
