'use client';

import React, { useState, useMemo } from 'react';
import styles from './PriceChart.module.css';

// Generates stable random walk price history
function generatePriceHistory(basePrice, days) {
  let prices = [];
  let currentPrice = basePrice * (1 - (Math.random() * 0.2 - 0.1)); // Start slightly off
  for (let i = days; i >= 0; i--) {
    let date = new Date();
    date.setDate(date.getDate() - i);
    prices.push({
      date,
      price: currentPrice
    });
    // Random walk with mean reversion
    let change = (Math.random() * 0.1 - 0.05) * basePrice;
    currentPrice = Math.max(basePrice * 0.5, currentPrice + change + (basePrice - currentPrice) * 0.1);
  }
  // Ensure last point is exactly the basePrice
  prices[prices.length - 1].price = basePrice;
  return prices;
}

export default function PriceChart({ currentPrice }) {
  const [filter, setFilter] = useState(30); // 7, 30, 90
  
  const history = useMemo(() => generatePriceHistory(currentPrice, 90), [currentPrice]);
  
  const displayData = history.slice(-filter - 1);
  const startPrice = displayData[0].price;
  const endPrice = displayData[displayData.length - 1].price;
  const change = endPrice - startPrice;
  const changePct = (change / startPrice) * 100;
  
  const isUp = change >= 0;
  const chartColor = isUp ? 'var(--emerald)' : 'var(--rose)';
  const chartGradientStart = isUp ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)';
  
  // SVG Calculations
  const minPrice = Math.min(...displayData.map(d => d.price)) * 0.95;
  const maxPrice = Math.max(...displayData.map(d => d.price)) * 1.05;
  const width = 600;
  const height = 200;
  
  const getX = (index) => (index / (displayData.length - 1)) * width;
  const getY = (price) => height - ((price - minPrice) / (maxPrice - minPrice)) * height;
  
  const pathD = displayData.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.price)}`).join(' ');
  const fillPathD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <div className={styles.currentPrice}>{currentPrice.toFixed(2)} €</div>
          <div className={`${styles.change} ${isUp ? styles.up : styles.down}`}>
            {isUp ? '+' : ''}{change.toFixed(2)} € ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
          </div>
        </div>
        
        <div className={styles.filters}>
          <button className={`${styles.filterBtn} ${filter === 7 ? styles.active : ''}`} onClick={() => setFilter(7)}>7D</button>
          <button className={`${styles.filterBtn} ${filter === 30 ? styles.active : ''}`} onClick={() => setFilter(30)}>30D</button>
          <button className={`${styles.filterBtn} ${filter === 90 ? styles.active : ''}`} onClick={() => setFilter(90)}>90D</button>
        </div>
      </div>
      
      <div className={styles.chartWrapper}>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg}>
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartGradientStart} />
              <stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
          
          <path d={fillPathD} fill="url(#chartGradient)" />
          <path d={pathD} fill="none" stroke={chartColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          
          {/* Hover effects or simple dots */}
          {displayData.map((d, i) => {
            if (displayData.length > 31 && i % 3 !== 0 && i !== displayData.length - 1) return null; // limit dots for 90d
            return (
              <circle key={i} cx={getX(i)} cy={getY(d.price)} r="3" fill={chartColor} className={styles.dot}>
                <title>{d.price.toFixed(2)}€ - {d.date.toLocaleDateString()}</title>
              </circle>
            )
          })}
        </svg>
        
        <div className={styles.yAxis}>
          <span>{maxPrice.toFixed(0)}€</span>
          <span>{((maxPrice + minPrice) / 2).toFixed(0)}€</span>
          <span>{minPrice.toFixed(0)}€</span>
        </div>
      </div>
    </div>
  );
}
