import { NextResponse } from "next/server";
import { products } from "@/data/mockData";
import { collections } from "@/data/collections";
import { createClient } from "@supabase/supabase-js";

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

    console.log(`🔍 [Search API] Consulta: "${query}", Categoría: "${category}", Condición: "${condition}", Seller: "${sellerUsername}", Page: ${page}, Limit: ${limit}`);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && key) {
      const supabase = createClient(url, key);
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      let dbQuery = supabase
        .from("products")
        .select("*, seller:users(*)", { count: "exact" });

      if (query) {
        dbQuery = dbQuery.or(
          `title.ilike.%${query}%,code.ilike.%${query}%,set.ilike.%${query}%,description.ilike.%${query}%`
        );
      }
      if (category !== "all") {
        const section = collections.find((c) => c.id === category);
        if (section) {
          const subcategoryIds = section.subs.map((s) => s.id);
          dbQuery = dbQuery.in("category", subcategoryIds);
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

      dbQuery = dbQuery.range(from, to);

      const { data, error, count } = await dbQuery;

      if (!error && data) {
        return NextResponse.json({
          success: true,
          products: data,
          total: count ?? data.length,
          page,
          limit,
        });
      }
      console.warn("Falló consulta de Supabase, usando fallback local:", error);
    }

    // Fallback local sobre mockData
    let filtered = [...products];

    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.set?.toLowerCase().includes(q) ||
          p.code?.toLowerCase().includes(q)
      );
    }

    if (category !== "all") {
      const section = collections.find((c) => c.id === category);
      if (section) {
        const subcategoryIds = section.subs.map((s) => s.id);
        filtered = filtered.filter((p) => subcategoryIds.includes(p.category));
      } else {
        filtered = filtered.filter((p) => p.category === category);
      }
    }

    if (condition && condition !== "all") {
      filtered = filtered.filter((p) => p.condition === condition);
    }

    if (sellerUsername) {
      filtered = filtered.filter(
        (p) => p.seller?.username === sellerUsername || p.seller === sellerUsername
      );
    }

    if (minPrice !== null) {
      filtered = filtered.filter((p) => p.price >= minPrice);
    }
    if (maxPrice !== null) {
      filtered = filtered.filter((p) => p.price <= maxPrice);
    }

    if (sort === "price-low" || sort === "price_asc") {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sort === "price-high" || sort === "price_desc") {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sort === "oldest") {
      filtered.sort((a, b) => new Date(a.listedAt || a.created_at) - new Date(b.listedAt || b.created_at));
    } else {
      filtered.sort((a, b) => new Date(b.listedAt || b.created_at) - new Date(a.listedAt || a.created_at));
    }

    const total = filtered.length;
    const from = (page - 1) * limit;
    const to = from + limit;
    const paginated = filtered.slice(from, to);

    return NextResponse.json({
      success: true,
      products: paginated,
      total,
      page,
      limit,
      source: "mockLocal",
    });
  } catch (error) {
    console.error("Error en Search API:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
