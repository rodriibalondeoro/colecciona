import { NextResponse } from "next/server";
import { products } from "@/data/mockData";
import { collections } from "@/data/collections";
import { createClient } from "@supabase/supabase-js";

function getCollectionName(categoryId) {
  for (const col of collections) {
    if (col.id === categoryId) return col.name;
    for (const sub of col.subs || []) {
      if (sub.id === categoryId) return `${col.name} / ${sub.name}`;
    }
  }
  return "";
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchesQuery(p, q) {
  if (!q) return true;
  const ql = normalize(q);
  if (
    normalize(p.title).includes(ql) ||
    normalize(p.description).includes(ql) ||
    normalize(p.set).includes(ql) ||
    normalize(p.code).includes(ql)
  ) return true;
  const colName = getCollectionName(p.category);
  if (normalize(colName).includes(ql)) return true;
  return false;
}

function matchesCategory(p, category) {
  if (category === "all") return true;
  const section = collections.find((c) => c.id === category);
  if (section) {
    return section.subs.some((s) => s.id === p.category) || p.category === category;
  }
  return p.category === category;
}

function filterProducts(list, { query, category, condition, minPrice, maxPrice, sort, sellerUsername }) {
  let filtered = list.filter((p) => matchesQuery(p, query) && matchesCategory(p, category));

  if (condition && condition !== "all") {
    filtered = filtered.filter((p) => p.condition === condition);
  }
  if (sellerUsername) {
    filtered = filtered.filter((p) => p.seller?.username === sellerUsername || p.seller === sellerUsername);
  }
  if (minPrice !== null) {
    filtered = filtered.filter((p) => Number(p.price) >= minPrice);
  }
  if (maxPrice !== null) {
    filtered = filtered.filter((p) => Number(p.price) <= maxPrice);
  }

  if (sort === "price-low" || sort === "price_asc") {
    filtered.sort((a, b) => Number(a.price) - Number(b.price));
  } else if (sort === "price-high" || sort === "price_desc") {
    filtered.sort((a, b) => Number(b.price) - Number(a.price));
  } else if (sort === "oldest") {
    filtered.sort((a, b) => new Date(a.listedAt || a.created_at) - new Date(b.listedAt || b.created_at));
  } else {
    filtered.sort((a, b) => new Date(b.listedAt || b.created_at) - new Date(a.listedAt || a.created_at));
  }

  return filtered;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const category = searchParams.get("category") || "all";
    const condition = searchParams.get("condition") || "all";
    const sort = searchParams.get("sort") || "recent";
    const sellerUsername = searchParams.get("seller") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const minRaw = searchParams.get("min_price");
    const maxRaw = searchParams.get("max_price");
    const minPrice = minRaw !== null && minRaw !== "" && !isNaN(Number(minRaw)) ? Number(minRaw) : null;
    const maxPrice = maxRaw !== null && maxRaw !== "" && !isNaN(Number(maxRaw)) ? Number(maxRaw) : null;

    const filters = { query, category, condition, minPrice, maxPrice, sort, sellerUsername };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    let dbProducts = [];

    if (url && key) {
      try {
        const supabase = createClient(url, key);
        let dbQuery = supabase
          .from("products")
          .select("*, seller:users(id, username, name, avatar, bio, level, level_name, sales, purchases, rating, location, followers, following)", { count: "exact" });

        dbQuery = dbQuery.eq("status", "ACTIVE");

        if (category !== "all") {
          const section = collections.find((c) => c.id === category);
          if (section) {
            const subcategoryIds = section.subs.map((s) => s.id);
            dbQuery = dbQuery.in("category", [...subcategoryIds, section.id]);
          } else {
            dbQuery = dbQuery.eq("category", category);
          }
        }
        if (condition && condition !== "all") {
          dbQuery = dbQuery.eq("condition", condition);
        }
        if (sellerUsername) {
          dbQuery = dbQuery.eq("seller.username", sellerUsername);
        }
        if (minPrice !== null) {
          dbQuery = dbQuery.gte("price", minPrice);
        }
        if (maxPrice !== null) {
          dbQuery = dbQuery.lte("price", maxPrice);
        }
        if (sort === "price-low" || sort === "price_asc") {
          dbQuery = dbQuery.order("price", { ascending: true });
        } else if (sort === "price-high" || sort === "price_desc") {
          dbQuery = dbQuery.order("price", { ascending: false });
        } else if (sort === "oldest") {
          dbQuery = dbQuery.order("created_at", { ascending: true });
        } else {
          dbQuery = dbQuery.order("created_at", { ascending: false });
        }

        const { data, error } = await dbQuery;
        if (!error && data) {
          dbProducts = filterProducts(data, filters);
        }
      } catch (e) {
        console.warn("Supabase error, usando mockData:", e.message);
      }
    }

    const mockFiltered = filterProducts([...products], filters);
    const seenIds = new Set(dbProducts.map((p) => p.id));
    const mockOnly = mockFiltered.filter((p) => !seenIds.has(p.id));

    const combined = filterProducts([...dbProducts, ...mockOnly], filters);

    const total = combined.length;
    const from = (page - 1) * limit;
    const paginated = combined.slice(from, from + limit);

    return NextResponse.json({
      success: true,
      products: paginated,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Error en Search API:", error);
    const filters = {
      query: new URL(req.url).searchParams.get("q") || "",
      category: new URL(req.url).searchParams.get("category") || "all",
      condition: new URL(req.url).searchParams.get("condition") || "all",
      minPrice: null,
      maxPrice: null,
      sort: "recent",
      sellerUsername: "",
    };
    const filtered = filterProducts([...products], filters);
    return NextResponse.json({
      success: true,
      products: filtered.slice(0, 20),
      total: filtered.length,
      page: 1,
      limit: 20,
    });
  }
}
