'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import { users, products, mockReviews } from '@/data/mockData';
import ProductCard from '@/components/ProductCard';
import { useApp } from '@/context/AppContext';
import { deleteProduct, fetchReviews } from '@/lib/dataService';
import Image from 'next/image';

const PAGE_LIMIT = 20;

function timeAgo(iso) {
  if (!iso) return "Desconocido";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

function ArrowSvg({ dir }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {dir === "left" ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 6l6 6-6 6" />}
    </svg>
  );
}

export default function SellerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const username = params.username;
  const { getReviewsForUser, startThread, showToast } = useApp();
  const [dbProducts, setDbProducts] = useState([]);
  const [serverReviews, setServerReviews] = useState([]);
  const [session, setSession] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [sellerPage, setSellerPage] = useState(0);
  const [buyerPage, setBuyerPage] = useState(0);
  const [productsAtStart, setProductsAtStart] = useState(true);
  const [productsAtEnd, setProductsAtEnd] = useState(false);
  const [sellerDb, setSellerDb] = useState(null);
  const [searchingUser, setSearchingUser] = useState(true);

  const productsTrackRef = useRef(null);

  const getAuthHeaders = async () => {
    try {
      const raw = localStorage.getItem("colecciona_session");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.access_token) {
          return { Authorization: `Bearer ${s.access_token}` };
        }
      }
    } catch {}
    return {};
  };

  const checkProductsScroll = useCallback(() => {
    const track = productsTrackRef.current;
    if (!track) return;
    setProductsAtStart(track.scrollLeft <= 0);
    setProductsAtEnd(track.scrollLeft + track.clientWidth >= track.scrollWidth - 1);
  }, []);

  const scrollTrack = (ref, dir) => {
    const track = ref.current;
    if (!track) return;
    track.scrollBy({ left: dir * Math.round(track.clientWidth * 0.75), behavior: "smooth" });
  };

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      setSession(s);
    } catch {}
  }, []);

  useEffect(() => {
    if (!username) {
      setSearchingUser(false);
      return;
    }
    setSearchingUser(true);
    const controller = new AbortController();
    fetch(`/api/users/search?q=${username}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        const found = (data.users || []).find(u => u.username === username);
        if (!controller.signal.aborted && found) setSellerDb(found);
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setSearchingUser(false);
      });
    return () => controller.abort();
  }, [username]);

  useEffect(() => {
    if (!session?.id || !sellerDb?.id || sellerDb.id === session.id) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sellerDb.id)) return;
    getAuthHeaders().then(headers => {
      fetch(`/api/follow?targetUserId=${sellerDb.id}`, { headers })
        .then(r => r.json()).then(data => {
          setIsFollowing(data.following);
        }).catch(() => {});
    });
  }, [session?.id, sellerDb?.id]);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const handleFollow = async () => {
    if (!session?.id) {
      showToast("Inicia sesión para seguir", "info");
      router.push("/auth");
      return;
    }
    if (!UUID_RE.test(session.id)) {
      showToast("Tu cuenta no está verificada. Vuelve a iniciar sesión.", "info");
      router.push("/auth");
      return;
    }
    const targetId = sellerDb?.id || seller?.id;
    if (!targetId || !UUID_RE.test(targetId)) {
      showToast("No se pudo identificar al usuario", "error");
      return;
    }
    const headers = { ...(await getAuthHeaders()), "Content-Type": "application/json" };
    const method = isFollowing ? "DELETE" : "POST";
    const url = isFollowing ? `/api/follow?targetUserId=${targetId}` : "/api/follow";
    const body = isFollowing ? undefined : JSON.stringify({ targetUserId: targetId });
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
      });
      const data = await res.json();
      if (data.success) {
        setIsFollowing(data.following);
        setSellerDb(prev => prev ? {
          ...prev,
          followers: (prev.followers || 0) + (data.following ? 1 : -1),
        } : prev);
      } else {
        showToast(data.error || "Error al seguir", "error");
      }
    } catch (e) {
      showToast("Error de conexión", "error");
    }
  };

  useEffect(() => {
    const track = productsTrackRef.current;
    if (!track) return;
    checkProductsScroll();
    track.addEventListener("scroll", checkProductsScroll, { passive: true });
    window.addEventListener("resize", checkProductsScroll);
    return () => {
      track.removeEventListener("scroll", checkProductsScroll);
      window.removeEventListener("resize", checkProductsScroll);
    };
  }, [checkProductsScroll, initialLoading]);

  const mockSeller = users.find(u => u.username === username);
  const seller = sellerDb ? { ...mockSeller, ...sellerDb } : mockSeller;

  const isMyProfile = session && (
    session.username === username ||
    session.id === seller?.id
  );

  const handleDelete = async (productId) => {
    await deleteProduct(productId);
    setDbProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  const handleContact = () => {
    if (!session?.id) {
      showToast("Inicia sesión para contactar al vendedor", "info");
      router.push("/auth");
      return;
    }
    const threadId = startThread(seller, null);
    router.push(`/messages?thread=${threadId}`);
  };

  const fetchSellerProducts = useCallback(async (page, append = false) => {
    if (!username) return;
    try {
      const res = await fetch(`/api/products/search?seller=${username}&page=${page}&limit=${PAGE_LIMIT}`);
      const data = await res.json();
      const normalized = (data.products || []).map(p => ({
        ...p,
        listedAt: p.listedAt || p.created_at,
      }));
      if (append) {
        setDbProducts(prev => [...prev, ...normalized]);
      } else {
        setDbProducts(normalized);
      }
      setTotal(data.total || normalized.length);
      setHasMore(normalized.length >= PAGE_LIMIT);
      setCurrentPage(data.page || page);
    } catch {
      if (!append) setDbProducts([]);
    }
  }, [username]);

  useEffect(() => {
    fetchSellerProducts(1, false).then(() => setInitialLoading(false));
  }, [fetchSellerProducts]);

  useEffect(() => {
    if (!seller?.id) return;
    let cancelled = false;
    fetchReviews(seller.id).then((list) => {
      if (!cancelled) setServerReviews(list);
    });
    return () => { cancelled = true; };
  }, [seller?.id]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await fetchSellerProducts(currentPage + 1, true);
    setLoadingMore(false);
  };

  if (searchingUser) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-muted)' }}>
        Cargando perfil…
      </div>
    );
  }

  if (!seller) {
    return (
      <div className={styles.notFound}>
        <div className={styles.notFoundIcon}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <h2 className={styles.notFoundTitle}>Usuario no encontrado</h2>
        <p className={styles.notFoundText}>
          El perfil de <strong>@{username}</strong> no existe o ha sido eliminado.
        </p>
        <p className={styles.notFoundHint}>
          Puede que el usuario haya cambiado su nombre de usuario o haya eliminado su cuenta.
        </p>
        <div className={styles.notFoundActions}>
          <button className={styles.notFoundBtn} onClick={() => router.push('/marketplace?openSearch=true')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Volver atrás
          </button>
          <button className={styles.notFoundBtnSecondary} onClick={() => router.push('/marketplace')}>
            Ir al mercado
          </button>
        </div>
      </div>
    );
  }

  const sellerProducts = [
    ...products.filter(p => p.seller === seller?.id),
    ...dbProducts.filter(p => p.seller?.username === username || p.seller === seller?.id),
  ].filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);

  const serverMapped = serverReviews.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    date: r.created_at,
    reviewer: r.reviewer || { name: 'Usuario' },
  }));
  const localReviews = getReviewsForUser(seller.id) || [];
  const mockSellerReviews = mockReviews[seller.id]?.asSeller || [];
  const mockBuyerReviews = mockReviews[seller.id]?.asBuyer || [];
  const sellerReviewsList = [...serverMapped, ...localReviews, ...mockSellerReviews];
  const buyerReviewsList = [...mockBuyerReviews];

  const allReviews = [...sellerReviewsList, ...buyerReviewsList];
  const totalReviews = allReviews.length;
  const avgRating = allReviews.length
    ? (allReviews.reduce((acc, r) => acc + r.rating, 0) / allReviews.length).toFixed(2)
    : seller.rating?.toFixed(2) || "0.00";

  const isVerified = (seller.sales || 0) + (seller.purchases || 0) >= 10;

  const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  if (allReviews.length) {
    allReviews.forEach(r => distribution[r.rating]++);
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.profileInfo}>
          <div className={styles.avatar}>
            {seller.name.charAt(0)}
          </div>
          <div className={styles.details}>
            <div className={styles.nameRow}>
              <h1 className={styles.name}>{seller.name}</h1>
              {isVerified && (
                <svg className={styles.verified} viewBox="0 0 24 24" width="20" height="20" fill="var(--accent-primary)">
                  <path d="M12 2L15.09 5.09L19.5 5.5L20.5 9.91L23.5 12L20.5 14.09L19.5 18.5L15.09 18.91L12 22L8.91 18.91L4.5 18.5L3.5 14.09L0.5 12L3.5 9.91L4.5 5.5L8.91 5.09L12 2ZM10.5 15.5L17.5 8.5L16.09 7.09L10.5 12.67L7.91 10.08L6.5 11.5L10.5 15.5Z" />
                </svg>
              )}
            </div>
            <p className={styles.username}>@{seller.username}</p>
            <div className={styles.location}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              {seller.location}
            </div>

            <div className={styles.statsRow}>
              <span className={styles.stat}><strong>{seller.sales || 0}</strong> ventas</span>
              <span className={styles.separator}>•</span>
              <span className={styles.stat}><strong>{seller.purchases || 0}</strong> compras</span>
              <span className={styles.separator}>•</span>
              <span className={styles.stat}><strong>{avgRating} ★</strong> ({totalReviews})</span>
              <span className={styles.separator}>•</span>
              <span className={styles.stat}>Miembro desde {seller.memberSince || '2023'}</span>
            </div>
          </div>

          <div className={styles.actions}>
            {!isMyProfile && sellerDb?.id && UUID_RE.test(sellerDb.id) && (
              <button
                className={`${styles.followBtn} ${isFollowing ? styles.following : ""}`}
                onClick={handleFollow}
              >
                {isFollowing ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Siguiendo
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <line x1="20" y1="8" x2="20" y2="14" />
                      <line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                    Seguir
                  </>
                )}
              </button>
            )}
            <button className={styles.contactBtn} onClick={handleContact}>Mensaje</button>
          </div>
        </div>

        <div className={styles.trustBar}>
          <div className={styles.trustItem}>
            <span className={styles.trustLabel}>Seguidores</span>
            <span className={styles.trustValue}>{seller.followers || 0}</span>
          </div>
          <div className={styles.trustItem}>
            <span className={styles.trustLabel}>Siguiendo</span>
            <span className={styles.trustValue}>{seller.following || 0}</span>
          </div>
          <div className={styles.trustItem}>
            <span className={styles.trustLabel}>Última conexión</span>
            <span className={styles.trustValue}>{timeAgo(seller.lastSeen)}</span>
          </div>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.mainCol}>

          {/* CROMOS EN VENTA */}
          <section className={styles.carouselSection}>
            <div className={styles.carouselHeader}>
              <h2 className={styles.sectionTitle}>Cromos en venta ({sellerProducts.length})</h2>
              <div className={styles.carouselControls}>
                <button className={styles.carouselArrow} onClick={() => scrollTrack(productsTrackRef, -1)} disabled={productsAtStart} type="button" aria-label="Anterior">
                  <ArrowSvg dir="left" />
                </button>
                <button className={styles.carouselArrow} onClick={() => scrollTrack(productsTrackRef, 1)} disabled={productsAtEnd} type="button" aria-label="Siguiente">
                  <ArrowSvg dir="right" />
                </button>
              </div>
            </div>

            {initialLoading ? (
              <p style={{ color: 'var(--text-secondary)', padding: '1rem 0' }}>Cargando productos...</p>
            ) : sellerProducts.length > 0 ? (
              <>
                <div ref={productsTrackRef} className={styles.carouselTrack}>
                  {sellerProducts.map(product => {
                    const productSeller = users.find((u) => u.id === product.seller);
                    return (
                      <Link key={product.id} href={`/product/${product.id}`} className={styles.carouselCard}>
                        <div className={styles.carouselCardImg}>
                          <Image src={product.image} alt={product.title} fill sizes="200px" style={{ objectFit: "cover" }} />
                        </div>
                        <div className={styles.carouselCardBody}>
                          <p className={styles.carouselCardTitle}>{product.title}</p>
                          <span className={styles.carouselCardPrice}>{product.price.toFixed(2)} €</span>
                          {product.condition && (
                            <span className={styles.carouselCardMeta}>{product.condition}</span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {hasMore && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "1.5rem 0 0.5rem" }}>
                    <button onClick={handleLoadMore} disabled={loadingMore} className={styles.contactBtn} style={{ minWidth: 180 }}>
                      {loadingMore ? "Cargando..." : "Cargar más"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.emptyReviews}>
                <p>Este vendedor aún no tiene cromos en venta.</p>
              </div>
            )}
          </section>

          {/* DISTRIBUCIÓN DE ESTRELLAS */}
          {sellerReviewsList.length > 0 && (
            <section className={styles.chartSection}>
              <h2 className={styles.chartTitle}>Total valoraciones ({totalReviews})</h2>
              <div className={styles.chart}>
                {[5, 4, 3, 2, 1].map(star => {
                  const count = distribution[star];
                  const percent = totalReviews ? (count / totalReviews) * 100 : 0;
                  return (
                    <div key={star} className={styles.chartRow}>
                      <span className={styles.starLabel}>{star} ★</span>
                      <div className={styles.barTrack}>
                        <div className={styles.barFill} style={{ width: `${percent}%` }}></div>
                      </div>
                      <span className={styles.countLabel}>{count}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <div className={styles.sideCol}>

          {/* VALORACIONES COMO VENDEDOR */}
          <section className={styles.carouselSection}>
            <div className={styles.carouselHeader}>
              <h2 className={styles.sectionTitle}>Valoraciones como vendedor ({sellerReviewsList.length})</h2>
              {sellerReviewsList.length > 2 && (
                <div className={styles.carouselControls}>
                  <button
                    className={styles.carouselArrow}
                    onClick={() => setSellerPage(p => Math.max(0, p - 1))}
                    disabled={sellerPage === 0}
                    type="button"
                    aria-label="Anterior"
                  >
                    <ArrowSvg dir="left" />
                  </button>
                  <button
                    className={styles.carouselArrow}
                    onClick={() => setSellerPage(p => Math.min(Math.floor((sellerReviewsList.length - 1) / 2), p + 1))}
                    disabled={sellerPage >= Math.floor((sellerReviewsList.length - 1) / 2)}
                    type="button"
                    aria-label="Siguiente"
                  >
                    <ArrowSvg dir="right" />
                  </button>
                </div>
              )}
            </div>

            {sellerReviewsList.length > 0 ? (
              <div className={styles.reviewsGrid}>
                {sellerReviewsList.slice(sellerPage * 2, sellerPage * 2 + 2).map(review => (
                    <div key={review.id} className={`${styles.reviewCard} ${styles.reviewCardLg}`}>
                      <div className={styles.reviewHeader}>
                        <div className={styles.reviewerInfo}>
                          <div className={styles.reviewerLink} onClick={() => review.reviewer?.username && router.push(`/seller/${review.reviewer.username}`)}>
                            <div className={styles.reviewerAvatar}>
                              {review.reviewer?.username?.charAt(0)?.toUpperCase() || 'U'}
                            </div>
                            <span className={styles.reviewerName}>{review.reviewer?.username || 'Usuario'}</span>
                          </div>
                        </div>
                        <span className={styles.reviewDate}>{new Date(review.date).toLocaleDateString()}</span>
                      </div>
                      <div className={styles.reviewStars}>
                        {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                      </div>
                      {review.comment && <p className={styles.reviewComment}>{review.comment}</p>}
                    </div>
                  ))}
                </div>
            ) : (
              <div className={styles.emptyReviews}>
                <p>Aún no tiene valoraciones como vendedor.</p>
              </div>
            )}
          </section>

          {/* VALORACIONES COMO COMPRADOR */}
          <section className={styles.carouselSection}>
            <div className={styles.carouselHeader}>
              <h2 className={styles.sectionTitle}>Valoraciones como comprador ({buyerReviewsList.length})</h2>
              {buyerReviewsList.length > 2 && (
                <div className={styles.carouselControls}>
                  <button
                    className={styles.carouselArrow}
                    onClick={() => setBuyerPage(p => Math.max(0, p - 1))}
                    disabled={buyerPage === 0}
                    type="button"
                    aria-label="Anterior"
                  >
                    <ArrowSvg dir="left" />
                  </button>
                  <button
                    className={styles.carouselArrow}
                    onClick={() => setBuyerPage(p => Math.min(Math.floor((buyerReviewsList.length - 1) / 2), p + 1))}
                    disabled={buyerPage >= Math.floor((buyerReviewsList.length - 1) / 2)}
                    type="button"
                    aria-label="Siguiente"
                  >
                    <ArrowSvg dir="right" />
                  </button>
                </div>
              )}
            </div>

            {buyerReviewsList.length > 0 ? (
              <div className={styles.reviewsGrid}>
                {buyerReviewsList.slice(buyerPage * 2, buyerPage * 2 + 2).map(review => (
                  <div key={review.id} className={`${styles.reviewCard} ${styles.reviewCardLg}`}>
                    <div className={styles.reviewHeader}>
                      <div className={styles.reviewerInfo}>
                        <div className={styles.reviewerLink} onClick={() => review.reviewer?.username && router.push(`/seller/${review.reviewer.username}`)}>
                          <div className={styles.reviewerAvatar}>
                            {review.reviewer?.username?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <span className={styles.reviewerName}>{review.reviewer?.username || 'Usuario'}</span>
                        </div>
                      </div>
                      <span className={styles.reviewDate}>{new Date(review.date).toLocaleDateString()}</span>
                    </div>
                    <div className={styles.reviewStars}>
                      {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                    </div>
                    {review.comment && <p className={styles.reviewComment}>{review.comment}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyReviews}>
                <p>Aún no tiene valoraciones como comprador.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
