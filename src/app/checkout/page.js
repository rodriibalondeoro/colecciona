'use client';
import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import Link from 'next/link';
import Image from 'next/image';
import { fireConfetti } from '@/lib/confetti';
import styles from './page.module.css';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '');

function StripePaymentForm({ finalTotal, session, onSuccess, onError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout`,
      },
      redirect: 'if_required',
    });

    if (error) {
      onError(error.message || 'Error al procesar el pago');
      setProcessing(false);
      return;
    }

    try {
      const token = session?.access_token || session?.accessToken;
      const res = await fetch('/api/stripe/capture-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
      } else {
        onError(data.error || 'Error al confirmar el pago');
      }
    } catch {
      onError('Error de conexión al confirmar el pago');
    }
    setProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || processing} className={styles.btnPrimary}>
        {processing ? 'Procesando pago...' : `Pagar ${finalTotal.toFixed(2)} €`}
      </button>
    </form>
  );
}

export default function CheckoutPage() {
  const [step, setStep] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [orderRef, setOrderRef] = useState(null);
  const { cart, cartTotal, showToast, clearCart, session } = useApp();

  const [address, setAddress] = useState({
    nombre: '', apellidos: '', calle: '', ciudad: '', cp: '', provincia: ''
  });

  const protectionFee = cart.length > 0 ? 2.50 : 0;
  const subtotal = cartTotal.subtotal || 0;
  const shippingTotal = cartTotal.shipping || 0;
  const commission = cartTotal.commission || 0;
  const finalTotal = subtotal + shippingTotal + commission + protectionFee;

  const handleNextStep = (e) => {
    e.preventDefault();
    if (step === 1) {
      if (!address.nombre || !address.calle || !address.ciudad) {
        showToast('Por favor completa los campos obligatorios', 'error');
        return;
      }
      setStep(2);
      createPaymentIntent();
    }
  };

  const createPaymentIntent = () => {
    setProcessing(true);
    const token = session?.access_token || session?.accessToken;

    fetch('/api/stripe/create-payment-intent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        cartItems: cart.map((i) => ({
          productId: i.product.id,
          shippingMethod: i.shippingMethod?.name || 'Sobre acolchado Correos',
          shipping: i.shippingMethod?.price || 1.8,
        })),
        shippingAddress: `${address.calle}, ${address.cp} ${address.ciudad}, ${address.provincia}`,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          showToast(data.error || 'No se pudo iniciar el pago', 'error');
        }
      })
      .catch(() => showToast('Error de conexión al iniciar el pago', 'error'))
      .finally(() => setProcessing(false));
  };

  const handlePaymentSuccess = async () => {
    fireConfetti();
    clearCart();
    try {
      const token = session?.access_token || session?.accessToken;
      const res = await fetch('/api/orders', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      const first = data.orders?.[0];
      setOrderRef(first?.id ? `CART-${first.id.slice(0, 8).toUpperCase()}` : 'CONFIRMADO');
    } catch {
      setOrderRef('CONFIRMADO');
    }
    setStep(3);
    showToast('Pago completado con éxito', 'success');
  };

  const handlePaymentError = (msg) => {
    showToast(msg, 'error');
  };

  if (cart.length === 0 && step !== 3) {
    return (
      <div className={styles.emptyState}>
        <h2>No hay productos en la cesta</h2>
        <Link href="/marketplace" className={styles.btnPrimary}>Ir al Mercado</Link>
      </div>
    );
  }

  if (!session && step !== 3) {
    return (
      <div className={styles.emptyState}>
        <h2>Inicia sesión para pagar</h2>
        <Link href="/auth" className={styles.btnPrimary}>Iniciar sesión</Link>
      </div>
    );
  }

  return (
    <div className={`${styles.container} page-enter`}>
      <div className={styles.stepIndicator}>
        <div className={`${styles.step} ${step >= 1 ? styles.active : ''}`}>
          <div className={styles.stepIcon}>1</div>
          <span>Envío</span>
        </div>
        <div className={styles.stepLine} />
        <div className={`${styles.step} ${step >= 2 ? styles.active : ''}`}>
          <div className={styles.stepIcon}>2</div>
          <span>Pago</span>
        </div>
        <div className={styles.stepLine} />
        <div className={`${styles.step} ${step >= 3 ? styles.active : ''}`}>
          <div className={styles.stepIcon}>3</div>
          <span>Confirmación</span>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.mainColumn}>
          {step === 1 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Dirección de entrega</h2>
              <form onSubmit={handleNextStep} className={styles.form}>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Nombre</label>
                    <input type="text" required value={address.nombre} onChange={e => setAddress({...address, nombre: e.target.value})} />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Apellidos</label>
                    <input type="text" required value={address.apellidos} onChange={e => setAddress({...address, apellidos: e.target.value})} />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>Calle y número</label>
                  <input type="text" required value={address.calle} onChange={e => setAddress({...address, calle: e.target.value})} />
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Ciudad</label>
                    <input type="text" required value={address.ciudad} onChange={e => setAddress({...address, ciudad: e.target.value})} />
                  </div>
                  <div className={styles.formGroup}>
                    <label>Código Postal</label>
                    <input type="text" required value={address.cp} onChange={e => setAddress({...address, cp: e.target.value})} />
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label>Provincia</label>
                  <input type="text" required value={address.provincia} onChange={e => setAddress({...address, provincia: e.target.value})} />
                </div>
                <button type="submit" className={styles.btnPrimary}>Continuar al pago</button>
              </form>
            </div>
          )}

          {step === 2 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Datos de pago</h2>
              <div className={styles.paymentMethods}>
                <div className={`${styles.paymentMethod} ${styles.selected}`}>
                  <span>💳 Tarjeta de crédito/débito — Pago seguro con Stripe</span>
                </div>
              </div>

              {processing && !clientSecret ? (
                <p className={styles.loadingPay}>Preparando pago seguro...</p>
              ) : clientSecret ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: 'night',
                      variables: {
                        colorPrimary: '#6366f1',
                        colorBackground: '#101216',
                        colorText: '#e2e8f0',
                        colorDanger: '#f43f5e',
                        borderRadius: '8px',
                        fontFamily: 'system-ui, sans-serif',
                      },
                    },
                  }}
                >
                  <StripePaymentForm
                    finalTotal={finalTotal}
                    session={session}
                    onSuccess={handlePaymentSuccess}
                    onError={handlePaymentError}
                  />
                </Elements>
              ) : (
                <p className={styles.loadingPay}>No se pudo iniciar el pago. Vuelve al paso anterior.</p>
              )}

              <button onClick={() => setStep(1)} className={styles.btnSecondary}>Volver</button>
            </div>
          )}

          {step === 3 && (
            <div className={`${styles.card} ${styles.successCard} modal-enter`}>
              <div className={styles.checkmarkContainer}>
                <svg className={styles.checkmark} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                  <circle className={styles.checkmarkCircle} cx="26" cy="26" r="25" fill="none" />
                  <path className={styles.checkmarkCheck} fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                </svg>
              </div>
              <h2 className={styles.successTitle}>¡Pedido confirmado!</h2>
              <p className={styles.orderId}>Referencia: {orderRef}</p>

              <div className={styles.trustMessage}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                Pago recibido. Tu dinero está en custodia segura hasta confirmar la recepción.
              </div>

              <div className={styles.flowSteps}>
                <div className={styles.flowStep}>Vendedor empaqueta</div>
                <div className={styles.flowArrow}>→</div>
                <div className={styles.flowStep}>Escanea QR</div>
                <div className={styles.flowArrow}>→</div>
                <div className={styles.flowStep}>En camino</div>
                <div className={styles.flowArrow}>→</div>
                <div className={styles.flowStep}>Confirmas recepción</div>
              </div>

              <div className={styles.actionButtons}>
                <Link href="/orders" className={styles.btnPrimary}>Ver mis pedidos</Link>
                <Link href="/marketplace" className={styles.btnSecondary}>Seguir comprando</Link>
              </div>
            </div>
          )}
        </div>

        {step < 3 && (
          <div className={styles.sidebar}>
            <div className={styles.summaryCard}>
              <h3 className={styles.summaryTitle}>Resumen del pedido</h3>
              <div className={styles.summaryProducts}>
                {cart.map(item => (
                  <div key={item.product.id} className={styles.summaryItem}>
                    <div className={styles.summaryItemImage}>
                      <Image src={item.product.image || '/placeholder.png'} alt={item.product.title || "Carta"} fill style={{objectFit: 'cover'}} />
                    </div>
                    <div className={styles.summaryItemDetails}>
                      <div className={styles.summaryItemTitle}>{item.product.title}</div>
                      <div className={styles.summaryItemPrice}>{Number(item.product.price || 0).toFixed(2)} €</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.summaryRow}>
                <span>Subtotal</span>
                <span>{subtotal.toFixed(2)} €</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Envío</span>
                <span>{shippingTotal.toFixed(2)} €</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Comisión</span>
                <span>{commission.toFixed(2)} €</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Protección</span>
                <span>{protectionFee.toFixed(2)} €</span>
              </div>

              <div className={styles.summaryDivider} />

              <div className={styles.summaryRowTotal}>
                <span>Total</span>
                <span>{finalTotal.toFixed(2)} €</span>
              </div>

              <div className={styles.secureNote}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Cifrado SSL · Pago procesado por Stripe
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}