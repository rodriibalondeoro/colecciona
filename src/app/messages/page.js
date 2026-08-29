'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import styles from './page.module.css';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return '';
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return 'ahora';
  const min = Math.floor(diff / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

function TickIcon({ status }) {
  if (status === 'sent') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={styles.tick}>
        <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (status === 'delivered') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={styles.tick}>
        <path d="M1.5 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  if (status === 'read') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`${styles.tick} ${styles.tickRead}`}>
        <path d="M1.5 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5.5 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  return null;
}

function MessagesInner() {
  const { threads = [], sendMessage, markThreadRead, session, unreadCount, markAllRead, deleteThread } = useApp();
  const searchParams = useSearchParams();
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messageText, setMessageText] = useState('');
  const [isMobileChatOpen, setIsMobileChatOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const messagesEndRef = useRef(null);

  const handleDeleteThread = () => {
    if (!activeThreadId) return;
    const confirmDelete = window.confirm(
      "¿Estás seguro de que quieres eliminar esta conversación? Esta acción no se puede deshacer."
    );
    if (confirmDelete) {
      deleteThread(activeThreadId);
      setActiveThreadId(null);
      setIsMobileChatOpen(false);
    }
  };

  const activeThread = threads.find(t => t.id === activeThreadId);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(iv);
  }, []);

  const filteredThreads = threads.filter(thread => {
    const q = searchQuery.toLowerCase();
    return (
      (thread.partner?.name || '').toLowerCase().includes(q) ||
      (thread.partnerName || '').toLowerCase().includes(q) ||
      (thread.partner?.username || '').toLowerCase().includes(q) ||
      (thread.product?.title || '').toLowerCase().includes(q)
    );
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [activeThread?.messages]);

  useEffect(() => {
    const threadId = searchParams.get('thread');
    if (threadId && threads.length > 0) {
      const exists = threads.some((t) => t.id === threadId);
      if (exists) {
        setActiveThreadId(threadId);
        setIsMobileChatOpen(true);
        markThreadRead(threadId);
      }
    }
  }, [searchParams, threads.length]);

  const handleThreadSelect = useCallback((id) => {
    setActiveThreadId(id);
    setIsMobileChatOpen(true);
    markThreadRead(id);
  }, [markThreadRead]);

  const handleSend = () => {
    if (messageText.trim() && activeThreadId) {
      if (sendMessage) {
        sendMessage(activeThreadId, messageText);
      }
      setMessageText('');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getInitials = (name) => {
    return name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
  };

  const formatTime = (time) => {
    if (!time) return '';
    if (typeof time === 'string') {
      if (time.includes(':') && time.length <= 5) return time;
      if (isNaN(new Date(time).getTime())) return time;
    }
    const date = new Date(time);
    return isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={styles.container}>
      {/* Left Panel - Thread List */}
      <div className={`${styles.threadList} ${isMobileChatOpen ? styles.hiddenMobile : ''}`}>
        <div className={styles.threadListHeader}>
          <h1 className={styles.searchHeader}>Mensajes</h1>
          <div className={styles.searchRow}>
            <input
              type="text"
              placeholder="Buscar conversaciones..."
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.threadListContent}>
          {filteredThreads.length > 0 ? (
            filteredThreads.map(thread => {
              return (
                <div
                  key={thread.id}
                  className={`${styles.threadItem} ${activeThreadId === thread.id ? styles.active : ''}`}
                  onClick={() => handleThreadSelect(thread.id)}
                >
                  <div className={styles.avatar}>
                    {getInitials(thread.partner?.username || thread.partner?.name || thread.partnerName)}
                  </div>
                  <div className={styles.threadInfo}>
                    <div className={styles.threadTop}>
                      <span className={styles.partnerName}>{thread.partner?.username || 'usuario'}</span>
                    </div>
                    <div className={styles.threadBottom}>
                      <span className={styles.lastMessage}>
                        {thread.lastTime ? timeAgo(thread.lastTime) : 'Sin mensajes aún'}
                      </span>
                      {thread.unread > 0 && (
                        <span className={styles.unreadBadge}>{thread.unread}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.emptyThreadList}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4, marginBottom: 4 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <p>No hay conversaciones aún</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Active Chat */}
      <div className={`${styles.chatArea} ${isMobileChatOpen ? styles.open : ''}`}>
        {activeThread ? (
          <>
            <div className={styles.chatHeader}>
              <button
                className={styles.backButton}
                onClick={() => setIsMobileChatOpen(false)}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
              </button>
              {activeThread.partner?.username ? (
                <Link href={`/seller/${activeThread.partner.username}`} className={styles.headerLink}>
                  <div className={styles.avatar}>
                    {getInitials(activeThread.partner?.username || activeThread.partner?.name || activeThread.partnerName)}
                  </div>
                  <div className={styles.headerInfo}>
                    <div className={styles.headerName}>
                      {activeThread.partner?.username || 'usuario'}
                      {activeThread.partner?.verified && (
                        <svg className={styles.verifiedBadge} width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                        </svg>
                      )}
                    </div>
                  </div>
                </Link>
              ) : (
                <div className={styles.headerLink}>
                  <div className={styles.avatar}>
                    {getInitials(activeThread.partner?.username || activeThread.partner?.name || activeThread.partnerName)}
                  </div>
                  <div className={styles.headerInfo}>
                    <div className={styles.headerName}>
                      {activeThread.partner?.username || 'usuario'}
                    </div>
                  </div>
                </div>
              )}

              <button
                className={styles.deleteThreadButton}
                onClick={handleDeleteThread}
                title="Eliminar conversación"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
              </button>
            </div>

            {activeThread.product?.id && (
              <div className={styles.productMiniCard} key={activeThread.product.id}>
                <img src={activeThread.product.image || 'https://via.placeholder.com/40'} alt={activeThread.product.title} className={styles.productMiniThumb} />
                <div>
                  <div className={styles.productMiniTitle}>{activeThread.product.title}</div>
                  <div className={styles.productMiniPrice}>{activeThread.product.price.toFixed(2)} €</div>
                </div>
              </div>
            )}

            <div className={styles.messagesContainer}>
              {activeThread.messages?.map((msg, idx) => {
                const isMe = msg.from === 'me' || msg.from === session?.id;
                const msgStatus = msg.status || (isMe ? 'read' : undefined);
                return (
                  <div key={msg.id} className={`${styles.messageWrapper} ${isMe ? styles.me : styles.partner}`}>
                    <div className={styles.messageBubble}>
                      {msg.text}
                    </div>
                    <div className={styles.messageMeta}>
                      <span className={styles.messageTime}>
                        {formatTime(msg.time)}
                      </span>
                      {isMe && <TickIcon status={msgStatus} />}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className={styles.chatInput}>
              <textarea
                className={styles.textarea}
                placeholder="Escribe un mensaje..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <button
                className={styles.sendButton}
                onClick={handleSend}
                disabled={!messageText.trim()}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div className={styles.emptyState}>
            <svg className={styles.emptyIcon} width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>Tus Mensajes</h2>
            <p style={{ fontSize: '0.9rem', maxWidth: 280, lineHeight: 1.5 }}>Selecciona una conversación o contacta a un usuario desde su perfil o publicación.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className={styles.container}><p style={{ padding: '2rem', color: 'var(--text-muted)' }}>Cargando mensajes...</p></div>}>
      <MessagesInner />
    </Suspense>
  );
}
