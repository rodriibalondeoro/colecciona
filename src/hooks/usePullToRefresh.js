"use client";
import { useState, useEffect, useCallback, useRef } from "react";

export default function usePullToRefresh(onRefresh) {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const containerRef = useRef(null);

  const onTouchStart = useCallback((e) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      setPulling(true);
    }
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!pulling) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff < 0) setPulling(false);
  }, [pulling]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling) return;
    setPulling(false);
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  }, [pulling, onRefresh]);

  return { containerRef, pulling, refreshing, handlers: { onTouchStart, onTouchMove, onTouchEnd } };
}
