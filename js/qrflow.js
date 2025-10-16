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
  renderQr({ container, text, size = 192, colorDark = '#000000', colorLight = '#FFFFFF' }) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) throw new Error('QR container not found');
    if (typeof QRCode === 'undefined') throw new Error('QRCode library not loaded');
    el.innerHTML = '';
    return new QRCode(el, { text, width: size, height: size, colorDark, colorLight });
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
