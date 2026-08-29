import React, { useState } from 'react';
import styles from './ReviewModal.module.css';
import StarRating from './StarRating';
import { useApp } from '@/context/AppContext';

export default function ReviewModal({ orderId, targetUser, product, onClose }) {
  const { addReview } = useApp();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (rating === 0) return;
    setIsSubmitting(true);
    setTimeout(() => {
      addReview(orderId, targetUser.id, rating, comment);
      setIsSubmitting(false);
      onClose();
    }, 500);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        
        <h2 className={styles.title}>Valora tu experiencia</h2>
        
        {product && (
          <div className={styles.productInfo}>
            <img src={product.image || 'https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?auto=format&fit=crop&q=80&w=150&h=150'} alt={product.title} className={styles.productImg} />
            <div className={styles.productDetails}>
              <span className={styles.productTitle}>{product.title}</span>
              <span className={styles.seller}>Vendedor: @{targetUser?.username}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.ratingSection}>
            <p className={styles.ratingLabel}>¿Qué tal fue la compra con @{targetUser?.username}?</p>
            <StarRating rating={rating} onChange={setRating} />
          </div>

          <textarea
            className={styles.textarea}
            placeholder="Cuéntale a la comunidad tu experiencia (opcional)..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows="4"
          />

          <button 
            type="submit" 
            className={styles.submitBtn} 
            disabled={rating === 0 || isSubmitting}
          >
            {isSubmitting ? 'Publicando...' : 'Publicar valoración'}
          </button>
        </form>
      </div>
    </div>
  );
}
