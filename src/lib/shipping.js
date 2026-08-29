// Colecciona Integrated Logistics Engine (Correos, InPost, Locker)

/**
 * Genera un código de seguimiento de Correos España (ej: ES123456789012) o InPost
 * @param {string} methodId - Método de envío seleccionado
 * @returns {string} Código de tracking válido
 */
export function generateTrackingCode(methodId) {
  const randomDigits = () => Math.floor(100000000 + Math.random() * 900000000);
  if (methodId === "locker" || methodId === "inpost") {
    return `IP-${randomDigits()}-ES`;
  }
  return `ES-${randomDigits()}-COR`;
}

/**
 * Calcula los costes de envío basados en la categoría del producto y volumen estimado
 * @param {string} category - Categoría de la carta
 * @returns {number} Coste base de transporte
 */
export function calculateShippingCost(category) {
  if (category === "pokemon" || category === "mtg" || category === "yugioh") {
    return 1.80; // Sobres ligeros acolchados
  }
  return 2.80; // Cajas para figuras, cómics o mazos completos
}

/**
 * Genera la representación SVG de un código QR simple con un patrón geométrico determinista
 * Esto evita el uso de librerías pesadas y simula el QR de entrega del transportista
 * @param {string} text - Texto a codificar en el QR (el tracking code)
 * @returns {string} Código SVG del QR
 */
export function generateShippingQR(text) {
  // Generar un patrón geométrico basado en el hash del texto de tracking
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }

  const size = 160;
  const blocks = 8;
  const blockSize = size / blocks;
  let squares = "";

  for (let x = 0; x < blocks; x++) {
    for (let y = 0; y < blocks; y++) {
      // Posiciones de anclaje típicas del QR (esquinas superior izquierda, derecha e inferior izquierda)
      const isAnchor =
        (x < 2 && y < 2) ||
        (x >= blocks - 2 && y < 2) ||
        (x < 2 && y >= blocks - 2);

      if (isAnchor) {
        squares += `<rect x="${x * blockSize + 2}" y="${y * blockSize + 2}" width="${blockSize - 4}" height="${blockSize - 4}" fill="currentColor" rx="2" />`;
      } else {
        const val = (hash >> (x + y)) & 1;
        if (val === 1) {
          squares += `<rect x="${x * blockSize + 4}" y="${y * blockSize + 4}" width="${blockSize - 8}" height="${blockSize - 8}" fill="currentColor" rx="1" />`;
        }
      }
    }
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%" style="color: var(--text-primary);">
      <rect width="100%" height="100%" fill="none" />
      ${squares}
    </svg>
  `;
}
