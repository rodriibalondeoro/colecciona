// Colecciona Price Intelligence Engine

/**
 * Analiza un precio comparándolo con el historial y las cotizaciones de mercado
 * @param {number} listingPrice - Precio del producto publicado
 * @param {string} category - ID de la categoría (pokemon, mtg...)
 * @param {string} condition - Estado físico (PSA10, NM, LP...)
 * @param {number} baseMarketPrice - Precio base de mercado para esa carta
 * @returns {object} Análisis de inteligencia de precio
 */
export function analyzePrice(listingPrice, category, condition, baseMarketPrice = 100.0) {
  // Ajuste según el estado físico
  const conditionMultipliers = {
    PSA10: 1.6,
    NM: 1.0,
    LP: 0.85,
    MP: 0.7,
    HP: 0.5,
    DMG: 0.35,
  };

  const multiplier = conditionMultipliers[condition] || 1.0;
  const estimatedValue = baseMarketPrice * multiplier;

  const diff = estimatedValue - listingPrice;
  const diffPercent = (diff / estimatedValue) * 100;

  // Clasificación del precio
  let rating = "good"; // good (verde), fair (amarillo), overpriced (rojo)
  let ratingText = "Excelente precio";

  if (diffPercent < -10) {
    rating = "overpriced";
    ratingText = "Por encima del mercado";
  } else if (diffPercent >= -10 && diffPercent < 5) {
    rating = "fair";
    ratingText = "Precio justo";
  } else {
    rating = "good";
    ratingText = "Oferta destacada";
  }

  // Ahorro vs comisiones tradicionales (Vinted cobra 5% + 0.70€ fijo + seguro extra)
  const conventionalFee = listingPrice * 0.05 + 0.70 + 2.0; // estimación Wallapop/Vinted
  const coleccionaFee = listingPrice * 0.08; // 8% comisión Colecciona

  const userSaving = conventionalFee - coleccionaFee;

  return {
    estimatedValue: parseFloat(estimatedValue.toFixed(2)),
    diff: parseFloat(diff.toFixed(2)),
    diffPercent: parseFloat(diffPercent.toFixed(1)),
    rating,
    ratingText,
    userSaving: parseFloat(userSaving.toFixed(2)),
    coleccionaFee: parseFloat(coleccionaFee.toFixed(2)),
  };
}

/**
 * Genera historial de precios de forma realista para la gráfica SVG
 * @param {number} currentPrice - Precio actual
 * @param {number} days - Cantidad de días
 * @returns {Array} Listado de precios históricos
 */
export function generatePriceHistory(currentPrice, days = 30) {
  const history = [];
  let tempPrice = currentPrice * 0.95; // empezar ligeramente más abajo

  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    // Random walk con tendencia alcista ligera
    const variation = (Math.random() - 0.45) * (currentPrice * 0.02);
    tempPrice += variation;

    history.push({
      date: date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
      price: parseFloat(Math.max(0.5, tempPrice).toFixed(2)),
    });
  }

  // Forzar que el último día sea el precio actual
  history[history.length - 1].price = currentPrice;

  return history;
}
