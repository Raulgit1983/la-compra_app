# La Compra App

Prototipo web (mobile-first) para gestionar tu compra en tiempo real.

## Qué hace

- Activa la cámara del móvil para escanear códigos de barras.
- En navegadores compatibles usa `BarcodeDetector`; en iPhone/Safari usa un fallback con Quagga2.
- Consulta nombre del producto por código de barras con Open Food Facts.
- Intenta obtener precio online por código de barras (si el endpoint aporta datos).
- Si no hay precio online, no inventa valores: pide completar precio manualmente o por OCR de imagen.
- Calcula el total de la cesta automáticamente (solo con productos que tengan precio confirmado).
- Activa la cámara del móvil para escanear códigos de barras (cuando el navegador soporta `BarcodeDetector`).
- Añade productos manualmente cuando el escáner no detecta o si no hay API disponible.
- Calcula el total de la cesta automáticamente.
- Permite definir presupuesto y muestra alertas visuales al acercarse o superar el límite.
- Incluye una lista de compra editable para planificar antes de salir.

## Cómo usar

1. Abre `index.html` en un navegador móvil moderno.
2. Pulsa **Activar cámara**.
3. Escanea productos; si falta precio, usa **Analizar precio por imagen** o escribe el precio.
1. Abre `index.html` en un navegador móvil moderno (Chrome Android recomendado para escaneo por código).
2. Pulsa **Activar cámara**.
3. Escanea o añade productos manualmente.
4. Ajusta el presupuesto para controlar gastos.

## Nota técnica

Este demo no usa backend propio. Para producción conviene integrar APIs de retailers/localización para precios realmente exactos por tienda.
Este demo no usa backend; para producción se puede conectar un catálogo real (EAN → producto/precio) y sincronizar con cuenta de usuario.
