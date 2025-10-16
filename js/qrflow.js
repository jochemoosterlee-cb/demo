// Lightweight browser module for QR-based portal/mobile flows.
// Responsibilities:
// - Session lifecycle in Firebase at sessions/{qrId}
// - QR rendering (requires global QRCode from qrcodejs)
// - Scanning helper (requires global Html5Qrcode from html5-qrcode)
// Texts/UX remain in pages; this module exposes only primitives + callbacks.

export class QrFlow {
  static async init({ databaseURL }) {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getDatabase, ref, set, onValue, get, child } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js');
    const app = initializeApp({ databaseURL });
    const db = getDatabase(app);
    return new QrFlow(app, db, { ref, set, onValue, get, child });
  }

  constructor(app, db, api) {
    this.app = app;
    this.db = db;
    this.api = api;
  }

  // --- Session management ---
  async createSession(qrId) {
    const id = qrId || Date.now().toString();
    const { ref, set } = this.api;
    await set(ref(this.db, `sessions/${id}`), {
      scanned: false,
      completed: false,
      createdAt: Date.now(),
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
  async startScanner({ elementId, onDecode, preferBackCamera = true, fps = 10, qrbox = 250, aspectRatio = 1.0 }) {
    if (typeof Html5Qrcode === 'undefined') throw new Error('Html5Qrcode not loaded');
    const el = document.getElementById(elementId);
    if (!el) throw new Error(`Scanner element #${elementId} not found`);

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) throw new Error('No cameras found');

    let deviceId = cameras[0].id;
    if (preferBackCamera) {
      const back = cameras.find(c => /back|rear|environment/i.test(c.label));
      if (back) deviceId = back.id;
    }

    const instance = new Html5Qrcode(elementId);
    let resolved = false;
    await instance.start(
      { deviceId: { exact: deviceId } },
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

    return {
      async stop() { try { await instance.stop(); } catch {} },
      async clear() { try { await instance.clear(); } catch {} },
      instance,
    };
  }
}

