'use client';

import React, { useState, useEffect } from 'react';
import styles from './ProfitCalculator.module.css';

const SHIPPING_METHODS = {
  'carta-normal': { name: 'Carta normal', cost: 1.65 },
  'sobre-acolchado': { name: 'Sobre acolchado', cost: 2.20 },
  'locker-inpost': { name: 'Locker InPost', cost: 2.80 },
  'paquete-correos': { name: 'Paquete Correos', cost: 4.50 },
};

export default function ProfitCalculator() {
  const [price, setPrice] = useState(20);
  const [shippingMethod, setShippingMethod] = useState('carta-normal');
  
  const shipCost = SHIPPING_METHODS[shippingMethod].cost;
  
  // Buyer pays price + shipping
  const buyerTotal = price + shipCost;
  
  // Platform fees
  const coleccionaComm = price * 0.08; // 8% comisión Colecciona
  const stripeComm = buyerTotal * 0.015 + 0.25; // 1.5% + 0.25€
  
  const totalFees = coleccionaComm + stripeComm + shipCost; // You have to pay for shipping eventually from the received money, or rather it's subtracted. Actually, buyer pays shipping, so total collected is buyerTotal.
  // Real calculation: 
  // Seller receives: buyerTotal - (shipping to buy label) - colecciona fee - stripe fee.
  // Actually, seller pays label: -shipCost
  const sellerProfit = buyerTotal - shipCost - coleccionaComm - stripeComm;
  
  // Vinted typical fee simulation (they charge buyer, but seller might have to lower price to sell. Wait, the spec says "-40%")
  // "Vs. Vinted (-40%): you'd get X,XX €"
  const vintedProfit = price * 0.6;
  const savings = sellerProfit - vintedProfit;

  return (
    <div className={styles.calculator}>
      <h3 className={styles.title}>Calculadora de Beneficios</h3>
      <p className={styles.subtitle}>Calcula cuánto ganarás exactamente por tu venta</p>
      
      <div className={styles.controls}>
        <div className={styles.formGroup}>
          <label className={styles.label}>Precio de venta (€)</label>
          <div className={styles.priceInputWrapper}>
            <input 
              type="number" 
              value={price} 
              onChange={(e) => setPrice(Number(e.target.value) || 0)} 
              min="0.5" 
              max="500" 
              step="0.5"
              className={styles.numberInput} 
            />
          </div>
          <input 
            type="range" 
            min="0.5" 
            max="200" 
            step="0.5" 
            value={price} 
            onChange={(e) => setPrice(Number(e.target.value))} 
            className={styles.slider} 
          />
        </div>
        
        <div className={styles.formGroup}>
          <label className={styles.label}>Método de envío</label>
          <select 
            value={shippingMethod} 
            onChange={(e) => setShippingMethod(e.target.value)}
            className={styles.select}
          >
            {Object.entries(SHIPPING_METHODS).map(([key, method]) => (
              <option key={key} value={key}>{method.name} ({method.cost.toFixed(2)}€)</option>
            ))}
          </select>
        </div>
      </div>
      
      <div className={styles.breakdown}>
        <div className={styles.row}>
          <span>Precio de venta</span>
          <span>{price.toFixed(2)} €</span>
        </div>
        <div className={styles.row}>
          <span className={styles.muted}>Envío (pagado por comprador)</span>
          <span className={styles.muted}>+{shipCost.toFixed(2)} €</span>
        </div>
        <div className={`${styles.row} ${styles.bold}`}>
          <span>Total cobrado al comprador</span>
          <span>{buyerTotal.toFixed(2)} €</span>
        </div>
        
        <hr className={styles.divider} />
        
        <div className={styles.row}>
          <span className={styles.muted}>Coste transporte</span>
          <span className={styles.muted}>-{shipCost.toFixed(2)} €</span>
        </div>
        <div className={styles.row}>
          <span className={styles.muted}>Comisión Colecciona (3.5%)</span>
          <span className={styles.muted}>-{coleccionaComm.toFixed(2)} €</span>
        </div>
        <div className={styles.row}>
          <span className={styles.muted}>Procesamiento pago (1.5% + 0.25€)</span>
          <span className={styles.muted}>-{stripeComm.toFixed(2)} €</span>
        </div>
        
        <hr className={styles.divider} />
        
        <div className={styles.result}>
          <span className={styles.resultLabel}>TÚ RECIBIRÁS</span>
          <span className={styles.resultValue}>{sellerProfit.toFixed(2)} €</span>
        </div>
        
        <div className={styles.comparison}>
          <div className={styles.vintedRow}>
            <span>Vs. Vinted (aprox -40%)</span>
            <span className={styles.crossedOut}>{vintedProfit.toFixed(2)} €</span>
          </div>
          <div className={styles.savingsRow}>
            <span>Ahorro vs otras plataformas</span>
            <span className={styles.savingsValue}>+{Math.max(0, savings).toFixed(2)} €</span>
          </div>
        </div>
      </div>
    </div>
  );
}
