(() => {
  const SETTINGS_KEY = 'tsrSkipSettings';
  const DEFAULT_SETTINGS = { enabled: true, guestMode: true, pollSeconds: 3, maxWaitSeconds: 60 };
  const GATE_MS = 8000;
  const FAST_POLL_MS = 1500;

  let settings = null;
  const path = window.location.pathname;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isCountdownPage() {
    return /^\/downloads\/download\/itemId\/\d+\/ticket\/[^/]+\/?$/.test(path);
  }

  function isDetailsPage() {
    return /^\/downloads\/(details|browse|overview|required-items|favorites)/.test(path) || path === '/';
  }

  function pageItemId() {
    const parts = path.match(/\/id\/(\d+)/g);
    if (!parts || !parts.length) return null;
    const last = parts[parts.length - 1].match(/\d+/);
    return last ? last[0] : null;
  }

  function parseCountdownPath() {
    const m = path.match(/^\/downloads\/download\/itemId\/(\d+)\/ticket\/([^/]+)\/?$/);
    return m ? { itemId: m[1], ticket: decodeURIComponent(m[2]) } : null;
  }

  const doneKey = (itemId, ticket) => 'tsr_done_' + itemId + '_' + ticket;

  async function loadSettings() {
    let stored = {};
    try {
      const res = await chrome.storage.local.get([SETTINGS_KEY]);
      stored = res[SETTINGS_KEY] || {};
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS, stored);
  }

  function setDone(itemId, ticket) {
    try {
      sessionStorage.setItem(doneKey(itemId, ticket), '1');
    } catch (e) {}
  }

  function resetGuestCounter() {
    try {
      sessionStorage.downloadCount = 0;
    } catch (e) {}
  }

  function makeOverlay() {
    const el = document.createElement('div');
    el.id = 'tsr-skip-overlay';
    el.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'background:#1e2a3a', 'color:#eef2f7', 'padding:10px 14px', 'border-radius:10px',
      'font:13px/1.4 system-ui,sans-serif', 'box-shadow:0 4px 14px rgba(0,0,0,.35)',
      'display:flex', 'align-items:center', 'gap:8px', 'max-width:340px'
    ].join(';');
    const dot = document.createElement('span');
    dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#f5b301;flex:none';
    const txt = document.createElement('span');
    txt.textContent = 'TSR: preparing file...';
    el.appendChild(dot);
    el.appendChild(txt);
    document.documentElement.appendChild(el);
    return { el, dot, txt, set: (color, text) => { dot.style.background = color; txt.textContent = text; } };
  }

  function removeOverlay(overlay) {
    try {
      overlay.el.remove();
    } catch (e) {}
  }

  function disableDownloaderButton() {
    const btn = document.querySelector('.downloader');
    if (!btn) return;
    btn.disabled = true;
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.55';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
    const label = btn.querySelector('.download-title') || btn;
    if (label && label.textContent.indexOf('Downloaded') === -1) {
      label.textContent = 'Downloaded ✓';
    }
  }

  async function requestDownloadUrl(itemId, ticket) {
    const qs =
      '/ajax.php?c=downloads&a=getdownloadurl&ajax=1&itemid=' + itemId +
      '&mid=0&lk=0&ticket=' + encodeURIComponent(ticket);
    const res = await fetch(qs, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function startBrowserDownload(url) {
    try {
      chrome.runtime.sendMessage({ type: 'download', url });
    } catch (e) {}
  }

  const vipPattern = /(vip|exclusive|subscription|premium|not available|no longer|deleted)/;

  async function handleCountdownPage() {
    const parsed = parseCountdownPath();
    if (!parsed) return;
    const { itemId, ticket } = parsed;

    if (settings.guestMode) resetGuestCounter();

    try {
      if (sessionStorage.getItem(doneKey(itemId, ticket))) return;
    } catch (e) {}

    const overlay = makeOverlay();
    const start = Date.now();
    const maxWait = (settings.maxWaitSeconds || 60) * 1000;
    const pollMs = (settings.pollSeconds || 3) * 1000;
    let first = true;

    while (Date.now() - start < maxWait) {
      if (first) {
        first = false;
        await sleep(4000);
      } else {
        await sleep(pollMs);
      }

      if (!settings.enabled) return;

      let data;
      try {
        data = await requestDownloadUrl(itemId, ticket);
      } catch (e) {
        continue;
      }

      if (!data) continue;

      if (data.error === '' && data.url) {
        setDone(itemId, ticket);
        disableDownloaderButton();
        overlay.set('#2ecc71', 'Download started ✓');
        startBrowserDownload(data.url);
        setTimeout(() => removeOverlay(overlay), 6000);
        return;
      }

      const low = String(data.error || '').toLowerCase();
      if (vipPattern.test(low)) {
        overlay.set('#e74c3c', 'This file is VIP-exclusive or unavailable: ' + data.error);
        setTimeout(() => removeOverlay(overlay), 8000);
        return;
      }
    }

    overlay.set('#e74c3c', 'Server did not release the file in time. Click the download button manually.');
    setTimeout(() => removeOverlay(overlay), 8000);
  }

  const prewarm = { itemId: null, ticket: null, armed: true, matureAt: 0 };

  async function initDownload(itemId) {
    const qs = '/ajax.php?c=downloads&a=initDownload&itemid=' + itemId + '&setItems=&format=zip';
    const res = await fetch(qs, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('init HTTP ' + res.status);
    const data = await res.json();
    if (!data || !data.ticket) throw new Error('no ticket');
    return data;
  }

  async function visitCountdown(itemId, ticket) {
    const url = '/downloads/download/itemId/' + itemId + '/ticket/' + encodeURIComponent(ticket);
    await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  }

  async function ensurePrewarmed(itemId) {
    if (prewarm.itemId === itemId && prewarm.ticket) return;
    const data = await initDownload(itemId);
    if (data && data.error) throw new Error(data.error);
    prewarm.itemId = itemId;
    prewarm.ticket = data.ticket;
    prewarm.matureAt = Date.now() + GATE_MS;
    try {
      await visitCountdown(itemId, data.ticket);
    } catch (e) {}
  }

  function invalidatePrewarm() {
    prewarm.itemId = null;
    prewarm.ticket = null;
    prewarm.armed = true;
    prewarm.matureAt = 0;
  }

  let instantRunning = false;

  async function runInstant(itemId) {
    if (instantRunning) return;
    instantRunning = true;
    const overlay = makeOverlay();
    overlay.set('#f5b301', 'Preparing file, no timer...');

    try {
      await ensurePrewarmed(itemId);
    } catch (e) {
      if (vipPattern.test(String(e.message || '').toLowerCase())) {
        overlay.set('#e74c3c', 'This file is VIP-exclusive or unavailable: ' + e.message);
        setTimeout(() => removeOverlay(overlay), 8000);
        instantRunning = false;
        return;
      }
      overlay.set('#e74c3c', 'Initialization failed. Retrying...');
      await sleep(1500);
      try {
        await ensurePrewarmed(itemId);
      } catch (e2) {
        if (vipPattern.test(String(e2.message || '').toLowerCase())) {
          overlay.set('#e74c3c', 'This file is VIP-exclusive or unavailable: ' + e2.message);
        } else {
          overlay.set('#e74c3c', 'Could not get access. Click Download again.');
        }
        setTimeout(() => removeOverlay(overlay), 8000);
        instantRunning = false;
        return;
      }
    }

    if (!settings.enabled) {
      removeOverlay(overlay);
      instantRunning = false;
      return;
    }

    if (prewarm.matureAt <= Date.now()) {
      overlay.set('#f5b301', 'Downloading now...');
    } else {
      overlay.set('#f5b301', 'The file will be ready in a few seconds — downloading automatically...');
    }

    const hardCap = Date.now() + 25000;
    while (Date.now() < hardCap) {
      let body;
      try {
        body = await requestDownloadUrl(itemId, prewarm.ticket);
      } catch (e) {
        await sleep(FAST_POLL_MS);
        continue;
      }
      if (!body) {
        await sleep(FAST_POLL_MS);
        continue;
      }
      if (body.error === '' && body.url) {
        overlay.set('#2ecc71', 'Download started ✓');
        disableDownloaderButton();
        if (settings.guestMode) resetGuestCounter();
        startBrowserDownload(body.url);
        setTimeout(() => removeOverlay(overlay), 6000);
        invalidatePrewarm();
        instantRunning = false;
        return;
      }
      const low = String(body.error || '').toLowerCase();
      if (vipPattern.test(low)) {
        overlay.set('#e74c3c', 'This file is VIP-exclusive or unavailable: ' + body.error);
        setTimeout(() => removeOverlay(overlay), 8000);
        invalidatePrewarm();
        instantRunning = false;
        return;
      }
      await sleep(FAST_POLL_MS);
    }

    overlay.set('#f5b301', 'Server is slow — opening the countdown page...');
    window.location.href = '/downloads/download/itemId/' + itemId + '/ticket/' + encodeURIComponent(prewarm.ticket);
    invalidatePrewarm();
    instantRunning = false;
  }

  const MODALS = {
    email: { id: 'md-modal-email-request', action: (m) => clickInside(m, '.md-close') || hideModal(m) },
    cta: { id: 'md-modal-downloadcta', action: (m) => clickInside(m, '.continue-download-button') || clickInside(m, '.md-close') || hideModal(m) },
    blocked: { id: 'becauseblocked', action: (m) => hideModal(m) },
    free_signup: { id: 'md-modal-free-signup-cta', action: (m) => hideModal(m) },
    login: { id: 'md-modal-login-popup', action: (m) => { resetGuestCounter(); clickInside(m, '.md-close') || hideModal(m); } },
  };

  function clickInside(modal, selector) {
    const el = modal.querySelector(selector);
    if (el) {
      el.click();
      return true;
    }
    return false;
  }

  function hideModal(modal) {
    modal.style.display = 'none';
  }

  function isVisible(el) {
    return el && getComputedStyle(el).display !== 'none' &&
      el.offsetParent !== null &&
      getComputedStyle(el).visibility !== 'hidden';
  }

  const inFlight = new Set();

  function sweepModals() {
    if (!settings.enabled) return;
    const names = settings.guestMode ? Object.keys(MODALS) : ['email', 'cta', 'blocked', 'free_signup'];
    for (const name of names) {
      const cfg = MODALS[name];
      if (!cfg || inFlight.has(name)) continue;
      const modal = document.getElementById(cfg.id);
      if (modal && isVisible(modal) && modal.offsetWidth > 0) {
        inFlight.add(name);
        cfg.action(modal);
        setTimeout(() => inFlight.delete(name), 1200);
      }
    }
  }

  const DL_SELECTOR = 'a.dl, a.download-button, a.downloader, a.continue-download-button';

  function setupDetailsPage() {
    const itemId = pageItemId();

    document.addEventListener('pointerover', (e) => {
      if (!prewarm.armed || !settings.enabled || !itemId) return;
      if (e.target.closest(DL_SELECTOR)) {
        prewarm.armed = false;
        ensurePrewarmed(itemId).catch(() => { prewarm.armed = true; });
      }
    }, true);

    document.addEventListener('click', (e) => {
      if (!settings.enabled) return;
      const btn = e.target.closest(DL_SELECTOR);
      if (!btn) return;
      if (!itemId) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      runInstant(itemId);
    }, true);

    document.documentElement.addEventListener('click', (e) => {
      if (!settings.guestMode) return;
      const hit = e.target.closest(DL_SELECTOR);
      if (hit) resetGuestCounter();
    }, true);

    const obs = new MutationObserver(() => sweepModals());
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
    window.addEventListener('load', () => setTimeout(sweepModals, 500));
    sweepModals();
  }

  async function init() {
    settings = await loadSettings();
    if (!settings.enabled) return;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) {
        settings = Object.assign({}, DEFAULT_SETTINGS, changes[SETTINGS_KEY].newValue || {});
      }
    });

    if (isCountdownPage()) {
      handleCountdownPage();
    } else if (isDetailsPage()) {
      setupDetailsPage();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();