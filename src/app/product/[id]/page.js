'use client';

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { products as mockProducts, users, shippingMethods, cardConditions } from "@/data/mockData";

import { VerifiedBadge, LevelBadge } from "@/components/Badge";
import ProductCard from "@/components/ProductCard";
import PriceChart from "@/components/PriceChart";
import MakeOfferModal from "@/components/MakeOfferModal";
import FoilCard from "@/components/FoilCard";
import { useApp } from "@/context/AppContext";
import { addRecentlyViewed, getRecentlyViewed } from "@/lib/recentlyViewed";
import styles from "./page.module.css";

export default function ProductDetailPage() {
  const params = useParams();
  const { addToCart, session, startThread, showToast } = useApp();
  const router = useRouter();
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedShipping, setSelectedShipping] = useState(shippingMethods[0]?.id);
  const [addedToCart, setAddedToCart] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentItems, setRecentItems] = useState([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxZoom, setLightboxZoom] = useState(1);

  useEffect(() => {
    const id = params.id;
    if (!id) return;

    setLoading(true);
    fetch(`/api/products/${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.product) {
          setProduct(data.product);
        } else {
          setProduct(null);
        }
      })
      .catch(() => setProduct(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    setActiveImageIndex(0);
    setLightboxZoom(1);
  }, [product?.id]);

  // Cerrar lightbox/modal con Escape (A11Y)
  useEffect(() => {
    if (!lightboxOpen && !isOfferModalOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setLightboxOpen(false);
        setIsOfferModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, isOfferModalOpen]);

  const seller = typeof product?.seller === "object" ? product.seller : (product?.seller ? users.find((u) => u.id === product.seller) : null);
  const conditionInfo = product ? cardConditions[product.condition] : null;

  const handleMessageSeller = () => {
    if (!session?.id) {
      showToast("Inicia sesión para enviar un mensaje", "info");
      router.push("/auth");
      return;
    }
    if (!seller) return;
    const threadId = startThread(seller, product);
    router.push(`/messages?thread=${threadId}`);
  };

  // SEO: set document title and meta tags
  useEffect(() => {
    if (!product) return;

    document.title = `${product.title} | Colecciona`;

    const setMeta = (property, content) => {
      let el = document.querySelector(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setMeta("og:title", product.title);
    setMeta("og:description", `${product.price.toFixed(2)}€ - ${product.condition} - ${product.set}`);
    setMeta("og:image", product.image);
    setMeta("og:type", "website");
    setMeta("og:url", window.location.href);

    const setTwitter = (name, content) => {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    setTwitter("twitter:card", "summary_large_image");
    setTwitter("twitter:title", product.title);
    setTwitter("twitter:description", `${product.price.toFixed(2)}€ - ${product.condition}`);
    setTwitter("twitter:image", product.image);
  }, [product]);

  // SEO: JSON-LD structured data
  useEffect(() => {
    if (!product) return;

    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      description: product.description,
      image: product.image,
      offers: {
        "@type": "Offer",
        price: product.price,
        priceCurrency: "EUR",
        availability: "https://schema.org/InStock",
      },
      brand: { "@type": "Brand", name: product.set },
    });
    document.head.appendChild(script);
    return () => script.remove();
  }, [product]);

  // Recently viewed
  useEffect(() => {
    if (product) addRecentlyViewed(product);
    setRecentItems(getRecentlyViewed().filter((p) => p.id !== product?.id).slice(0, 8));
  }, [product]);

  // Related products
  useEffect(() => {
    if (!product) return;
    fetch(`/api/products/related?id=${product.id}&category=${product.category}`)
      .then((res) => res.json())
      .then((data) => setRelatedProducts(data.products || []))
      .catch(() => setRelatedProducts([]));
  }, [product]);

  if (loading) {
    return (
      <div className={styles.notFoundWrapper}>
        <div className={styles.notFoundBox}>
          <p>Cargando carta...</p>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className={styles.notFoundWrapper}>
        <div className={styles.notFoundBox}>
          <h2>Carta no encontrada</h2>
          <p>Esta carta ya se ha vendido o la dirección es incorrecta.</p>
          <Link href="/marketplace" className={styles.primaryLink}>
            Volver al Mercado
          </Link>
        </div>
      </div>
    );
  }

  const shippingObj = shippingMethods.find((m) => m.id === selectedShipping) || shippingMethods[0];
  const totalPrice = product.price + shippingObj.price;

  // Normaliza `images`: puede venir como array real, string JSON o CSV desde Supabase
  let rawImages = product.images;
  if (!Array.isArray(rawImages)) {
    if (typeof rawImages === "string") {
      const trimmed = rawImages.trim();
      try {
        rawImages = trimmed.startsWith("[") ? JSON.parse(trimmed) : trimmed.split(",");
      } catch {
        rawImages = trimmed.split(",");
      }
    } else {
      rawImages = [];
    }
  }
  const gallery = (Array.isArray(rawImages) ? rawImages : [])
    .map((src) => (typeof src === "string" ? src.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
  if (gallery.length === 0 && product.image) gallery.push(product.image);
  const activeImage = gallery[Math.min(activeImageIndex, gallery.length - 1)] || product.image;

  const otherProducts = mockProducts.filter(
    (p) => p.seller === seller?.id && p.id !== product.id
  );

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        <div className={styles.breadcrumbNav}>
          <Link href="/marketplace">Mercado</Link>
          <span>/</span>
          <span>{product.category.toUpperCase()}</span>
          <span>/</span>
          <span className={styles.breadcrumbActive}>{product.title}</span>
        </div>

        <div className={styles.mainGrid}>
          <div className={styles.leftColumn}>
            <div className={styles.imageCard} onClick={() => setLightboxOpen(true)}>
              <FoilCard>
                <Image
                  src={activeImage}
                  alt={product.title}
                  fill
                  priority
                  sizes="(max-width: 900px) 100vw, 50vw"
                  className={styles.mainImage}
                />
              </FoilCard>
            </div>

            {gallery.length > 1 && (
              <div className={styles.thumbRow} role="tablist" aria-label="Imágenes de la carta">
                {gallery.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    role="tab"
                    aria-selected={idx === activeImageIndex}
                    aria-label={`Ver imagen ${idx + 1} de ${gallery.length}`}
                    className={`${styles.thumbBtn} ${idx === activeImageIndex ? styles.thumbActive : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveImageIndex(idx);
                    }}
                  >
                    <Image src={img} alt="" fill sizes="72px" style={{ objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            )}
            
            <div className={styles.authenticityChip}>
              <div className={styles.authIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div className={styles.authText}>
                <span className={styles.authTitle}>Garantía de Autenticidad Colecciona</span>
                <span className={styles.authSub}>Protección de reembolso completo si la carta no coincide 100% con la descripción.</span>
              </div>
            </div>
          </div>

          <div className={styles.rightColumn}>
            <div className={styles.titleSection}>
              <div className={styles.setRow}>
                <span className={styles.setTag}>{product.set}</span>
                <span className={styles.rarityLabel}>{product.rarity}</span>
              </div>
              <h1 className={styles.productTitle}>{product.title}</h1>
              <span className={styles.metaSub}>
                Idioma: {product.language} • Año: {product.year}
              </span>
            </div>

            <div className={styles.priceBox}>
              <div className={styles.priceHeader}>
                <span className={styles.priceTagLbl}>Precio</span>
              </div>

              <div className={styles.priceValRow}>
                <span className={styles.mainPrice}>{product.price.toFixed(2)} €</span>
                {product.marketPrice && (
                  <span className={styles.marketPriceRef}>
                    Precio de mercado est: {product.marketPrice.toFixed(2)} €
                  </span>
                )}
              </div>

              <div className={styles.escrowNotice}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>El importe se congela en cuenta de custodia Stripe durante 48h.</span>
              </div>
            </div>
            
            <div className={styles.conditionInfoBox}>
              <div className={styles.condHeader}>
                <span className={styles.condTitle}>Estado Conservación:</span>
                <span>{product.condition}</span>
              </div>
              <p className={styles.condText}>{conditionInfo?.description}</p>
            </div>

            {product.description && (
              <div className={styles.descBox}>
                <h4>Nota del Vendedor:</h4>
                <p>{product.description}</p>
              </div>
            )}

            <div className={styles.shippingBox}>
              <span className={styles.boxTitle}>Opciones de Envío Directo</span>
              <div className={styles.shippingOptions}>
                {shippingMethods.map((method) => {
                  const isSelected = selectedShipping === method.id;
                  return (
                    <div
                      key={method.id}
                      className={`${styles.shippingCard} ${isSelected ? styles.shippingActive : ""}`}
                      onClick={() => setSelectedShipping(method.id)}
                    >
                      <div className={styles.shippingRadio}>
                        <div className={`${styles.radioDot} ${isSelected ? styles.radioActive : ""}`} />
                      </div>
                      <div className={styles.shippingContent}>
                        <div className={styles.shippingNameRow}>
                          <span className={styles.shippingName}>{method.name}</span>
                          <span className={styles.shippingCost}>{method.price.toFixed(2)} €</span>
                        </div>
                        <span className={styles.shippingDays}>Estimación: {method.estimatedDays}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {seller && (
              <div className={styles.sellerTrustBox}>
                <div className={styles.sellerTop}>
                  <div className={styles.sellerAvatarCircle}>
                    {seller.initials || seller.name.charAt(0)}
                  </div>
                  <div className={styles.sellerNameCol}>
                    <div className={styles.sellerNameRow}>
                      <span className={styles.sellerName}>{seller.name}</span>
                      {seller.verified && <VerifiedBadge />}
                    </div>
                    <span className={styles.sellerHandle}>@{seller.username} • {seller.location}</span>
                  </div>
                  <LevelBadge level={seller.level} />
                </div>

                <div className={styles.sellerMetricsGrid}>
                  <div className={styles.sellerMetric}>
                    <span className={styles.mVal}>{seller.sales || 0}</span>
                    <span className={styles.mLbl}>Ventas</span>
                  </div>
                  <div className={styles.sellerMetric}>
                    <span className={styles.mVal}>
                      {Number(seller.rating) > 0 ? `★ ${seller.rating}` : "—"}
                    </span>
                    <span className={styles.mLbl}>{Number(seller.rating) > 0 ? "Valoración" : "Sin valoraciones"}</span>
                  </div>
                </div>

                <button className={styles.messageSellerBtn} onClick={handleMessageSeller}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Mensaje al vendedor
                </button>
              </div>
            )}

            <div className={styles.desktopActions}>
              <button 
                className={`${styles.cartBtn} ${addedToCart ? styles.cartActive : ""}`}
                onClick={() => {
                  addToCart(product);
                  setAddedToCart(true);
                }}
              >
                {addedToCart ? "✓ Añadido a Cesta" : `Añadir a Cesta • ${totalPrice.toFixed(2)} €`}
              </button>
              <button 
                className={styles.offerBtn}
                onClick={() => setIsOfferModalOpen(true)}
              >
                Hacer una oferta
              </button>
              <button 
                className={styles.shareBtn}
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Compartir
              </button>
            </div>
          </div>
        </div>
        
        {recentItems.length > 0 && (
          <section className={styles.moreSection} style={{ marginTop: '3rem' }}>
            <h2 className={styles.moreTitle}>Vistos recientemente</h2>
            <div className={styles.recentRow}>
              {recentItems.map((item) => (
                <Link key={item.id} href={`/product/${item.id}`} className={styles.recentCard}>
                  <div className={styles.recentThumb}>
                    <Image src={item.image} alt={item.title} fill sizes="120px" style={{ objectFit: 'cover' }} />
                  </div>
                  <span className={styles.recentName}>{item.title}</span>
                  <span className={styles.recentPrice}>{Number(item.price || 0).toFixed(2)} €</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div style={{ marginTop: '3rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Historial de Precio</h2>
          <PriceChart currentPrice={product.price} />
        </div>

        {otherProducts.length > 0 && (
          <section className={styles.moreSection}>
            <h2 className={styles.moreTitle}>Más cartas de este vendedor</h2>
            <div className={styles.moreGrid}>
              {otherProducts.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </section>
        )}

        {relatedProducts.length > 0 && (
          <section className={styles.moreSection}>
            <h2 className={styles.moreTitle}>También te puede interesar</h2>
            <div className={styles.moreGrid}>
              {relatedProducts.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className={styles.mobileBar}>
        <div className={styles.mobilePriceGroup}>
          <span className={styles.mobileTotalLbl}>Total con Envío ({shippingObj.name.split(" ")[0]})</span>
          <span className={styles.mobileTotalVal}>{totalPrice.toFixed(2)} €</span>
        </div>
        <button 
          className={styles.mobileBuyBtn}
          onClick={() => addToCart(product)}
        >
          Añadir
        </button>
      </div>

      {lightboxOpen && (
        <div className={styles.lightboxOverlay} onClick={() => setLightboxOpen(false)} role="dialog" aria-modal="true" aria-label={`Imagen de ${product.title}`}>
          <button className={styles.closeLightboxBtn} aria-label="Cerrar imagen">✕</button>
          <div className={styles.lightboxCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.lightboxStage} style={{ transform: `scale(${lightboxZoom})` }}>
              <Image
                src={activeImage}
                alt={product.title}
                width={600}
                height={800}
                className={styles.lightboxImage}
              />
            </div>
            <div className={styles.lightboxControls}>
              {gallery.length > 1 && (
                <>
                  <button
                    className={styles.lightboxNav}
                    aria-label="Imagen anterior"
                    onClick={() => setActiveImageIndex((idx) => (idx - 1 + gallery.length) % gallery.length)}
                  >
                    ‹
                  </button>
                  <span className={styles.lightboxCounter}>
                    {activeImageIndex + 1} / {gallery.length}
                  </span>
                  <button
                    className={styles.lightboxNav}
                    aria-label="Imagen siguiente"
                    onClick={() => setActiveImageIndex((idx) => (idx + 1) % gallery.length)}
                  >
                    ›
                  </button>
                </>
              )}
              <div className={styles.zoomGroup} role="group" aria-label="Zoom de la imagen">
                {[1, 2, 3].map((z) => (
                  <button
                    key={z}
                    className={`${styles.zoomBtn} ${lightboxZoom === z ? styles.zoomActive : ""}`}
                    aria-pressed={lightboxZoom === z}
                    onClick={() => setLightboxZoom(z)}
                  >
                    {z}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isOfferModalOpen && (
        <MakeOfferModal 
          product={product} 
          onClose={() => setIsOfferModalOpen(false)} 
        />
      )}
    </div>
  );
}
