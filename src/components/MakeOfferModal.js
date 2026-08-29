'use client';

import React, { useState } from 'react';
import styles from './MakeOfferModal.module.css';
import { useApp } from '@/context/AppContext';

export default function MakeOfferModal({ product, onClose }) {
  const { session, showToast } = useApp();
  const [amount, setAmount] = useState(product?.price || 0);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!product) return null;

  const minOffer = product.price * 0.5;
  const maxOffer = product.price * 0.99;

  const percentage = (amount / product.price) * 100;
  let statusClass = styles.statusGreen;
  if (percentage < 60) statusClass = styles.statusRed;
  else if (percentage < 80) statusClass = styles.statusAmber;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (amount < minOffer || amount > maxOffer) return;

    setSending(true);
    try {
      const token = session?.access_token || session?.accessToken;
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productId: product.id,
          amount,
          message: message || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        showToast(`Oferta de ${amount.toFixed(2)} EUR enviada`, 'success');
        onClose();
      } else {
        showToast(data.error || 'Error al enviar oferta', 'error');
      }
    } catch (err) {
      showToast('Error de conexion', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Hacer una oferta"
      >
        <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <h2 className={styles.title}>Hacer una oferta</h2>

        <div className={styles.productInfo}>
          <img src={product.image} alt={product.title} className={styles.productImg} />
          <div className={styles.productDetails}>
            <span className={styles.productTitle}>{product.title}</span>
            <span className={styles.productPrice}>Precio original: {product.price.toFixed(2)} EUR</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Tu oferta (EUR)</label>
            <div className={styles.priceInputWrapper}>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                min={minOffer}
                max={maxOffer}
                step="0.50"
                autoFocus
                className={styles.numberInput}
              />
              <span className={`${styles.percentage} ${statusClass}`}>
                {percentage.toFixed(0)}% del precio original
              </span>
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Mensaje al vendedor (opcional)</label>
            <textarea
              className={styles.textarea}
              placeholder="Ej: Hola! Estaria interesado en comprarla a este precio..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows="3"
            />
          </div>

          <p className={styles.note}>Las ofertas caducan a las 48 horas.</p>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={amount < minOffer || amount > maxOffer || sending}
          >
            {sending ? 'Enviando...' : 'Enviar oferta'}
          </button>
        </form>
      </div>
    </div>
  );
}
