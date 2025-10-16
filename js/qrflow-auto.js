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

  dispatch(el, 'qrflow:session', { id });
  f.renderQr({ container: el, text: id, size, colorDark, colorLight });

  const unsubScanned = f.onScanned(id, () => {
    dispatch(el, 'qrflow:scanned', { id });
    if (waitFor === 'scanned' && nextUrl) window.location.href = nextUrl;
  });
  const unsubCompleted = f.onCompleted(id, () => {
    dispatch(el, 'qrflow:completed', { id });
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

  const controller = await f.startScanner({
    elementId: el.id || (el.getAttribute('id') || 'qrflow_scanner_' + Date.now()),
    preferBackCamera: preferBack,
    onDecode: async (decodedText) => {
      lastId = decodedText || '';
      el.dataset.sessionId = lastId;
      try { await f.markScanned(lastId); } catch {}
      dispatch(el, 'qrflow:scanned', { id: lastId });
      if (boolAttr(el.dataset.completeImmediate, false)) {
        try { await f.markCompleted(lastId); } catch {}
        dispatch(el, 'qrflow:completed', { id: lastId });
        const nextUrl = el.dataset.nextUrl || '';
        if (nextUrl) window.location.href = nextUrl;
      }
    }
  });

  el._qrflowCtrl = controller;
}

async function initScanner(el) {
  // Ensure element has an id for html5-qrcode target
  if (!el.id) el.id = 'qrflow_scanner_' + Math.random().toString(36).slice(2);
  const autostart = boolAttr(el.dataset.autostart, true);
  const startBtnSel = el.dataset.startButton || '';

  if (autostart && !startBtnSel) {
    try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
  } else if (startBtnSel) {
    const btn = document.querySelector(startBtnSel);
    btn?.addEventListener('click', async () => {
      try { await startScanner(el); } catch (e) { dispatch(el, 'qrflow:error', { error: e }); }
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

