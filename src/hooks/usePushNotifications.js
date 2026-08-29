"use client";

import { useState, useCallback, useEffect } from "react";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;

export default function usePushNotifications(session) {
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      Boolean(publicKey)
  );
  const [permission, setPermission] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const refreshState = useCallback(async () => {
    if (!supported) return;
    try {
      setPermission(Notification.permission);
      if (Notification.permission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        setSubscribed(Boolean(sub));
      } else {
        setSubscribed(false);
      }
    } catch {
      setSubscribed(false);
    }
  }, [supported]);

  useEffect(() => {
    refreshState();
  }, [refreshState, session?.id]);

  const subscribe = useCallback(async () => {
    if (!supported || !publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js").catch(() => navigator.serviceWorker.getRegistration());
      const permission = await Notification.requestPermission();
      setPermission(permission);
      if (permission !== "granted") {
        setError("Permiso denegado");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const token = session?.access_token || session?.accessToken;
      if (token) {
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ subscription: sub.toJSON() }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Error al guardar");
      }
      setSubscribed(true);
    } catch (err) {
      setError(err?.message || "No se pudo activar notificaciones");
    } finally {
      setLoading(false);
    }
  }, [supported, session]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) await sub.unsubscribe();
      const token = session?.access_token || session?.accessToken;
      if (token) {
        const subscribed = sub ? sub.toJSON() : null;
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: subscribed?.endpoint || null }),
        });
      }
      setSubscribed(false);
    } catch {
      setSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, [supported, session]);

  return { supported, subscribed, permission, error, loading, subscribe, unsubscribe, refreshState };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}