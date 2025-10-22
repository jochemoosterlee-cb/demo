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

  async createSession(qrId, { ttlMs = 10 * 60 * 1000 } = {}) {
    const id = qrId || Date.now().toString();
    const { ref, set, serverTimestamp } = this.api;
    const expiresAt = Date.now() + (Number(ttlMs) || 0);
    await set(ref(this.db, `sessions/${id}`), {
      scanned: false,
      completed: false,
      createdAt: serverTimestamp(),
      expiresAt: expiresAt || null,
      status: { scannedAt: null, completedAt: null },
    });
    return { id };
  }

  async markScanned(qrId) {
    const { ref, set, serverTimestamp } = this.api;
    await set(ref(this.db, `sessions/${qrId}/scanned`), true);
    await set(ref(this.db, `sessions/${qrId}/status/scannedAt`), serverTimestamp());
  }

  async markCompleted(qrId) {
    const { ref, set, serverTimestamp } = this.api;
    await set(ref(this.db, `sessions/${qrId}/completed`), true);
    await set(ref(this.db, `sessions/${qrId}/status/completedAt`), serverTimestamp());
  }

  async deleteSession(qrId) {
    const { ref, remove } = this.api;
    await remove(ref(this.db, `sessions/${qrId}`));
  }

  async setSessionInfo(qrId, { intent, kind, type } = {}) {
    const { ref, set } = this.api;
    try { if (kind != null) await set(ref(this.db, `sessions/${qrId}/kind`), kind); } catch {}
    try { if (intent != null) await set(ref(this.db, `sessions/${qrId}/intent`), intent); } catch {}
    try { if (type != null) await set(ref(this.db, `sessions/${qrId}/type`), type); } catch {}
  }

  async setMeta(qrId, meta) { return this.setOffer(qrId, meta); }
  async setOffer(qrId, offer) {
    const { ref, set } = this.api;
    const payload = offer && offer.payload ? offer.payload : (offer || {});
    const normalized = { type: offer?.type || '', issuer: offer?.issuer || '', payload, version: offer?.version || 1 };
    await set(ref(this.db, `sessions/${qrId}/offer`), normalized);
    // Also store quick-identifiers at session root for fast intent detection
    try {
      await set(ref(this.db, `sessions/${qrId}/kind`), 'offer');
      // If no explicit intent provided, treat as issuing a card
      await set(ref(this.db, `sessions/${qrId}/intent`), offer?.intent || 'issue_card');
    } catch {}
  }

  async setRequest(qrId, request) {
    const { ref, set } = this.api;
    const normalized = {
      intent: request?.intent || '',
      type: request?.type || '',
      scope: request?.scope || undefined,
      reason: request?.reason || undefined,
      version: request?.version || 1,
    };
    await set(ref(this.db, `sessions/${qrId}/request`), normalized);
    // Also store quick-identifiers at session root for fast intent detection
    try {
      await set(ref(this.db, `sessions/${qrId}/kind`), 'request');
      await set(ref(this.db, `sessions/${qrId}/intent`), normalized.intent || '');
    } catch {}
  }

  async setShared(qrId, shared) {
    const { ref, set } = this.api;
    const payload = shared && shared.payload ? shared.payload : (shared || {});
    const normalized = { type: shared?.type || '', issuer: shared?.issuer || '', payload, version: shared?.version || 1 };
    await set(ref(this.db, `sessions/${qrId}/shared`), normalized);
    // Also write to response for new structure
    const outcome = shared && shared.error === 'not_found' ? 'not_found' : 'ok';
    const resp = outcome === 'ok'
      ? { outcome: 'ok', type: normalized.type, issuer: normalized.issuer, payload: normalized.payload, version: normalized.version }
      : { outcome: 'not_found', requestedType: (shared && shared.requestedType) || normalized.type || '', version: normalized.version };
    await set(ref(this.db, `sessions/${qrId}/response`), resp);
  }

  async getMeta(qrId) { return this.getOffer(qrId); }
  async getOffer(qrId) {
    const { ref, get } = this.api;
    let snap = await get(ref(this.db, `sessions/${qrId}/offer`));
    let val = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    if (val) return val;
    snap = await get(ref(this.db, `sessions/${qrId}/meta`));
    val = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    return val;
  }

  async getRequest(qrId) {
    const { ref, get } = this.api;
    const snap = await get(ref(this.db, `sessions/${qrId}/request`));
    const val = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    return val;
  }

  async getShared(qrId) {
    const { ref, get } = this.api;
    let snap = await get(ref(this.db, `sessions/${qrId}/response`));
    let val = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    if (val) return val;
    snap = await get(ref(this.db, `sessions/${qrId}/shared`));
    val = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    return val;
  }

  async getIntent(qrId) {
    const { ref, get } = this.api;
    try {
      const snap = await get(ref(this.db, `sessions/${qrId}/intent`));
      const v = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
      return typeof v === 'string' ? v : '';
    } catch { return ''; }
  }

  async getKind(qrId) {
    const { ref, get } = this.api;
    try {
      const snap = await get(ref(this.db, `sessions/${qrId}/kind`));
      const v = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
      return typeof v === 'string' ? v : '';
    } catch { return ''; }
  }

  async getType(qrId) {
    const { ref, get } = this.api;
    try {
      const snap = await get(ref(this.db, `sessions/${qrId}/type`));
      const v = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
      return typeof v === 'string' ? v : '';
    } catch { return ''; }
  }

  async setResponse(qrId, response) {
    const { ref, set } = this.api;
    const normalized = {
      outcome: response?.outcome || 'ok',
      type: response?.type || '',
      issuer: response?.issuer || '',
      payload: response?.payload || {},
      requestedType: response?.requestedType || undefined,
      selectedFields: response?.selectedFields || undefined,
      version: response?.version || 1,
    };
    await set(ref(this.db, `sessions/${qrId}/response`), normalized);
  }

  async getResponse(qrId) {
    const { ref, get } = this.api;
    const snap = await get(ref(this.db, `sessions/${qrId}/response`));
    const val = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    return val;
  }

  async sessionExists(qrId) {
    const { ref, get } = this.api;
    const snap = await get(ref(this.db, `sessions/${qrId}`));
    try { if (typeof snap.exists === 'function') return snap.exists(); } catch {}
    const v = snap && typeof snap.val === 'function' ? snap.val() : (snap ? snap.val : null);
    return v != null;
  }

  onScanned(qrId, callback) {
    const { ref, onValue } = this.api;
    const rNew = ref(this.db, `sessions/${qrId}/status/scannedAt`);
    const unsubNew = onValue(rNew, (snap) => { if (snap.val()) callback(true); });
    const rOld = ref(this.db, `sessions/${qrId}/scanned`);
    const unsubOld = onValue(rOld, (snap) => { if (snap.val() === true) callback(true); });
    return () => { try { unsubNew(); } catch {} try { unsubOld(); } catch {} };
  }

  onCompleted(qrId, callback) {
    const { ref, onValue } = this.api;
    const rNew = ref(this.db, `sessions/${qrId}/status/completedAt`);
    const unsubNew = onValue(rNew, (snap) => { if (snap.val()) callback(true); });
    const rOld = ref(this.db, `sessions/${qrId}/completed`);
    const unsubOld = onValue(rOld, (snap) => { if (snap.val() === true) callback(true); });
    return () => { try { unsubNew(); } catch {} try { unsubOld(); } catch {} };
  }

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

  async startScanner({ elementId, onDecode, preferBackCamera = true, fps = 10, qrbox = 250, aspectRatio = 1.0, onCameraSelected, preferredDeviceId } = {}) {
    if (typeof Html5Qrcode === 'undefined') throw new Error('Html5Qrcode not loaded');
    const el = document.getElementById(elementId);
    if (!el) throw new Error(`Scanner element #${elementId} not found`);

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) throw new Error('No cameras found');

    const isBack = (c) => /back|rear|environment/i.test(c.label || '');
    const backList = cameras.filter(isBack).map(c => c.id);
    const otherList = cameras.filter(c => !isBack(c)).map(c => c.id);
    let order = preferBackCamera ? [...backList, ...otherList] : [...otherList, ...backList];
    if (preferredDeviceId && order.includes(preferredDeviceId)) {
      order = [preferredDeviceId, ...order.filter((x) => x !== preferredDeviceId)];
    }

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
      try {
        if (video) {
          video.setAttribute('playsinline', '');
          video.setAttribute('autoplay', '');
          video.muted = true;
          const p = video.play?.();
          if (p && typeof p.catch === 'function') { p.catch(() => {}); }
        }
      } catch {}
      const playing = video && video.readyState >= 2 && (video.videoWidth || 0) > 0;
      if (!playing) {
        try { await instance.stop(); } catch {}
        try { await instance.clear(); } catch {}
        throw new Error('Camera started but no frames');
      }
      currentIndex = idx;
    };

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
          async switchToDevice(deviceId) {
            const idx = order.indexOf(deviceId);
            if (idx === -1) return;
            try { await instance.stop(); } catch {}
            try { await instance.clear(); } catch {}
            await tryStartAt(idx);
          },
          instance,
          get currentDeviceId() { return order[currentIndex]; },
          get cameras() { return order.slice(); },
          get devices() { return cameras.slice(); },
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
