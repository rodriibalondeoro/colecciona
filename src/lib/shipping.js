/**
 * Colecciona Shipping Utilities
 *
 * ⚠️ This module provides internal shipping state management ONLY.
 * No real tracking codes or carrier integrations exist.
 * Do NOT generate fake tracking numbers that could mislead users.
 */

/**
 * Estimated shipping cost based on card category.
 * This is an ESTIMATE, not a real carrier quote.
 * @param {string} category
 * @returns {number} Estimated cost in EUR
 */
export function calculateShippingCost(category) {
  if (category === "pokemon" || category === "mtg" || category === "yugioh") {
    return 1.80;
  }
  return 2.80;
}

/**
 * Internal order status labels for display.
 * These are NOT official carrier tracking statuses.
 */
export const SHIPPING_STATES = {
  PREPARING: { label: "Preparando", icon: "📦" },
  MARKED_AS_SHIPPED: { label: "Marcado como enviado", icon: "📮" },
  WAITING_RECEIPT: { label: "En espera de recepción", icon: "⏳" },
  RECEIVED: { label: "Recibido", icon: "✅" },
  COMPLETED: { label: "Completado", icon: "🎉" },
};

/**
 * Validate that a shipping method ID is from the allowed list.
 * Prevents injection of arbitrary carrier names.
 */
const ALLOWED_METHODS = [
  "carta-ordinaria",
  "carta-certificada",
  "locker-inpost",
  "bulto-economico",
  "seur-24h",
  "envio-gratuito",
  "retiro-mano",
];

export function isValidShippingMethod(methodId) {
  return ALLOWED_METHODS.includes(methodId);
}
