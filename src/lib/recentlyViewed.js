const MAX_ITEMS = 20;

function getUserId() {
  try {
    const s = JSON.parse(localStorage.getItem("colecciona_session") || "null");
    return s?.id || "anon";
  } catch {
    return "anon";
  }
}

function getKey() {
  return `colecciona_recent_${getUserId()}`;
}

export function getRecentlyViewed() {
  try {
    return JSON.parse(localStorage.getItem(getKey()) || "[]");
  } catch {
    return [];
  }
}

export function addRecentlyViewed(product) {
  try {
    const key = getKey();
    const list = getRecentlyViewed().filter((p) => p.id !== product.id);
    list.unshift({
      id: product.id,
      title: product.title,
      price: product.price,
      image: product.image,
      category: product.category,
      set: product.set,
      condition: product.condition,
      viewedAt: new Date().toISOString(),
    });
    localStorage.setItem(key, JSON.stringify(list.slice(0, MAX_ITEMS)));
  } catch {}
}
