'use client';

import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PushToggle from '@/components/PushToggle';
import styles from './page.module.css';

const ICONS = {
  heart: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  offer: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  package: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  chart: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
};

export default function NotificationsPage() {
  const { notifications = [], markAllRead, markRead, unreadCount, session } = useApp();

  const formatTime = (t) => {
    if (!t) return '';
    const d = new Date(t);
    if (isNaN(d)) return '';
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'ahora';
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'ayer';
    if (days < 7) return `hace ${days} días`;
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  };

  const iconFor = (n) => {
    if (n.icon && ICONS[n.icon]) return ICONS[n.icon];
    const byType = { heart: ICONS.heart, favorite: ICONS.heart, offer: ICONS.offer, package: ICONS.package, message: ICONS.chart };
    return byType[n.type] || ICONS.chart;
  };

  return (
    <div className={`${styles.wrapper} page-enter`}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Notificaciones</h1>
            {unreadCount > 0 && (
              <span className={styles.unreadPill}>{unreadCount} sin leer</span>
            )}
          </div>
          {unreadCount > 0 && (
            <button className={styles.markAllBtn} onClick={() => markAllRead()}>
              Marcar todas como leídas
            </button>
          )}
        </div>

        <div className={styles.pushRow}>
          <PushToggle session={session} />
        </div>

        {notifications.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <h3>No tienes notificaciones</h3>
            <p>Te avisaremos de nuevas ventas, ofertas y mensajes aquí.</p>
            <Link href="/marketplace" className={styles.primaryLink}>Explorar mercado</Link>
          </div>
        ) : (
          <div className={styles.list}>
            {notifications.map((n) => (
              <Link
                key={n.id}
                href={n.link && n.link !== '#' ? n.link : '/orders'}
                className={`${styles.item} ${n.read ? styles.read : ''}`}
                onClick={() => { if (!n.read) markRead(n.id); }}
              >
                <div className={`${styles.iconWrap} ${n.read ? '' : styles.iconUnread}`}>
                  {iconFor(n)}
                </div>
                <div className={styles.body}>
                  <div className={styles.itemTop}>
                    <span className={styles.itemTitle}>{n.title || 'Actualización'}</span>
                    <span className={styles.time}>{formatTime(n.time)}</span>
                  </div>
                  <p className={styles.itemText}>{n.body}</p>
                </div>
                {!n.read && <span className={styles.dot} />}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}