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

  // Prevent multiple starts
  if (el.dataset.isStarting === 'true') {
    
    return el._qrflowCtrl;
  }
  el.dataset.isStarting = 'true';

  // Cleanup existing scanner before starting anew
  if (el._qrflowCtrl) {
    
    try {
      await el._qrflowCtrl.stop();
      await el._qrflowCtrl.clear();
    } catch (e) {
      
    }
    delete el._qrflowCtrl;
  }

  const handleDecoded = async (decodedText) => {
    lastId = decodedText || '';
    const errorEl = document.querySelector(el.dataset.errorTarget || '#scanError');
    if (!(await f.sessionExists(lastId))) {
      if (errorEl) {
        errorEl.textContent = 'Ongeldige of verlopen code. Toon een nieuwe QR en probeer opnieuw.';
      }
      dispatch(el, 'qrflow:error', { error: new Error('Session not found') });
      return;
    }
    el.dataset.sessionId = lastId;
    try {
      sessionStorage.setItem('qrId', lastId);
    } catch {}
    try {
      await f.markScanned(lastId);
    } catch {}
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
        const showOverlay = () => { try { overlay.style.display = ''; overlay.classList.remove('hidden'); } catch {} }; const hideOverlay = () => { try { overlay.classList.add('hidden'); overlay.style.display = 'none'; } catch {} }; showOverlay();
        let value = '';
        const PIN = (el.dataset.pinValue || '12345').toString();
        const renderDots = () => {
          dots.forEach((d, i) => {
            d.className = i < value.length
              ? 'w-3 h-3 rounded-full bg-textDark inline-block'
              : 'w-3 h-3 rounded-full border border-textDark/40 inline-block';
          });
        };
        const clearErr = () => {
          if (err) {
            err.textContent = '';
            err.classList.add('invisible');
            err.classList.remove('hidden');
          }
        };
        const showErr = (m) => {
          if (err) {
            err.textContent = m;
            err.classList.remove('invisible');
          }
        };
        const onKey = (e) => {
          const t = e.currentTarget;
          if (!(t instanceof Element)) return;
          const digit = t.dataset.digit;
          if (!digit) return;
          clearErr();
          if (value.length < 5) {
            value += digit;
            renderDots();
            if (value.length === 5) {
              if (value === PIN) {
                try { f.markCompleted(lastId); } catch {}
                dispatch(el, 'qrflow:completed', { id: lastId });
                if (boolAttr(el.dataset.deleteOnComplete, false)) {
                  try { f.deleteSession(lastId); } catch {}
                }
                if (nextUrl) window.location.href = nextUrl;
              } else {
                showErr('Onjuiste PIN. Probeer opnieuw.');
                value = '';
                renderDots();
              }
            }
          }
        };
        const onBack = () => {
          clearErr();
          value = value.slice(0, -1);
          renderDots();
        };
        keys.forEach(k => k.removeEventListener('click', onKey));
        keys.forEach(k => k.addEventListener('click', onKey));
        if (backBtn) {
          backBtn.removeEventListener('click', onBack);
          backBtn.addEventListener('click', onBack);
        }
      }
    }
  };

  const cameras = await Html5Qrcode.getCameras();
  if (!cameras || cameras.length === 0) {
    
    throw new Error('No cameras found');
  }

  const isBack = (c) => /back|rear|environment/i.test(c.label || '');
  const backList = cameras.filter(isBack).map(c => c.id);
  const otherList = cameras.filter(c => !isBack(c)).map(c => c.id);
  let order = preferBack ? [...backList, ...otherList] : [...otherList, ...backList];
  if (preferredDeviceId && order.includes(preferredDeviceId)) {
    order = [preferredDeviceId, ...order.filter((x) => x !== preferredDeviceId)];
  }

  const instance = new Html5Qrcode(el.id);
  let resolved = false;
  let lastError = null;
  let currentIndex = -1;

  const tryStartAt = async (idx) => {
    const id = order[idx];
    
    try {
      // Ensure container is ready and clean up any existing video stream
      let video = el.querySelector('video');
      if (!video) {
        video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', 'true');
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        el.appendChild(video);
        
      }
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => {
          try {
            track.stop();
            
          } catch (e) {
            
          }
        });
        video.srcObject = null;
        video.pause();
      }
      await new Promise(r => setTimeout(r, 100)); // Small delay to avoid conflicts
      await instance.start(
        { deviceId: { exact: id } },
        { fps: 10, qrbox: 250, aspectRatio: 1.0 },
        async (decodedText) => {
          if (resolved) return;
          resolved = true;
          try {
            await handleDecoded(decodedText);
          } finally {
            try {
              await instance.stop();
              
            } catch (e) {
              
            }
            try {
              await instance.clear();
              
            } catch (e) {
              
            }
            if (video && video.srcObject) {
              video.srcObject.getTracks().forEach(track => {
                try {
                  track.stop();
                  
                } catch (e) {
                  
                }
              });
              video.srcObject = null;
              video.pause();
            }
            el.innerHTML = ''; // Clear container after decode
          }
        },
        () => {}
      );
      await new Promise(r => setTimeout(r, 500));
      video = el.querySelector('video'); // Reuse the video variable
      if (video) {
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.muted = true;
        const p = video.play?.();
        if (p && typeof p.catch === 'function') {
          p.catch(e => console.error('Video play failed:', e));
        }
      }
      const playing = video && video.readyState >= 2 && (video.videoWidth || 0) > 0;
      if (!playing) {
        
        throw new Error('Camera started but no frames');
      }
      
      currentIndex = idx;
    } catch (e) {
      
      throw e;
    }
  };

  try {
    for (let i = 0; i < order.length; i++) {
      try {
        await tryStartAt(i);
        const controller = {
          async stop() {
            try {
              await instance.stop();
              
            } catch (e) {
              
            }
            const video = el.querySelector('video');
            if (video && video.srcObject) {
              video.srcObject.getTracks().forEach(track => {
                try {
                  track.stop();
                  
                } catch (e) {
                  
                }
              });
              video.srcObject = null;
              video.pause();
            }
            el.innerHTML = ''; // Clear container on stop
            
          },
          async clear() {
            try {
              await instance.clear();
              
            } catch (e) {
              
            }
            el.innerHTML = ''; // Clear container on clear
          },
          async switchToNext() {
            const next = (currentIndex + 1) % order.length;
            try {
              await instance.stop();
              await instance.clear();
              const video = el.querySelector('video');
              if (video && video.srcObject) {
                video.srcObject.getTracks().forEach(track => {
                  try {
                    track.stop();
                    
                  } catch (e) {
                    
                  }
                });
                video.srcObject = null;
                video.pause();
              }
              el.innerHTML = ''; // Clear container before switching
            } catch {}
            await tryStartAt(next);
          },
          async switchToDevice(deviceId) {
            const idx = order.indexOf(deviceId);
            if (idx === -1) return;
            try {
              await instance.stop();
              await instance.clear();
              const video = el.querySelector('video');
              if (video && video.srcObject) {
                video.srcObject.getTracks().forEach(track => {
                  try {
                    track.stop();
                    
                  } catch (e) {
                    
                  }
                });
                video.srcObject = null;
                video.pause();
              }
              el.innerHTML = ''; // Clear container before switching
            } catch {}
            await tryStartAt(idx);
          },
          instance,
          get currentDeviceId() {
            return order[currentIndex];
          },
          get cameras() {
            return order.slice();
          },
          get devices() {
            return cameras.slice();
          },
        };
        el._qrflowCtrl = controller;
        return controller;
      } catch (e) {
        lastError = e;
        continue;
      }
    }
  } finally {
    el.dataset.isStarting = 'false'; // Reset starting flag
  }

  throw lastError || new Error('Unable to start any available camera');
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
          const showOverlay = () => { try { overlay.style.display = ''; overlay.classList.remove('hidden'); } catch {} }; const hideOverlay = () => { try { overlay.classList.add('hidden'); overlay.style.display = 'none'; } catch {} }; showOverlay();
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
          if (cancelBtn2) { cancelBtn2.onclick = () => { try { overlay.classList.add('hidden'); overlay.style.display='none'; } catch {} }; }
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

