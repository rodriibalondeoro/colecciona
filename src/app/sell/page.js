"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { shippingMethods, cardConditions } from "@/data/mockData";
import { collections } from "@/data/collections";
import ProfitCalculator from "@/components/ProfitCalculator";
import ImageCropper from "@/components/ImageCropper";
import PSAVerifier from "@/components/PSAVerifier";
import CardIdentifier from "@/components/CardIdentifier";
import PriceSuggest from "@/components/PriceSuggest";
import PremiumBadge from "@/components/PremiumBadge";
import { publishProduct, uploadCardImage, getProfile } from "@/lib/dataService";
import { hapticSuccess } from "@/lib/haptics";
import { usePremium } from "@/hooks/usePremium";
import styles from "./page.module.css";

const themeSectionIds = [
  'mundial', 'tlg-futbol', 'champions', 'baloncesto', 'beisbol',
  'nfl-ufc', 'motor', 'comics-cine', 'nintendo', 'especial-digital',
];

export default function SellPage() {
  const { isPremium, commissionRate } = usePremium();
  const uploadPromiseRef = useRef(null);
  const lastPhotoRef = useRef(null);
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [step, setStep] = useState(1);
  const [imagePreview, setImagePreview] = useState(null);
  const [croppedPreview, setCroppedPreview] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageStatus, setImageStatus] = useState("idle"); // idle | uploading | ready | error
  const [imageError, setImageError] = useState(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("pokemon");
  const [condition, setCondition] = useState("NM");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [shippingMethod, setShippingMethod] = useState("sm1");
  const [shippingPreferences, setShippingPreferences] = useState(["sm1"]);
  const [isPublished, setIsPublished] = useState(false);
  const [showIdentifier, setShowIdentifier] = useState(false);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      setSession(s);
      if (s?.email) {
        getProfile().then(setProfile).finally(() => setProfileChecked(true));
      } else {
        setProfileChecked(true);
      }
    } catch {}
    setSessionChecked(true);
  }, []);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
        setCroppedPreview(null);
        setImageUrl(null);
        setImageStatus("idle");
        setImageError(null);
        lastPhotoRef.current = null;
      };
      reader.readAsDataURL(file);
    }
  };

    // Subida en segundo plano nada más recortar: el usuario no espera.
  const handleCropApplied = (dataUrl, blob) => {
    lastPhotoRef.current = blob || dataUrl;
    setCroppedPreview(dataUrl);
    setImageStatus("uploading");
    setImageError(null);
    setShowIdentifier(true);
    uploadPromiseRef.current = uploadCardImage(blob || dataUrl)
      .then((url) => {
        setImageUrl(url);
        setImageStatus("ready");
        return url;
      })
      .catch((err) => {
        setImageStatus("error");
        setImageError(err?.message || "Error al subir la imagen.");
        setImageUrl(null);
      });
  };

  const handleIdentify = (data) => {
    if (data.title) setTitle(data.title);
    if (data.category) setCategory(data.category);
    if (data.set) {
      setDescription((prev) =>
        prev ? `${prev}\nSet: ${data.set}` : `Set: ${data.set}`
      );
    }
    setShowIdentifier(false);
    setStep(2);
  };

  const handleSkipIdentifier = () => {
    setShowIdentifier(false);
    setStep(2);
  };

  const handleRetryUpload = () => {
    if (!lastPhotoRef.current) return;
    setImageStatus("uploading");
    setImageError(null);
    uploadPromiseRef.current = uploadCardImage(lastPhotoRef.current)
      .then((url) => {
        setImageUrl(url);
        setImageStatus("ready");
        return url;
      })
      .catch((err) => {
        setImageStatus("error");
        setImageError(err?.message || "Error al subir la imagen.");
        setImageUrl(null);
      });
  };

  const publishedImage = imageUrl || croppedPreview || imagePreview;

  const numericPrice = parseFloat(price) || 0;
  const commissionFee = numericPrice * commissionRate;
  const netEarnings = numericPrice - commissionFee;
  const selectedShipping = shippingMethods.find((m) => m.id === shippingMethod) || shippingMethods[0];

  const [publishing, setPublishing] = useState(false);

  const handlePublish = async () => {
    setPublishing(true);
    try {
      // Esperar la subida de la imagen y usar SU resultado (no el estado stale).
      // Si la subida falló, usar placeholder — NUNCA enviar el data URL gigante.
      let finalImage = imageUrl;
      if (!finalImage && uploadPromiseRef.current) {
        const uploaded = await uploadPromiseRef.current;
        if (uploaded) finalImage = uploaded;
      }
      if (finalImage && finalImage.startsWith("data:")) finalImage = null;
      const newProduct = {
        title,
        category,
        condition,
        price: numericPrice,
        image: finalImage || "/images/cards/collection.png",
        seller: session?.id || "u1",
        sellerName: session?.name || null,
        code: title.split(" ").pop(),
        rarity: null,
        description: description || "Carta en venta.",
        set: "Colección TCG",
        language: "Español",
        year: new Date().getFullYear(),
        listedAt: new Date().toISOString(),
        views: 0,
        favorites: 0,
      };
      const result = await publishProduct(newProduct);
      if (result) {
        hapticSuccess();
        setIsPublished(true);
      } else {
        alert("Error al publicar. Inténtalo de nuevo.");
      }
    } catch (err) {
      alert(`Error al publicar: ${err?.message || "Inténtalo de nuevo."}`);
    } finally {
      setPublishing(false);
    }
  };

  if (isPublished) {
    return (
      <div className={`${styles.wrapper} page-enter`}>
        <div className="container">
          <div className={styles.successCard}>
            <div className={styles.successBadge}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2>¡Carta Publicada en el Mercado!</h2>
            <p>
              Tu anuncio <strong>&ldquo;{title || "Carta TCG"}&rdquo;</strong> ya está disponible para miles de coleccionistas por{" "}
              <strong>{numericPrice.toFixed(2)} €</strong>.
            </p>

            <div className={styles.successActions}>
              <Link href="/marketplace" className={styles.primaryBtn}>
                Ver en el Mercado
              </Link>
              <button
                onClick={() => {
                  setIsPublished(false);
                  setStep(1);
                  setImagePreview(null);
                  setCroppedPreview(null);
                  setTitle("");
                  setPrice("");
                }}
                className={styles.secondaryBtn}
              >
                Publicar otra carta
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionChecked || !profileChecked) {
    return <div className={`${styles.wrapper} page-enter`}><div className="container" style={{ minHeight: 300 }} /></div>;
  }

  if (!session || !session.email) {
    return (
      <div className={`${styles.wrapper} page-enter`}>
        <div className="container">
          <div className={styles.successCard} style={{ textAlign: "center", padding: "3rem 2rem" }}>
            <div className={styles.successBadge} style={{ color: "var(--accent, #7c5cff)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h2>Necesitas iniciar sesión</h2>
            <p style={{ margin: "0.75rem 0 1.5rem", color: "var(--text-muted, #9aa0b4)" }}>
              Crea tu cuenta o inicia sesión para publicar tus cartas en el mercado.
            </p>
            <div className={styles.successActions} style={{ justifyContent: "center" }}>
              <Link href="/auth" className={styles.primaryBtn}>
                Crear cuenta / Iniciar sesión
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile?.address_complete) {
    return (
      <div className={`${styles.wrapper} page-enter`}>
        <div className="container">
          <div className={styles.successCard} style={{ textAlign: "center", padding: "3rem 2rem" }}>
            <div className={styles.successBadge} style={{ color: "var(--accent, #7c5cff)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <h2>Completa tu dirección para vender</h2>
            <p style={{ margin: "0.75rem 0 1.5rem", color: "var(--text-muted, #9aa0b4)" }}>
              Para publicar cartas y gestionar envíos necesitamos tu dirección de
              envío. Es obligatoria para todos los vendedores y solo la verá Colecciona.
            </p>
            <div className={styles.successActions} style={{ justifyContent: "center" }}>
              <Link href="/profile" className={styles.primaryBtn}>
                Añadir dirección en mi perfil
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        <div className={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <span className={styles.headerBadge}>PANEL DE VENDEDOR TCG</span>
            <PremiumBadge size="xs" />
          </div>
          <h1 className={styles.pageTitle}>Publicar Carta en Mercado</h1>
          <p className={styles.pageSubtitle}>
            Venta protegida con comisión {isPremium ? 'reducida' : 'baja'} del {(commissionRate * 100).toFixed(0)}%.
          </p>
        </div>

        {/* Wizard Progress Bar */}
        <div className={styles.wizardBar}>
          {[
            { num: 1, label: "Fotografía" },
            { num: 2, label: "Especificaciones" },
            { num: 3, label: "Logística QR" },
            { num: 4, label: "Revisión Final" },
          ].map((s) => (
            <div
              key={s.num}
              className={`${styles.wizardStep} ${step >= s.num ? styles.stepActive : ""}`}
            >
              <div className={styles.stepCircle}>{s.num}</div>
              <span className={styles.stepText}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Form Container */}
        <div className={styles.formContainer}>
          {/* Step 1: Foto */}
          {step === 1 && (
            <div className={styles.stepBox}>
              <h2 className={styles.stepTitle}>1. Fotografía de la Carta</h2>
              <p className={styles.stepDesc}>Sube una imagen nítida sin brillos ni desenfoques.</p>

              <div className={styles.uploadZone}>
                {croppedPreview ? (
                  <div className={styles.previewBox}>
                    <img src={croppedPreview} alt="Preview" className={styles.previewImage} />
                    <label className={styles.reuploadBtn}>
                      Volver a Recortar
                      <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                    </label>
                    <div className={`${styles.uploadStatus} ${styles[`uploadStatus_${imageStatus}`]}`}>
                      {imageStatus === "uploading" && (
                        <>
                          <span className={styles.uploadSpinner} />
                          Subiendo imagen a la nube...
                        </>
                      )}
                      {imageStatus === "ready" && "✓ Imagen lista"}
                      {imageStatus === "error" && (
                        <>
                          ⚠ No se pudo subir{imageError ? `: ${imageError}` : ""}
                          <button type="button" className={styles.uploadRetry} onClick={handleRetryUpload}>
                            Reintentar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : imagePreview ? (
                  <div className={styles.cropStage}>
                    <span className={styles.cropHint}>Arrastra para centrar la carta y ajusta el zoom. Se publicará en formato 3:4.</span>
                    <ImageCropper
                      src={imagePreview}
                      onApply={handleCropApplied}
                      onCancel={() => {
                        setImagePreview(null);
                        setCroppedPreview(null);
                        setImageUrl(null);
                        setImageStatus("idle");
                        setImageError(null);
                        lastPhotoRef.current = null;
                      }}
                    />
                  </div>
                ) : (
                  <label className={styles.dropArea}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <span className={styles.dropTitle}>Haz clic o arrastra tu fotografía</span>
                    <span className={styles.dropSub}>Formato JPG, PNG o WEBP en resolución clara</span>
                    <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                  </label>
                )}
              </div>

              {showIdentifier && croppedPreview && (
                <div className={styles.identifierBox}>
                  <CardIdentifier
                    imageUrl={croppedPreview}
                    onIdentify={handleIdentify}
                    onSkip={handleSkipIdentifier}
                  />
                </div>
              )}

              {!showIdentifier && (
                <div className={styles.navRight}>
                  <button
                    className={styles.primaryBtn}
                    disabled={!croppedPreview}
                    onClick={() => setStep(2)}
                  >
                    Continuar: Especificaciones →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Detalles */}
          {step === 2 && (
            <div className={styles.stepBox}>
              <h2 className={styles.stepTitle}>2. Detalles y Precio</h2>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Título exacto del anuncio *</label>
                <input
                  type="text"
                  placeholder="Ej. Charizard Holo 1ª Edición Base Set BS-004"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={styles.input}
                />
              </div>

              <div className={styles.psaVerifierBox}>
                <PSAVerifier
                  onVerify={(data) => {
                    setTitle(data.title);
                    setCategory(data.category || category);
                    if (data.condition) setCondition(data.condition);
                  }}
                />
              </div>

              <div className={styles.grid2}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Juego / Categoría</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={styles.select}
                  >
                    <option value="">Seleccionar categoría</option>
                    {collections
                      .filter((col) => themeSectionIds.includes(col.id))
                      .map((col) => (
                      <optgroup key={col.id} label={col.name}>
                        {col.subs?.map((sub) => (
                          <option key={sub.id} value={sub.id}>
                            {sub.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.label}>Precio de Venta (€) *</label>
                  <input
                    type="number"
                    step="0.50"
                    placeholder="0.00"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <PriceSuggest
                category={category}
                condition={condition}
                title={title}
                onSuggestedPrice={(p) => setPrice(String(p))}
              />

              <div className={styles.inputGroup}>
                <div className={styles.conditionGrid}>
                  {Object.entries(cardConditions).map(([code, info]) => (
                    <button
                      key={code}
                      type="button"
                      className={`${styles.condBtn} ${condition === code ? styles.condActive : ""}`}
                      onClick={() => setCondition(code)}
                    >
                      <span className={styles.condCode} style={{ color: info.color }}>{code}</span>
                      <span className={styles.condLbl}>{info.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Descripción adicional</label>
                <textarea
                  rows={3}
                  placeholder="Indica si incluye funda toploader, centrado del corte, etc."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={styles.textarea}
                />
              </div>

              <div className={styles.navBetween}>
                <button className={styles.secondaryBtn} onClick={() => setStep(1)}>
                  ← Atrás
                </button>
                <button
                  className={styles.primaryBtn}
                  disabled={!title || !price}
                  onClick={() => setStep(3)}
                >
                  Continuar: Logística →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Envío */}
          {step === 3 && (
            <div className={styles.stepBox}>
              <h2 className={styles.stepTitle}>3. Métodos de Envío</h2>
              <p className={styles.stepDesc}>
                Selecciona los métodos de envío que aceptas. El comprador asume el coste del transporte.
              </p>

              <div className={styles.shippingList}>
                {shippingMethods.map((m) => (
                  <label
                    key={m.id}
                    className={`${styles.shippingRow} ${shippingPreferences.includes(m.id) ? styles.shippingActive : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={shippingPreferences.includes(m.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setShippingPreferences(prev => [...prev, m.id]);
                          setShippingMethod(m.id);
                        } else {
                          setShippingPreferences(prev => prev.filter(id => id !== m.id));
                          if (shippingMethod === m.id) {
                            setShippingMethod(shippingPreferences.find(id => id !== m.id) || "sm1");
                          }
                        }
                      }}
                      style={{ accentColor: 'var(--accent-primary)' }}
                    />
                    <div className={styles.shippingInfo}>
                      <span className={styles.shippingTitle}>{m.name}</span>
                      <span className={styles.shippingDesc}>{m.description}</span>
                    </div>
                    <span className={styles.shippingPrice}>{m.price.toFixed(2)} €</span>
                  </label>
                ))}
              </div>

              <div className={styles.navBetween}>
                <button className={styles.secondaryBtn} onClick={() => setStep(2)}>
                  ← Atrás
                </button>
                <button
                  className={styles.primaryBtn}
                  disabled={shippingPreferences.length === 0}
                  onClick={() => setStep(4)}
                >
                  Continuar: Revisión →
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Confirmar */}
          {step === 4 && (
            <div className={styles.stepBox}>
              <h2 className={styles.stepTitle}>4. Desglose Financiero</h2>

              <div className={styles.summaryCard}>
                <div className={styles.summaryTop}>
                  {publishedImage && (
                    <div className={styles.summaryThumb}>
                      <img src={publishedImage} alt="Summary" className={styles.thumbImg} />
                    </div>
                  )}
                  <div>
                    <h3 className={styles.summaryTitle}>{title}</h3>
                    <span className={styles.summaryMeta}>Estado: {condition} • Categoría: {category.toUpperCase()}</span>
                  </div>
                </div>

                <div className={styles.feeBreakdown}>
                  <div className={styles.feeRow}>
                    <span>Precio de venta al comprador</span>
                    <span className={styles.monoPrice}>{numericPrice.toFixed(2)} €</span>
                  </div>

                  <div className={styles.feeRow}>
                    <span>Comisión Colecciona (8%)</span>
                    <span className={styles.feeVal}>- {commissionFee.toFixed(2)} €</span>
                  </div>

                  <div className={styles.feeRow}>
                    <span>Envío QR Correos (lo paga el comprador)</span>
                    <span className={styles.monoPrice}>+ {selectedShipping.price.toFixed(2)} €</span>
                  </div>

                  <div className={`${styles.feeRow} ${styles.feeTotal}`}>
                    <span>Ganancia líquida en tu Wallet</span>
                    <span className={styles.earningsVal}>{netEarnings.toFixed(2)} €</span>
                  </div>
                </div>
              </div>

              <div className={styles.navBetween}>
                <button className={styles.secondaryBtn} onClick={() => setStep(3)}>
                  ← Atrás
                </button>
                <button className={styles.publishBtn} onClick={handlePublish} disabled={publishing}>
                  {publishing ? "Publicando..." : "Publicar Carta en Mercado"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
