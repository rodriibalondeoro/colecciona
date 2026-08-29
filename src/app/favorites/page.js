'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { useApp } from '@/context/AppContext';
import { products, users } from '@/data/mockData';
import ProductCard from '@/components/ProductCard';
import Skeleton from '@/components/Skeleton';

export default function FavoritesPage() {
  const { favorites } = useApp();
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/products/search?sort=recent&limit=100')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const real = (data.products || []).map((p) => ({
          ...p,
          listedAt: p.listedAt || p.created_at,
        }));
        const known = new Set(real.map((p) => p.id));
        const mock = products.filter((p) => !known.has(p.id));
        if (real.length) setCatalog([...real, ...mock]);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const list = catalog.length ? catalog : products;
  const favoriteProducts = list.filter((p) => favorites.has(p.id));

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Mis Favoritos</h1>
        <span className={styles.badge}>{favorites.size} cartas</span>
      </header>

      {loading && favorites.size > 0 ? (
        <Skeleton type="card" count={8} />
      ) : favoriteProducts.length > 0 ? (
        <div className={styles.grid}>
          {favoriteProducts.map((product) => {
            const seller =
              typeof product.seller === 'object'
                ? product.seller
                : users.find((u) => u.id === product.seller);
            return <ProductCard key={product.id} product={product} seller={seller} />;
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <svg className={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
          <h2 className={styles.emptyTitle}>No tienes cartas guardadas</h2>
          <p className={styles.emptyDesc}>Guarda tus cartas favoritas para no perderlas de vista y comprarlas más tarde.</p>
          <Link href="/marketplace" className={styles.exploreBtn}>
            Explorar mercado
          </Link>
        </div>
      )}
    </div>
  );
}
