"use client";

export function hapticLight() {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(10);
}
export function hapticSuccess() {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([10, 50, 10]);
}
