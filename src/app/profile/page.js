"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import Skeleton from "@/components/Skeleton";
import { LevelBadge, VerifiedBadge, StatusBadge } from "@/components/Badge";
import AnimatedCounter from "@/components/AnimatedCounter";
import Magnetic from "@/components/Magnetic";
import CountryGlobe from "@/components/CountryGlobe";
import { getProfile, updateProfile } from "@/lib/dataService";
import { COUNTRIES, findCountry } from "@/data/countries";
import { useApp } from "@/context/AppContext";
import styles from "./page.module.css";

export default function ProfilePage() {
  const { session, setSession, showToast } = useApp();
  const [tab, setTab] = useState("selling");
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [withdrawDone, setWithdrawDone] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    bio: "",
    location: "",
    address_street: "",
    address_city: "",
    address_zip: "",
    address_country: "España",
  });

  const [profile, setProfile] = useState(null);
  const [userProducts, setUserProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Prioridad: perfil real de la BD → datos de la sesión → (nunca un usuario mock random)
  const rawUser = profile || {
    id: session?.id,
    name: session?.name || "Usuario",
    username: session?.username || "",
    initials: session?.initials || String(session?.name || "U").charAt(0).toUpperCase(),
    balance: 0,
    level: 1,
    rating: 0,
    sales: 0,
    member_since: session?.registeredAt || null,
    location: session?.location || "",
    bio: "",
    address_complete: false,
  };
  const memberSince = rawUser.member_since || rawUser.memberSince;
  const memberSinceText = memberSince
    ? new Date(memberSince).toLocaleDateString("es-ES", { year: "numeric", month: "long" })
    : "Hoy";
  const user = { ...rawUser, memberSince: memberSinceText };
  const walletBalance = Number(user.balance || 0);
  const walletFee = 0.5;
  const walletNet = Math.max(walletBalance - walletFee, 0);
  const purchases = orders.filter((o) => o.buyer_id === user.id);
  const sales = orders.filter((o) => o.seller_id === user.id);
  const isVerified = (purchases.length + sales.length) >= 10;

  const selectedCountry = findCountry(form.address_country) || {
    lat: 40.42,
    lon: -3.7,
    name: COUNTRIES[0].name,
  };

  useEffect(() => {
    getProfile().then((p) => {
      if (p) setProfile(p);
    }).finally(() => {
      const t = setTimeout(() => setLoading(false), 450);
    });
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    fetch(`/api/products/search?limit=100`)
      .then((r) => r.json())
      .then((data) => {
        const mine = (data.products || []).filter((p) => {
          const sellerId = typeof p.seller === "object" ? p.seller?.id : p.seller;
          return sellerId === user.id;
        });
        setUserProducts(mine);
      })
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setOrders(data.orders || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name || "",
        username: profile.username || "",
        bio: profile.bio || "",
        location: profile.location || "",
        address_street: profile.address_street || "",
        address_city: profile.address_city || "",
        address_zip: profile.address_zip || "",
        address_country: profile.address_country || "España",
      });
    }
  }, [profile]);

  const handleWithdrawConfirm = () => {
    setWithdrawDone(true);
    setTimeout(() => {
      setWithdrawDone(false);
      setWithdrawModal(false);
    }, 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateProfile(form);
      if (updated) {
        setProfile(updated);
        showToast("Perfil actualizado", "success");
      } else {
        showToast("Error al guardar", "error");
      }
    } catch {
      showToast("Error de red", "error");
    }
    setSaving(false);
    setEditing(false);
  };

  const handleLogout = () => {
    setLogoutModal(false);
    try {
      localStorage.removeItem("colecciona_session");
    } catch {}
    setSession(null);
    window.location.href = "/auth";
  };

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        {/* User Banner / Header */}
        {loading ? (
          <Skeleton type="profile" />
        ) : (
        <div className={styles.userCard}>
          <div className={styles.userTop}>
            <div className={styles.avatarCircle}>
              {user.initials || (user.name || "").charAt(0)}
            </div>

            <div className={styles.userMeta}>
              {editing ? (
                <div className={styles.editForm}>
                  <input
                    className={styles.input}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Nombre"
                  />
                  <input
                    className={styles.input}
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="Username"
                  />
                  <textarea
                    className={styles.textarea}
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    placeholder="Bio (opcional)"
                    rows={2}
                  />
                  <input
                    className={styles.input}
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                    placeholder="Ubicación"
                  />
                  <div className={styles.addressSection}>
                    <span className={styles.addressTitle}>Dirección de envío (obligatoria para vender)</span>
                    <input
                      className={styles.input}
                      value={form.address_street}
                      onChange={(e) => setForm({ ...form, address_street: e.target.value })}
                      placeholder="Calle y número"
                    />
                    <div className={styles.addressRow2}>
                      <input
                        className={styles.input}
                        value={form.address_city}
                        onChange={(e) => setForm({ ...form, address_city: e.target.value })}
                        placeholder="Ciudad"
                      />
<input
                      className={styles.input}
                      value={form.address_zip}
                      onChange={(e) => setForm({ ...form, address_zip: e.target.value })}
                      placeholder="C.P."
                    />
                  </div>
                </div>
                <div className={styles.countrySection}>
                  <div className={styles.countryGlobe}>
                    <CountryGlobe
                      lat={selectedCountry.lat}
                      lon={selectedCountry.lon}
                      label={selectedCountry.name}
                      code={selectedCountry.code}
                      size={220}
                    />
                  </div>
                  <div className={styles.countryFields}>
                    <label className={styles.fieldLabel} htmlFor="country-select">País donde vives</label>
                    <select
                      id="country-select"
                      className={styles.input}
                      value={form.address_country}
                      onChange={(e) => setForm({ ...form, address_country: e.target.value })}
                    >
                      {!COUNTRIES.some((c) => c.name === form.address_country) &&
                        form.address_country && (
                          <option value={form.address_country}>{form.address_country}</option>
                        )}
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <p className={styles.countryHint}>Se marca en el globo con un punto esmeralda.</p>
                  </div>
                </div>
              <div className={styles.editActions}>
                    <button className={styles.cancelBtnSmall} onClick={() => setEditing(false)}>Cancelar</button>
                    <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.nameRow}>
                    <h1 className={styles.userName}>{user.name}</h1>
                    {isVerified && <VerifiedBadge />}
                    <LevelBadge level={user.level} />
                    <button className={styles.editBtn} onClick={() => setEditing(true)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                  <span className={styles.userHandle}>@{user.username} • {user.location}</span>
                  <span className={styles.memberDate}>Miembro activo desde {user.memberSince}</span>
                  {user.bio && <span className={styles.userBio}>{user.bio}</span>}
                  {!user.address_complete && (
                    <button className={styles.addressWarningBtn} onClick={() => setEditing(true)}>
                      ⚠️ Completa tu dirección para poder vender — <u>Tópcalo aquí</u>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className={styles.statsRow}>
            <div className={styles.statBox}>
              <span className={styles.statVal}><AnimatedCounter value={Number(user.sales || 0)} /></span>
              <span className={styles.statLbl}>Ventas Realizadas</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statBox}>
              <span className={styles.statVal}><AnimatedCounter value={Number(user.purchases || 0)} /></span>
              <span className={styles.statLbl}>Compras</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statBox}>
              <span className={styles.statVal}>
                {Number(user.rating) > 0 ? `★ ${user.rating}` : "—"}
              </span>
              <span className={styles.statLbl}>{Number(user.rating) > 0 ? "Valoración" : "Sin valoraciones"}</span>
            </div>
          </div>
        </div>
        )}

        {/* Virtual Wallet Card */}
        <div className={styles.walletCard}>
          <div className={styles.walletHeader}>
            <div className={styles.walletTitleGroup}>
              <div className={styles.walletIcon}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div>
                <span className={styles.walletName}>Wallet Colecciona (Stripe Escrow)</span>
                <span className={styles.walletSub}>Cuenta de pago regulada PSD2</span>
              </div>
            </div>

            <span className={styles.escrowChip}>🔒 Custodia Bancaria Activa</span>
          </div>

          <div className={styles.walletBalanceRow}>
            <div>
              <span className={styles.balanceVal}>
                {(Number(user.balance || 0)).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
              </span>
              <span className={styles.balanceLbl}>Saldo Líquido Disponible</span>
            </div>

            <Magnetic strength={0.2}>
              <button className={styles.withdrawBtn} onClick={() => setWithdrawModal(true)}>
                Retirar a Cuenta Bancaria
              </button>
            </Magnetic>
          </div>

          <div className={styles.walletFooter}>
            <span>Fee único de payout bancario: 0,50 €</span>
            <span className={styles.freeNotice}>
              ¡Las compras internas usando tu saldo tienen 0% de comisión!
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabSection}>
          <div className={styles.tabHeader}>
            <button
              className={`${styles.tabBtn} ${tab === "selling" ? styles.tabActive : ""}`}
              onClick={() => setTab("selling")}
            >
              En Venta ({userProducts.length})
            </button>
            <button
              className={`${styles.tabBtn} ${tab === "purchases" ? styles.tabActive : ""}`}
              onClick={() => setTab("purchases")}
            >
              Mis Compras
            </button>
            <button
              className={`${styles.tabBtn} ${tab === "sales" ? styles.tabActive : ""}`}
              onClick={() => setTab("sales")}
            >
              Mis Ventas
            </button>
          </div>

          {/* Tab Contents */}
          <div className={styles.tabContent}>
            {tab === "selling" && (
              loading ? (
                <Skeleton type="card" count={6} />
              ) : (
              <div className={styles.productGrid}>
                {userProducts.map((p) => (
                  <ProductCard key={p.id} product={p} seller={user} />
                ))}
              </div>
              )
            )}

            {tab === "purchases" && (
              <>
                {historyLoading ? (
                  <Skeleton type="card" count={3} />
                ) : purchases.length ? (
                  <div className={styles.historyList}>
                    {purchases.map((o) => (
                      <div key={o.id} className={styles.historyItem}>
                        <div className={styles.historyInfo}>
                          <span className={styles.itemTitle}>{o.product?.title || "Compra"}</span>
                          <span className={styles.itemMeta}>
                            {new Date(o.created_at).toLocaleDateString("es-ES")} • {o.shipping_method || "Envío por gestionar"}
                          </span>
                        </div>
                        <div className={styles.historyRight}>
                          <span className={styles.priceVal}>{Number(o.total || o.price || 0).toFixed(2)} €</span>
                          <StatusBadge status={o.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.historyEmpty}>
                    <p>No tienes compras todavía.</p>
                    <Link href="/marketplace" className={styles.historyEmptyLink}>Explorar mercado</Link>
                  </div>
                )}
              </>
            )}

            {tab === "sales" && (
              <>
                {historyLoading ? (
                  <Skeleton type="card" count={3} />
                ) : sales.length ? (
                  <div className={styles.historyList}>
                    {sales.map((o) => (
                      <div key={o.id} className={styles.historyItem}>
                        <div className={styles.historyInfo}>
                          <span className={styles.itemTitle}>{o.product?.title || "Venta"}</span>
                          <span className={styles.itemMeta}>
                            {new Date(o.created_at).toLocaleDateString("es-ES")} • {o.shipping_method || "Envío por gestionar"}
                          </span>
                        </div>
                        <div className={styles.historyRight}>
                          <span className={styles.priceNet}>+{(Number(o.price || 0) * 0.92).toFixed(2)} €</span>
                          <StatusBadge status={o.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className={styles.historyEmpty}>No tienes ventas todavía.</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Cerrar sesión */}
        <div className={styles.logoutSection}>
          <button className={styles.logoutBtn} onClick={() => setLogoutModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Cerrar sesión
          </button>
        </div>

        {/* Logout Modal */}
        {logoutModal && (
          <div className={styles.modalOverlay} onClick={() => setLogoutModal(false)}>
            <div className={`${styles.modalDialog} modal-enter`} onClick={(e) => e.stopPropagation()}>
              <h3 className={styles.modalTitle}>¿Estás seguro?</h3>
              <p className={styles.modalSub}>
                Vas a cerrar la sesión. Tendrás que volver a iniciar sesión para publicar o comprar.
              </p>
              <div className={styles.modalActions}>
                <button className={styles.cancelBtn} onClick={() => setLogoutModal(false)}>
                  Cancelar
                </button>
                <button className={styles.confirmBtn} onClick={handleLogout}>
                  Sí, cerrar sesión
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Withdraw Modal */}
        {withdrawModal && (
          <div className={styles.modalOverlay} onClick={() => setWithdrawModal(false)}>
            <div className={`${styles.modalDialog} modal-enter`} onClick={(e) => e.stopPropagation()}>
              {withdrawDone ? (
                <div className={styles.modalSuccess}>
                  <h3>¡Transferencia en Proceso!</h3>
                  <p>Se han enviado {walletNet.toLocaleString("es-ES", { minimumFractionDigits: 2 })} € (saldo menos 0,50€ fee) a tu IBAN registrado.</p>
                </div>
              ) : (
                <>
                  <h3 className={styles.modalTitle}>Retirar Saldo de Wallet</h3>
                  <p className={styles.modalSub}>El dinero se transferirá por SEPA Instant a tu banco habitual.</p>

                  <div className={styles.withdrawSummary}>
                    <div className={styles.row}>
                      <span>Saldo actual en Wallet:</span>
                      <span className={styles.mono}>
                        {(Number(user.balance || 0)).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </span>
                    </div>
                    <div className={styles.row}>
                      <span>Fee de payout SEPA:</span>
                      <span className={styles.fee}>-0,50 €</span>
                    </div>
                    <div className={`${styles.row} ${styles.totalRow}`}>
                      <span>Importe abonado en tu IBAN:</span>
                      <span className={styles.netVal}>
                        {walletNet.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </span>
                    </div>
                  </div>

                  <div className={styles.modalActions}>
                    <button className={styles.cancelBtn} onClick={() => setWithdrawModal(false)}>
                      Cancelar
                    </button>
                    <button className={styles.confirmBtn} onClick={handleWithdrawConfirm}>
                      Confirmar Retirada SEPA
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
