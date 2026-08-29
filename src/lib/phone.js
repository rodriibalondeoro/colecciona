// Utilidades de teléfono (España por defecto).
// Normaliza un número para comparaciones tolerantes a prefijo/espacios.

export function normalizePhone(phone) {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  // Longitud local española sin prefijo: 9 dígitos (610 000 000)
  if (digits.length === 9 && !digits.startsWith("34")) digits = `34${digits}`;
  return `+${digits}`;
}
