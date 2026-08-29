const STORAGE_KEY = "colecciona_recent_searches";
const MAX_ITEMS = 10;

/** Normaliza entradas antiguas (strings) y nuevas ({ q, at }). */
function normalize(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (typeof item === "string") return { q: item, at: Date.now() };
      const q = String(item?.q ?? item?.term ?? item ?? "").trim();
      return { q, at: Number(item?.at) || Date.now() };
    })
    .filter((i) => i.q.length > 0);
}

export function getRecentSearches() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

export function addRecentSearch(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return;
  try {
    const list = getRecentSearches().filter(
      (s) => s.q.toLowerCase() !== trimmed.toLowerCase()
    );
    list.unshift({ q: trimmed, at: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {}
}

export function removeRecentSearch(query) {
  const target = String(query || "").toLowerCase();
  try {
    const list = getRecentSearches().filter((s) => s.q.toLowerCase() !== target);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

export function clearRecentSearches() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
