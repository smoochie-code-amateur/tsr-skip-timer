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

const STATE_IMAGES = {
    preparing: { img: 'gettin_files.png' },
    warming: { img: 'stroking_llamas.png' },
    ready: { img: 'don_s_winking_at_you.png' },
    started: { img: 'downloading.png' },
    done: { img: 'download_started.png' },
    error_vip: { img: 'vip_cc_no.png' }
  };

  function makeOverlay() {
    const el = document.createElement('div');
    el.id = 'tsr-skip-overlay';
    el.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'background:#1e2a3a', 'border-radius:10px',
      'box-shadow:0 6px 18px rgba(0,0,0,.4)',
      'overflow:hidden', 'max-width:300px'
    ].join(';');

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.style.cssText = [
      'position:absolute', 'top:4px', 'right:6px', 'z-index:2', 'border:0',
      'background:rgba(0,0,0,.45)', 'color:#fff', 'cursor:pointer',
      'width:20px', 'height:20px', 'border-radius:50%', 'font:13px/1 system-ui,sans-serif'
    ].join(';');

    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.style.cssText = 'display:block;width:100%;max-height:104px;object-fit:contain';

    const cap = document.createElement('div');
    cap.style.cssText = 'padding:10px 14px;font:12.5px/1.4 system-ui,sans-serif;display:none';

    el.appendChild(close);
    el.appendChild(img);
    el.appendChild(cap);
    document.documentElement.appendChild(el);

    const overlay = {
      el,
      state(name) {
        const s = STATE_IMAGES[name];
        if (!s) return;
        img.style.display = 'block';
        img.src = chrome.runtime.getURL('states/' + s.img);
        cap.style.display = 'none';
      },
      text(color, text) {
        img.style.display = 'none';
        cap.style.cssText = 'padding:12px 14px;font:12.5px/1.4 system-ui,sans-serif;color:#eef2f7;display:flex;align-items:center;gap:8px';
        cap.textContent = '';
        const dot = document.createElement('span');
        dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:' + color + ';flex:none';
        const span = document.createElement('span');
        span.textContent = text;
        cap.appendChild(dot);
        cap.appendChild(span);
      }
    };

    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      removeOverlay(overlay);
    }, true);

    overlay.state('preparing');
    return overlay;
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

  function prettifySlug(slug) {
    return slug.split('-').map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
  }

  function suggestFilename() {
    try {
      const slug = path.match(/\/title\/([^/]+)\//);
      if (slug) return prettifySlug(decodeURIComponent(slug[1]));
    } catch (e) {}
    try {
      let t = String(document.title || '').trim();
      const cut = t.search(/\s*-\s*The Sims\b/);
      if (cut > 0) t = t.slice(0, cut);
      t = t.replace(/^The Sims Resource\s*\|\s*/i, '');
      t = t.replace(/\s*-\s*Download\s*$/i, '');
      if (t) return t;
    } catch (e) {}
    return '';
  }

  function makeFilename() {
    let s = String(suggestFilename() || '')
      .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 100);
    if (!s) return '';
    return s.toLowerCase().endsWith('.zip') ? s : s + '.zip';
  }

  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  }

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function w16(b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; }
  function w32(b, o, v) { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; }

  function parseZipEntries(bytes) {
    const n = bytes.length;
    let eocd = -1;
    for (let i = n - 22; i >= 0 && eocd < 0; i--) {
      if (u32(bytes, i) === 0x06054b50) eocd = i;
    }
    if (eocd < 0) throw new Error('no EOCD');
    const count = u16(bytes, eocd + 10);
    const cdOffset = u32(bytes, eocd + 16);
    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('bad central dir');
      const method = u16(bytes, p + 10);
      const mtime = u16(bytes, p + 12);
      const mdate = u16(bytes, p + 14);
      const crc = u32(bytes, p + 16);
      const compSize = u32(bytes, p + 20);
      const uncompSize = u32(bytes, p + 24);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const localOffset = u32(bytes, p + 42);
      const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
      if (u32(bytes, localOffset) !== 0x04034b50) throw new Error('bad local header');
      const lNameLen = u16(bytes, localOffset + 26);
      const lExtraLen = u16(bytes, localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = bytes.slice(dataStart, dataStart + compSize);
      entries.push({ name, method, mtime, mdate, crc, compSize, uncompSize, data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  function buildZip(entries) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const local = new Uint8Array(30 + name.length);
      w32(local, 0, 0x04034b50);
      w16(local, 4, 20);
      w16(local, 6, 0);
      w16(local, 8, e.method);
      w16(local, 10, e.mtime);
      w16(local, 12, e.mdate);
      w32(local, 14, e.crc);
      w32(local, 18, e.data.length);
      w32(local, 22, e.uncompSize);
      w16(local, 26, name.length);
      w16(local, 28, 0);
      local.set(name, 30);
      central.push({ name, method: e.method, mtime: e.mtime, mdate: e.mdate, crc: e.crc, compSize: e.data.length, uncompSize: e.uncompSize, local: offset });
      offset += local.length + e.data.length;
      parts.push(local, e.data);
    }
    const cdStart = offset;
    const cdParts = [];
    for (const c of central) {
      const name = c.name;
      const rec = new Uint8Array(46 + name.length);
      w32(rec, 0, 0x02014b50);
      w16(rec, 4, 20);
      w16(rec, 6, 20);
      w16(rec, 8, 0);
      w16(rec, 10, c.method);
      w16(rec, 12, c.mtime);
      w16(rec, 14, c.mdate);
      w32(rec, 16, c.crc);
      w32(rec, 20, c.compSize);
      w32(rec, 24, c.uncompSize);
      w16(rec, 28, name.length);
      w16(rec, 30, 0);
      w16(rec, 32, 0);
      w16(rec, 34, 0);
      w16(rec, 36, 0);
      w32(rec, 38, 0);
      w32(rec, 42, c.local);
      rec.set(name, 46);
      cdParts.push(rec);
      offset += rec.length;
    }
    const cdSize = offset - cdStart;
    const eocd = new Uint8Array(22);
    w32(eocd, 0, 0x06054b50);
    w16(eocd, 4, 0);
    w16(eocd, 6, 0);
    w16(eocd, 8, central.length);
    w16(eocd, 10, central.length);
    w32(eocd, 12, cdSize);
    w32(eocd, 16, cdStart);
    w16(eocd, 20, 0);
    const total = parts.reduce((a, b) => a + b.length, 0) + cdParts.reduce((a, b) => a + b.length, 0) + 22;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    for (const p of cdParts) { out.set(p, o); o += p.length; }
    out.set(eocd, o);
    return out;
  }

  const META_KEY = 'tsrskip:meta:';

  function storePageMeta(itemId, meta) {
    try {
      if (itemId && meta && (meta.author || meta.category)) {
        sessionStorage.setItem(META_KEY + itemId, JSON.stringify(meta));
      }
    } catch (e) {}
  }

  function loadPageMeta(itemId) {
    try {
      const raw = itemId && sessionStorage.getItem(META_KEY + itemId);
      if (raw) return JSON.parse(raw) || null;
    } catch (e) {}
    return null;
  }

  function pageMeta(itemId) {
    const meta = { name: '', author: '', category: '' };
    const base = makeFilename().replace(/\.zip$/i, '');
    meta.name = base;
    try {
      const creator = document.querySelector('a.big-creator');
      if (creator) {
        const href = creator.getAttribute('href') || '';
        const m = href.match(/\/artists\/([^/]+)\/?/);
        if (m) meta.author = decodeURIComponent(m[1]);
        else meta.author = creator.textContent.trim();
      }
    } catch (e) {}
    try {
      const current = pageItemId();
      const nodes = document.querySelectorAll('[data-item]');
      let parsed = null;
      const decode = (s) => {
        const d = document.createElement('textarea');
        d.innerHTML = s;
        return d.value;
      };
      for (const node of nodes) {
        try {
          const obj = JSON.parse(decode(node.getAttribute('data-item')));
          if (obj && current && String(obj.ID) === String(current)) { parsed = obj; break; }
        } catch (e) {}
      }
      if (!parsed && nodes.length) {
        try { parsed = JSON.parse(decode(nodes[0].getAttribute('data-item'))); } catch (e) {}
      }
      if (parsed && parsed.CategoryDisplay) meta.category = parsed.CategoryDisplay;
    } catch (e) {}
    if (!meta.author || !meta.category) {
      const stored = loadPageMeta(itemId);
      if (stored) {
        if (!meta.author && stored.author) meta.author = stored.author;
        if (!meta.category && stored.category) meta.category = stored.category;
        if (!meta.name && stored.name) meta.name = stored.name;
      }
    }
    storePageMeta(itemId, meta);
    return meta;
  }

  function readmeText(meta) {
    const now = new Date();
    const date = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const lines = [
      'Name: ' + meta.name,
      'Creator: ' + meta.author,
      'Category: ' + meta.category,
      'Source: ' + window.location.href,
      'Downloaded: ' + date,
      '',
      'This archive was re-packaged by TSR Skip Download Timer.'
    ];
    return lines.join('\r\n') + '\r\n';
  }

  function isZipMagic(buf) {
    return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
  }

  async function fetchBytes(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  function triggerBlobDownload(bytes, filename) {
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000);
  }

  async function repackAndSave(url, itemId) {
    let filename = makeFilename();
    if (!filename) filename = 'download.zip';
    const meta = pageMeta(itemId);
    let bytes;
    try {
      bytes = await fetchBytes(url);
    } catch (e) {
      console.warn('[TSR skip] fetch of file failed:', e && e.message || e);
      return false;
    }
    console.log('[TSR skip] fetched', bytes.length, 'bytes for', filename);
    const rc = new TextEncoder().encode(readmeText(meta));
    const readmeEntry = {
      name: 'README.txt',
      method: 0,
      mtime: 0,
      mdate: 0x21dd,
      crc: crc32(rc),
      uncompSize: rc.length,
      data: rc
    };
    if (!isZipMagic(bytes)) {
      let ext = '.package';
      try {
        const m = url.split('?')[0].match(/(\.[A-Za-z0-9]+)$/);
        if (m) ext = m[1];
      } catch (e) {}
      const innerName = (meta.name || 'download') + ext;
      const entries = [
        { name: innerName, method: 0, mtime: 0, mdate: 0x21dd, crc: crc32(bytes), uncompSize: bytes.length, data: bytes },
        readmeEntry
      ];
      try {
        const out = buildZip(entries);
        console.log('[TSR skip] wrapped raw file into zip ->', filename);
        triggerBlobDownload(out, filename);
        return true;
      } catch (e) {
        console.warn('[TSR skip] wrap failed, saving raw bytes:', e && e.message || e);
        triggerBlobDownload(bytes, filename.replace(/\.zip$/i, ext));
        return true;
      }
    }
    try {
      const entries = parseZipEntries(bytes).filter((e) => !/read\s*me/i.test(e.name));
      entries.push(readmeEntry);
      const out = buildZip(entries);
      console.log('[TSR skip] repacked OK:', entries.length, 'entries,', out.length, 'bytes ->', filename);
      triggerBlobDownload(out, filename);
      return true;
    } catch (e) {
      console.warn('[TSR skip] repack failed, saving original bytes:', e && e.message || e);
      triggerBlobDownload(bytes, filename);
      return true;
    }
  }

  function startBrowserDownload(url, itemId) {
    repackAndSave(url, itemId).then((ok) => {
      if (ok) return;
      console.warn('[TSR skip] falling back to background download');
      try {
        chrome.runtime.sendMessage({ type: 'download', url });
      } catch (e2) {}
    }).catch((e) => {
      console.warn('[TSR skip] unexpected error:', e && e.message || e);
      try {
        chrome.runtime.sendMessage({ type: 'download', url });
      } catch (e2) {}
    });
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
        overlay.state('started');
        startBrowserDownload(data.url, itemId);
        setTimeout(() => overlay.state('done'), 1000);
        setTimeout(() => removeOverlay(overlay), 6000);
        return;
      }

      const low = String(data.error || '').toLowerCase();
      if (vipPattern.test(low)) {
        overlay.state('error_vip');
        setTimeout(() => removeOverlay(overlay), 8000);
        return;
      }
    }

    overlay.text('#e74c3c', 'Server did not release the file in time. Click the download button manually.');
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
    overlay.state('preparing');

    try {
      await ensurePrewarmed(itemId);
    } catch (e) {
      if (vipPattern.test(String(e.message || '').toLowerCase())) {
        overlay.state('error_vip');
        setTimeout(() => removeOverlay(overlay), 8000);
        instantRunning = false;
        return;
      }
      overlay.text('#e74c3c', 'Initialization failed. Retrying...');
      await sleep(1500);
      try {
        await ensurePrewarmed(itemId);
      } catch (e2) {
        if (vipPattern.test(String(e2.message || '').toLowerCase())) {
          overlay.state('error_vip');
        } else {
          overlay.text('#e74c3c', 'Could not get access. Click Download again.');
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
      overlay.state('ready');
    } else {
      overlay.state('warming');
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
        overlay.state('started');
        disableDownloaderButton();
        if (settings.guestMode) resetGuestCounter();
        startBrowserDownload(body.url, itemId);
        setTimeout(() => overlay.state('done'), 1000);
        setTimeout(() => removeOverlay(overlay), 6000);
        invalidatePrewarm();
        instantRunning = false;
        return;
      }
      const low = String(body.error || '').toLowerCase();
      if (vipPattern.test(low)) {
        overlay.state('error_vip');
        setTimeout(() => removeOverlay(overlay), 8000);
        invalidatePrewarm();
        instantRunning = false;
        return;
      }
      await sleep(FAST_POLL_MS);
    }

    overlay.text('#f5b301', 'Server is slow — opening the countdown page...');
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
    try { if (itemId) pageMeta(itemId); } catch (e) {}

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