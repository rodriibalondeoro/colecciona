'use client';

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { products as mockProducts, users, shippingMethods, mockReviews } from "@/data/mockData";

import { VerifiedBadge } from "@/components/Badge";
import ProductCard from "@/components/ProductCard";
import MakeOfferModal from "@/components/MakeOfferModal";
import FoilCard from "@/components/FoilCard";
import PriceAlertButton from "@/components/PriceAlertButton";
import { useApp } from "@/context/AppContext";
import { addRecentlyViewed } from "@/lib/recentlyViewed";
import { collections } from "@/data/collections";
import styles from "./page.module.css";

export default function ProductDetailPage() {
  const params = useParams();
  const { addToCart, session, startThread, showToast } = useApp();
  const router = useRouter();
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
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
  const sellerShippingIds = Array.isArray(seller?.seller_shipping_methods) && seller.seller_shipping_methods.length
    ? seller.seller_shipping_methods
    : shippingMethods.map((method) => method.id);
  const sellerShippingMethods = shippingMethods.filter((method) => sellerShippingIds.includes(method.id));
  const visibleShippingMethods = sellerShippingMethods.length ? sellerShippingMethods : shippingMethods;

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

  const detailPrice = product.price;

  function getCollectionName(categoryId) {
    for (const col of collections) {
      for (const sub of col.subs || []) {
        if (sub.id === categoryId) return `${col.name} / ${sub.name}`;
      }
    }
    return "";
  }

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
  const mockReviewCount = seller
    ? (mockReviews[seller.id]?.asSeller?.length || 0) + (mockReviews[seller.id]?.asBuyer?.length || 0)
    : 0;
  const sellerReviewCount = mockReviewCount || Number(seller?.sellerReviews || 0) + Number(seller?.buyerReviews || 0);
  const sellerRating = Number(seller?.rating || 0);
  const sellerMemberSince = seller?.memberSince || (
    seller?.member_since ? new Date(seller.member_since).getFullYear() : null
  );
  const sellerProfileHref = seller?.username ? `/seller/${seller.username}` : "#";

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        <div className={styles.breadcrumbNav}>
          <button className={styles.backBtn} onClick={() => router.back()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver al Mercado
          </button>
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
                <span className={styles.authTitle}>Garantía de Autenticidad en Colecciona</span>
                <span className={styles.authSub}>Protección de reembolso completo si el/los cromos no coinciden al 100% con la descripción.</span>
              </div>
            </div>
          </div>

          <div className={styles.rightColumn}>
            <div className={styles.titleSection}>
              <h1 className={styles.productTitle}>{product.title}</h1>
              <span className={styles.metaSub}>
                {getCollectionName(product.category)}
              </span>
            </div>

            <div className={styles.priceBox}>
              <div className={styles.priceValRow}>
                <span className={styles.priceTagLbl}>Precio</span>
                <span className={styles.mainPrice}>
                  {product.price.toFixed(2)}
                  <span className={styles.currencySymbol}> €</span>
                </span>
              </div>

              <div className={styles.escrowNotice}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>El importe se congelará por seguridad.</span>
              </div>
            </div>

            <div className={styles.descBox}>
              <h4>Descripción</h4>
              <p>{product.description || "Sin descripción."}</p>
            </div>

            {seller && (
              <div className={styles.sellerTrustBox}>
                <div className={styles.sellerAccent} />
                <div className={styles.sellerTop}>
                  <Link href={sellerProfileHref} className={styles.sellerAvatarLink} aria-label={`Ver perfil de ${seller.name}`}>
                    <div className={styles.sellerAvatarCircle}>
                      {seller.initials || seller.name.charAt(0)}
                    </div>
                  </Link>
                  <div className={styles.sellerNameCol}>
                    <span className={styles.sellerOverline}>Vendedor</span>
                    <div className={styles.sellerNameRow}>
                      <Link href={sellerProfileHref} className={styles.sellerNameLink}>{seller.name}</Link>
                      {seller.verified && (
                        <span className={styles.verifiedSpacer}>
                          <VerifiedBadge />
                        </span>
                      )}
                    </div>
                    <span className={styles.sellerLocation}>{seller.location || "Localidad no indicada"}</span>
                  </div>
                  <button className={styles.sellerChatBtn} onClick={handleMessageSeller} aria-label="Enviar mensaje al vendedor">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </button>
                </div>
                <div className={styles.sellerStatsLine}>
                  <strong>{seller.sales || 0}</strong> ventas
                  <span>•</span>
                  <strong>{seller.purchases || 0}</strong> compras
                  <span>•</span>
                  <strong>{sellerRating > 0 ? sellerRating.toFixed(2) : "--"}</strong> <strong>★</strong> ({sellerReviewCount})
                  {sellerMemberSince && (
                    <>
                      <span>•</span>
                      Miembro desde {sellerMemberSince}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className={styles.shippingBox}>
              <span className={styles.boxTitle}>Métodos de envíos disponibles del vendedor</span>
              <div className={styles.shippingOptions}>
                {visibleShippingMethods.map((method) => {
                  return (
                    <div
                      key={method.id}
                      className={styles.shippingCard}
                    >
                      <div className={styles.shippingContent}>
                        <span className={styles.shippingName}>{method.name}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.desktopActions}>
              <button
                className={styles.buyNowBtn}
                onClick={() => {
                  addToCart(product);
                  router.push("/checkout");
                }}
              >
                Comprar
              </button>
              <button 
                className={`${styles.cartBtn} ${addedToCart ? styles.cartActive : ""}`}
                onClick={() => {
                  addToCart(product);
                  setAddedToCart(true);
                }}
              >
                {addedToCart ? "✓ Añadido a Cesta" : "Añadir a Cesta"}
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

            <div style={{ marginTop: 10 }}>
              <PriceAlertButton productId={product.id} currentPrice={product.price} />
            </div>
          </div>
        </div>
        
        {otherProducts.length > 0 && (
          <section className={styles.sellerShelf}>
            <div className={styles.sellerShelfHeader}>
              <div>
                <span className={styles.shelfEyebrow}>DEL MISMO VENDEDOR</span>
                <h2 className={styles.shelfTitle}>Más cromos de {seller?.name}</h2>
              </div>
              {seller?.username && (
                <Link href={`/seller/${seller.username}`} className={styles.shelfLink}>
                  Ver perfil
                </Link>
              )}
            </div>
            <div className={styles.sellerShelfTrack}>
              {otherProducts.slice(0, 6).map((item) => (
                <Link key={item.id} href={`/product/${item.id}`} className={styles.sellerShelfItem}>
                  <div className={styles.sellerShelfThumb}>
                    <Image src={item.image} alt={item.title} fill sizes="140px" style={{ objectFit: "cover" }} />
                  </div>
                  <span className={styles.sellerShelfName}>{item.title}</span>
                  <span className={styles.sellerShelfPrice}>{Number(item.price || 0).toFixed(2)} €</span>
                </Link>
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
          <span className={styles.mobileTotalLbl}>Precio del cromo</span>
          <span className={styles.mobileTotalVal}>{detailPrice.toFixed(2)} €</span>
        </div>
        <button 
          className={styles.mobileBuyBtn}
          onClick={() => {
            addToCart(product);
            router.push("/checkout");
          }}
        >
          Comprar
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
