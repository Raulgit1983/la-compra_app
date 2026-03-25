const dom = {
  cameraView: document.getElementById('cameraView'),
  cameraState: document.getElementById('cameraState'),
  toggleCameraBtn: document.getElementById('toggleCameraBtn'),
  scanOnceBtn: document.getElementById('scanOnceBtn'),
  manualBtn: document.getElementById('manualBtn'),
  manualDialog: document.getElementById('manualDialog'),
  closeManual: document.getElementById('closeManual'),
  manualForm: document.getElementById('manualForm'),
  manualName: document.getElementById('manualName'),
  manualPrice: document.getElementById('manualPrice'),
  manualCode: document.getElementById('manualCode'),
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

function formatMoney(value) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(value);
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
      </div>
      <div>
        <strong>${formatMoney(item.price)}</strong>
        <button class="btn ghost" data-remove="${index}">Quitar</button>
      </div>
    `;
    dom.basketList.append(li);
  });

  const total = state.basket.reduce((acc, item) => acc + item.price, 0);
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

function getCatalogProduct(code) {
  const product = state.catalog[code];

  if (product) {
    return { ...product, code };
  }

  return {
    name: `Producto ${code.slice(-4)}`,
    code,
    price: Number((Math.random() * 4 + 0.8).toFixed(2)),
  };
}

async function scanOnce() {
  if (!state.stream || !detector) {
    return;
  }

  try {
    const barcodes = await detector.detect(dom.cameraView);

    if (!barcodes.length) {
      return;
    }

    const code = barcodes[0].rawValue;
    if (!code || code === state.lastCode) {
      return;
    }

    state.lastCode = code;
    const product = getCatalogProduct(code);
    addBasketItem(product);

    setTimeout(() => {
      state.lastCode = null;
    }, 1300);
  } catch (error) {
    console.error('No se pudo escanear', error);
  }
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
    dom.cameraState.textContent = hasBarcodeAPI ? 'Escaneando…' : 'Cámara activa';
    dom.cameraState.classList.remove('off');
    dom.cameraState.classList.add('on');
    dom.toggleCameraBtn.textContent = 'Apagar cámara';

    if (!hasBarcodeAPI) {
      dom.cameraState.textContent = 'Cámara activa (sin API de escaneo)';
      return;
    }

    state.scanTimer = setInterval(scanOnce, 1000);
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

    if (!hasBarcodeAPI) {
      dom.manualDialog.showModal();
      return;
    }

    await scanOnce();
  });

  dom.manualBtn.addEventListener('click', () => dom.manualDialog.showModal());
  dom.closeManual.addEventListener('click', () => dom.manualDialog.close());

  dom.manualForm.addEventListener('submit', (event) => {
    event.preventDefault();

    addBasketItem({
      name: dom.manualName.value.trim(),
      price: Number(dom.manualPrice.value),
      code: dom.manualCode.value.trim() || null,
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
    const total = state.basket.reduce((acc, item) => acc + item.price, 0);
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
