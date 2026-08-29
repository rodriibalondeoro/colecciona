'use client';

import { useApp } from '@/context/AppContext';
import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';

// Using a fallback for ConditionBadge since it might not exist yet
const ConditionBadge = ({ condition }) => (
  <span className={styles.conditionBadge}>{condition}</span>
);

export default function CartPage() {
  const { cart, removeFromCart, cartTotal } = useApp();

  const protectionFee = cart.length > 0 ? 2.50 : 0; // Fixed fee for demo
  const subtotal = cartTotal.subtotal || 0;
  const shippingTotal = cartTotal.shipping || 0;
  const commission = cartTotal.commission || 0;
  const finalTotal = subtotal + shippingTotal + commission + protectionFee;

  if (!cart || cart.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIllustration}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <h1 className={styles.emptyTitle}>¡Tu cesta está vacía!</h1>
        <p className={styles.emptySubtitle}>Encuentra cartas únicas de los mejores vendedores.</p>
        <Link href="/marketplace" className={styles.primaryButton}>
          Ir al Mercado
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <h1 className={styles.pageTitle}>Tu Cesta ({cart.length})</h1>
      
      <div className={styles.content}>
        <div className={styles.itemsList}>
          {cart.map((item) => (
            <div key={item.product.id} className={styles.cartItem}>
              <div className={styles.itemImageWrapper}>
<Image 
                  src={item.product.image || '/placeholder.png'} 
                  fill
                  className={styles.itemImage}
                  style={{ objectFit: 'cover' }}
                />
              </div>
              <div className={styles.itemDetails}>
                <div className={styles.itemHeader}>
                  <h3 className={styles.itemTitle}>{item.product.title}</h3>
                  <button 
                    onClick={() => removeFromCart(item.product.id)} 
                    className={styles.removeButton}
                    aria-label="Eliminar producto"
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                
                <div className={styles.itemMeta}>
                  <ConditionBadge condition={item.product.condition || 'NM'} />
                  <span className={styles.sellerName}>Vendido por {item.product.seller?.username || item.shippingMethod?.name || 'Vendedor'}</span>
                </div>
                
                <div className={styles.itemPrice}>
                  {Number(item.product.price || 0).toFixed(2)} €
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.sidebar}>
          <div className={styles.summaryCard}>
            <h2 className={styles.summaryTitle}>Resumen del pedido</h2>
            
            <div className={styles.summaryRow}>
              <span>Subtotal productos</span>
              <span>{subtotal.toFixed(2)} €</span>
            </div>
            
            <div className={styles.summaryRow}>
              <span>Envío</span>
              <span>{shippingTotal.toFixed(2)} €</span>
            </div>

            <div className={styles.summaryRow}>
              <span>Comisión de venta</span>
              <span>{commission.toFixed(2)} €</span>
            </div>
            
            <div className={styles.summaryRow}>
              <span>Protección del comprador</span>
              <span>{protectionFee.toFixed(2)} €</span>
            </div>
            
            <div className={styles.summaryDivider} />
            
            <div className={styles.summaryRowTotal}>
              <span>Total</span>
              <span>{finalTotal.toFixed(2)} €</span>
            </div>
            
            <div className={styles.trustMessage}>
              <svg className={styles.lockIcon} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>Pago 100% seguro. Dinero en custodia hasta confirmar recepción.</span>
            </div>
            
            <Link href="/checkout" className={styles.checkoutButton}>
              Proceder al pago
            </Link>
          </div>
          
          <div className={styles.trustBadges}>
            <div className={styles.badge}>
              <div className={styles.badgeIcon}>🛡️</div>
              <div className={styles.badgeText}>Protección comprador</div>
            </div>
            <div className={styles.badge}>
              <div className={styles.badgeIcon}>💳</div>
              <div className={styles.badgeText}>Stripe seguro</div>
            </div>
            <div className={styles.badge}>
              <div className={styles.badgeIcon}>📦</div>
              <div className={styles.badgeText}>Envío QR sin impresora</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
