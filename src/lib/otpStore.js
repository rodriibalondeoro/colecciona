// Almacén compartido de OTP por teléfono (en memoria del servidor).
// Los módulos de /api/sms/send y /api/sms/verify son instancias separadas,
// por eso el Map vive en un módulo común.
// En producción: reemplazar por Redis con TTL.

const otpStorage = new Map();

export function setOtp(phone, code, ttlMs = 5 * 60 * 1000) {
  otpStorage.set(phone, { code, expiresAt: Date.now() + ttlMs });
}

export function getOtp(phone) {
  const entry = otpStorage.get(phone);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    otpStorage.delete(phone);
    return null;
  }
  return entry;
}

export function deleteOtp(phone) {
  otpStorage.delete(phone);
}
