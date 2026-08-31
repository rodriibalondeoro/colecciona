import { useState, useEffect, useRef, useCallback } from "react";

const cache = new Map();

/**
 * Simple SWR-like hook: fetches data, caches it, revalidates on focus.
 * @param {string} key - cache key (URL)
 * @param {Function} fetcher - async function that returns data
 * @param {Object} options - { revalidateOnFocus, dedupingInterval }
 */
export function useSWR(key, fetcher, options = {}) {
  const { revalidateOnFocus = true, dedupingInterval = 5000 } = options;
  const [data, setData] = useState(cache.get(key)?.data || null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!cache.has(key));
  const lastFetch = useRef(cache.get(key)?.timestamp || 0);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async (force = false) => {
    if (!key || !fetcher) return;
    const now = Date.now();
    if (!force && cache.has(key) && now - lastFetch.current < dedupingInterval) {
      setData(cache.get(key).data);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await fetcher(key);
      if (!mountedRef.current) return;
      cache.set(key, { data: result, timestamp: Date.now() });
      lastFetch.current = Date.now();
      setData(result);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [key, fetcher, dedupingInterval]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, [fetchData]);

  // Revalidate on window focus
  useEffect(() => {
    if (!revalidateOnFocus) return;
    const onFocus = () => fetchData(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchData, revalidateOnFocus]);

  return { data, error, loading, mutate: () => fetchData(true) };
}
