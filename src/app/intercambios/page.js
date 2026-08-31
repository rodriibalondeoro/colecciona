'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import styles from './page.module.css';

export default function IntercambiosPage() {
  const { session, showToast } = useApp();
  const router = useRouter();
  const [tab, setTab] = useState('matches');
  const [matches, setMatches] = useState([]);
  const [matchLoading, setMatchLoading] = useState(true);
  const [matchHint, setMatchHint] = useState('');
  const [proposals, setProposals] = useState([]);
  const [proposalFilter, setProposalFilter] = useState('all');
  const [proposalsLoading, setProposalsLoading] = useState(true);

  useEffect(() => {
    if (!session?.id) { router.push('/auth'); return; }
    loadMatches();
    loadProposals();
  }, [session]);

  const loadMatches = async () => {
    setMatchLoading(true);
    try {
      const res = await fetch('/api/match');
      const data = await res.json();
      setMatches(data.matches || []);
      setMatchHint(data.hint || '');
    } catch { showToast('Error al cargar matches', 'error'); }
    setMatchLoading(false);
  };

  const loadProposals = async () => {
    setProposalsLoading(true);
    try {
      const res = await fetch('/api/trade-proposals');
      const data = await res.json();
      setProposals(data.proposals || []);
    } catch { showToast('Error al cargar propuestas', 'error'); }
    setProposalsLoading(false);
  };

  const handleStatusChange = async (proposalId, newStatus, message) => {
    try {
      const res = await fetch(`/api/trade-proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, message }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Propuesta ${newStatus === 'ACCEPTED' ? 'aceptada' : newStatus === 'CANCELLED' ? 'cancelada' : 'actualizada'}`, 'success');
        loadProposals();
      } else {
        showToast(data.error || 'Error', 'error');
      }
    } catch { showToast('Error', 'error'); }
  };

  const filteredProposals = proposals.filter(p => {
    if (proposalFilter === 'all') return true;
    return p.status === proposalFilter;
  });

  const statusBadge = (status) => {
    const map = {
      PROPOSED: { label: 'Propuesta', color: '#6366f1' },
      COUNTERED: { label: 'Contraoferta', color: '#f59e0b' },
      ACCEPTED: { label: 'Aceptada', color: '#10b981' },
      SHIPPING_PENDING: { label: 'Envío pendiente', color: '#3b82f6' },
      SHIPPED: { label: 'Enviado', color: '#3b82f6' },
      RECEIVED: { label: 'Recibido', color: '#10b981' },
      COMPLETED: { label: 'Completado', color: '#10b981' },
      CANCELLED: { label: 'Cancelada', color: '#6b7280' },
      DISPUTED: { label: 'Disputa', color: '#ef4444' },
    };
    const s = map[status] || { label: status, color: '#6b7280' };
    return <span className={styles.badge} style={{ color: s.color, background: s.color + '18' }}>{s.label}</span>;
  };

  if (!session?.id) return null;

  return (
    <div className={styles.page}>
      <div className="container">
        <h1 className={styles.title}>Intercambios</h1>
        <p className={styles.subtitle}>Encuentra coleccionistas compatibles e intercambia cromos</p>

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'matches' ? styles.tabActive : ''}`} onClick={() => setTab('matches')}>
            🔥 Matches ({matches.length})
          </button>
          <button className={`${styles.tab} ${tab === 'proposals' ? styles.tabActive : ''}`} onClick={() => setTab('proposals')}>
            🤝 Propuestas ({proposals.length})
          </button>
        </div>

        {tab === 'matches' && (
          <div className={styles.section}>
            {matchLoading ? (
              <div className={styles.loading}>Buscando matches...</div>
            ) : matchHint ? (
              <div className={styles.hintBox}>
                <p>{matchHint}</p>
                <Link href="/collections" className={styles.hintLink}>Ir a mis colecciones →</Link>
              </div>
            ) : matches.length === 0 ? (
              <div className={styles.emptyBox}>
                <div className={styles.emptyIcon}>🔍</div>
                <h3>Sin matches aún</h3>
                <p>Marca cromos como <strong>"Me falta"</strong> y <strong>"Para intercambio"</strong> en tus colecciones para encontrar compatibles.</p>
              </div>
            ) : (
              <div className={styles.matchGrid}>
                {matches.map(m => (
                  <div key={m.userId} className={styles.matchCard}>
                    <div className={styles.matchHeader}>
                      <div className={styles.matchAvatar}>
                        {m.avatarUrl ? <img src={m.avatarUrl} alt="" /> : (m.userName || '?')[0]}
                      </div>
                      <div>
                        <Link href={`/seller/${m.username}`} className={styles.matchName}>{m.userName}</Link>
                        {m.score >= 75 && <span className={styles.hotBadge}>🔥</span>}
                      </div>
                      <div className={styles.scoreCircle}>
                        <span className={styles.scoreVal}>{m.score}</span>
                        <span className={styles.scorePct}>%</span>
                      </div>
                    </div>

                    <div className={styles.matchBody}>
                      {m.youCanGet.length > 0 && (
                        <div className={styles.matchCol}>
                          <span className={styles.matchLabel}>Tú puedes recibir:</span>
                          {m.youCanGet.map((c, i) => <span key={i} className={styles.matchItem}>✓ {c}</span>)}
                        </div>
                      )}
                      {m.theyCanGet.length > 0 && (
                        <div className={styles.matchCol}>
                          <span className={styles.matchLabel}>{m.userName} puede recibir:</span>
                          {m.theyCanGet.map((c, i) => <span key={i} className={styles.matchItem}>⇄ {c}</span>)}
                        </div>
                      )}
                    </div>

                    <div className={styles.matchFooter}>
                      <span className={styles.matchCount}>{m.matchedCount} coincidencias</span>
                      <Link href={`/intercambios?tab=proposals&newProposal=${m.userId}`} className={styles.proposeBtn}>
                        Proponer intercambio
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'proposals' && (
          <div className={styles.section}>
            <div className={styles.filterRow}>
              {['all', 'PROPOSED', 'COUNTERED', 'ACCEPTED', 'SHIPPED', 'COMPLETED', 'CANCELLED'].map(f => (
                <button key={f} className={`${styles.filterBtn} ${proposalFilter === f ? styles.filterActive : ''}`}
                  onClick={() => setProposalFilter(f)}>
                  {f === 'all' ? 'Todas' : f}
                </button>
              ))}
            </div>

            {proposalsLoading ? (
              <div className={styles.loading}>Cargando...</div>
            ) : filteredProposals.length === 0 ? (
              <div className={styles.emptyBox}>
                <div className={styles.emptyIcon}>🤝</div>
                <h3>Sin propuestas</h3>
                <p>Encuentra un match y propón un intercambio.</p>
              </div>
            ) : (
              <div className={styles.proposalList}>
                {filteredProposals.map(p => {
                  const isProposer = p.proposer_id === session.id;
                  const other = isProposer ? p.receiver : p.proposer;
                  const proposerItems = (p.items || []).filter(i => i.side === 'proposer');
                  const receiverItems = (p.items || []).filter(i => i.side === 'receiver');

                  return (
                    <div key={p.id} className={styles.proposalCard}>
                      <div className={styles.proposalHeader}>
                        <div>
                          <span className={styles.proposalWith}>
                            {isProposer ? `Para: ${other?.name}` : `De: ${other?.name}`}
                          </span>
                          {statusBadge(p.status)}
                        </div>
                        <span className={styles.proposalDate}>
                          {new Date(p.created_at).toLocaleDateString('es-ES')}
                        </span>
                      </div>

                      <div className={styles.tradeView}>
                        <div className={styles.tradeSide}>
                          <span className={styles.tradeSideLabel}>Tú recibes:</span>
                          {(isProposer ? receiverItems : proposerItems).map((item, i) => (
                            <div key={i} className={styles.tradeItem}>
                              {item.collection_item?.image_url && (
                                <img src={item.collection_item.image_url} alt="" className={styles.tradeItemImg} />
                              )}
                              <span>{item.collection_item?.card_name || 'Cromo'}</span>
                            </div>
                          ))}
                          {(isProposer ? receiverItems : proposerItems).length === 0 && (
                            <span className={styles.tradeEmpty}>Sin elementos</span>
                          )}
                        </div>
                        <div className={styles.tradeDivider}>⇄</div>
                        <div className={styles.tradeSide}>
                          <span className={styles.tradeSideLabel}>Tú ofreces:</span>
                          {(isProposer ? proposerItems : receiverItems).map((item, i) => (
                            <div key={i} className={styles.tradeItem}>
                              {item.collection_item?.image_url && (
                                <img src={item.collection_item.image_url} alt="" className={styles.tradeItemImg} />
                              )}
                              <span>{item.collection_item?.card_name || 'Cromo'}</span>
                            </div>
                          ))}
                          {(isProposer ? proposerItems : receiverItems).length === 0 && (
                            <span className={styles.tradeEmpty}>Sin elementos</span>
                          )}
                        </div>
                      </div>

                      {p.message && <p className={styles.proposalMsg}>"{p.message}"</p>}

                      {['PROPOSED', 'COUNTERED'].includes(p.status) && !isProposer && (
                        <div className={styles.proposalActions}>
                          <button onClick={() => handleStatusChange(p.id, 'ACCEPTED')} className={styles.acceptBtn}>
                            ✓ Aceptar
                          </button>
                          <button onClick={() => handleStatusChange(p.id, 'CANCELLED')} className={styles.rejectBtn}>
                            ✕ Rechazar
                          </button>
                        </div>
                      )}

                      {p.status === 'ACCEPTED' && isProposer && (
                        <div className={styles.proposalActions}>
                          <button onClick={() => handleStatusChange(p.id, 'SHIPPING_PENDING')} className={styles.acceptBtn}>
                            📦 Marcar envío pendiente
                          </button>
                        </div>
                      )}

                      {p.status === 'SHIPPED' && !isProposer && (
                        <div className={styles.proposalActions}>
                          <button onClick={() => handleStatusChange(p.id, 'RECEIVED')} className={styles.acceptBtn}>
                            ✓ Confirmar recepción
                          </button>
                        </div>
                      )}

                      {p.status === 'RECEIVED' && (
                        <div className={styles.proposalActions}>
                          <button onClick={() => handleStatusChange(p.id, 'COMPLETED')} className={styles.acceptBtn}>
                            ✓ Completar intercambio
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
