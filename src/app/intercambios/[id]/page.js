'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { authFetch } from '@/lib/authFetch';
import styles from './page.module.css';

export default function TradeProposalDetail() {
  const { session, showToast } = useApp();
  const router = useRouter();
  const params = useParams();
  const id = params?.id;
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!session?.id) { router.push('/auth'); return; }
    if (id) loadProposal();
  }, [session, id]);

  const loadProposal = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/trade-proposals/${id}`);
      const data = await res.json();
      if (data.proposal) {
        setProposal(data.proposal);
      } else {
        showToast('Propuesta no encontrada', 'error');
        router.push('/intercambios');
      }
    } catch { showToast('Error al cargar', 'error'); }
    setLoading(false);
  };

  const handleStatus = async (newStatus) => {
    setUpdating(true);
    try {
      const res = await authFetch(`/api/trade-proposals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Propuesta ${newStatus === 'ACCEPTED' ? 'aceptada' : newStatus === 'CANCELLED' ? 'cancelada' : 'actualizada'}`, 'success');
        loadProposal();
      } else {
        showToast(data.error || 'Error', 'error');
      }
    } catch { showToast('Error', 'error'); }
    setUpdating(false);
  };

  const statusBadge = (status) => {
    const map = {
      PROPOSED: { label: 'Propuesta', color: '#6366f1', icon: '📨' },
      COUNTERED: { label: 'Contraoferta', color: '#f59e0b', icon: '🔄' },
      ACCEPTED: { label: 'Aceptada', color: '#10b981', icon: '✅' },
      SHIPPING_PENDING: { label: 'Envío pendiente', color: '#3b82f6', icon: '📦' },
      SHIPPED: { label: 'Enviado', color: '#3b82f6', icon: '🚚' },
      RECEIVED: { label: 'Recibido', color: '#10b981', icon: '📬' },
      COMPLETED: { label: 'Completado', color: '#10b981', icon: '🎉' },
      CANCELLED: { label: 'Cancelada', color: '#6b7280', icon: '❌' },
      DISPUTED: { label: 'Disputa', color: '#ef4444', icon: '⚠️' },
    };
    const s = map[status] || { label: status, color: '#6b7280', icon: '❓' };
    return <span className={styles.statusBadge} style={{ color: s.color, background: s.color + '18', borderColor: s.color + '30' }}>{s.icon} {s.label}</span>;
  };

  const timeline = (status) => {
    const steps = ['PROPOSED', 'ACCEPTED', 'SHIPPING_PENDING', 'SHIPPED', 'RECEIVED', 'COMPLETED'];
    const idx = steps.indexOf(status);
    if (status === 'CANCELLED') return null;
    return (
      <div className={styles.timeline}>
        {steps.map((step, i) => (
          <div key={step} className={`${styles.timelineStep} ${i <= idx ? styles.timelineActive : ''}`}>
            <div className={styles.timelineDot} />
            <span className={styles.timelineLabel}>{step.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return <div className={styles.loading}>Cargando...</div>;
  if (!proposal) return null;

  const isProposer = proposal.proposer_id === session?.id;
  const other = isProposer ? proposal.receiver : proposal.proposer;
  const proposerItems = (proposal.items || []).filter(i => i.side === 'proposer');
  const receiverItems = (proposal.items || []).filter(i => i.side === 'receiver');

  return (
    <div className={styles.page}>
      <div className="container">
        <Link href="/intercambios" className={styles.backLink}>← Volver a intercambios</Link>
        <h1 className={styles.title}>Detalle de propuesta</h1>

        <div className={styles.detailCard}>
          <div className={styles.detailHeader}>
            <div className={styles.partiesRow}>
              <div className={styles.party}>
                <div className={styles.partyAvatar}>{proposal.proposer?.name?.[0] || '?'}</div>
                <div>
                  <span className={styles.partyName}>{proposal.proposer?.name}</span>
                  <span className={styles.partyRole}>Propone</span>
                </div>
              </div>
              <span className={styles.arrow}>⇄</span>
              <div className={styles.party}>
                <div className={styles.partyAvatar}>{proposal.receiver?.name?.[0] || '?'}</div>
                <div>
                  <span className={styles.partyName}>{proposal.receiver?.name}</span>
                  <span className={styles.partyRole}>Recibe</span>
                </div>
              </div>
            </div>
            {statusBadge(proposal.status)}
          </div>

          {timeline(proposal.status)}

          <div className={styles.tradeView}>
            <div className={styles.tradeSide}>
              <span className={styles.tradeSideLabel}>📦 {isProposer ? 'Tú ofreces' : `${proposal.proposer?.name} ofrece`}:</span>
              {(isProposer ? proposerItems : receiverItems).map((item, i) => (
                <div key={i} className={styles.tradeItem}>
                  {item.collection_item?.image_url && <img src={item.collection_item.image_url} alt="" className={styles.tradeItemImg} />}
                  <div>
                    <span className={styles.tradeItemName}>{item.collection_item?.card_name || 'Cromo'}</span>
                    {item.collection_item?.card_number && <span className={styles.tradeItemNum}>#{item.collection_item.card_number}</span>}
                  </div>
                </div>
              ))}
              {(isProposer ? proposerItems : receiverItems).length === 0 && <span className={styles.tradeEmpty}>Sin elementos</span>}
            </div>

            <div className={styles.tradeDivider}>⇄</div>

            <div className={styles.tradeSide}>
              <span className={styles.tradeSideLabel}>📦 {isProposer ? `${other?.name} ofrece` : 'Tú ofreces'}:</span>
              {(isProposer ? receiverItems : proposerItems).map((item, i) => (
                <div key={i} className={styles.tradeItem}>
                  {item.collection_item?.image_url && <img src={item.collection_item.image_url} alt="" className={styles.tradeItemImg} />}
                  <div>
                    <span className={styles.tradeItemName}>{item.collection_item?.card_name || 'Cromo'}</span>
                    {item.collection_item?.card_number && <span className={styles.tradeItemNum}>#{item.collection_item.card_number}</span>}
                  </div>
                </div>
              ))}
              {(isProposer ? receiverItems : proposerItems).length === 0 && <span className={styles.tradeEmpty}>Sin elementos</span>}
            </div>
          </div>

          {proposal.message && (
            <div className={styles.messageBox}>
              <span className={styles.messageIcon}>💬</span>
              <p className={styles.messageText}>&ldquo;{proposal.message}&rdquo;</p>
            </div>
          )}

          <div className={styles.metaRow}>
            <span>Creada: {new Date(proposal.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            {proposal.updated_at !== proposal.created_at && (
              <span>Actualizada: {new Date(proposal.updated_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            )}
          </div>

          {['PROPOSED', 'COUNTERED'].includes(proposal.status) && !isProposer && (
            <div className={styles.actions}>
              <button onClick={() => handleStatus('ACCEPTED')} disabled={updating} className={styles.acceptBtn}>✓ Aceptar propuesta</button>
              <button onClick={() => handleStatus('CANCELLED')} disabled={updating} className={styles.rejectBtn}>✕ Rechazar</button>
            </div>
          )}
          {proposal.status === 'ACCEPTED' && isProposer && (
            <div className={styles.actions}>
              <button onClick={() => handleStatus('SHIPPING_PENDING')} disabled={updating} className={styles.acceptBtn}>📦 Marcar envío pendiente</button>
            </div>
          )}
          {proposal.status === 'SHIPPED' && !isProposer && (
            <div className={styles.actions}>
              <button onClick={() => handleStatus('RECEIVED')} disabled={updating} className={styles.acceptBtn}>✓ Confirmar recepción</button>
            </div>
          )}
          {proposal.status === 'RECEIVED' && (
            <div className={styles.actions}>
              <button onClick={() => handleStatus('COMPLETED')} disabled={updating} className={styles.acceptBtn}>🎉 Completar intercambio</button>
            </div>
          )}
          {['PROPOSED', 'COUNTERED', 'ACCEPTED'].includes(proposal.status) && (
            <div className={styles.actions}>
              <button onClick={() => handleStatus('CANCELLED')} disabled={updating} className={styles.rejectBtn}>Cancelar propuesta</button>
            </div>
          )}

          <Link href={`/messages?thread=${proposal.id}`} className={styles.chatLink}>
            💬 Abrir chat sobre esta propuesta
          </Link>
        </div>
      </div>
    </div>
  );
}
