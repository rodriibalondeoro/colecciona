"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/context/AppContext";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { cart, unreadCount, notifications, markAllRead, markRead, session } = useApp();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 15);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") {
        setNotifOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const notifIcons = {
    heart: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    ),
    package: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    offer: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
    chart: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  };

  const notifColors = { heart: "var(--rose)", package: "var(--accent-primary)", offer: "var(--emerald)", chart: "var(--amber)" };

  return (
    <header className={`${styles.navbar} ${scrolled ? styles.scrolled : ""}`}>
      <div className={styles.container}>
        {/* Brand */}
        <Link href="/" className={styles.brand}>
          <div className={styles.brandBadge}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className={styles.brandName}>COLECC<span className={styles.brandAccent}>IONA</span></span>
        </Link>

        {/* Desktop Navigation */}
        <nav className={styles.navLinks}>
          <Link href="/marketplace" className={`${styles.link} ${styles.textShine} ${pathname === "/marketplace" ? styles.active : ""}`}>
            Mercado
          </Link>
          <Link href="/sell" className={`${styles.link} ${styles.textShine} ${pathname === "/sell" ? styles.active : ""}`}>
            Vender
          </Link>
          <Link href="/orders" className={`${styles.link} ${styles.textShine} ${pathname === "/orders" ? styles.active : ""}`}>
            Pedidos
          </Link>
          <Link href="/messages" className={`${styles.link} ${styles.textShine} ${pathname === "/messages" ? styles.active : ""}`}>
            Mensajes
          </Link>
        </nav>

        {/* Actions */}
        <div className={styles.actionGroup}>
          {/* Cart */}
          <Link href="/cart" className={styles.iconBtn} aria-label="Cesta">
            <span className={styles.iconShine}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            </span>
            {cart.length > 0 && (
              <span className={styles.cartBadge}>{cart.length}</span>
            )}
          </Link>

          {/* Notifications */}
          <div className={styles.notifWrapper}>
            <button
              className={styles.iconBtn}
              onClick={() => { setNotifOpen(!notifOpen); if (!notifOpen) markAllRead(); }}
              aria-label="Notificaciones"
            >
              <span className={styles.iconShine}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </span>
              {unreadCount > 0 && (
                <span className={styles.notifBadge}>{unreadCount}</span>
              )}
            </button>

            {notifOpen && (
              <>
                <div className={styles.notifBackdrop} onClick={() => setNotifOpen(false)} />
                <div className={styles.notifPanel}>
                  <div className={styles.notifHeader}>
                    <span className={styles.notifTitle}>Notificaciones</span>
                    <button className={styles.notifMarkAll} onClick={markAllRead}>Marcar todas leídas</button>
                  </div>
                  <div className={styles.notifList}>
                    {notifications.map((n) => (
                      <Link
                        key={n.id}
                        href={n.link || "#"}
                        className={`${styles.notifItem} ${!n.read ? styles.notifUnread : ""}`}
                        onClick={() => { markRead(n.id); setNotifOpen(false); }}
                      >
                        <div className={styles.notifIcon} style={{ color: notifColors[n.icon] }}>
                          {notifIcons[n.icon]}
                        </div>
                        <div className={styles.notifContent}>
                          <div className={styles.notifItemTitle}>{n.title}</div>
                          <div className={styles.notifBody}>{n.body}</div>
                          <div className={styles.notifTime}>{n.time}</div>
                        </div>
                        {!n.read && <div className={styles.unreadDot} />}
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Sell CTA */}
          <Link href="/sell" className={styles.sellBtn} data-magnetic data-magnetic-strength="0.2"><span className={styles.sellShine}>+ Vender</span></Link>

          {/* Avatar */}
          <Link href="/profile" className={styles.avatarLink}>
            <div className={styles.avatar}>
              <span className={styles.iconShine}>{session?.initials || session?.name?.charAt(0) || "U"}</span>
            </div>
          </Link>
        </div>
      </div>
    </header>
  );
}
