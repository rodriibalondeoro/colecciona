"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useApp } from "@/context/AppContext";
import { users } from "@/data/mockData";
import styles from "./page.module.css";

export default function AdminPage() {
  const { orders = [], sales = [], offers = [], respondToOffer, showToast } = useApp();
  const [activeTab, setActiveTab] = useState("transactions");

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [disputes, setDisputes] = useState([]);
  const [resolvingId, setResolvingId] = useState(null);
  const [fraudFlags, setFraudFlags] = useState([]);

  useEffect(() => {
    async function fetchStats() {
      try {
        const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
        const res = await fetch("/api/admin/stats", {
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setStats(data.stats);
        }
      } catch (e) {
        console.warn("[Admin] Stats fetch error:", e?.message);
      }
      setLoading(false);
    }
    fetchStats();
  }, []);

  useEffect(() => {
    async function fetchDisputes() {
      try {
        const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
        const res = await fetch("/api/admin/disputes", {
          headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          setDisputes(data.orders || []);
        }
      } catch (e) {
        console.warn("[Admin] Disputes fetch error:", e?.message);
      }
    }
    fetchDisputes();
  }, []);

  const [bannedIds, setBannedIds] = useState([]);
  const allUsers = users.map((u) => ({ ...u, banned: bannedIds.includes(u.id) }));

  const handleResolveDispute = async (orderId, resolution) => {
    if (resolvingId) return;
    setResolvingId(orderId);
    try {
      const session = JSON.parse(localStorage.getItem("colecciona_session") || "null");
      const res = await fetch("/api/admin/disputes/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: session?.token ? `Bearer ${session.token}` : "",
        },
        body: JSON.stringify({ orderId, type: resolution }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Error al resolver la disputa", "error");
        return;
      }
      setDisputes((prev) => prev.filter((d) => d.id !== orderId));
      const msg = resolution === "refund"
        ? "Reembolso iniciado para el comprador."
        : "Disputa resuelta — fondos liberados al vendedor.";
      showToast(msg, "success");
    } catch (err) {
      showToast("Error de red al resolver la disputa", "error");
    } finally {
      setResolvingId(null);
    }
  };

  const handleActionFraud = (id, action) => {
    setFraudFlags((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: action } : f))
    );
    showToast(`Acción "${action}" aplicada al sospechoso con éxito.`, "info");
  };

  const handleBan = (id, user) => {
    setBannedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    const isBanned = bannedIds.includes(id);
    showToast(
      isBanned ? `Cuenta @${user.username} desbloqueada.` : `Cuenta @${user.username} baneada.`,
      isBanned ? "info" : "warning"
    );
  };

  const escrowStatus = (status) => {
    switch (status) {
      case "paid": return { label: "Pagado · En escrow (48h)", cls: styles.statusAmber };
      case "shipped": return { label: "En camino · Escrow activo", cls: styles.statusBlue };
      case "review": return { label: "Recibido · Pendiente liberar", cls: styles.statusViolet };
      case "completed": return { label: "Completado · Fondos liberados", cls: styles.statusGreen };
      default: return { label: status, cls: styles.statusGray };
    }
  };

  const totalEscrow = orders
    .filter((o) => o.status === "paid" || o.status === "shipped" || o.status === "review")
    .reduce((acc, o) => acc + o.total, 0);

  const byStatus = stats?.byStatus || {};
  const maxStatusCount = Math.max(...Object.values(byStatus), 1);

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        <div className={styles.adminHeader}>
          <div>
            <div className={styles.adminBadge}>CENTRAL DE MEDIACIÓN</div>
            <h1 className={styles.title}>Panel de Control Colecciona</h1>
            <p className={styles.subtitle}>Supervisión de transacciones, custodia Stripe y robots anti-fraude.</p>
          </div>
          <div className={styles.escrowCard}>
            <div className={styles.escrowVal}>{totalEscrow.toFixed(2)} €</div>
            <div className={styles.escrowLbl}>Fondos Totales en Custodia (Stripe Escrow)</div>
          </div>
        </div>

        {/* Metrics Cards */}
        {stats && (
          <div className={styles.metricsGrid}>
            <div className={styles.metricCard}>
              <div className={styles.metricValue}>{stats.totalProducts}</div>
              <div className={styles.metricLabel}>Productos</div>
              <div className={styles.metricSub}>+{stats.recentProducts} últimos 30 días</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricValue}>{stats.totalUsers}</div>
              <div className={styles.metricLabel}>Usuarios</div>
              <div className={styles.metricSub}>+{stats.recentUsers} últimos 30 días</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricValue}>{stats.totalOrders}</div>
              <div className={styles.metricLabel}>Órdenes</div>
              <div className={styles.metricSub}>+{stats.recentOrders} últimos 30 días</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricValue}>{stats.totalRevenue.toFixed(2)} €</div>
              <div className={styles.metricLabel}>Ingresos</div>
              <div className={styles.metricSub}>Comisión: {stats.totalCommission.toFixed(2)} €</div>
            </div>
            <div className={styles.metricCard}>
              <div className={styles.metricValue}>{stats.totalMessages}</div>
              <div className={styles.metricLabel}>Mensajes</div>
              <div className={styles.metricSub}>Comunicación total</div>
            </div>
          </div>
        )}

        {/* Orders by Status Bar Chart */}
        {stats && Object.keys(byStatus).length > 0 && (
          <div className={styles.tableCard}>
            <h3>Órdenes por Estado</h3>
            <div className={styles.barChart}>
              {Object.entries(byStatus).map(([status, count]) => (
                <div key={status} className={styles.barRow}>
                  <span className={styles.barLabel}>{status}</span>
                  <div className={styles.barTrack}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${(count / maxStatusCount) * 100}%` }}
                    />
                  </div>
                  <span className={styles.barCount}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Controls */}
        <div className={styles.tabGroup}>
          <button
            className={`${styles.tab} ${activeTab === "transactions" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("transactions")}
          >
            💳 Transacciones ({orders.length + sales.length})
          </button>
          <button
            className={`${styles.tab} ${activeTab === "disputes" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("disputes")}
          >
            🛡️ Disputas y Reclamaciones ({disputes.filter((d) => d.status === "open").length})
          </button>
          <button
            className={`${styles.tab} ${activeTab === "fraud" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("fraud")}
          >
            🚨 Alertas Anti-Multicuenta ({fraudFlags.filter((f) => f.status === "pending_review").length})
          </button>
          <button
            className={`${styles.tab} ${activeTab === "users" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("users")}
          >
            👥 Usuarios y Baneos ({allUsers.filter((u) => u.banned).length})
          </button>
        </div>

        {/* Recent Activity Feed */}
        {stats && (
          <div className={styles.tableCard}>
            <h3>Actividad Reciente (30 días)</h3>
            <div className={styles.list}>
              {stats.recentProductsList.map((p) => (
                <div key={`rp-${p.id}`} className={styles.activityItem}>
                  <span className={styles.activityIcon}>📦</span>
                  <span>Nuevo producto: <strong>{p.title}</strong> — {Number(p.price).toFixed(2)} €</span>
                </div>
              ))}
              {stats.recentUsersList.map((u) => (
                <div key={`ru-${u.id}`} className={styles.activityItem}>
                  <span className={styles.activityIcon}>👤</span>
                  <span>Nuevo usuario: <strong>@{u.username}</strong></span>
                </div>
              ))}
              {stats.recentOrdersList.map((o) => (
                <div key={`ro-${o.id}`} className={styles.activityItem}>
                  <span className={styles.activityIcon}>🛒</span>
                  <span>Nueva orden: <strong>{o.id}</strong> — {Number(o.total).toFixed(2)} € ({o.status})</span>
                </div>
              ))}
              {!stats.recentProductsList.length && !stats.recentUsersList.length && !stats.recentOrdersList.length && (
                <div className={styles.empty}>Sin actividad reciente.</div>
              )}
            </div>
          </div>
        )}

        {/* Transactions Content */}
        {activeTab === "transactions" && (
          <div className={styles.tableCard}>
            <h3>Transacciones Activas y Escrow</h3>
            <p className={styles.desc}>
              Compraventas en curso. Los fondos permanecen en custodia hasta que el comprador confirma la recepción.
            </p>
            <div className={styles.list}>
              {orders.map((o) => {
                const st = escrowStatus(o.status);
                return (
                  <div key={o.id} className={styles.disputeItem}>
                    <div className={styles.disputeGrid}>
                      <div className={styles.evidenceColumn}>
                        <img src={(o.product && o.product.image) || "/images/cards/collection.png"} alt={o.product?.title} className={styles.thumb} />
                        <span className={styles.idLabel}>{o.id}</span>
                      </div>
                      <div className={styles.detailColumn}>
                        <div className={styles.row}>
                          <span className={styles.bold}>{o.product?.title || "Producto"}</span>
                          <span className={styles.priceLabel}>{Number(o.total || o.price).toFixed(2)} €</span>
                        </div>
                        <div className={styles.participants}>
                          Comprador: <strong>{o.buyer === "me" ? "@tú" : o.buyer}</strong> → Vendedor: <strong>@{o.seller?.username || "-"}</strong>
                        </div>
                        <div className={styles.statusRow}>
                          <span className={`${styles.statusBadge} ${st.cls}`}>{st.label}</span>
                        </div>
                      </div>
                      <div className={styles.actionsColumn}>
                        {o.status === "review" && (
                          <button
                            className={`${styles.btn} ${styles.btnSeller}`}
                            onClick={() => showToast(`Fondos de ${o.id} liberados al vendedor.`, "success")}
                          >
                            Liberar Fondos
                          </button>
                        )}
                        {(o.status === "paid" || o.status === "shipped") && (
                          <button
                            className={`${styles.btn} ${styles.btnBuyer}`}
                            onClick={() => showToast(`Reembolso de ${o.id} procesado.`, "info")}
                          >
                            Reembolsar (Escrow)
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {sales.map((s) => {
                const st = escrowStatus(s.status);
                return (
                  <div key={s.id} className={styles.disputeItem}>
                    <div className={styles.disputeGrid}>
                      <div className={styles.evidenceColumn}>
                        <img src={s.product?.image || "/images/cards/collection.png"} alt={s.product?.title} className={styles.thumb} />
                        <span className={styles.idLabel}>{s.id}</span>
                      </div>
                      <div className={styles.detailColumn}>
                        <div className={styles.row}>
                          <span className={styles.bold}>{s.product?.title || "Producto"}</span>
                          <span className={styles.priceLabel}>{Number(s.totalReceived || s.price).toFixed(2)} €</span>
                        </div>
                        <div className={styles.participants}>
                          Vendedor: <strong>{s.buyer === "me" ? "@tú" : s.buyer?.username || "-"}</strong> → Comprador: <strong>{s.buyer?.name || "-"}</strong>
                        </div>
                        <div className={styles.statusRow}>
                          <span className={`${styles.statusBadge} ${st.cls}`}>{st.label}</span>
                        </div>
                      </div>
                      <div className={styles.actionsColumn}>
                        {s.status === "paid" && (
                          <button
                            className={`${styles.btn} ${styles.btnSeller}`}
                            onClick={() => showToast(`Venta ${s.id} confirmada, fondos por liberar.`, "info")}
                          >
                            Confirmar Venta
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {orders.length + sales.length === 0 && (
                <div className={styles.empty}>No hay transacciones activas.</div>
              )}
            </div>
          </div>
        )}

        {/* Disputes Content */}
        {activeTab === "disputes" && (
          <div className={styles.tableCard}>
            <h3>Cola de Mediación de Pagos</h3>
            <div className={styles.list}>
              {disputes.map((d) => (
                <div key={d.id} className={styles.disputeItem}>
                  <div className={styles.disputeGrid}>
                    <div className={styles.evidenceColumn}>
                      <img src={d.products?.image || "/images/cards/collection.png"} alt="Evidencia" className={styles.thumb} />
                      <span className={styles.idLabel}>{d.id?.slice(0, 8)}</span>
                    </div>
                    <div className={styles.detailColumn}>
                      <div className={styles.row}>
                        <span className={styles.bold}>{d.products?.title || "Producto"}</span>
                        <span className={styles.priceLabel}>{Number(d.total_paid || d.subtotal || 0).toFixed(2)} €</span>
                      </div>
                      <div className={styles.participants}>
                        Comprador: <strong>{d.buyer?.name || d.buyer?.username || "-"}</strong> → Vendedor: <strong>{d.seller?.name || d.seller?.username || "-"}</strong>
                      </div>
                      <p className={styles.reasonText}>
                        <strong>Orden:</strong> {d.id}
                      </p>
                      <div className={styles.statusRow}>
                        <span className={`${styles.statusBadge} ${styles.statusAmber}`}>Abierta (En mediación)</span>
                      </div>
                    </div>
                    <div className={styles.actionsColumn}>
                      <button
                        className={`${styles.btn} ${styles.btnBuyer}`}
                        disabled={resolvingId === d.id}
                        onClick={() => handleResolveDispute(d.id, "refund")}
                      >
                        {resolvingId === d.id ? "Procesando..." : "Reembolsar Comprador"}
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnSeller}`}
                        disabled={resolvingId === d.id}
                        onClick={() => handleResolveDispute(d.id, "complete")}
                      >
                        {resolvingId === d.id ? "Procesando..." : "Liberar al Vendedor"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {disputes.length === 0 && (
                <div className={styles.empty}>No hay disputas abiertas.</div>
              )}
            </div>
          </div>
        )}

        {/* Fraud Content */}
        {activeTab === "fraud" && (
          <div className={styles.tableCard}>
            <h3>Detección Automática de Cuentas Múltiples</h3>
            <p className={styles.desc}>
              El robot anti-fraude analiza registros basándose en el número de teléfono, direcciones IP, identificadores de dispositivo y patrones de comportamiento.
            </p>
            <div className={styles.list}>
              {fraudFlags.map((f) => (
                <div key={f.id} className={styles.disputeItem}>
                  <div className={styles.fraudGrid}>
                    <div className={styles.detailColumn}>
                      <div className={styles.row}>
                        <span className={styles.flagName}>
                          Sospechoso: <span className={styles.bold}>{f.username}</span>
                        </span>
                        <span className={styles.confBadge}>Confianza: {f.confidence}</span>
                      </div>
                      <div className={styles.matchingDetail}>
                        Campo duplicado detectado: <strong>{f.matchingField}</strong>
                      </div>
                      <div className={styles.ownerDetail}>
                        Cuenta activa coincidente: <strong>{f.owner}</strong>
                      </div>
                      <div className={styles.ipDetail}>
                        IP de registro: <code>{f.ipAddress}</code> • {f.date}
                      </div>
                    </div>
                    <div className={styles.actionsColumn}>
                      {f.status === "pending_review" ? (
                        <>
                          <button
                            className={`${styles.btn} ${styles.btnBuyer}`}
                            onClick={() => handleActionFraud(f.id, "blocked")}
                          >
                            Bloquear permanentemente
                          </button>
                          <button
                            className={`${styles.btn} ${styles.btnWhite}`}
                            onClick={() => handleActionFraud(f.id, "dismissed")}
                          >
                            Descartar alerta
                          </button>
                        </>
                      ) : (
                        <span
                          className={`${styles.statusBadge} ${
                            f.status === "blocked" ? styles.statusRose : styles.statusGray
                          }`}
                        >
                          {f.status === "blocked" ? "Cuenta Bloqueada" : "Alerta Descartada"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Users Content */}
        {activeTab === "users" && (
          <div className={styles.tableCard}>
            <h3>Gestión de Cuentas y Baneos</h3>
            <p className={styles.desc}>
              Banco una cuenta sospechosa para bloquear su actividad en el mercado. El ban es reversible.
            </p>
            <div className={styles.list}>
              {allUsers.map((u) => (
                <div key={u.id} className={styles.disputeItem}>
                  <div className={styles.fraudGrid}>
                    <div className={styles.detailColumn}>
                      <div className={styles.row}>
                        <span className={styles.flagName}>
                          <span className={`${styles.avatar} ${u.banned ? styles.avatarBanned : ""}`}>
                            {u.initials || u.name?.charAt(0)}
                          </span>
                          <span className={styles.bold}>{u.name}</span>
                        </span>
                        <span className={styles.confBadge}>@{u.username}</span>
                      </div>
                      <div className={styles.matchingDetail}>
                        Ventas: <strong>{u.sales}</strong> · Valoración: <strong>★ {u.rating}</strong> · Respuesta: <strong>{u.responseTime}</strong>
                      </div>
                      <div className={styles.ipDetail}>
                        {u.location} · Miembro desde {u.memberSince}
                      </div>
                    </div>
                    <div className={styles.actionsColumn}>
                      {u.banned ? (
                        <>
                          <button
                            className={`${styles.btn} ${styles.btnWhite}`}
                            onClick={() => handleBan(u.id, u)}
                          >
                            Desbloquear cuenta
                          </button>
                          <span className={`${styles.statusBadge} ${styles.statusRose}`}>Baneada</span>
                        </>
                      ) : (
                        <button
                          className={`${styles.btn} ${styles.btnDanger}`}
                          onClick={() => handleBan(u.id, u)}
                        >
                          Banear cuenta
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
