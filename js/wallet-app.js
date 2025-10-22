// Simple SPA router + wallet state and rendering

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

const VIEWS = ['landing', 'scan', 'wallet', 'done'];
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const stateKey = 'walletState';
const settingsKey = 'walletSettings';
function loadState() { try { return JSON.parse(localStorage.getItem(stateKey)) || { cards: [] }; } catch { return { cards: [] }; } }
function saveState(s) { try { localStorage.setItem(stateKey, JSON.stringify(s)); } catch {} }
// First run: show the seed prompt (hideSeedPrompt=false)
function loadSettings() { try { return JSON.parse(localStorage.getItem(settingsKey)) || { hideSeedPrompt: false }; } catch { return { hideSeedPrompt: false }; } }
function saveSettings(s) { try { localStorage.setItem(settingsKey, JSON.stringify(s)); } catch {} }

let state = loadState();
let settings = loadSettings();
const pendingMeta = new Map();
let uiSchema = {};

async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) { return null; }
}


function addCardFromSession(id, metaOverride) {
  const meta = metaOverride || { type: 'INKOMEN', issuer: 'Belastingdienst', payload: {} };
  const now = Date.now();
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const card = {
    id: `${meta.type}-${now}`,
    type: meta.type,
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
      if (c.type === 'PID') {
        const p = c.payload;
        // Migrate old fields to new schema keys
        if (p.name && !p.given_name && !p.family_name) {
          // naive split: first token as given_name, rest as family_name
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
          // derive simple majority flag if possible
          try {
            const ts = Date.parse(p.birth_date || p.birth || '');
            if (!isNaN(ts)) {
              const ageYears = (Date.now() - ts) / (365.25*24*60*60*1000);
              p.age_over_18 = ageYears >= 18;
            }
          } catch {}
        }
      }
      // Normalize issuedAt/expiresAt to timestamps
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
  // Use the wallet's cards-seed.json as the source for PID & BSN seed
  loadJson('./data/cards-seed.json').then((seed) => {
    const now = Date.now();
    const toTs = (v) => { if (!v) return undefined; if (typeof v === 'number') return v; const t = Date.parse(v); return isNaN(t) ? undefined : t; };
    const sel = Array.isArray(seed?.cards) ? seed.cards.filter(c => c && (c.type === 'PID' || c.type === 'BSN')) : [];
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
      console.warn('Geen PID/BSN seed gevonden in ./data/cards-seed.json');
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
        <p class="font-inter text-sm text-gray-700">Wil je de wallet vullen met PID & BSN?</p>
        <div class="mt-4 flex items-center justify-center gap-3">
          <button id="seedWalletBtn" class="px-4 py-2 rounded-md text-sm font-inter bg-brandBlue text-white hover:bg-brandBlueHover">Ja, vul met PID & BSN</button>
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
    // Status badge on the card (outside details)
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
    // Standard meta rows inside details
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
      // Als de wallet leeg wordt door verwijderen, toon de seed-vraag NIET automatisch
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
  console.log('Route changed to:', route); // Debug
  const scanView = document.querySelector('[data-view="scan"]');
  if (route !== 'scan') {
    console.log('Stopping scanner for non-scan route...'); // Debug
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
        delete scanner._qrflowCtrl; // Verwijder controller referentie
      } else {
        console.warn('No scanner controller found, attempting manual cleanup...');
      }
      // Extra: Handmatig video-stream opruimen
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
      // Extra: Container leegmaken
      const container = scanView?.querySelector('#reader');
      if (container) {
        container.innerHTML = '';
        console.log('Scanner container cleared.');
      }
    }
  }
  showView(route);
  if (doneTimer) {
    try {
      clearTimeout(doneTimer);
    } catch {}
    doneTimer = null;
  }
  if (route === 'done') {
    doneTimer = setTimeout(() => {
      try {
        window.location.replace('#/wallet');
      } catch {
        window.location.hash = '#/wallet';
      }
    }, 1000);
  }
}

function attachScanHandlers() {
  const scanners = Array.from(document.querySelectorAll('[data-qrflow="scanner"]'));
  if (scanners.length === 0) return;
  scanners.forEach((scanner) => {
    scanner.addEventListener('qrflow:scanned', async (e) => {
      const id = (scanner.getAttribute('data-session-id') || (e.detail && e.detail.id) || '').toString();
      if (!id) return;
      try { const f = await flow(); const meta = await f.getOffer(id); if (meta) pendingMeta.set(id, meta); } catch {}
    });
    scanner.addEventListener('qrflow:completed', (e) => {
      const id = (scanner.getAttribute('data-session-id') || (e.detail && e.detail.id) || '').toString();
      if (!id) return;
      const m = pendingMeta.get(id) || null;
      const type = (m && m.type) ? String(m.type).toUpperCase() : 'INKOMEN';
      const issuer = (m && m.issuer) || 'Onbekend';
      const payload = (m && m.payload) || {};
      addCardFromSession(id, { type, issuer, payload });
    });
  });
}

// No automatic seeding; offer a prompt in renderCards()

window.addEventListener('DOMContentLoaded', () => {
  // Load UI schema first; fallback to empty
  loadJson('./data/card-ui.json').then((s) => { uiSchema = s || {}; renderCards(); });
  migrateState();
  renderCards();
  attachScanHandlers();
  window.addEventListener('hashchange', () => { onRouteChange(); });
  onRouteChange();

  // Hidden reset: triple-click on title
  const title = document.getElementById('appTitle');
  if (title) {
    let clicks = 0; let timer = null;
    title.addEventListener('click', () => {
      clicks++;
      if (!timer) { timer = setTimeout(() => { clicks = 0; timer = null; }, 800); }
      if (clicks >= 3) { clicks = 0; clearTimeout(timer); timer = null; clearWallet(); }
    });
  }

  // Clear via hash query (#/wallet?clear=1)
  try {
    const hash = location.hash || '';
    if (/clear=1/i.test(hash)) { clearWallet(); location.hash = '#/wallet'; }
  } catch {}
});
