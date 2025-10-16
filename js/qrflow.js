// Lightweight browser module for QR-based portal/mobile flows.
// Responsibilities:
// - Session lifecycle in Firebase at sessions/{qrId}
// - QR rendering (requires global QRCode from qrcodejs)
// - Scanning helper (requires global Html5Qrcode from html5-qrcode)
// Texts/UX remain in pages; this module exposes only primitives + callbacks.

export class QrFlow {
  static async init({ databaseURL }) {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getDatabase, ref, set, onValue, get, child, remove, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
    const app = initializeApp({ databaseURL });
    const db = getDatabase(app);
    return new QrFlow(app, db, { ref, set, onValue, get, child, remove, serverTimestamp });
  }

  constructor(app, db, api) {
    this.app = app;
    this.db = db;
    this.api = api;
  }

  // --- Session management ---
  async createSession(qrId) {
    const id = qrId || Date.now().toString();
    const { ref, set, serverTimestamp } = this.api;
    await set(ref(this.db, `sessions/${id}`), {
      scanned: false,
      completed: false,
      createdAt: serverTimestamp(),
    });
    return { id };
  }

  async markScanned(qrId) {
    const { ref, set } = this.api;
    await set(ref(this.db, `sessions/${qrId}/scanned`), true);
  }

  async markCompleted(qrId) {
    const { ref, set } = this.api;
    await set(ref(this.db, `sessions/${qrId}/completed`), true);
  }

  async deleteSession(qrId) {
    const { ref, remove } = this.api;
    await remove(ref(this.db, `sessions/${qrId}`));
  }

  onScanned(qrId, callback) {
    const { ref, onValue } = this.api;
    const r = ref(this.db, `sessions/${qrId}/scanned`);
    return onValue(r, (snap) => { if (snap.val() === true) callback(true); });
  }

  onCompleted(qrId, callback) {
    const { ref, onValue } = this.api;
    const r = ref(this.db, `sessions/${qrId}/completed`);
    return onValue(r, (snap) => { if (snap.val() === true) callback(true); });
  }

  // --- QR rendering ---
  // Supports size/width/height, colors, error correction level, quiet zone padding, and optional center logo overlay.
  // correctLevel: one of 'L','M','Q','H' (defaults to 'M').
  renderQr({
    container,
    text,
    size = 192,
    width,
    height,
    colorDark = '#000000',
    colorLight = '#FFFFFF',
    correctLevel = 'M',
    quietZone = 0,
    logoSrc,
    logoSizeRatio = 0.2,
  }) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) throw new Error('QR container not found');
    if (typeof QRCode === 'undefined') throw new Error('QRCode library not loaded');
    el.innerHTML = '';

    const w = Number.isFinite(width) ? Number(width) : size;
    const h = Number.isFinite(height) ? Number(height) : size;

    // Wrapper to support quiet zone and overlay logo
    const wrapper = document.createElement('div');
    wrapper.style.display = 'inline-block';
    wrapper.style.position = 'relative';
    if (quietZone > 0) {
      wrapper.style.padding = `${quietZone}px`;
      wrapper.style.background = colorLight;
      wrapper.style.borderRadius = '8px';
    }
    el.appendChild(wrapper);

    const target = document.createElement('div');
    target.style.width = `${w}px`;
    target.style.height = `${h}px`;
    wrapper.appendChild(target);

    const levelMap = (typeof QRCode !== 'undefined' && QRCode.CorrectLevel)
      ? {
          L: QRCode.CorrectLevel.L,
          M: QRCode.CorrectLevel.M,
          Q: QRCode.CorrectLevel.Q,
          H: QRCode.CorrectLevel.H,
        }
      : null;

    const opts = {
      text,
      width: w,
      height: h,
      colorDark,
      colorLight,
    };
    if (levelMap && levelMap[String(correctLevel).toUpperCase()]) {
      opts.correctLevel = levelMap[String(correctLevel).toUpperCase()];
    }

    const instance = new QRCode(target, opts);

    if (logoSrc) {
      const img = document.createElement('img');
      img.src = logoSrc;
      img.alt = '';
      img.style.position = 'absolute';
      img.style.left = '50%';
      img.style.top = '50%';
      img.style.transform = 'translate(-50%, -50%)';
      const logoSize = Math.round(Math.min(w, h) * (logoSizeRatio > 0 && logoSizeRatio < 1 ? logoSizeRatio : 0.2));
      img.style.width = `${logoSize}px`;
      img.style.height = `${logoSize}px`;
      img.style.borderRadius = '8px';
      img.style.background = colorLight;
      img.style.padding = '4px';
      wrapper.appendChild(img);
    }

    return instance;
  }

  // --- Scanning helper ---
  async startScanner({ elementId, onDecode, preferBackCamera = true, fps = 10, qrbox = 250, aspectRatio = 1.0, onCameraSelected } = {}) {
    if (typeof Html5Qrcode === 'undefined') throw new Error('Html5Qrcode not loaded');
    const el = document.getElementById(elementId);
    if (!el) throw new Error(`Scanner element #${elementId} not found`);

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) throw new Error('No cameras found');

    // Build an ordered list of deviceIds to try
    const isBack = (c) => /back|rear|environment/i.test(c.label || '');
    const backList = cameras.filter(isBack).map(c => c.id);
    const otherList = cameras.filter(c => !isBack(c)).map(c => c.id);
    const order = preferBackCamera ? [...backList, ...otherList] : [...otherList, ...backList];

    const instance = new Html5Qrcode(elementId);
    let resolved = false;
    let lastError = null;
    let currentIndex = -1;

    const tryStartAt = async (idx) => {
      const id = order[idx];
      onCameraSelected && onCameraSelected(id);
      await instance.start(
        { deviceId: { exact: id } },
        { fps, qrbox, aspectRatio },
        async (decodedText) => {
          if (resolved) return;
          resolved = true;
          try { await onDecode?.(decodedText); } finally {
            try { await instance.stop(); } catch {}
            try { await instance.clear(); } catch {}
          }
        },
        () => { /* ignore frequent decode errors */ }
      );
      await new Promise(r => setTimeout(r, 500));
      const container = document.getElementById(elementId);
      const video = container?.querySelector('video');
      const playing = video && video.readyState >= 2 && (video.videoWidth || 0) > 0;
      if (!playing) {
        try { await instance.stop(); } catch {}
        try { await instance.clear(); } catch {}
        throw new Error('Camera started but no frames');
      }
      currentIndex = idx;
    };

    // Attempt to start with each camera until success
    for (let i = 0; i < order.length; i++) {
      try {
        await tryStartAt(i);
        const controller = {
          async stop() { try { await instance.stop(); } catch {} },
          async clear() { try { await instance.clear(); } catch {} },
          async switchToNext() {
            const next = (currentIndex + 1) % order.length;
            try { await instance.stop(); } catch {}
            try { await instance.clear(); } catch {}
            await tryStartAt(next);
          },
          instance,
          get currentDeviceId() { return order[currentIndex]; },
          get cameras() { return order.slice(); },
        };
        return controller;
      } catch (e) {
        lastError = e;
        continue;
      }
    }

    throw lastError || new Error('Unable to start any available camera');
  }
}
