'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import ShippingQR from '@/components/ShippingQR';
import styles from './page.module.css';
import { ORDER_STATES, normalizeOrderStatus } from '@/lib/orderStates';

export default function OrdersPage() {
  const { session, showToast, addReview } = useApp();
  const [activeTab, setActiveTab] = useState('compras');
  const [orders, setOrders] = useState([]);
  const [sales, setSales] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isShippingModalOpen, setIsShippingModalOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [trackingCode, setTrackingCode] = useState('');

  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewOrderId, setReviewOrderId] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewedOrderIds, setReviewedOrderIds] = useState(new Set());

  const token = session?.access_token || session?.accessToken;

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const [ordersRes, offersRes] = await Promise.all([
          fetch('/api/orders', { headers }),
          fetch('/api/offers?type=received', { headers }),
        ]);

        const ordersData = ordersRes.ok ? await ordersRes.json() : { orders: [] };
        const offersData = offersRes.ok ? await offersRes.json() : { offers: [] };

        const myOrders = (ordersData.orders || []).filter(o => o.buyer_id === session?.id);
        const mySales = (ordersData.orders || []).filter(o => o.seller_id === session?.id);

        setOrders(myOrders);
        setSales(mySales);
        setOffers(offersData.offers || []);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    }

    if (token || session?.id) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [token, session]);

  const getInitials = (name) => {
    return name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
  };

  const openShippingModal = (saleId) => {
    setSelectedSaleId(saleId);
    setTrackingCode('');
    setIsShippingModalOpen(true);
  };

  const handleShippingSubmit = async () => {
    if (!trackingCode.trim() || !selectedSaleId) return;

    try {
      const res = await fetch(`/api/orders/${selectedSaleId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: ORDER_STATES.SHIPPED, tracking_code: trackingCode }),
      });

      const data = await res.json();
      if (data.success) {
        setSales(prev => prev.map(s =>
          s.id === selectedSaleId ? { ...s, status: ORDER_STATES.SHIPPED, tracking_code: trackingCode } : s
        ));
        setIsShippingModalOpen(false);
        showToast('Envio marcado como enviado', 'success');
      } else {
        showToast(data.error || 'Error al actualizar', 'error');
      }
    } catch (err) {
      showToast('Error de conexion', 'error');
    }
  };

  const handleConfirmDelivery = async (orderId) => {
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: ORDER_STATES.COMPLETED }),
      });

      const data = await res.json();
      if (data.success) {
        setOrders(prev => prev.map(o =>
          o.id === orderId ? { ...o, status: ORDER_STATES.COMPLETED } : o
        ));
        showToast('Recepcion confirmada! Valoracion disponible.', 'success');
      } else {
        showToast(data.error || 'Error al confirmar', 'error');
      }
    } catch (err) {
      showToast('Error de conexion', 'error');
    }
  };

  const handleRespondToOffer = async (offerId, action, counterAmount) => {
    try {
      const body = { status: action };
      if (action === 'countered' && counterAmount) {
        body.counter_amount = counterAmount;
      }

      const res = await fetch(`/api/offers/${offerId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setOffers(prev => prev.map(o =>
          o.id === offerId ? { ...o, status: action, amount: counterAmount || o.amount } : o
        ));
        const labels = { accepted: 'Oferta aceptada', rejected: 'Oferta rechazada', countered: 'Contraoferta enviada' };
        showToast(labels[action] || 'Oferta actualizada', action === 'accepted' ? 'success' : 'info');
      } else {
        showToast(data.error || 'Error al responder', 'error');
      }
    } catch (err) {
      showToast('Error de conexion', 'error');
    }
  };

  const handleSubmitReview = async () => {
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          orderId: reviewOrderId,
          rating: reviewRating,
          comment: reviewComment,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setReviewedOrderIds(prev => new Set([...prev, reviewOrderId]));
        setReviewModalOpen(false);
        setReviewOrderId(null);
        setReviewRating(5);
        setReviewComment('');
        showToast('Resena enviada! Gracias.', 'success');
      } else {
        showToast(data.error || 'Error al enviar resena', 'error');
      }
    } catch (err) {
      showToast('Error de conexion', 'error');
    }
  };

  const getStatusBadge = (status) => {
    switch (normalizeOrderStatus(status)) {
      case ORDER_STATES.PENDING: return <span className={`${styles.badge} ${styles.amber}`}>Pendiente</span>;
      case ORDER_STATES.PAYMENT_PROCESSING: return <span className={`${styles.badge} ${styles.amber}`}>Pago en proceso</span>;
      case ORDER_STATES.PAID: return <span className={`${styles.badge} ${styles.amber}`}>Pagado - Esperando envio</span>;
      case ORDER_STATES.PREPARING: return <span className={`${styles.badge} ${styles.amber}`}>Preparando</span>;
      case ORDER_STATES.SHIPPED: return <span className={`${styles.badge} ${styles.blue}`}>En camino</span>;
      case ORDER_STATES.DELIVERED: return <span className={`${styles.badge} ${styles.blue}`}>Recibido</span>;
      case ORDER_STATES.COMPLETED: return <span className={`${styles.badge} ${styles.emerald}`}>Completado</span>;
      case ORDER_STATES.CANCELLED: return <span className={`${styles.badge} ${styles.rose}`}>Cancelado</span>;
      case ORDER_STATES.REFUNDED: return <span className={`${styles.badge} ${styles.rose}`}>Reembolsado</span>;
      case ORDER_STATES.DISPUTED: return <span className={`${styles.badge} ${styles.rose}`}>En disputa</span>;
      case 'accepted': return <span className={`${styles.badge} ${styles.emerald}`}>Aceptada</span>;
      case 'rejected': return <span className={`${styles.badge} ${styles.rose}`}>Rechazada</span>;
      case 'countered': return <span className={`${styles.badge} ${styles.violet}`}>Contraoferta</span>;
      default: return <span className={styles.badge}>{status}</span>;
    }
  };

  const renderProgressBar = (status) => {
    const normalized = normalizeOrderStatus(status);
    const steps = [ORDER_STATES.PAID, ORDER_STATES.SHIPPED, ORDER_STATES.COMPLETED];
    let currentIndex = steps.indexOf(normalized);
    if (currentIndex === -1) currentIndex = 0;
    if ([ORDER_STATES.CANCELLED, ORDER_STATES.REFUNDED, ORDER_STATES.DISPUTED].includes(normalized)) return null;

    return (
      <div className={styles.progressBar}>
        {['Pagado', 'Enviado', 'Entregado'].map((label, idx) => (
          <div key={idx} className={styles.progressStep}>
            <div className={`${styles.stepDot} ${idx < currentIndex ? styles.completed : idx === currentIndex ? styles.active : ''}`}>
              {idx < currentIndex ? '✓' : (idx + 1)}
            </div>
            <span className={`${styles.stepLabel} ${idx <= currentIndex ? styles.active : ''}`}>{label}</span>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>Cargando...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Panel de Actividad</h1>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'compras' ? styles.active : ''}`}
            onClick={() => setActiveTab('compras')}
          >
            Mis Compras
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'ventas' ? styles.active : ''}`}
            onClick={() => setActiveTab('ventas')}
          >
            Mis Ventas
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'ofertas' ? styles.active : ''}`}
            onClick={() => setActiveTab('ofertas')}
          >
            Ofertas
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {activeTab === 'compras' && (
          <div className={styles.cardList}>
            {orders.length > 0 ? orders.map(order => (
              <div key={order.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.productInfo}>
                    <img src={order.product?.image || 'https://via.placeholder.com/80'} alt={order.product?.title} className={styles.productImage} />
                    <div className={styles.productDetails}>
                      <span className={styles.productTitle}>{order.product?.title || 'Producto'}</span>
                      <span className={styles.productPrice}>{order.total || order.price} €</span>
                      <div className={styles.partnerInfo}>
                        Vendedor:
                        <div className={styles.avatar}>{getInitials(order.seller?.name)}</div>
                        {order.seller?.name || 'Usuario'}
                      </div>
                    </div>
                  </div>
                  <div className={styles.cardActions}>
                    {getStatusBadge(order.status)}
                    <span className={styles.date}>{order.created_at ? new Date(order.created_at).toLocaleDateString('es-ES') : '—'}</span>
                  </div>
                </div>

                <div className={styles.cardBody}>
                  {order.shipping_method && (
                    <div className={styles.shippingInfo}>
                      <span>Envio: {order.shipping_method}</span>
                      {order.tracking_code && <span>Seguimiento: <span className={styles.trackingCode}>{order.tracking_code}</span></span>}
                    </div>
                  )}

                  {renderProgressBar(order.status)}

                  {normalizeOrderStatus(order.status) === ORDER_STATES.SHIPPED && (
                    <button
                      className={`${styles.actionButton} ${styles.primary}`}
                      onClick={() => handleConfirmDelivery(order.id)}
                    >
                      CONFIRMAR RECEPCION
                    </button>
                  )}
                  {normalizeOrderStatus(order.status) === ORDER_STATES.COMPLETED && !reviewedOrderIds.has(order.id) && !order.reviewed && (
                    <button
                      className={`${styles.actionButton} ${styles.success}`}
                      onClick={() => {
                        setReviewOrderId(order.id);
                        setReviewRating(5);
                        setReviewComment('');
                        setReviewModalOpen(true);
                      }}
                    >
                      Valorar Compra
                    </button>
                  )}
                </div>
              </div>
            )) : (
              <div className={styles.emptyState}>No tienes compras recientes.</div>
            )}
          </div>
        )}

        {activeTab === 'ventas' && (
          <div className={styles.cardList}>
            {sales.length > 0 ? sales.map(sale => {
              const priceNum = parseFloat(sale.price || 0);
              const earning = (priceNum * 0.92).toFixed(2);

              return (
                <div key={sale.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.productInfo}>
                      <img src={sale.product?.image || 'https://via.placeholder.com/80'} alt={sale.product?.title} className={styles.productImage} />
                      <div className={styles.productDetails}>
                        <span className={styles.productTitle}>{sale.product?.title || 'Producto'}</span>
                        <div className={styles.partnerInfo}>
                          Comprador:
                          <div className={styles.avatar}>{getInitials(sale.buyer?.name)}</div>
                          {sale.buyer?.name || 'Usuario'}
                        </div>
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      {getStatusBadge(sale.status)}
                      <span className={styles.date}>{sale.created_at ? new Date(sale.created_at).toLocaleDateString('es-ES') : '—'}</span>
                    </div>
                  </div>

                  <div className={styles.cardBody}>
                    <div className={styles.shippingInfo}>
                      <span>Precio venta: {sale.price} €</span>
                      <span>Cobraras (aprox): <strong className={styles.trackingCode}>{earning} €</strong></span>
                    </div>

                    {renderProgressBar(sale.status)}

                    {normalizeOrderStatus(sale.status) === ORDER_STATES.SHIPPED && sale.tracking_code && (
                      <div className={styles.shippingInfo} style={{ alignItems: 'center' }}>
                        <ShippingQR
                          value={`https://colecciona.com/rastreo/${encodeURIComponent(sale.tracking_code)}`}
                          label={`QR de envío · ${sale.tracking_code}`}
                          size={140}
                        />
                      </div>
                    )}

                    {normalizeOrderStatus(sale.status) === ORDER_STATES.PAID && (
                      <button
                        className={`${styles.actionButton} ${styles.primary}`}
                        onClick={() => openShippingModal(sale.id)}
                      >
                        Marcar como enviado
                      </button>
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className={styles.emptyState}>No tienes ventas recientes.</div>
            )}
          </div>
        )}

        {activeTab === 'ofertas' && (
          <div className={styles.cardList}>
            {offers.length > 0 ? offers.map(offer => {
              const isReceived = offer.to_user_id === session?.id;
              const partner = isReceived ? offer.from_user : offer.to_user;
              const fmt = (n) => `${Number(n || 0).toFixed(2)} €`;

              return (
                <div key={offer.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <div className={styles.productInfo}>
                      <img src={offer.product?.image || 'https://via.placeholder.com/80'} alt={offer.product?.title} className={styles.productImage} />
                      <div className={styles.productDetails}>
                        <span className={styles.productTitle}>{offer.product?.title || 'Producto'}</span>
                        <span className={styles.productPrice}>Oferta: {fmt(offer.amount)} · Original: {fmt(offer.original_price)}</span>
                        <div className={styles.partnerInfo}>
                          {isReceived ? 'De:' : 'Para:'}
                          <div className={styles.avatar}>{getInitials(partner?.name)}</div>
                          {partner?.name || 'Usuario'}
                        </div>
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      {getStatusBadge(offer.status)}
                      <span className={styles.date}>{offer.created_at ? new Date(offer.created_at).toLocaleDateString('es-ES') : '—'}</span>
                    </div>
                  </div>

                  <div className={styles.cardBody}>
                    {offer.message && (
                      <div className={styles.shippingInfo}>
                        <span>Mensaje: &ldquo;{offer.message}&rdquo;</span>
                      </div>
                    )}

                    {isReceived && offer.status === 'pending' && (
                      <OfferActions offer={offer} onRespond={handleRespondToOffer} />
                    )}
                  </div>
                </div>
              );
            }) : (
              <div className={styles.emptyState}>No hay ofertas activas.</div>
            )}
          </div>
        )}
      </div>

      {isShippingModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Ingresar Codigo de Seguimiento</h3>
            <p className={styles.date}>Ingresa el codigo de la paqueteria para notificar al comprador.</p>
            <input
              type="text"
              className={styles.input}
              placeholder="Ej. TRK123456789"
              value={trackingCode}
              onChange={(e) => setTrackingCode(e.target.value)}
              autoFocus
            />
            <div className={styles.modalButtons}>
              <button className={styles.cancelButton} onClick={() => setIsShippingModalOpen(false)}>
                Cancelar
              </button>
              <button
                className={`${styles.actionButton} ${styles.primary}`}
                onClick={handleShippingSubmit}
                disabled={!trackingCode.trim()}
              >
                Confirmar Envio
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3>Dejar Resena</h3>
            <div style={{ display: 'flex', gap: '4px', margin: '12px 0' }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => setReviewRating(star)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '28px',
                    cursor: 'pointer',
                    color: star <= reviewRating ? '#f59e0b' : '#4b5563',
                    padding: '2px',
                  }}
                >
                  ★
                </button>
              ))}
            </div>
            <textarea
              className={styles.input}
              placeholder="Cuenta tu experiencia (opcional)"
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
            <div className={styles.modalButtons}>
              <button className={styles.cancelButton} onClick={() => setReviewModalOpen(false)}>
                Cancelar
              </button>
              <button
                className={`${styles.actionButton} ${styles.success}`}
                onClick={handleSubmitReview}
              >
                Enviar Resena
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OfferActions({ offer, onRespond }) {
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterValue, setCounterValue] = useState(offer.amount);
  const [counterMessage, setCounterMessage] = useState('');

  return (
    <>
      <div className={styles.offerButtons}>
        <button
          className={`${styles.actionButton} ${styles.success}`}
          onClick={() => onRespond(offer.id, 'accepted')}
        >
          Aceptar
        </button>
        <button
          className={`${styles.actionButton} ${styles.danger}`}
          onClick={() => onRespond(offer.id, 'rejected')}
        >
          Rechazar
        </button>
        <button
          className={`${styles.actionButton} ${styles.primary}`}
          onClick={() => {
            setCounterOpen(!counterOpen);
            setCounterValue(offer.amount);
            setCounterMessage('');
          }}
        >
          Contraoferta
        </button>
      </div>

      {counterOpen && (
        <div className={styles.counterPanel}>
          <span className={styles.counterLabel}>Negocia el precio:</span>
          <div className={styles.counterRow}>
            <input
              type="number"
              step="0.50"
              min="1"
              className={styles.input}
              value={counterValue}
              onChange={(e) => setCounterValue(Number(e.target.value))}
              placeholder="Tu precio (EUR)"
            />
          </div>
          <input
            type="text"
            className={styles.input}
            value={counterMessage}
            onChange={(e) => setCounterMessage(e.target.value)}
            placeholder="Mensaje (opcional)"
          />
          <button
            className={`${styles.actionButton} ${styles.primary}`}
            disabled={!counterValue || Number(counterValue) <= 0}
            onClick={() => {
              onRespond(offer.id, 'countered', Number(counterValue));
              setCounterOpen(false);
            }}
          >
            Enviar contraoferta
          </button>
        </div>
      )}
    </>
  );
}
