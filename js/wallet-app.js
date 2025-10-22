import { QrFlow } from './qrflow.js';

let flowInstance = null;
async function flow() {
  if (!flowInstance) {
    flowInstance = await QrFlow.init({
      databaseURL: 'https://demoapp-6cc2a-default-rtdb.europe-west1.firebasedatabase.app/'
    });
  }
  return flowInstance;
}

const VIEWS = ['landing', 'scan', 'wallet', 'share', 'done'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const stateKey = 'walletState';
const settingsKey = 'walletSettings';
function loadState() { try { return JSON.parse(localStorage.getItem(stateKey)) || { cards: [] }; } catch { return { cards: [] }; } }
function saveState(s) { try { localStorage.setItem(stateKey, JSON.stringify(s)); } catch {} }
function loadSettings() { try { return JSON.parse(localStorage.getItem(settingsKey)) || { hideSeedPrompt: false }; } catch { return { hideSeedPrompt: false }; } }
function saveSettings(s) { try { localStorage.setItem(settingsKey, JSON.stringify(s)); } catch {} }

let state = loadState();
let settings = loadSettings();
const pendingMeta = new Map();
let uiSchema = {};
let pendingShare = null; // { id, meta, card }

async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) { return null; }
}


function addCardFromSession(id, metaOverride) {
  const meta = metaOverride || { type: 'INKOMEN', issuer: 'Belastingdienst', payload: {} };
  const cType = canonicalType(meta.type || '');
  const now = Date.now();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const card = {
    id: `${cType}-${now}`,
    type: cType,
    issuer: meta.issuer,
    issuedAt: now,
    expiresAt: now + oneYear,
    expanded: false,
    payload: meta.payload,
  };
  state.cards.push(card);
  saveState(state);
  renderCards();
}

function formatDate(ts) {
  if (!ts) return '';
  try { const d = new Date(ts); const dd = String(d.getDate()).padStart(2,'0'); const mm = String(d.getMonth()+1).padStart(2,'0'); const yyyy = d.getFullYear(); return `${dd}-${mm}-${yyyy}`; } catch { return ''; }
}
function formatDateTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const HH = String(d.getHours()).padStart(2, '0');
    const MM = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yyyy} ${HH}:${MM}`;
  } catch { return ''; }
}
function formatCurrencyEUR(val) {
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.,-]/g,'').replace(',','.'));
  if (!isFinite(n)) return '';
  try { return new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n); } catch { return `€ ${Math.round(n).toLocaleString('nl-NL')}`; }
}
function computeStatus(card) { const now = Date.now(); return card.expiresAt && card.expiresAt < now ? 'verlopen' : 'geldig'; }

function renderDetailsFromSchema(type, payload) {
  const schema = uiSchema && uiSchema[type];
  if (!schema) {
    const frag = document.createElement('div');
    frag.className = 'mt-2 grid grid-cols-1 gap-1 font-inter text-sm';
    Object.entries(payload || {}).forEach(([k, v]) => {
      const row = document.createElement('div');
      row.innerHTML = `<strong>${k}</strong>: ${Array.isArray(v) ? v.join(', ') : (typeof v === 'object' ? JSON.stringify(v) : String(v))}`;
      frag.appendChild(row);
    });
    return frag;
  }
  const order = schema.order || Object.keys(payload || {});
  const labels = schema.labels || {};
  const format = schema.format || {};
  const frag = document.createElement('div');
  frag.className = 'mt-2 grid grid-cols-1 gap-1 font-inter text-sm';
  order.forEach((key) => {
    const raw = payload ? payload[key] : undefined;
    let val = raw;
    const fmt = format[key];
    if (fmt === 'date') {
      if (typeof raw === 'string') { try { val = formatDate(new Date(raw).getTime()); } catch { val = raw; } }
      else if (typeof raw === 'number') { val = formatDate(raw); }
    } else if (fmt === 'boolean') {
      val = raw ? 'ja' : 'nee';
    } else if (fmt === 'eur') {
      val = formatCurrencyEUR(raw);
    } else if (Array.isArray(raw)) {
      val = raw.join(', ');
    } else if (typeof raw === 'object' && raw != null) {
      val = JSON.stringify(raw);
    }
    const row = document.createElement('div');
    row.innerHTML = `<strong>${labels[key] || key}</strong>: ${val ?? ''}`;
    frag.appendChild(row);
  });
  return frag;
}

function migrateState() {
  try {
    if (!state || !Array.isArray(state.cards)) return;
    state.cards.forEach((c) => {
      if (!c || !c.payload) return;
      // Normalize type values for robustness
      c.type = canonicalType(c.type || '');
      if (c.type === 'PID') {
        const p = c.payload;
        if (p.name && !p.given_name && !p.family_name) {
          const parts = String(p.name).trim().split(/\s+/);
          if (parts.length > 1) {
            p.given_name = parts.slice(0, -1).join(' ');
            p.family_name = parts[parts.length - 1];
          } else {
            p.given_name = parts[0];
          }
        }
        if (p.birth && !p.birth_date) p.birth_date = p.birth;
        if (typeof p.age_over_18 === 'undefined') {
          try {
            const ts = Date.parse(p.birth_date || p.birth || '');
            if (!isNaN(ts)) {
              const ageYears = (Date.now() - ts) / (365.25*24*60*60*1000);
              p.age_over_18 = ageYears >= 18;
            }
          } catch {}
        }
      }
      const toTs = (v) => {
        if (!v) return undefined;
        if (typeof v === 'number') return v;
        const t = Date.parse(v);
        return isNaN(t) ? undefined : t;
      };
      c.issuedAt = toTs(c.issuedAt) || c.issuedAt;
      c.expiresAt = toTs(c.expiresAt) || c.expiresAt;
    });
    saveState(state);
  } catch {}
}

function clearWallet() {
  state = { cards: [] };
  saveState(state);
  try { settings.hideSeedPrompt = false; saveSettings(settings); } catch {}
  renderCards();
}

function seedFromTemplates() {
  loadJson('./data/cards-seed.json').then((seed) => {
    const now = Date.now();
    const toTs = (v) => { if (!v) return undefined; if (typeof v === 'number') return v; const t = Date.parse(v); return isNaN(t) ? undefined : t; };
    const sel = Array.isArray(seed?.cards) ? seed.cards.filter(c => c && c.type === 'PID') : [];
    const mapped = sel.map((c, i) => ({
      id: c.id || `${c.type}-${now + i}`,
      type: c.type,
      issuer: c.issuer || '',
      issuedAt: toTs(c.issuedAt),
      expiresAt: toTs(c.expiresAt),
      expanded: false,
      payload: c.payload || {},
    }));
    if (mapped.length === 0) {
      console.warn('Geen PID seed gevonden in ./data/cards-seed.json');
      return;
    }
    state.cards = [...(state.cards || []), ...mapped];
    try { settings.hideSeedPrompt = true; saveSettings(settings); } catch {}
    saveState(state);
    renderCards();
  });
}

function renderCards() {
  const list = $('#cardsList');
  if (!list) return;
  list.innerHTML = '';
  if (state.cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bg-cardBg border border-dashed border-gray-300 rounded-xl p-6 text-center';
    if (settings.hideSeedPrompt) {
      empty.innerHTML = `
        <p class="font-inter text-sm text-gray-700 mb-3">De wallet is leeg.</p>
        <p class="font-inter text-xs text-gray-600">Scan een QR of plak een code om een kaartje toe te voegen.</p>`;
      list.appendChild(empty);
    } else {
      empty.innerHTML = `
        <p class="font-inter text-sm text-gray-700 mb-3">De wallet is leeg.</p>
        <p class="font-inter text-sm text-gray-700">Wil je de wallet vullen met PID?</p>
        <div class="mt-4 flex items-center justify-center gap-3">
          <button id="seedWalletBtn" class="px-4 py-2 rounded-md text-sm font-inter bg-brandBlue text-white hover:bg-brandBlueHover">Ja, vul met PID</button>
          <button id="skipSeedBtn" class="px-4 py-2 rounded-md text-sm font-inter bg-white border border-gray-300 text-textDark">Nee</button>
        </div>
        <p class="font-inter text-xs text-gray-600 mt-3">Je kunt ook altijd een QR scannen.</p>`;
      list.appendChild(empty);
      const yes = empty.querySelector('#seedWalletBtn');
      const no = empty.querySelector('#skipSeedBtn');
      yes?.addEventListener('click', (e) => { e.currentTarget.disabled = true; seedFromTemplates(); });
      no?.addEventListener('click', () => { settings.hideSeedPrompt = true; saveSettings(settings); renderCards(); });
    }
    return;
  }
  state.cards.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'bg-cardBg rounded-xl p-4 border border-gray-200 flex flex-col gap-3';

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between gap-4';
    const title = document.createElement('div');
    title.innerHTML = `<div class=\"font-headland text-lg\">${c.type}</div><div class=\"font-inter text-sm text-gray-700\">${c.issuer}</div>`;
    const leftWrap = document.createElement('div');
    leftWrap.className = 'flex items-center gap-3';
    leftWrap.appendChild(title);
    const statusNow = computeStatus(c);
    const badge = document.createElement('span');
    if (statusNow === 'geldig') {
      badge.className = 'font-inter text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800';
    } else {
      badge.className = 'font-inter text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800';
    }
    badge.textContent = statusNow;
    leftWrap.appendChild(badge);
    header.appendChild(leftWrap);
    el.appendChild(header);

    const details = document.createElement('div');
    details.className = c.expanded ? 'block' : 'hidden';
    const status = computeStatus(c); const statusCls = status === 'geldig' ? 'text-green-700' : 'text-red-700';
    const metaRows = document.createElement('div');
    metaRows.className = 'mt-1 grid grid-cols-1 gap-1 font-inter text-sm';
    metaRows.innerHTML = `
      <div><strong>Uitgegeven</strong>: ${formatDateTime(c.issuedAt)}</div>
      <div><strong>Verloopt</strong>: ${formatDateTime(c.expiresAt)}</div>
    `;
    details.appendChild(metaRows);
    details.appendChild(renderDetailsFromSchema(c.type, c.payload || {}));
    const actionsRow = document.createElement('div');
    actionsRow.className = 'mt-3 flex items-center gap-2';
    const renewBtn = document.createElement('button');
    renewBtn.className = 'px-3 py-1 rounded-md text-sm font-inter bg-white border border-gray-300 text-textDark hover:bg-brandBlue hover:text-white';
    renewBtn.textContent = 'Vernieuwen';
    renewBtn.addEventListener('click', (e) => { e.stopPropagation(); const now = Date.now(); const oneYear = 365*24*60*60*1000; c.issuedAt = now; c.expiresAt = now + oneYear; saveState(state); renderCards(); });
    const removeBtn = document.createElement('button');
    removeBtn.className = 'px-3 py-1 rounded-md text-sm font-inter bg-white border border-gray-300 text-textDark hover:bg-red-600 hover:text-white';
    removeBtn.textContent = 'Verwijder';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.cards = state.cards.filter((x) => x.id !== c.id);
      if (state.cards.length === 0) { try { settings.hideSeedPrompt = true; saveSettings(settings); } catch {} }
      saveState(state);
      renderCards();
    });
    actionsRow.appendChild(renewBtn);
    actionsRow.appendChild(removeBtn);
    details.appendChild(actionsRow);
    el.appendChild(details);

    el.addEventListener('click', () => { c.expanded = !c.expanded; saveState(state); renderCards(); });

    list.appendChild(el);
  });
}

async function confirmWithPin(pinValue = '12345') {
  return new Promise((resolve) => {
    try {
      const overlay = document.getElementById('pinOverlay');
      const dots = overlay?.querySelectorAll('#pinDots > span');
      const keys = overlay?.querySelectorAll('.pin-key');
      const backBtn = overlay?.querySelector('#pinBack');
      const cancelBtn = overlay?.querySelector('#pinCancel');
      const err = overlay?.querySelector('#pinError');
      if (!overlay || !dots || !keys || !err) { resolve(true); return; }

      let value = '';
      const PIN = (pinValue || '12345').toString();
      const renderDots = () => {
        dots.forEach((d, i) => {
          d.className = i < value.length
            ? 'w-3 h-3 rounded-full bg-textDark inline-block'
            : 'w-3 h-3 rounded-full border border-textDark/40 inline-block';
        });
      };
      const clearErr = () => { try { err.textContent = ''; err.classList.add('invisible'); err.classList.remove('hidden'); } catch {} };
      const showErr = (m) => { try { err.textContent = m; err.classList.remove('invisible'); } catch {} };
      const showOverlay = () => { try { overlay.style.display = ''; overlay.classList.remove('hidden'); } catch {} };
      const hideOverlay = () => { try { overlay.classList.add('hidden'); overlay.style.display = 'none'; } catch {} };

      const cleanup = () => {
        try { keys.forEach((k) => k.removeEventListener('click', onKey)); } catch {}
        try { backBtn && backBtn.removeEventListener('click', onBack); } catch {}
        try { cancelBtn && cancelBtn.removeEventListener('click', onCancel); } catch {}
        try { window.removeEventListener('keydown', onKeydown); } catch {}
      };

      const trySubmit = () => {
        if (value.length !== PIN.length) return;
        if (value !== PIN) {
          value = '';
          renderDots();
          showErr('Onjuiste PIN. Probeer opnieuw.');
          return;
        }
        clearErr();
        cleanup();
        hideOverlay();
        resolve(true);
      };

      const onKey = (e) => {
        const t = e.currentTarget;
        if (!(t instanceof Element)) return;
        const d = t.getAttribute('data-digit');
        if (!d) return;
        clearErr();
        if (value.length >= PIN.length) return;
        value += d;
        renderDots();
        if (value.length === PIN.length) trySubmit();
      };
      const onBack = (e) => { e?.preventDefault?.(); clearErr(); value = value.slice(0, -1); renderDots(); };
      const onCancel = (e) => { e?.preventDefault?.(); cleanup(); hideOverlay(); resolve(false); };
      const onKeydown = (e) => {
        if (/^[0-9]$/.test(e.key)) {
          if (value.length < PIN.length) {
            value += e.key;
            renderDots();
            if (value.length === PIN.length) trySubmit();
          }
          e.preventDefault();
        } else if (e.key === 'Backspace') {
          value = value.slice(0, -1);
          renderDots();
          e.preventDefault();
        }
      };

      keys.forEach((k) => k.addEventListener('click', onKey));
      backBtn && backBtn.addEventListener('click', onBack);
      cancelBtn && cancelBtn.addEventListener('click', onCancel);
      window.addEventListener('keydown', onKeydown, { once: false });

      clearErr();
      renderDots();
      showOverlay();
    } catch {
      resolve(true);
    }
  });
}

function renderShareView() {
  const info = document.getElementById('shareInfo');
  const details = document.getElementById('shareDetails');
  const err = document.getElementById('shareError');
  const btn = document.getElementById('shareConfirm');
  const cancel = document.getElementById('shareCancel');
  if (!info || !details || !btn || !err) return;
  info.textContent = '';
  details.innerHTML = '';
  err.textContent = '';
  if (!pendingShare || !pendingShare.card) {
    info.textContent = 'Geen passend kaartje in de wallet gevonden voor dit verzoek.';
    try { btn.style.display = 'none'; } catch {}
    if (cancel) { cancel.textContent = 'Verder'; cancel.style.display = ''; }
    // Notify portal that nothing was found (once)
    if (pendingShare && !pendingShare._reported) {
      pendingShare._reported = true;
      (async () => {
        try {
          const f = await flow();
          let reqType = (pendingShare.meta?.type || '').toString().toUpperCase().trim();
          if (!reqType) { try { const rt = await f.getType(pendingShare.id); if (rt) reqType = String(rt).toUpperCase().trim(); } catch {} }
          await f.setShared(pendingShare.id, { error: 'not_found', requestedType: reqType, version: 1 });
          await f.setResponse(pendingShare.id, { outcome: 'not_found', requestedType: reqType, version: 1 });
          await f.markCompleted(pendingShare.id);
          try { sessionStorage.setItem('lastAction', 'shared_none'); } catch {}
          try { window.location.hash = '#/done'; } catch {}
        } catch {}
      })();
    }
    return;
  }
  const { meta, card } = pendingShare;
  const labelMap = { PID: 'PID', INKOMEN: 'Inkomensverklaring' };
  const title = labelMap[card.type] || card.type;
  info.textContent = `Je staat op het punt je ${title} te delen met het portaal.`;
  const block = renderDetailsFromSchema(card.type, card.payload || {});
  details.appendChild(block);
  try { btn.style.display = ''; } catch {}
  if (cancel) { cancel.textContent = 'Annuleren'; cancel.style.display = ''; }
  btn.onclick = async () => {
    btn.disabled = true;
    const ok = await confirmWithPin('12345');
    if (!ok) { btn.disabled = false; return; }
    try {
      const f = await flow();
      await f.setShared(pendingShare.id, { type: card.type, issuer: card.issuer, payload: card.payload, version: 1 });
      await f.setResponse(pendingShare.id, { outcome: 'ok', type: card.type, issuer: card.issuer, payload: card.payload, version: 1 });
      await f.markCompleted(pendingShare.id);
    } catch {}
    try { sessionStorage.setItem('lastAction', 'shared'); } catch {}
    try { window.location.hash = '#/done'; } catch {}
  };
}

function showView(name) {
  VIEWS.forEach(v => {
    const s = document.querySelector(`[data-view="${v}"]`);
    if (!s) return;
    if (v === name) { s.classList.remove('hidden'); } else { s.classList.add('hidden'); }
  });
}

function currentRoute() { const h = location.hash.replace(/^#\/?/, '').trim(); return h || 'wallet'; }

let doneTimer = null;
async function onRouteChange() {
  const route = currentRoute();
  console.log('Route changed to:', route);
  const scanView = document.querySelector('[data-view="scan"]');
  if (route !== 'scan') {
    console.log('Stopping scanner for non-scan route...');
    const scanner = scanView?.querySelector('[data-qrflow="scanner"]');
    if (scanner) {
      const ctrl = scanner._qrflowCtrl;
      if (ctrl && typeof ctrl.stop === 'function') {
        try {
          await ctrl.stop();
          console.log('Scanner stopped successfully.');
        } catch (e) {
          console.error('Failed to stop scanner:', e);
        }
        try {
          await ctrl.clear();
          console.log('Scanner cleared successfully.');
        } catch (e) {
          console.error('Failed to clear scanner:', e);
        }
        delete scanner._qrflowCtrl;
      } else {
        console.warn('No scanner controller found, attempting manual cleanup...');
      }
      const video = scanView?.querySelector('video');
      if (video && video.srcObject) {
        console.log('Manually stopping video stream...');
        video.srcObject.getTracks().forEach(track => {
          try {
            track.stop();
            console.log('Video track stopped:', track.kind);
          } catch (e) {
            console.error('Failed to stop track:', e);
          }
        });
        video.srcObject = null;
        video.pause();
      }
      const container = scanView?.querySelector('#reader');
      if (container) {
        container.innerHTML = '';
        console.log('Scanner container cleared.');
      }
    }
  }
  showView(route); try { const ov = document.getElementById('pinOverlay'); if (ov) { ov.classList.add('hidden'); ov.style.display='none'; } } catch {}
  if (doneTimer) {
    try {
      clearTimeout(doneTimer);
    } catch {}
    doneTimer = null;
  }
  if (route === 'done') {
    try {
      const el = document.getElementById('doneTitle');
      const icon = document.getElementById('doneIcon');
      const last = sessionStorage.getItem('lastAction') || '';
      if (el) {
        if (last === 'shared') el.textContent = 'Gegevens gedeeld';
        else if (last === 'shared_none') el.textContent = 'Niet gedeeld';
        else el.textContent = 'Kaartje toegevoegd';
      }
      if (icon) {
        const success = (last === 'shared' || last === 'added');
        icon.style.display = success ? '' : 'none';
      }
    } catch {}
    doneTimer = setTimeout(() => {
      try {
        window.location.replace('#/wallet');
      } catch {
        window.location.hash = '#/wallet';
      }
    }, 1000);
  }
  if (route === 'share') {
    renderShareView();
  }
  if (route === 'scan') {
    // Reset manual input and any previous error/session state
    try {
      const input = document.getElementById('manualCode');
      if (input) input.value = '';
    } catch {}
    try {
      const err = document.getElementById('scanError');
      if (err) err.textContent = '';
    } catch {}
    try { sessionStorage.removeItem('lastAction'); } catch {}
    try {
      const scanner = scanView?.querySelector('[data-qrflow="scanner"]');
      if (scanner) {
        delete scanner.dataset.sessionId;
        if (scanner._qrflowCtrl) {
          try { await scanner._qrflowCtrl.stop?.(); } catch {}
          try { await scanner._qrflowCtrl.clear?.(); } catch {}
          delete scanner._qrflowCtrl;
        }
        const container = scanView?.querySelector('#reader');
        if (container) container.innerHTML = '';
      }
    } catch {}
  }
}

function attachScanHandlers() {
  const scanners = Array.from(document.querySelectorAll('[data-qrflow="scanner"]'));
  if (scanners.length === 0) return;
  scanners.forEach((scanner) => {
    scanner.addEventListener('qrflow:scanned', async (e) => {
      const id = (scanner.getAttribute('data-session-id') || (e.detail && e.detail.id) || '').toString();
      if (!id) return;
      try {
        const f = await flow();
        // Fast path: check root intent
        let intent = '';
        try { intent = String(await f.getIntent(id) || '').toLowerCase(); } catch {}
        // Fallback to meta detection if needed
        let meta = null;
        const ensureMeta = async () => {
          let m = await f.getRequest(id);
          if (!m) m = await f.getOffer(id);
          return m;
        };
        // Always attempt to have meta ready for both flows (especially add-card)
        meta = await ensureMeta();
        if (!meta) {
          for (let i = 0; i < 10 && !meta; i++) {
            await new Promise(r => setTimeout(r, 200));
            try { meta = await ensureMeta(); } catch {}
          }
        }
        if (meta) pendingMeta.set(id, meta);
        if (!intent) {
          intent = (meta && (meta.intent || (meta.payload && meta.payload.intent))) ? String(meta.intent || meta.payload.intent).toLowerCase() : '';
        }
        if (intent === 'use_card') {
          let reqType = '';
          try {
            const m = pendingMeta.get(id) || (await f.getRequest(id)) || null;
            reqType = (m && m.type) ? String(m.type).toUpperCase().trim() : '';
            if (!reqType) {
              const rootType = await f.getType(id);
              if (rootType) reqType = String(rootType).toUpperCase().trim();
            }
            if (!meta) meta = m;
          } catch {}
          const normalize = (s) => (s == null ? '' : String(s).toUpperCase().trim());
          let found = state.cards.find(c => normalize(c.type) === reqType) || null;
          // Fallbacks: detect by known payload keys if type missing or no match
          const hasIncome = (c) => c && c.payload && (('nl_bld_bri_year' in (c.payload||{})) || ('nl_bld_bri_income' in (c.payload||{})));
          if (!found && (reqType === 'INKOMEN' || reqType === '')) {
            found = state.cards.find(hasIncome) || found;
          }
          if (!found && reqType === '' && state.cards.length === 1) {
            // As a last resort, if there is exactly one card, offer it
            found = state.cards[0];
          }
          pendingShare = { id, meta, card: found };
          try { window.location.hash = '#/share'; } catch {}
          renderShareView();
        }
      } catch {}
    });
    scanner.addEventListener('qrflow:completed', async (e) => {
      const id = (scanner.getAttribute('data-session-id') || (e.detail && e.detail.id) || '').toString();
      if (!id) return;
      const f = await flow();
      // Check request first to see if this was a 'use_card' flow; if so, don't add a card.
      try {
        let intentReq = '';
        try { intentReq = String(await f.getIntent(id) || '').toLowerCase(); } catch {}
        if (!intentReq) {
          const req = await f.getRequest(id);
          intentReq = (req && req.intent) ? String(req.intent).toLowerCase() : '';
        }
        if (intentReq === 'use_card') return;
      } catch {}

      // Otherwise treat as add-card flow. Prefer the latest offer from DB.
      let offer = null;
      try { offer = await f.getOffer(id); } catch {}
      let m = offer || pendingMeta.get(id) || null;
      if (!m) return; // nothing meaningful to add
      const type = (m && m.type) ? String(m.type).toUpperCase() : 'INKOMEN';
      const issuer = (m && m.issuer) || 'Onbekend';
      const payload = (m && m.payload) || {};
      addCardFromSession(id, { type, issuer, payload });
      try { sessionStorage.setItem('lastAction', 'added'); } catch {}
    });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  loadJson('./data/card-ui.json').then((s) => { uiSchema = s || {}; renderCards(); });
  migrateState();
  renderCards();
  attachScanHandlers();
  window.addEventListener('hashchange', () => { onRouteChange(); });
  onRouteChange();

  const title = document.getElementById('appTitle');
  if (title) {
    let clicks = 0; let timer = null;
    title.addEventListener('click', () => {
      clicks++;
      if (!timer) { timer = setTimeout(() => { clicks = 0; timer = null; }, 800); }
      if (clicks >= 3) { clicks = 0; clearTimeout(timer); timer = null; clearWallet(); }
    });
  }

  try {
    const hash = location.hash || '';
    if (/clear=1/i.test(hash)) { clearWallet(); location.hash = '#/wallet'; }
  } catch {}
});
function canonicalType(t) {
  const s = (t == null ? '' : String(t)).trim().toUpperCase();
  if (s === 'INKOMENSVERKLARING' || s === 'INCOME' || s === 'INKOMENSCHECK') return 'INKOMEN';
  if (s === 'PERSON_ID' || s === 'IDENTITEIT' || s === 'ID') return 'PID';
  return s;
}
