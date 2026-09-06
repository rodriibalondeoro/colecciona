'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { authFetch } from '@/lib/authFetch';
import styles from './page.module.css';

export default function IntercambiosPage() {
  const { session, showToast } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState('matches');
  const [matches, setMatches] = useState([]);
  const [matchLoading, setMatchLoading] = useState(true);
  const [matchHint, setMatchHint] = useState('');
  const [proposals, setProposals] = useState([]);
  const [proposalFilter, setProposalFilter] = useState('all');
  const [proposalsLoading, setProposalsLoading] = useState(true);

  // Proposal creation
  const [showProposal, setShowProposal] = useState(false);
  const [proposalTarget, setProposalTarget] = useState(null);
  const [myForTradeItems, setMyForTradeItems] = useState([]);
  const [theirForTradeItems, setTheirForTradeItems] = useState([]);
  const [selectedMyItems, setSelectedMyItems] = useState([]);
  const [selectedTheirItems, setSelectedTheirItems] = useState([]);
  const [proposalMsg, setProposalMsg] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!session?.id) { router.push('/auth'); return; }
    let cancelled = false;
    loadMatches(cancelled);
    loadProposals(cancelled);
    // Check if we should open proposal modal from URL
    const targetId = searchParams.get('newProposal');
    if (targetId) {
      setTab('proposals');
      openProposalFor(targetId);
    }
    return () => { cancelled = true; };
  }, [session, searchParams]);

  const loadMatches = async (cancelled) => {
    setMatchLoading(true);
    try {
      const res = await authFetch('/api/match');
      const data = await res.json();
      if (!cancelled) setMatches(data.matches || []);
      if (!cancelled) setMatchHint(data.hint || '');
    } catch { showToast('Error al cargar matches', 'error'); }
    setMatchLoading(false);
  };

  const loadProposals = async (cancelled) => {
    setProposalsLoading(true);
    try {
      const res = await authFetch('/api/trade-proposals');
      const data = await res.json();
      if (!cancelled) setProposals(data.proposals || []);
    } catch { showToast('Error al cargar propuestas', 'error'); }
    setProposalsLoading(false);
  };

  const openProposalFor = async (userId) => {
    setProposalTarget(userId);
    setSelectedMyItems([]);
    setSelectedTheirItems([]);
    setProposalMsg('');
    setShowProposal(true);

    // Load my FOR_TRADE items
    try {
      const res = await authFetch(`/api/collections?userId=${session.id}`);
      const data = await res.json();
      const allItems = [];
      for (const col of data.collections || []) {
        const itemRes = await authFetch(`/api/collections/${col.id}/items?status=FOR_TRADE`);
        const itemData = await itemRes.json();
        allItems.push(...(itemData.items || []).map(i => ({ ...i, collectionName: col.name })));
      }
      setMyForTradeItems(allItems);
    } catch {}

    // Load their FOR_TRADE items (via match data)
    const match = matches.find(m => m.userId === userId);
    if (match) {
      // Items they can give us are what we're missing
      setTheirForTradeItems(match.youCanGet.map(name => ({ card_name: name })));
    }
  };

  const handleCreateProposal = async () => {
    if (!proposalTarget || (!selectedMyItems.length && !selectedTheirItems.length)) {
      showToast('Selecciona al menos un elemento', 'error');
      return;
    }
    setSending(true);
    try {
      const res = await authFetch('/api/trade-proposals', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: proposalTarget,
          message: proposalMsg || null,
          proposer_items: selectedMyItems.map(id => ({ collection_item_id: id, quantity: 1 })),
          receiver_items: selectedTheirItems.map(name => ({ card_name: name })),
        }),
      });
      const data = await res.json();
      if (data.proposal) {
        showToast('Propuesta enviada', 'success');
        setShowProposal(false);
        loadProposals();
        setTab('proposals');
      } else {
        showToast(data.error || 'Error al enviar', 'error');
      }
    } catch { showToast('Error', 'error'); }
    setSending(false);
  };

  const handleStatusChange = async (proposalId, newStatus) => {
    try {
      const res = await authFetch(`/api/trade-proposals/${proposalId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
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

  const filteredProposals = proposals.filter(p => proposalFilter === 'all' || p.status === proposalFilter);

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
                      <div className={styles.matchAvatar}>{m.userName?.[0] || '?'}</div>
                      <div>
                        <span className={styles.matchName}>{m.userName}</span>
                        <div className={styles.matchMeta}>
                          {m.rating > 0 && <span className={styles.matchRating}>⭐ {m.rating.toFixed(1)}</span>}
                          {m.location && <span className={styles.matchLocation}>📍 {m.location}</span>}
                        </div>
                        {m.finalScore >= 75 && <span className={styles.hotBadge}>🔥</span>}
                      </div>
                      <div className={styles.scoreCircle}>
                        <span className={styles.scoreVal}>{m.finalScore}</span>
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
                      <button className={styles.proposeBtn} onClick={() => openProposalFor(m.userId)}>
                        Proponer intercambio
                      </button>
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
                    <Link key={p.id} href={`/intercambios/${p.id}`} className={styles.proposalCard}>
                      <div className={styles.proposalHeader}>
                        <div>
                          <span className={styles.proposalWith}>{isProposer ? `Para: ${other?.name}` : `De: ${other?.name}`}</span>
                          {statusBadge(p.status)}
                        </div>
                        <span className={styles.proposalDate}>{new Date(p.created_at).toLocaleDateString('es-ES')}</span>
                      </div>
                      <div className={styles.tradeView}>
                        <div className={styles.tradeSide}>
                          <span className={styles.tradeSideLabel}>Tú recibes:</span>
                          {(isProposer ? receiverItems : proposerItems).map((item, i) => (
                            <div key={i} className={styles.tradeItem}>
                              {item.collection_item?.image_url && <img src={item.collection_item.image_url} alt="" className={styles.tradeItemImg} />}
                              <span>{item.collection_item?.card_name || 'Cromo'}</span>
                            </div>
                          ))}
                          {(isProposer ? receiverItems : proposerItems).length === 0 && <span className={styles.tradeEmpty}>Sin elementos</span>}
                        </div>
                        <div className={styles.tradeDivider}>⇄</div>
                        <div className={styles.tradeSide}>
                          <span className={styles.tradeSideLabel}>Tú ofreces:</span>
                          {(isProposer ? proposerItems : receiverItems).map((item, i) => (
                            <div key={i} className={styles.tradeItem}>
                              {item.collection_item?.image_url && <img src={item.collection_item.image_url} alt="" className={styles.tradeItemImg} />}
                              <span>{item.collection_item?.card_name || 'Cromo'}</span>
                            </div>
                          ))}
                          {(isProposer ? proposerItems : receiverItems).length === 0 && <span className={styles.tradeEmpty}>Sin elementos</span>}
                        </div>
                      </div>
                      {p.message && <p className={styles.proposalMsg}>"{p.message}"</p>}
                      {['PROPOSED', 'COUNTERED'].includes(p.status) && !isProposer && (
                        <div className={styles.proposalActions}>
                          <button onClick={(e) => { e.preventDefault(); handleStatusChange(p.id, 'ACCEPTED'); }} className={styles.acceptBtn}>✓ Aceptar</button>
                          <button onClick={(e) => { e.preventDefault(); handleStatusChange(p.id, 'CANCELLED'); }} className={styles.rejectBtn}>✕ Rechazar</button>
                        </div>
                      )}
                      {p.status === 'ACCEPTED' && isProposer && (
                        <div className={styles.proposalActions}>
                          <button onClick={(e) => { e.preventDefault(); handleStatusChange(p.id, 'SHIPPING_PENDING'); }} className={styles.acceptBtn}>📦 Envío pendiente</button>
                        </div>
                      )}
                      {p.status === 'SHIPPED' && !isProposer && (
                        <div className={styles.proposalActions}>
                          <button onClick={(e) => { e.preventDefault(); handleStatusChange(p.id, 'RECEIVED'); }} className={styles.acceptBtn}>✓ Confirmar recepción</button>
                        </div>
                      )}
                      {p.status === 'RECEIVED' && (
                        <div className={styles.proposalActions}>
                          <button onClick={(e) => { e.preventDefault(); handleStatusChange(p.id, 'COMPLETED'); }} className={styles.acceptBtn}>✓ Completar</button>
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Proposal Creation Modal */}
        {showProposal && (
          <div className={styles.modal} onClick={() => setShowProposal(false)}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
              <h2>Proponer intercambio</h2>
              <div className={styles.proposalForm}>
                <div className={styles.formSection}>
                  <label>Tú ofreces:</label>
                  {myForTradeItems.length === 0 ? (
                    <p className={styles.formHint}>No tienes cromos marcados para intercambio. Marca algunos en tus colecciones.</p>
                  ) : myForTradeItems.map(item => (
                    <label key={item.id} className={styles.checkItem}>
                      <input type="checkbox" checked={selectedMyItems.includes(item.id)}
                        onChange={e => setSelectedMyItems(prev => e.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} />
                      {item.card_name} {item.card_number ? `#${item.card_number}` : ''} ({item.collectionName})
                    </label>
                  ))}
                </div>
                <div className={styles.formSection}>
                  <label>Ellos te dan:</label>
                  {theirForTradeItems.length === 0 ? (
                    <p className={styles.formHint}>Los elementos que buscas aparecerán aquí.</p>
                  ) : theirForTradeItems.map((item, i) => (
                    <label key={i} className={styles.checkItem}>
                      <input type="checkbox" checked={selectedTheirItems.includes(item.card_name)}
                        onChange={e => setSelectedTheirItems(prev => e.target.checked ? [...prev, item.card_name] : prev.filter(n => n !== item.card_name))} />
                      {item.card_name}
                    </label>
                  ))}
                </div>
                <textarea placeholder="Mensaje (opcional)" value={proposalMsg} onChange={e => setProposalMsg(e.target.value)}
                  className={styles.input} rows={2} />
                <div className={styles.formActions}>
                  <button onClick={() => setShowProposal(false)} className={styles.cancelBtn}>Cancelar</button>
                  <button onClick={handleCreateProposal} disabled={sending || (!selectedMyItems.length && !selectedTheirItems.length)}
                    className={styles.submitBtn}>
                    {sending ? 'Enviando...' : 'Enviar propuesta'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
