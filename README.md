# La Compra App

Prototipo web (mobile-first) para gestionar tu compra en tiempo real.

## Qué hace

- Activa la cámara del móvil para escanear códigos de barras (cuando el navegador soporta `BarcodeDetector`).
- Añade productos manualmente cuando el escáner no detecta o si no hay API disponible.
- Calcula el total de la cesta automáticamente.
- Permite definir presupuesto y muestra alertas visuales al acercarse o superar el límite.
- Incluye una lista de compra editable para planificar antes de salir.

## Cómo usar

1. Abre `index.html` en un navegador móvil moderno (Chrome Android recomendado para escaneo por código).
2. Pulsa **Activar cámara**.
3. Escanea o añade productos manualmente.
4. Ajusta el presupuesto para controlar gastos.

## Nota técnica

Este demo no usa backend; para producción se puede conectar un catálogo real (EAN → producto/precio) y sincronizar con cuenta de usuario.
