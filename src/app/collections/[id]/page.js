'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { authFetch } from '@/lib/authFetch';
import styles from './page.module.css';

const STATUS_LABELS = {
  OWNED: { label: 'Tengo', color: '#10b981', icon: '✓' },
  MISSING: { label: 'Me falta', color: '#ef4444', icon: '✕' },
  DUPLICATE: { label: 'Repetido', color: '#f59e0b', icon: '↻' },
  FOR_TRADE: { label: 'Para intercambio', color: '#6366f1', icon: '⇄' },
  FOR_SALE: { label: 'En venta', color: '#8b5cf6', icon: '€' },
};

const PRIORITY_LABELS = {
  low: { label: 'Baja', color: '#6b7280', icon: '▽' },
  normal: { label: 'Normal', color: '#3b82f6', icon: '◆' },
  high: { label: 'Alta', color: '#f59e0b', icon: '▲' },
  urgent: { label: 'Urgente', color: '#ef4444', icon: '⬥' },
};

export default function CollectionDetailPage() {
  const { id } = useParams();
  const { session, showToast } = useApp();
  const router = useRouter();
  const [collection, setCollection] = useState(null);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ card_name: '', card_number: '', set_name: '', status: 'OWNED', total_quantity: 1, priority: 'normal' });
  const [searchingCard, setSearchingCard] = useState(null);
  const [sellers, setSellers] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('ALL');

  useEffect(() => {
    if (!session?.id) { router.push('/auth'); return; }
    loadCollection();
  }, [id, session]);

  const loadCollection = async () => {
    try {
      const res = await authFetch(`/api/collections/${id}`);
      const data = await res.json();
      if (data.collection) {
        setCollection(data.collection);
        setItems(data.collection.items || []);
        setStats(data.collection.stats || {});
      }
    } catch { showToast('Error al cargar', 'error'); }
    setLoading(false);
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!newItem.card_name.trim()) return;
    try {
      const res = await authFetch(`/api/collections/${id}/items`, {
        method: 'POST',
        body: JSON.stringify(newItem),
      });
      const data = await res.json();
      if (data.item) {
        setShowAdd(false);
        setNewItem({ card_name: '', card_number: '', set_name: '', status: 'OWNED', total_quantity: 1, priority: 'normal' });
        showToast('Elemento añadido', 'success');
        loadCollection();
      } else {
        showToast(data.error || 'Error', 'error');
      }
    } catch { showToast('Error al añadir', 'error'); }
  };

  const handleUpdateStatus = async (itemId, newStatus) => {
    try {
      const res = await authFetch(`/api/collections/${id}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ itemId, status: newStatus, total_quantity: 1 }),
      });
      const data = await res.json();
      if (data.item) { setItems(prev => prev.map(i => i.id === itemId ? data.item : i)); loadCollection(); }
    } catch { showToast('Error al actualizar', 'error'); }
  };

  const handleUpdatePriority = async (itemId, newPriority) => {
    try {
      const res = await authFetch(`/api/collections/${id}/items`, {
        method: 'PATCH',
        body: JSON.stringify({ itemId, priority: newPriority }),
      });
      const data = await res.json();
      if (data.item) { setItems(prev => prev.map(i => i.id === itemId ? data.item : i)); }
    } catch { showToast('Error al actualizar prioridad', 'error'); }
  };

  const handleDeleteItem = async (itemId) => {
    if (!confirm('¿Eliminar este elemento?')) return;
    try {
      const res = await authFetch(`/api/collections/${id}/items?itemId=${itemId}`, { method: 'DELETE' });
      if (res.ok) { setItems(prev => prev.filter(i => i.id !== itemId)); loadCollection(); }
    } catch { showToast('Error al eliminar', 'error'); }
  };

  const handleSearchWhoHasIt = async (cardName) => {
    setSearchingCard(cardName);
    setSearchLoading(true);
    setSellers([]);
    try {
      const res = await authFetch(`/api/cards/who-has-it?card_name=${encodeURIComponent(cardName)}`);
      const data = await res.json();
      setSellers(data.sellers || []);
    } catch { showToast('Error al buscar', 'error'); }
    setSearchLoading(false);
  };

  const filtered = items.filter(i => {
    if (filter !== 'ALL' && i.status !== filter) return false;
    if (priorityFilter !== 'ALL' && i.priority !== priorityFilter) return false;
    if (search && !i.card_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const progress = collection?.total_items > 0
    ? Math.round((items.filter(i => i.status !== 'MISSING').length / collection.total_items) * 100)
    : 0;

  if (loading) return <div className={styles.loading}>Cargando...</div>;
  if (!collection) return <div className={styles.loading}>Colección no encontrada</div>;

  return (
    <div className={styles.page}>
      <div className="container">
        <Link href="/collections" className={styles.backLink}>← Mis Colecciones</Link>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>{collection.name}</h1>
            {collection.description && <p className={styles.desc}>{collection.description}</p>}
            <div className={styles.tags}>
              {collection.category && <span className={styles.tag}>{collection.category}</span>}
              {collection.year && <span className={styles.tag}>{collection.year}</span>}
              <span className={styles.tag}>{collection.visibility === 'public' ? '🌍 Pública' : collection.visibility === 'followers' ? '👥 Seguidores' : '🔒 Privada'}</span>
            </div>
          </div>
        </div>

        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span>Progreso</span>
            <span className={styles.progressPct}>{progress}%</span>
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <div className={styles.progressStats}>
            <span>✅ {items.filter(i => i.status !== 'MISSING').length} obtenidos</span>
            <span>❌ {items.filter(i => i.status === 'MISSING').length} faltan</span>
            <span>↻ {items.filter(i => i.status === 'DUPLICATE' || i.status === 'FOR_TRADE' || i.status === 'FOR_SALE').length} repetidos</span>
          </div>
        </div>

        <div className={styles.controls}>
          <div className={styles.filterRow}>
            {['ALL', 'OWNED', 'MISSING', 'DUPLICATE', 'FOR_TRADE', 'FOR_SALE'].map(s => (
              <button key={s} className={`${styles.filterBtn} ${filter === s ? styles.filterActive : ''}`} onClick={() => setFilter(s)}>
                {s === 'ALL' ? 'Todos' : STATUS_LABELS[s]?.icon + ' ' + STATUS_LABELS[s]?.label}
              </button>
            ))}
          </div>
          {filter === 'MISSING' && (
            <div className={styles.filterRow}>
              <span className={styles.filterLabel}>Prioridad:</span>
              {['ALL', 'low', 'normal', 'high', 'urgent'].map(p => (
                <button key={p} className={`${styles.filterBtn} ${priorityFilter === p ? styles.filterActive : ''}`} onClick={() => setPriorityFilter(p)}>
                  {p === 'ALL' ? 'Todas' : PRIORITY_LABELS[p]?.icon + ' ' + PRIORITY_LABELS[p]?.label}
                </button>
              ))}
            </div>
          )}
          <div className={styles.searchRow}>
            <input type="text" placeholder="Buscar cromo..." value={search} onChange={e => setSearch(e.target.value)} className={styles.searchInput} />
            <button className={styles.addBtn} onClick={() => setShowAdd(true)}>+ Añadir</button>
          </div>
        </div>

        {showAdd && (
          <div className={styles.addForm}>
            <form onSubmit={handleAddItem} className={styles.form}>
              <input type="text" placeholder="Nombre del cromo *" value={newItem.card_name}
                onChange={e => setNewItem(p => ({ ...p, card_name: e.target.value }))} className={styles.input} autoFocus />
              <div className={styles.formRow}>
                <input type="text" placeholder="Número" value={newItem.card_number}
                  onChange={e => setNewItem(p => ({ ...p, card_number: e.target.value }))} className={styles.input} />
                <input type="text" placeholder="Set/Serie" value={newItem.set_name}
                  onChange={e => setNewItem(p => ({ ...p, set_name: e.target.value }))} className={styles.input} />
              </div>
              <div className={styles.formRow}>
                <select value={newItem.status} onChange={e => setNewItem(p => ({ ...p, status: e.target.value }))} className={styles.input}>
                  <option value="OWNED">Tengo</option>
                  <option value="MISSING">Me falta</option>
                  <option value="DUPLICATE">Repetido</option>
                  <option value="FOR_TRADE">Para intercambio</option>
                  <option value="FOR_SALE">En venta</option>
                </select>
                <input type="number" min="1" value={newItem.total_quantity}
                  onChange={e => setNewItem(p => ({ ...p, total_quantity: parseInt(e.target.value) || 1 }))} className={styles.input} />
              </div>
              <div className={styles.formRow}>
                <select value={newItem.priority} onChange={e => setNewItem(p => ({ ...p, priority: e.target.value }))} className={styles.input}>
                  <option value="low">▽ Baja</option>
                  <option value="normal">◆ Normal</option>
                  <option value="high">▲ Alta</option>
                  <option value="urgent">⬥ Urgente</option>
                </select>
                <div />
              </div>
              <div className={styles.formActions}>
                <button type="button" onClick={() => setShowAdd(false)} className={styles.cancelBtn}>Cancelar</button>
                <button type="submit" disabled={!newItem.card_name.trim()} className={styles.submitBtn}>Añadir</button>
              </div>
            </form>
          </div>
        )}

        <div className={styles.itemsList}>
          {filtered.length === 0 ? (
            <div className={styles.emptyItems}>
              <p>{items.length === 0 ? 'Añade tu primer cromo a esta colección' : 'No hay elementos con este filtro'}</p>
            </div>
          ) : (
            filtered.map(item => {
              const st = STATUS_LABELS[item.status] || STATUS_LABELS.OWNED;
              return (
                <div key={item.id} className={styles.item}>
                  <div className={styles.itemStatus} style={{ background: st.color + '20', color: st.color }}>{st.icon}</div>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{item.card_number ? `#${item.card_number} ` : ''}{item.card_name}</span>
                    <span className={styles.itemMeta}>
                      {item.set_name && `${item.set_name} · `}
                      {item.total_quantity > 1 && `×${item.total_quantity} · `}
                      {st.label}
                      {item.status === 'MISSING' && item.priority && item.priority !== 'normal' && (
                        <span className={styles.priorityBadge} style={{ color: PRIORITY_LABELS[item.priority]?.color }}>
                          {' · '}{PRIORITY_LABELS[item.priority]?.icon} {PRIORITY_LABELS[item.priority]?.label}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className={styles.itemActions}>
                    {item.status === 'MISSING' && (
                      <button onClick={() => handleSearchWhoHasIt(item.card_name)} className={styles.searchBtn} title="Buscar quién lo tiene disponible">
                        🔍
                      </button>
                    )}
                    {item.status === 'MISSING' && (
                      <select value={item.priority || 'normal'} onChange={e => handleUpdatePriority(item.id, e.target.value)} className={styles.statusSelect}>
                        <option value="low">▽ Baja</option>
                        <option value="normal">◆ Normal</option>
                        <option value="high">▲ Alta</option>
                        <option value="urgent">⬥ Urgente</option>
                      </select>
                    )}
                    <select value={item.status} onChange={e => handleUpdateStatus(item.id, e.target.value)} className={styles.statusSelect}>
                      <option value="OWNED">✓ Tengo</option>
                      <option value="MISSING">✕ Me falta</option>
                      <option value="DUPLICATE">↻ Repetido</option>
                      <option value="FOR_TRADE">⇄ Intercambio</option>
                      <option value="FOR_SALE">€ Venta</option>
                    </select>
                    <button onClick={() => handleDeleteItem(item.id)} className={styles.itemDelete}>✕</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {searchingCard && (
        <div className={styles.modal} onClick={() => setSearchingCard(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2>¿Quién tiene &ldquo;{searchingCard}&rdquo;?</h2>
            {searchLoading ? (
              <p className={styles.searchHint}>Buscando...</p>
            ) : sellers.length === 0 ? (
              <p className={styles.searchHint}>Nadie tiene este cromo disponible actualmente.</p>
            ) : (
              <div className={styles.sellerList}>
                {sellers.map(s => (
                  <div key={s.user.id} className={styles.sellerCard}>
                    <div className={styles.sellerAvatar}>{s.user.name?.[0] || '?'}</div>
                    <div className={styles.sellerInfo}>
                      <Link href={`/seller/${s.user.username}`} className={styles.sellerName}>{s.user.name}</Link>
                      <div className={styles.sellerMeta}>
                        {s.user.rating > 0 && <span>⭐ {s.user.rating.toFixed(1)}</span>}
                        {s.user.location && <span>📍 {s.user.location}</span>}
                      </div>
                      <div className={styles.sellerItems}>
                        {s.items.map((item, i) => (
                          <span key={i} className={styles.sellerItemBadge}>
                            {item.status === 'FOR_TRADE' ? '⇄ Intercambio' : '€ Venta'}
                            {item.quantity > 1 && ` ×${item.quantity}`}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Link href={`/intercambios?newProposal=${s.user.id}`} className={styles.sellerProposeBtn}>Proponer</Link>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setSearchingCard(null)} className={styles.cancelBtn}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
