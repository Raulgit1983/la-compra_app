import { localCatalog } from './catalog.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, enableMultiTabIndexedDbPersistence, onSnapshot, query, collection, orderBy, limit, addDoc, serverTimestamp, getDocs, where } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJa3P-HMm94anM-BQoOgtRKNvTy6sq7H8",
  authDomain: "la-compra-2ea28.firebaseapp.com",
  projectId: "la-compra-2ea28",
  storageBucket: "la-compra-2ea28.firebasestorage.app",
  messagingSenderId: "544507120104",
  appId: "1:544507120104:web:637f85c45e3b7fb45e7c5d",
  measurementId: "G-4L0JBTDN74"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Authentication Bootstrap
signInAnonymously(auth).catch((error) => {
  console.warn("Firebase Auth falló de forma silenciosa:", error.message);
});

// Enable offline persistence with multi-tab support
enableMultiTabIndexedDbPersistence(db).catch((err) => {
  console.warn("No se pudo habilitar offline persistence", err);
});


const dom = {
  cameraView: document.getElementById('cameraView'),
  cameraState: document.getElementById('cameraState'),
  scanFeedback: document.getElementById('scanFeedback'),
  toggleCameraBtn: document.getElementById('toggleCameraBtn'),
  scanOnceBtn: document.getElementById('scanOnceBtn'),
  manualBtn: document.getElementById('manualBtn'),
  manualDialog: document.getElementById('manualDialog'),
  closeManual: document.getElementById('closeManual'),
  manualForm: document.getElementById('manualForm'),
  manualName: document.getElementById('manualName'),
  manualPrice: document.getElementById('manualPrice'),
  manualCode: document.getElementById('manualCode'),
  manualStore: document.getElementById('manualStore'),
  storeSuggestions: document.getElementById('storeSuggestions'),
  priceFromImageBtn: document.getElementById('priceFromImageBtn'),
  receiptInput: document.getElementById('receiptInput'),
  basketList: document.getElementById('basketList'),
  basketTotal: document.getElementById('basketTotal'),
  budgetInput: document.getElementById('budgetInput'),
  budgetProgress: document.getElementById('budgetProgress'),
  budgetStatus: document.getElementById('budgetStatus'),
  planForm: document.getElementById('planForm'),
  planName: document.getElementById('planName'),
  planQty: document.getElementById('planQty'),
  planList: document.getElementById('planList'),
  communityList: document.getElementById('communityList'),
};

const state = {
  stream: null,
  scanTimer: null,
  basket: [],
  plan: [],
  lastCode: null,
  catalog: { ...localCatalog },
};

async function saveLearnedProduct(code, name, price) {
  if (!code) return;
  const storeText = dom.manualStore ? dom.manualStore.value.trim() : '';
  const userId = auth.currentUser ? auth.currentUser.uid : 'anonymous';
  try {
    // Phase A: Write to append-only priceReports instead of overwriting "prices"
    await addDoc(collection(db, "priceReports"), {
      code,
      name,
      price,
      storeText,
      userId,
      createdAt: serverTimestamp()
    });
    console.log(`Reportado de forma segura en Firebase: ${name} a ${price}€ en ${storeText}`);
  } catch (error) {
    console.error("Error reportando en Firebase:", error);
  }
}


const hasBarcodeAPI = 'BarcodeDetector' in window;
const detector = hasBarcodeAPI
  ? new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] })
  : null;

// ─── Utilidades ───────────────────────────────────────────────

function setFeedback(message) {
  dom.scanFeedback.textContent = message;
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
}

function extractPriceFromUnknownPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const queue = [payload];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) { queue.push(...current); continue; }
    if (current && typeof current === 'object') {
      const candidates = [current.price, current.price_value, current.amount, current.value];
      for (const candidate of candidates) {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0) return Number(numeric.toFixed(2));
      }
      queue.push(...Object.values(current));
    }
  }
  return null;
}

// ─── Consulta online y fallback local/aprendido ───────────────────────

async function getLiveProductInfo(code) {
  // 1. PRECIO COMUNITARIO (NUEVO: priceReports ledger)
  try {
    const qReports = query(collection(db, "priceReports"), where("code", "==", code), orderBy("createdAt", "desc"), limit(1));
    const snapReports = await getDocs(qReports);
    if (!snapReports.empty) {
      const data = snapReports.docs[0].data();
      if (Number.isFinite(data.price)) {
        return { name: data.name, price: data.price, code, store: data.storeText || null, source: 'comunidad (reciente)' };
      }
    }
  } catch (error) {
    console.error("Error consultando priceReports:", error);
  }

  // 1.5 PRECIO COMUNITARIO LEGACY (Fallback a colección prices antigua)
  try {
    const docRef = doc(db, "prices", code);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (Number.isFinite(data.price)) {
        return { name: data.name, price: data.price, code, store: data.store || null, source: 'comunidad (legacy)' };
      }
    }
  } catch (error) {
    console.error("Error consultando prices (legacy):", error);
  }

  // 2. CATÁLOGO LOCAL (Fallback)
  const fallback = state.catalog[code];
  let name = fallback?.name || `Producto ${code}`;
  let price = Number.isFinite(fallback?.price) ? fallback.price : null;

  if (price !== null) {
    return { name, price, code, source: 'catálogo local' };
  }

  // 3. OPEN FOOD FACTS (Solo para el NOMBRE, ya que queremos que el usuario fije el precio si no existe)
  try {
    const offResponse = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`
    );
    if (offResponse.ok) {
      const offData = await offResponse.json();
      name = offData?.product?.product_name || offData?.product?.generic_name || name;
    }
  } catch (error) {
    console.warn('No pude consultar Open Food Facts para nombre', error);
  }

  // Si llegamos aquí, no tenemos precio seguro, así que devolvemos null para forzar que el usuario lo introduzca.
  return { name, price: null, code, source: 'nuevo (requiere precio)' };
}

// ─── Render ───────────────────────────────────────────────────

function renderBasket() {
  dom.basketList.innerHTML = '';

  state.basket.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'basket-item';
    li.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <p class="small">${item.code ? `Código: ${item.code}` : 'Añadido manualmente'}</p>
        <p class="small">${item.source} ${item.store ? `(📍 ${item.store})` : ''}</p>
      </div>
      <div>
        <strong>${Number.isFinite(item.price) ? formatMoney(item.price) : 'Precio pendiente'}</strong>
        <button class="btn ghost danger" data-remove="${index}" style="padding: 6px 10px; margin-left: 8px;">✕</button>
      </div>
    `;
    dom.basketList.append(li);
  });

  // FIX: una sola declaración de total, usando Number.isFinite para evitar NaN
  const total = state.basket.reduce(
    (acc, item) => acc + (Number.isFinite(item.price) ? item.price : 0),
    0
  );
  dom.basketTotal.textContent = formatMoney(total);
  updateBudgetStatus(total);
}

function renderPlan() {
  dom.planList.innerHTML = '';

  state.plan.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <p class="small">Cantidad: ${item.qty}</p>
      </div>
      <div style="display:flex; gap:12px; align-items:center;">
        <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
          <input type="checkbox" data-check="${index}" ${item.done ? 'checked' : ''} style="width:18px;height:18px;margin:0" />
          <span class="small">Listo</span>
        </label>
        <button type="button" class="btn ghost danger" data-remove-plan="${index}" style="padding: 10px 14px; font-weight: 800; font-size: 1.1rem; border-radius:12px; flex-shrink:0;">✕</button>
      </div>
    `;
    dom.planList.append(li);
  });
}

function updateBudgetStatus(total) {
  const budget = Number(dom.budgetInput.value || 0);
  const ratio = budget > 0 ? Math.min(100, (total / budget) * 100) : 0;
  dom.budgetProgress.style.width = `${ratio}%`;

  if (budget === 0) {
    dom.budgetStatus.textContent = 'Define un presupuesto para recibir alertas.';
    dom.budgetProgress.style.background = 'linear-gradient(90deg, var(--warn), #fbc02d)';
    return;
  }

  if (total > budget) {
    dom.budgetStatus.textContent = `Te has pasado ${formatMoney(total - budget)}.`;
    dom.budgetProgress.style.background = 'linear-gradient(90deg, var(--bad), #f0625f)';
  } else if (total > budget * 0.8) {
    dom.budgetStatus.textContent = 'Ojo: vas cerca del límite.';
    dom.budgetProgress.style.background = 'linear-gradient(90deg, var(--warn), #fbc02d)';
  } else {
    dom.budgetStatus.textContent = 'Perfecto: vas dentro del presupuesto.';
    dom.budgetProgress.style.background = 'linear-gradient(90deg, var(--ok), #18c273)';
  }
}

function addBasketItem(item) {
  state.basket.unshift(item);
  renderBasket();

  // Auto-check plan list item if matches name
  const itemNameLower = item.name.toLowerCase();
  let planUpdated = false;
  state.plan.forEach(pItem => {
    if (!pItem.done) {
      const pNameLower = pItem.name.toLowerCase();
      // Simple substring test
      if (itemNameLower.includes(pNameLower) || pNameLower.includes(itemNameLower)) {
        pItem.done = true;
        planUpdated = true;
        setFeedback(`¡"${pItem.name}" marcado como conseguido en la lista!`);
      }
    }
  });
  if (planUpdated) renderPlan();
}

// ─── Escáner ──────────────────────────────────────────────────

async function applyScanResult(code) {
  if (!code || code === state.lastCode) return;

  state.lastCode = code;
  setFeedback(`Código detectado: ${code}. Buscando nombre y precio…`);

  const product = await getLiveProductInfo(code);
  addBasketItem(product);

  if (product.price === null) {
    dom.manualName.value = product.name;
    dom.manualCode.value = code;
    dom.manualDialog.showModal();
    setFeedback('No encontré precio online. Escribe el precio manualmente.');
  } else {
    setFeedback(`Añadido: ${product.name} (${formatMoney(product.price)} · ${product.source}).`);
  }

  setTimeout(() => { state.lastCode = null; }, 1300);
}

// FIX: una sola función scanWithBarcodeDetector, correctamente cerrada
async function scanWithBarcodeDetector() {
  if (!state.stream || !detector) return;
  try {
    const barcodes = await detector.detect(dom.cameraView);
    if (!barcodes.length) return;
    await applyScanResult(barcodes[0].rawValue);
  } catch (error) {
    console.error('Error con BarcodeDetector', error);
  }
}

function scanWithQuagga() {
  if (!window.Quagga || !state.stream) return;

  const canvas = document.createElement('canvas');
  canvas.width = dom.cameraView.videoWidth || 1280;
  canvas.height = dom.cameraView.videoHeight || 720;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(dom.cameraView, 0, 0, canvas.width, canvas.height);

  window.Quagga.decodeSingle(
    {
      src: canvas.toDataURL('image/jpeg', 0.85),
      numOfWorkers: 0,
      inputStream: { size: 1024 },
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader', 'code_128_reader'],
      },
      locate: true,
    },
    async (result) => {
      const code = result?.codeResult?.code;
      if (code) await applyScanResult(code);
    }
  );
}

// FIX: una sola función scanOnce, fuera de las demás
async function scanOnce() {
  if (hasBarcodeAPI) {
    await scanWithBarcodeDetector();
  } else {
    scanWithQuagga();
  }
}

// ─── Cámara ───────────────────────────────────────────────────

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Tu navegador no permite usar cámara desde esta página.');
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });

    dom.cameraView.srcObject = state.stream;
    dom.cameraView.style.display = 'block';
    document.querySelector('.scan-line').style.display = 'block';

    // FIX: un solo textContent y un solo setInterval
    dom.cameraState.textContent = hasBarcodeAPI ? 'Escaneando…' : 'Cámara activa';
    dom.cameraState.classList.replace('off', 'on');
    dom.toggleCameraBtn.textContent = 'Apagar cámara';

    setFeedback(
      hasBarcodeAPI
        ? 'Escáner nativo activo.'
        : 'Escáner alternativo activo (Quagga).'
    );

    state.scanTimer = setInterval(scanOnce, hasBarcodeAPI ? 1000 : 1400);
  } catch (error) {
    alert('No pude abrir la cámara. Comprueba los permisos.');
    console.error(error);
  }
}

function stopCamera() {
  if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; }
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }

  dom.cameraView.srcObject = null;
  dom.cameraView.style.display = 'none';
  document.querySelector('.scan-line').style.display = 'none';
  dom.cameraState.textContent = 'Cámara apagada';
  dom.cameraState.classList.replace('on', 'off');
  dom.toggleCameraBtn.textContent = 'Activar cámara';
  setFeedback('Cámara detenida.');
}

// ─── OCR ──────────────────────────────────────────────────────

async function extractPriceFromImage(file) {
  if (!window.Tesseract) { setFeedback('OCR no disponible en este navegador.'); return; }

  const btn = dom.priceFromImageBtn;
  const ogText = btn.textContent;
  btn.textContent = 'Analizando... (puede tardar)';
  btn.disabled = true;

  try {
    setFeedback('Analizando imagen para detectar precio…');
    const result = await window.Tesseract.recognize(file, 'eng+spa');
    const text = result?.data?.text || '';

    // Mejor RegEx para abarcar resultados sucios "1, 50" o "1 50"
    const candidates = text.match(/\d+[\., ]\d{2}/g) || [];

    if (!candidates.length) { setFeedback('No detecté precio claro en la imagen.'); return; }

    const parsed = candidates
      .map((v) => Number(v.replace(/ /g, '.').replace(',', '.')))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);

    if (!parsed.length) { setFeedback('No detecté un precio válido tras OCR.'); return; }

    dom.manualPrice.value = parsed[0].toFixed(2);
    setFeedback(`Precio detectado: ${formatMoney(parsed[0])}. Revísalo antes de guardar.`);
  } catch (err) {
    console.error("OCR Error", err);
    setFeedback('Hubo un error detectando texto en la imagen.');
  } finally {
    btn.textContent = ogText;
    btn.disabled = false;
  }
}

// ─── Autocompletado Geográfico (Nominatim) ─────────────────────────

let addressTimeout = null;

async function fetchAddressSuggestions(query) {
  if (!query || query.length < 3) {
    dom.storeSuggestions.hidden = true;
    return;
  }

  // Mostrar cargando
  dom.storeSuggestions.innerHTML = '<li class="small hint">Buscando...</li>';
  dom.storeSuggestions.hidden = false;

  try {
    // Buscar en España para más relevancia, aunque se puede quitar countrycodes
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=es&limit=5`;
    const res = await fetch(url);
    const data = await res.json();

    dom.storeSuggestions.innerHTML = '';

    if (!data.length) {
      dom.storeSuggestions.innerHTML = '<li class="small hint">No se encontraron resultados</li>';
      return;
    }

    data.forEach(place => {
      const li = document.createElement('li');
      // Dividimos el nombre principal de la dirección detallada
      const parts = place.display_name.split(', ');
      const name = parts[0];
      const details = parts.slice(1, 3).join(', '); // Localidad, región

      li.innerHTML = `<strong>${name}</strong><small>${details}</small>`;
      li.addEventListener('click', () => {
        dom.manualStore.value = `${name}, ${details}`;
        dom.storeSuggestions.hidden = true;
      });
      dom.storeSuggestions.appendChild(li);
    });
  } catch (error) {
    console.error("Error buscando ubicación:", error);
    dom.storeSuggestions.hidden = true;
  }
}

// ─── Eventos ──────────────────────────────────────────────────

function wireEvents() {
  dom.toggleCameraBtn.addEventListener('click', () => {
    state.stream ? stopCamera() : startCamera();
  });

  dom.scanOnceBtn.addEventListener('click', async () => {
    if (!state.stream) await startCamera();
    if (!hasBarcodeAPI) { dom.manualDialog.showModal(); return; }
    await scanOnce();
  });

  dom.manualBtn.addEventListener('click', () => dom.manualDialog.showModal());
  dom.closeManual.addEventListener('click', () => dom.manualDialog.close());

  dom.priceFromImageBtn.addEventListener('click', () => dom.receiptInput.click());

  dom.receiptInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await extractPriceFromImage(file);
    dom.receiptInput.value = '';
  });

  dom.manualForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const itemName = dom.manualName.value.trim();
    const itemPrice = Number(dom.manualPrice.value);
    const itemCode = dom.manualCode.value.trim() || null;

    if (itemCode) {
      saveLearnedProduct(itemCode, itemName, itemPrice);
    }

    addBasketItem({
      name: itemName,
      price: itemPrice,
      code: itemCode,
      source: 'manual / diario',
    });
    dom.manualForm.reset();
    dom.manualDialog.close();
  });

  dom.basketList.addEventListener('click', (e) => {
    const index = e.target.dataset.remove;
    if (index === undefined) return;
    state.basket.splice(Number(index), 1);
    renderBasket();
  });

  dom.budgetInput.addEventListener('input', () => {
    // FIX: una sola declaración de total
    const total = state.basket.reduce(
      (acc, item) => acc + (Number.isFinite(item.price) ? item.price : 0),
      0
    );
    updateBudgetStatus(total);
  });

  dom.planForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.plan.unshift({
      name: dom.planName.value.trim(),
      qty: Number(dom.planQty.value),
      done: false,
    });
    dom.planForm.reset();
    dom.planQty.value = '1';
    renderPlan();
  });

  dom.planList.addEventListener('change', (e) => {
    const index = e.target.dataset.check;
    if (index === undefined) return;
    state.plan[Number(index)].done = e.target.checked;
    renderPlan();
  });

  dom.planList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-plan]');
    if (!btn) return;
    const index = Number(btn.dataset.removePlan);
    state.plan.splice(index, 1);
    renderPlan();
  });

  // Listener para el buscador de supermercado
  if (dom.manualStore) {
    dom.manualStore.addEventListener('input', (e) => {
      clearTimeout(addressTimeout);
      const query = e.target.value.trim();
      if (query.length < 3) {
        dom.storeSuggestions.hidden = true;
        return;
      }
      addressTimeout = setTimeout(() => {
        fetchAddressSuggestions(query);
      }, 500); // 500ms debounce
    });

    // Ocultar si hacemos click fuera
    document.addEventListener('click', (e) => {
      if (!dom.manualStore.contains(e.target) && !dom.storeSuggestions.contains(e.target)) {
        dom.storeSuggestions.hidden = true;
      }
    });
  }
}

function initSocialFeed() {
  if (!dom.communityList) return;

  // Phase A: Listen to priceReports ledger instead of legacy prices collection
  const q = query(collection(db, "priceReports"), orderBy("createdAt", "desc"), limit(4)); // Max 4 for mobile compactness

  onSnapshot(q, (snapshot) => {
    dom.communityList.innerHTML = '';
    if (snapshot.empty) {
      dom.communityList.innerHTML = '<li class="small hint" style="padding:10px; list-style:none; text-align:center;">Aún no hay actividad reciente.</li>';
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const li = document.createElement('li');
      li.className = 'basket-item';
      li.innerHTML = `
        <div style="flex: 1;">
          <strong style="color: var(--primary);">${data.name}</strong>
          ${data.storeText ? `<p class="small hint" style="margin:2px 0 0">📍 ${data.storeText}</p>` : ''}
        </div>
        <div style="text-align: right;">
          <b style="font-size: 1.1rem;">${Number(data.price).toFixed(2)}€</b>
        </div>
      `;
      dom.communityList.appendChild(li);
    });
  }, (err) => {
    console.warn("Feed social no pudo cargar", err);
    dom.communityList.innerHTML = '<li class="small hint" style="padding:10px; list-style:none; text-align:center;">No se pudo conectar al radar.</li>';
  });
}

// ─── Arranque ─────────────────────────────────────────────────
renderBasket();
renderPlan();
wireEvents();
initSocialFeed();
