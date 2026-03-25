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
  catalog: {
    '8410188012345': { name: 'Leche semidesnatada', price: 1.14 },
    '8437000456123': { name: 'Pan integral', price: 1.45 },
    '8480000123456': { name: 'Arroz redondo 1kg', price: 1.8 },
    '5000159484695': { name: 'Cereal avena', price: 2.95 },
  },
};

const hasBarcodeAPI = 'BarcodeDetector' in window;
const detector = hasBarcodeAPI
  ? new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
    })
  : null;

function setFeedback(message) {
  dom.scanFeedback.textContent = message;
}

function formatMoney(value) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
}

function extractPriceFromUnknownPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const queue = [payload];
  while (queue.length) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (current && typeof current === 'object') {
      const knownCandidates = [
        current.price,
        current.price_value,
        current.amount,
        current.value,
      ];

      for (const candidate of knownCandidates) {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0) {
          return Number(numeric.toFixed(2));
        }
      }

      queue.push(...Object.values(current));
    }
  }

  return null;
}

async function getLiveProductInfo(code) {
  const fallbackCatalog = state.catalog[code];
  let name = fallbackCatalog?.name || `Producto ${code}`;
  let price = Number.isFinite(fallbackCatalog?.price) ? fallbackCatalog.price : null;

  try {
    const offResponse = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
    );

    if (offResponse.ok) {
      const offData = await offResponse.json();
      name = offData?.product?.product_name || offData?.product?.generic_name || name;
    }
  } catch (error) {
    console.warn('No pude consultar Open Food Facts para nombre', error);
  }

  if (price !== null) {
    return { name, price, code, source: 'catálogo local' };
  }

  const possiblePriceEndpoints = [
    `https://prices.openfoodfacts.org/api/v1/prices?product_code=${encodeURIComponent(code)}`,
    `https://prices.openfoodfacts.org/api/v1/prices?barcode=${encodeURIComponent(code)}`,
    `https://prices.openfoodfacts.org/api/v1/products/${encodeURIComponent(code)}/prices`,
  ];

  for (const endpoint of possiblePriceEndpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        continue;
      }

      const payload = await response.json();
      const livePrice = extractPriceFromUnknownPayload(payload);
      if (livePrice !== null) {
        return { name, price: livePrice, code, source: 'precio online' };
      }
    } catch (error) {
      console.warn('Error consultando precio online', endpoint, error);
    }
  }

  return { name, price: null, code, source: 'sin precio detectado' };
}

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

  const total = state.basket.reduce((acc, item) => acc + (Number.isFinite(item.price) ? item.price : 0), 0);
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
}

async function applyScanResult(code) {
  if (!code || code === state.lastCode) {
    return;
  }

  state.lastCode = code;
  setFeedback(`Código detectado: ${code}. Buscando nombre y precio real…`);

  const product = await getLiveProductInfo(code);
  addBasketItem(product);

  if (product.price === null) {
    dom.manualName.value = product.name;
    dom.manualCode.value = code;
    dom.manualDialog.showModal();
    setFeedback('No encontré precio online. Puedes capturar etiqueta para OCR o escribir precio.');
  } else {
    setFeedback(`Añadido: ${product.name} (${formatMoney(product.price)} · ${product.source}).`);
  }

  setTimeout(() => {
    state.lastCode = null;
  }, 1300);
}

async function scanWithBarcodeDetector() {
  if (!state.stream || !detector) {
    return;
  }

  try {
    const barcodes = await detector.detect(dom.cameraView);
    if (!barcodes.length) {
      return;
    }

    const code = barcodes[0].rawValue;
    await applyScanResult(code);
  } catch (error) {
    console.error('No se pudo escanear con BarcodeDetector', error);
  }
}

function scanWithQuagga() {
  if (!window.Quagga || !state.stream) {
    return;
  }

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
      if (code) {
        await applyScanResult(code);
      }
    },
  );
}

async function scanOnce() {
  if (hasBarcodeAPI) {
    await scanWithBarcodeDetector();
    return;
  }

  scanWithQuagga();
}

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
    dom.cameraState.textContent = hasBarcodeAPI ? 'Escaneando…' : 'Escaneando (modo iPhone compatible)…';
    dom.cameraState.classList.remove('off');
    dom.cameraState.classList.add('on');
    dom.toggleCameraBtn.textContent = 'Apagar cámara';

    setFeedback(
      hasBarcodeAPI
        ? 'Escáner nativo activo.'
        : 'Escáner alternativo activo (Quagga) para navegadores sin BarcodeDetector.',
    );

    state.scanTimer = setInterval(scanOnce, hasBarcodeAPI ? 1000 : 1400);
  } catch (error) {
    alert('No pude abrir la cámara. Comprueba permisos.');
    console.error(error);
  }
}

function stopCamera() {
  if (state.scanTimer) {
    clearInterval(state.scanTimer);
    state.scanTimer = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  dom.cameraView.srcObject = null;
  dom.cameraView.style.display = 'none';
  document.querySelector('.scan-line').style.display = 'none';
  dom.cameraState.textContent = 'Cámara apagada';
  dom.cameraState.classList.remove('on');
  dom.cameraState.classList.add('off');
  dom.toggleCameraBtn.textContent = 'Activar cámara';
  setFeedback('Cámara detenida.');
}

async function extractPriceFromImage(file) {
  if (!window.Tesseract) {
    setFeedback('OCR no disponible en este navegador.');
    return;
  }

  setFeedback('Analizando imagen para detectar precio…');
  const result = await window.Tesseract.recognize(file, 'eng+spa');
  const text = result?.data?.text || '';
  const candidates = text.match(/\d{1,3}[\.,]\d{2}/g) || [];
  if (!candidates.length) {
    setFeedback('No detecté precio claro en la imagen.');
    return;
  }

  const parsed = candidates
    .map((value) => Number(value.replace('.', '').replace(',', '.')))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!parsed.length) {
    setFeedback('No detecté un precio válido tras OCR.');
    return;
  }

  dom.manualPrice.value = parsed[0].toFixed(2);
  setFeedback(`Precio detectado por imagen: ${formatMoney(parsed[0])}. Revísalo antes de guardar.`);
}

function wireEvents() {
  dom.toggleCameraBtn.addEventListener('click', () => {
    if (state.stream) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  dom.scanOnceBtn.addEventListener('click', async () => {
    if (!state.stream) {
      await startCamera();
    }

    await scanOnce();
  });

  dom.manualBtn.addEventListener('click', () => dom.manualDialog.showModal());
  dom.closeManual.addEventListener('click', () => dom.manualDialog.close());

  dom.priceFromImageBtn.addEventListener('click', () => {
    dom.receiptInput.click();
  });

  dom.receiptInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await extractPriceFromImage(file);
    dom.receiptInput.value = '';
  });

  dom.manualForm.addEventListener('submit', (event) => {
    event.preventDefault();

    addBasketItem({
      name: dom.manualName.value.trim(),
      price: Number(dom.manualPrice.value),
      code: dom.manualCode.value.trim() || null,
      source: 'manual / OCR',
    });

    dom.manualForm.reset();
    dom.manualDialog.close();
  });

  dom.basketList.addEventListener('click', (event) => {
    const index = event.target.dataset.remove;
    if (index === undefined) {
      return;
    }

    state.basket.splice(Number(index), 1);
    renderBasket();
  });

  dom.budgetInput.addEventListener('input', () => {
    const total = state.basket.reduce((acc, item) => acc + (Number.isFinite(item.price) ? item.price : 0), 0);
    updateBudgetStatus(total);
  });

  dom.planForm.addEventListener('submit', (event) => {
    event.preventDefault();
    state.plan.unshift({
      name: dom.planName.value.trim(),
      qty: Number(dom.planQty.value),
      done: false,
    });
    dom.planForm.reset();
    dom.planQty.value = '1';
    renderPlan();
  });

  dom.planList.addEventListener('change', (event) => {
    const index = event.target.dataset.check;
    if (index === undefined) {
      return;
    }

    state.plan[Number(index)].done = event.target.checked;
    renderPlan();
  });
}

renderBasket();
renderPlan();
wireEvents();
