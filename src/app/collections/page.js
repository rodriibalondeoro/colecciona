'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { authFetch } from '@/lib/authFetch';
import styles from './page.module.css';

export default function CollectionsPage() {
  const { session, showToast } = useApp();
  const router = useRouter();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newCollection, setNewCollection] = useState({
    name: '', description: '', category: '', year: '', visibility: 'private'
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!session?.id) { router.push('/auth'); return; }
    let cancelled = false;
    loadCollections(cancelled);
    return () => { cancelled = true; };
  }, [session]);

  const loadCollections = async (cancelled) => {
    try {
      const res = await authFetch('/api/collections');
      const data = await res.json();
      if (!cancelled) setCollections(data.collections || []);
    } catch { showToast('Error al cargar colecciones', 'error'); }
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCollection.name.trim()) return;
    setCreating(true);
    try {
      const res = await authFetch('/api/collections', {
        method: 'POST',
        body: JSON.stringify(newCollection),
      });
      const data = await res.json();
      if (data.collection) {
        setCollections(prev => [data.collection, ...prev]);
        setShowCreate(false);
        setNewCollection({ name: '', description: '', category: '', year: '', visibility: 'private' });
        showToast('Colección creada', 'success');
      } else {
        showToast(data.error || 'Error', 'error');
      }
    } catch { showToast('Error al crear', 'error'); }
    setCreating(false);
  };

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta colección y todos sus elementos?')) return;
    try {
      const res = await authFetch(`/api/collections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCollections(prev => prev.filter(c => c.id !== id));
        showToast('Colección eliminada', 'success');
      }
    } catch { showToast('Error al eliminar', 'error'); }
  };

  if (!session?.id) return null;

  return (
    <div className={styles.page}>
      <div className="container">
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Mis Colecciones</h1>
            <p className={styles.subtitle}>Organiza tus cromos y cartas</p>
          </div>
          <button className={styles.createBtn} onClick={() => setShowCreate(true)}>
            + Nueva Colección
          </button>
        </div>

        {showCreate && (
          <div className={styles.modal} onClick={() => setShowCreate(false)}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
              <h2>Crear Colección</h2>
              <form onSubmit={handleCreate} className={styles.form}>
                <input type="text" placeholder="Nombre (ej: LaLiga 2026)" value={newCollection.name}
                  onChange={e => setNewCollection(p => ({ ...p, name: e.target.value }))} className={styles.input} autoFocus />
                <textarea placeholder="Descripción (opcional)" value={newCollection.description}
                  onChange={e => setNewCollection(p => ({ ...p, description: e.target.value }))} className={styles.input} rows={2} />
                <div className={styles.formRow}>
                  <input type="text" placeholder="Categoría" value={newCollection.category}
                    onChange={e => setNewCollection(p => ({ ...p, category: e.target.value }))} className={styles.input} />
                  <input type="number" placeholder="Año" value={newCollection.year}
                    onChange={e => setNewCollection(p => ({ ...p, year: e.target.value }))} className={styles.input} />
                </div>
                <select value={newCollection.visibility} onChange={e => setNewCollection(p => ({ ...p, visibility: e.target.value }))} className={styles.input}>
                  <option value="private">Privada</option>
                  <option value="public">Pública</option>
                  <option value="followers">Solo seguidores</option>
                </select>
                <div className={styles.formActions}>
                  <button type="button" onClick={() => setShowCreate(false)} className={styles.cancelBtn}>Cancelar</button>
                  <button type="submit" disabled={creating || !newCollection.name.trim()} className={styles.submitBtn}>
                    {creating ? 'Creando...' : 'Crear'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {loading ? (
          <div className={styles.grid}>{[1,2,3].map(i => <div key={i} className={styles.skeletonCard} />)}</div>
        ) : collections.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📚</div>
            <h3>Sin colecciones</h3>
            <p>Crea tu primera colección para empezar a organizar tus cromos.</p>
            <button className={styles.createBtn} onClick={() => setShowCreate(true)}>Crear mi primera colección</button>
          </div>
        ) : (
          <div className={styles.grid}>
            {collections.map(col => (
              <Link key={col.id} href={`/collections/${col.id}`} className={styles.card}>
                <div className={styles.cardImage}>
                  {col.cover_image ? <img src={col.cover_image} alt={col.name} /> : <div className={styles.cardPlaceholder}>📚</div>}
                </div>
                <div className={styles.cardBody}>
                  <h3 className={styles.cardTitle}>{col.name}</h3>
                  {col.description && <p className={styles.cardDesc}>{col.description}</p>}
                  <div className={styles.cardMeta}>
                    {col.category && <span className={styles.tag}>{col.category}</span>}
                    {col.year && <span className={styles.tag}>{col.year}</span>}
                    <span className={styles.tag}>{col.visibility === 'public' ? '🌍 Pública' : col.visibility === 'followers' ? '👥 Seguidores' : '🔒 Privada'}</span>
                  </div>
                  <div className={styles.cardStats}>{col.total_items || 0} elementos</div>
                </div>
                <button className={styles.deleteBtn} onClick={(e) => { e.preventDefault(); handleDelete(col.id); }} aria-label="Eliminar">✕</button>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
