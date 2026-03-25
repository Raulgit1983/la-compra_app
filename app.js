import { localCatalog } from './catalog.js';

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";

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

// Enable offline persistence to keep the app ultra-fast
enableIndexedDbPersistence(db).catch((err) => {
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
  try {
    await setDoc(doc(db, "prices", code), {
      name,
      price,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`Guardado en Firebase: ${name} a ${price}€`);
  } catch (error) {
    console.error("Error guardando en Firebase:", error);
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
  // 1. PRECIO COMUNITARIO (Firebase Firestore)
  try {
    const docRef = doc(db, "prices", code);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (Number.isFinite(data.price)) {
        return { name: data.name, price: data.price, code, source: 'comunidad' };
      }
    }
  } catch (error) {
    console.error("Error consultando Firebase:", error);
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
        <p class="small">${item.source || 'fuente no indicada'}</p>
      </div>
      <div>
        <strong>${Number.isFinite(item.price) ? formatMoney(item.price) : 'Precio pendiente'}</strong>
        <button class="btn ghost" data-remove="${index}">Quitar</button>
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
      <label>
        <input type="checkbox" data-check="${index}" ${item.done ? 'checked' : ''} />
        Listo
      </label>
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

  setFeedback('Analizando imagen para detectar precio…');
  const result = await window.Tesseract.recognize(file, 'eng+spa');
  const text = result?.data?.text || '';
  const candidates = text.match(/\d{1,3}[\.,]\d{2}/g) || [];

  if (!candidates.length) { setFeedback('No detecté precio claro en la imagen.'); return; }

  const parsed = candidates
    .map((v) => Number(v.replace('.', '').replace(',', '.')))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (!parsed.length) { setFeedback('No detecté un precio válido tras OCR.'); return; }

  dom.manualPrice.value = parsed[0].toFixed(2);
  setFeedback(`Precio detectado: ${formatMoney(parsed[0])}. Revísalo antes de guardar.`);
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
}

// ─── Arranque ─────────────────────────────────────────────────
renderBasket();
renderPlan();
wireEvents();
