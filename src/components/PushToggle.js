'use client';

import usePushNotifications from '@/hooks/usePushNotifications';

export default function PushToggle({ session }) {
  const { supported, subscribed, error, loading, subscribe, unsubscribe } = usePushNotifications(session);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => (subscribed ? unsubscribe() : subscribe())}
      disabled={loading}
      aria-pressed={subscribed}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.85rem',
        borderRadius: '10px',
        border: `1px solid ${subscribed ? 'var(--accent-primary)' : 'var(--border-medium)'}`,
        background: subscribed ? 'var(--accent-muted)' : 'transparent',
        color: subscribed ? 'var(--accent-light)' : 'var(--text-muted)',
        fontWeight: 600,
        fontSize: '0.8rem',
        cursor: 'pointer',
      }}
      title={error || undefined}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {loading
        ? 'Activando…'
        : subscribed
          ? 'Push activado ✓'
          : 'Activar notificaciones'}
    </button>
  );
}