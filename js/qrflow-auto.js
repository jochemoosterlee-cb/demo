// Auto-initializer for QrFlow using data attributes.
// Usage examples:
// - Presenter (portal page B):
//   <div id="qrcode" data-qrflow="presenter" data-wait="completed" data-next-url="done.html"></div>
//   <script type="module" src="/js/qrflow-auto.js"></script>
// - Scanner (mobile page 2):
//   <div id="reader" data-qrflow="scanner" data-autostart="true"></div>
//   <button data-qrflow-complete data-next-url="/mobile/3.html">OK</button>

import { QrFlow } from './qrflow.js';

let flowInstance = null;
async function flow() {
  if (!flowInstance) {
    flowInstance = await QrFlow.init({
      databaseURL: "https://demoapp-6cc2a-default-rtdb.europe-west1.firebasedatabase.app/"
    });
  }
  return flowInstance;
}

function boolAttr(v, def = false) {
  if (v == null) return def;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === '';
}

function dispatch(el, name, detail) {
  el.dispatchEvent(new CustomEvent(name, { detail }));
}

async function initPresenter(el) {
  const f = await flow();
  const size = parseInt(el.dataset.size || '192', 10);
  const colorDark = el.dataset.colorDark || '#000000';
  const colorLight = el.dataset.colorLight || '#FFFFFF';
  const correctLevel = (el.dataset.correctLevel || 'M').toUpperCase();
  const quietZone = parseInt(el.dataset.quietZone || '', 10);
  const logoSrc = el.dataset.logoSrc || '';
  const logoSizeRatio = parseFloat(el.dataset.logoSizeRatio || '0.5');
  const waitFor = (el.dataset.wait || 'completed').toLowerCase(); // 'scanned' | 'completed'
  const nextUrl = el.dataset.nextUrl || '';
  let id = el.dataset.sessionId || '';

  if (id) {
    await f.createSession(id);
  } else {
    const r = await f.createSession();
    id = r.id;
    el.dataset.sessionId = id;
  }
  try { sessionStorage.setItem('qrId', id); } catch {}

  dispatch(el, 'qrflow:session', { id });
  f.renderQr({ container: el, text: id, size, colorDark, colorLight, correctLevel, quietZone, logoSrc, logoSizeRatio });

  const unsubScanned = f.onScanned(id, () => {
    dispatch(el, 'qrflow:scanned', { id });
    if (waitFor === 'scanned' && nextUrl) window.location.href = nextUrl;
  });
  const unsubCompleted = f.onCompleted(id, async () => {
    dispatch(el, 'qrflow:completed', { id });
    if (el.dataset.deleteOnComplete) {
      try { await f.deleteSession(id); } catch {}
    }
    if (waitFor === 'completed' && nextUrl) window.location.href = nextUrl;
  });

  // Store unsub for potential cleanup if needed
  el._qrflowUnsub = () => {
    try { typeof unsubScanned === 'function' && unsubScanned(); } catch {}
    try { typeof unsubCompleted === 'function' && unsubCompleted(); } catch {}
  };
}

async function startScanner(el) {
  const f = await flow();
  const preferBack = boolAttr(el.dataset.preferBackCamera, true);
  let lastId = '';
  const preferredDeviceId = el.dataset.preferredDeviceId || '';

  // Single handler used by both camera decode and manual input
  const handleDecoded = async (decodedText) => {
    lastId = decodedText || '';
    // Validate session exists in DB before proceeding
    const errorEl = document.querySelector(el.dataset.errorTarget || '#scanError');
    if (!(await f.sessionExists(lastId))) {
      if (errorEl) { errorEl.textContent = 'Ongeldige of verlopen code. Toon een nieuwe QR en probeer opnieuw.'; }
      dispatch(el, 'qrflow:error', { error: new Error('Session not found') });
      return;
    }
    el.dataset.sessionId = lastId;
    try { sessionStorage.setItem('qrId', lastId); } catch {}
    try { await f.markScanned(lastId); } catch {}
    dispatch(el, 'qrflow:scanned', { id: lastId });
    const nextUrl = el.dataset.nextUrl || '';
    const requirePin = boolAttr(el.dataset.requirePin, false);
    if (requirePin) {
      // PIN overlay flow
      const overlay = document.querySelector(el.dataset.pinOverlay || '#pinOverlay');
      const dots = overlay?.querySelectorAll('#pinDots > span');
      const keys = overlay?.querySelectorAll('.pin-key');
      const backBtn = overlay?.querySelector('#pinBack');
      const err = overlay?.querySelector('#pinError');
      if (overlay && dots && keys) {
        overlay.classList.remove('hidden');
        let value = '';
        const PIN = (el.dataset.pinValue || '12345').toString();
        const renderDots = () => {
          dots.forEach((d, i) => {
            d.className = i < value.length
              ? 'w-3 h-3 rounded-full bg-textDark inline-block'
              : 'w-3 h-3 rounded-full border border-textDark/40 inline-block';
          });
        };
        const clearErr = () => { if (err) { err.textContent = ''; err.classList.add('invisible'); err.classList.remove('hidden'); } };
        const showErr = (m) => { if (err) { err.textContent = m; err.classList.remove('invisible'); } };
        const trySubmit = async () => {
          if (value.length !== PIN.length) return;
          if (value !== PIN) { value=''; renderDots(); showErr('Onjuiste PIN. Probeer opnieuw.'); return; }
          clearErr();
          try {
            await f.markCompleted(lastId);
            dispatch(el, 'qrflow:completed', { id: lastId });
            try { overlay.classList.add('hidden'); } catch {}
            if (el.dataset.deleteOnComplete) { try { await f.deleteSession(lastId); } catch {} }
            if (nextUrl) window.location.href = nextUrl;
          } catch (e) {
            showErr('Er ging iets mis. Probeer opnieuw.');
          }
        };
        // Ensure we don't accumulate multiple handlers across sessions
        keys.forEach((b) => { b.onclick = null; });
        keys.forEach((b) => {
          b.onclick = () => {
            clearErr();
            const d = b.getAttribute('data-digit');
            if (!d) return;
            if (value.length >= PIN.length) return;
            value += d;
            renderDots();
            if (value.length === PIN.length) trySubmit();
          };
        });
        if (backBtn) { backBtn.onclick = () => { clearErr(); value = value.slice(0,-1); renderDots(); }; }
        const cancelBtn = overlay.querySelector('#pinCancel');
        if (cancelBtn) { cancelBtn.onclick = () => { try { overlay.classList.add('hidden'); } catch {} }; }
        window.addEventListener('keydown', (e) => {
          if (/^[0-9]$/.test(e.key)) { if (value.length < PIN.length) { value += e.key; renderDots(); if (value.length===PIN.length) trySubmit(); } e.preventDefault(); }
          else if (e.key === 'Backspace') { value = value.slice(0,-1); renderDots(); e.preventDefault(); }
        }, { once: true });
        renderDots();
        return;
      }
    }
    // If page wants to navigate immediately after scan, do so now.
    if (nextUrl && boolAttr(el.dataset.navigateOnScan, false)) {
      window.location.href = nextUrl;
      return;
    }
    // If page wants to complete immediately, mark and navigate.
    if (boolAttr(el.dataset.completeImmediate, false)) {
      try { await f.markCompleted(lastId); } catch {}
      dispatch(el, 'qrflow:completed', { id: lastId });
      if (el.dataset.deleteOnComplete) {
        try { await f.deleteSession(lastId); } catch {}
      }
      if (nextUrl) window.location.href = nextUrl;
      return;
    }
    // Otherwise, wait for portal to mark completed and then navigate.
    try {
      f.onCompleted(lastId, async () => {
        dispatch(el, 'qrflow:completed', { id: lastId });
        if (el.dataset.deleteOnComplete) {
          try { await f.deleteSession(lastId); } catch {}
        }
        if (nextUrl) window.location.href = nextUrl;
      });
    } catch {}
  };

  const controller = await f.startScanner({
    elementId: el.id || (el.getAttribute('id') || 'qrflow_scanner_' + Date.now()),
    preferBackCamera: preferBack,
    preferredDeviceId,
    onDecode: async (decodedText) => {
      await handleDecoded(decodedText);
    }
  });

  el._qrflowCtrl = controller;
  try { dispatch(el, 'qrflow:camera-started', { deviceId: controller.currentDeviceId }); } catch {}

  // Optional manual input support to bypass camera
  const inputSel = el.dataset.manualInput || '';
  const btnSel = el.dataset.manualButton || '';
  const submitOnEnter = boolAttr(el.dataset.manualSubmitOnEnter, true);
  if (inputSel) {
    const input = document.querySelector(inputSel);
    const doSubmit = async () => {
      const val = (input?.value || '').trim();
      if (!val) return;
      try { await handleDecoded(val); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
    };
    if (submitOnEnter && input) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    }
    if (btnSel) {
      const btn = document.querySelector(btnSel);
      btn?.addEventListener('click', (e) => { e.preventDefault(); doSubmit(); });
    }
  }
}

async function initScanner(el) {
  // Ensure element has an id for html5-qrcode target
  if (!el.id) el.id = 'qrflow_scanner_' + Math.random().toString(36).slice(2);
  const autostart = boolAttr(el.dataset.autostart, true);
  const startBtnSel = el.dataset.startButton || '';
  const switchBtnSel = el.dataset.switchButton || '';
  const inputSel = el.dataset.manualInput || '';
  const btnSel = el.dataset.manualButton || '';
  const submitOnEnter = boolAttr(el.dataset.manualSubmitOnEnter, true);
  const listSel = el.dataset.cameraList || '';

  // Suppress noisy AbortError from video.play() when DOM changes during start
  // (Occurs in some browsers when the scan view toggles visibility.)
  if (!window.__qrflowAbortErrorFilter) {
    window.__qrflowAbortErrorFilter = true;
    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = e && e.reason;
        const name = r && (r.name || r.constructor?.name);
        const msg = (r && (r.message || String(r))) || '';
        if (name === 'AbortError' && /play\(\)/i.test(msg)) {
          e.preventDefault();
        }
      } catch {}
    });
  }

  // Attach manual input listeners even if we don't start the camera
  if (inputSel) {
    const f = await flow();
    const input = document.querySelector(inputSel);
    const doSubmit = async () => {
      const val = (input?.value || '').trim();
      if (!val) return;
      // Validate first
      const ok = await f.sessionExists(val);
      const errorEl = document.querySelector(el.dataset.errorTarget || '#scanError');
      if (!ok) {
        if (errorEl) { errorEl.textContent = 'Ongeldige of verlopen code. Toon een nieuwe QR en probeer opnieuw.'; }
        dispatch(el, 'qrflow:error', { error: new Error('Session not found') });
        return;
      }
      const lastId = val;
      el.dataset.sessionId = lastId;
      try { sessionStorage.setItem('qrId', lastId); } catch {}
      try { await f.markScanned(lastId); } catch {}
      dispatch(el, 'qrflow:scanned', { id: lastId });
      const nextUrl = el.dataset.nextUrl || '';
      const requirePin = boolAttr(el.dataset.requirePin, false);
      if (requirePin) {
        const overlay = document.querySelector(el.dataset.pinOverlay || '#pinOverlay');
        const dots = overlay?.querySelectorAll('#pinDots > span');
        const keys = overlay?.querySelectorAll('.pin-key');
        const backBtn = overlay?.querySelector('#pinBack');
        const err = overlay?.querySelector('#pinError');
        if (overlay && dots && keys) {
          overlay.classList.remove('hidden');
          let value = '';
          const PIN = (el.dataset.pinValue || '12345').toString();
          const renderDots = () => {
            dots.forEach((d, i) => {
              d.className = i < value.length
                ? 'w-3 h-3 rounded-full bg-textDark inline-block'
                : 'w-3 h-3 rounded-full border border-textDark/40 inline-block';
            });
          };
          const clearErr = () => { if (err) { err.textContent = ''; err.classList.add('invisible'); err.classList.remove('hidden'); } };
          const showErr = (m) => { if (err) { err.textContent = m; err.classList.remove('invisible'); } };
          const trySubmit = async () => {
            if (value.length !== PIN.length) return;
            if (value !== PIN) { value=''; renderDots(); showErr('Onjuiste PIN. Probeer opnieuw.'); return; }
            clearErr();
            try {
              await f.markCompleted(lastId);
              dispatch(el, 'qrflow:completed', { id: lastId });
              try { overlay.classList.add('hidden'); } catch {}
              if (el.dataset.deleteOnComplete) { try { await f.deleteSession(lastId); } catch {} }
              if (nextUrl) window.location.href = nextUrl;
            } catch (e) {
              showErr('Er ging iets mis. Probeer opnieuw.');
            }
          };
        keys.forEach((b) => { b.onclick = null; });
        keys.forEach((b) => {
          b.onclick = () => {
            clearErr();
            const d = b.getAttribute('data-digit');
            if (!d) return;
            if (value.length >= PIN.length) return;
            value += d;
            renderDots();
            if (value.length === PIN.length) trySubmit();
          };
        });
          if (backBtn) { backBtn.onclick = () => { clearErr(); value = value.slice(0,-1); renderDots(); }; }
          const cancelBtn2 = overlay.querySelector('#pinCancel');
          if (cancelBtn2) { cancelBtn2.onclick = () => { try { overlay.classList.add('hidden'); } catch {} }; }
          window.addEventListener('keydown', (e) => {
            if (/^[0-9]$/.test(e.key)) { if (value.length < PIN.length) { value += e.key; renderDots(); if (value.length===PIN.length) trySubmit(); } e.preventDefault(); }
            else if (e.key === 'Backspace') { value = value.slice(0,-1); renderDots(); e.preventDefault(); }
          }, { once: true });
          renderDots();
          return;
        }
      }
      if (nextUrl && boolAttr(el.dataset.navigateOnScan, false)) {
        window.location.href = nextUrl;
        return;
      }
      if (boolAttr(el.dataset.completeImmediate, false)) {
        try { await f.markCompleted(lastId); } catch {}
        dispatch(el, 'qrflow:completed', { id: lastId });
        if (el.dataset.deleteOnComplete) {
          try { await f.deleteSession(lastId); } catch {}
        }
        if (nextUrl) window.location.href = nextUrl;
        return;
      }
      try {
        f.onCompleted(lastId, async () => {
          dispatch(el, 'qrflow:completed', { id: lastId });
          if (el.dataset.deleteOnComplete) {
            try { await f.deleteSession(lastId); } catch {}
          }
          if (nextUrl) window.location.href = nextUrl;
        });
      } catch {}
    };
    if (submitOnEnter && input) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    }
    if (btnSel) {
      const btn = document.querySelector(btnSel);
      btn?.addEventListener('click', (e) => { e.preventDefault(); doSubmit(); });
    }
  }

  // Populate camera list if requested
  if (listSel && typeof Html5Qrcode !== 'undefined') {
    try {
      const cams = await Html5Qrcode.getCameras();
      const listEl = document.querySelector(listSel);
      if (listEl) {
        // Support <select> or a container for buttons
        if (listEl.tagName === 'SELECT') {
          listEl.innerHTML = '';
          cams.forEach((c, i) => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.label || `Camera ${i+1}`;
            listEl.appendChild(opt);
          });
          listEl.addEventListener('change', async () => {
            const id = listEl.value;
            if (el._qrflowCtrl && typeof el._qrflowCtrl.switchToDevice === 'function') {
              try { await el._qrflowCtrl.switchToDevice(id); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
            } else {
              el.dataset.preferredDeviceId = id;
              try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
            }
          });
        } else {
          listEl.innerHTML = '';
          cams.forEach((c, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = c.label || `Camera ${i+1}`;
            b.className = 'px-3 py-1 rounded-md text-sm font-inter bg-white border border-gray-300 text-textDark hover:bg-brandBlue hover:text-white';
            b.addEventListener('click', async () => {
              const id = c.id;
              if (el._qrflowCtrl && typeof el._qrflowCtrl.switchToDevice === 'function') {
                try { await el._qrflowCtrl.switchToDevice(id); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
              } else {
                el.dataset.preferredDeviceId = id;
                try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
              }
            });
            listEl.appendChild(b);
          });
        }
      }
    } catch (e) {
      dispatch(el, 'qrflow:error', { error: e });
    }
  }

  // Helper: start only when element is visible (prevents camera from starting in hidden view)
  const isVisible = (node) => {
    if (!node || !(node instanceof Element)) return false;
    const rects = node.getClientRects();
    if (!rects || rects.length === 0) return false;
    const style = window.getComputedStyle(node);
    return style && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const startWhenVisible = async () => {
    if (isVisible(el)) {
      try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
      return true;
    }
    return false;
  };

  if (autostart && !startBtnSel) {
    if (!(await startWhenVisible())) {
      const observer = new MutationObserver(async () => {
        if (await startWhenVisible()) { try { observer.disconnect(); } catch {} }
      });
      try { observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style'] }); } catch {}
      const onHash = async () => { await startWhenVisible(); };
      window.addEventListener('hashchange', onHash, { once: true });
    }
  } else if (startBtnSel) {
    const btn = document.querySelector(startBtnSel);
    btn?.addEventListener('click', async () => {
      try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
    });
  }

  if (switchBtnSel) {
    const sbtn = document.querySelector(switchBtnSel);
    sbtn?.addEventListener('click', async () => {
      const ctrl = el._qrflowCtrl;
      if (ctrl && typeof ctrl.switchToNext === 'function') {
        try { await ctrl.switchToNext(); dispatch(el, 'qrflow:camera-switched', { deviceId: ctrl.currentDeviceId }); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
      } else {
        // If controller not available yet (e.g., first start failed), try starting now (user gesture)
        try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
      }
    });
  }
}

// Global handler for completion buttons
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (!t.matches('[data-qrflow-complete]')) return;

  // Find nearest scanner element or by selector
  const targetSel = t.getAttribute('data-target');
  const scanner = targetSel ? document.querySelector(targetSel) : t.closest('[data-qrflow="scanner"]') || document.querySelector('[data-qrflow="scanner"]');
  if (!scanner) return;
  const id = scanner.getAttribute('data-session-id');
  if (!id) return;
  try {
    const f = await flow();
    await f.markCompleted(id);
    dispatch(scanner, 'qrflow:completed', { id });
    const nextUrl = t.getAttribute('data-next-url') || '';
    if (nextUrl) window.location.href = nextUrl;
  } catch {}
});

document.addEventListener('DOMContentLoaded', async () => {
  const nodes = Array.from(document.querySelectorAll('[data-qrflow]'));
  for (const el of nodes) {
    const role = (el.dataset.qrflow || '').toLowerCase();
    if (role === 'presenter') {
      initPresenter(el);
    } else if (role === 'scanner') {
      initScanner(el);
    }
  }
});
