import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import {
  formatTimestamp,
  getStatusColor,
  statusLabel,
} from '../../utils/reviewerHelpers';

function MetaRow({ label, value, mono }) {
  return (
    <div style={styles.metaRow}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={mono ? styles.metaValueMono : styles.metaValue}>{value ?? '—'}</span>
    </div>
  );
}

export default function MemoryManager({ onViewLifecycle }) {
  const [memories, setMemories] = useState([]);
  const [supersessionById, setSupersessionById] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');

  const [formData, setFormData] = useState({
    content: '',
    topic: '',
    source: '',
    source_type: 'user',
    confidence: 1.0,
    tags: '',
    canonical_key: '',
  });
  const [isCorrection, setIsCorrection] = useState(false);

  const loadMemories = async () => {
    setLoading(true);
    try {
      const data = await apiClient.listMemories({ status: filterStatus });
      setMemories(data);
      setError(null);

      const links = {};
      await Promise.all(
        data.map(async (mem) => {
          try {
            links[mem.id] = await apiClient.getSupersessions(mem.id);
          } catch {
            links[mem.id] = { supersedes: [], superseded_by: [] };
          }
        })
      );
      setSupersessionById(links);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMemories();
  }, [filterStatus]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const metadata = formData.canonical_key
        ? { canonical_key: formData.canonical_key.trim() }
        : {};
      const payload = {
        content: formData.content,
        topic: formData.topic,
        source: formData.source,
        source_type: formData.source_type,
        confidence: parseFloat(formData.confidence),
        tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        metadata,
      };
      if (isCorrection) {
        await apiClient.correctMemory(payload);
      } else {
        await apiClient.createMemory(payload);
      }
      setFormData({
        content: '',
        topic: '',
        source: '',
        source_type: 'user',
        confidence: 1.0,
        tags: '',
        canonical_key: '',
      });
      setIsCorrection(false);
      loadMemories();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Soft-delete this memory? It will remain in lifecycle history.')) return;
    try {
      await apiClient.deleteMemory(id);
      loadMemories();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <h2 style={styles.title}>{isCorrection ? 'Correct Memory (explicit replacement)' : 'Add New Memory'}</h2>
        <p style={styles.hint}>
          Corrections use the same topic/canonical fact key; reconciliation may supersede prior active memories.
        </p>
        {error && <div style={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={isCorrection}
              onChange={(e) => setIsCorrection(e.target.checked)}
            />
            Submit as explicit correction (POST /memories/correct)
          </label>
          <textarea
            placeholder="Content..."
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            required
            style={{ ...styles.input, minHeight: '80px' }}
          />
          <div style={styles.row}>
            <input
              type="text"
              placeholder="Topic (e.g. user.location.home_city)"
              value={formData.topic}
              onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
              required
              style={styles.input}
            />
            <input
              type="text"
              placeholder="Canonical key (optional, e.g. user.location.home_city)"
              value={formData.canonical_key}
              onChange={(e) => setFormData({ ...formData, canonical_key: e.target.value })}
              style={styles.input}
            />
          </div>
          <div style={styles.row}>
            <input
              type="text"
              placeholder="Source (e.g. settings-panel)"
              value={formData.source}
              onChange={(e) => setFormData({ ...formData, source: e.target.value })}
              required
              style={styles.input}
            />
            <select
              value={formData.source_type}
              onChange={(e) => setFormData({ ...formData, source_type: e.target.value })}
              style={styles.input}
            >
              <option value="user">User</option>
              <option value="system">System</option>
              <option value="inferred">Inferred</option>
            </select>
            <input
              type="number"
              placeholder="Confidence (0.0-1.0)"
              step="0.1"
              min="0"
              max="1"
              value={formData.confidence}
              onChange={(e) => setFormData({ ...formData, confidence: e.target.value })}
              required
              style={styles.input}
            />
          </div>
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            style={styles.input}
          />
          <button type="submit" style={styles.submitBtn}>
            {isCorrection ? 'Submit Correction' : 'Add Memory'}
          </button>
        </form>
      </div>

      <div style={styles.panel}>
        <div style={styles.listHeader}>
          <h2 style={styles.title}>All Memories</h2>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={styles.input}>
            <option value="">All (except deleted)</option>
            <option value="active">Active</option>
            <option value="contradicted">Contradicted</option>
            <option value="superseded">Superseded</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <div style={styles.list}>
            {memories.map((mem) => {
              const links = supersessionById[mem.id] || { supersedes: [], superseded_by: [] };
              const supersedesIds = (links.supersedes || []).map((s) => s.old_memory_id);
              const supersededByIds = (links.superseded_by || []).map((s) => s.new_memory_id);
              const borderColor = getStatusColor(mem.status);

              return (
                <div
                  key={mem.id}
                  style={{
                    ...styles.card,
                    borderLeft: `6px solid ${borderColor}`,
                  }}
                >
                  <div
                    style={{
                      ...styles.statusBanner,
                      backgroundColor: borderColor,
                    }}
                  >
                    Lifecycle: {statusLabel(mem.status)}
                  </div>

                  <p style={styles.content}>{mem.content}</p>

                  <div style={styles.metaGrid}>
                    <MetaRow label="Memory ID" value={mem.id} mono />
                    <MetaRow label="Status" value={statusLabel(mem.status)} />
                    <MetaRow label="Topic" value={mem.topic} mono />
                    <MetaRow label="Source" value={mem.source} />
                    <MetaRow label="Source Type" value={mem.source_type} />
                    <MetaRow label="Created At" value={formatTimestamp(mem.created_at)} />
                    <MetaRow label="Updated At" value={formatTimestamp(mem.updated_at)} />
                    <MetaRow label="Confidence" value={String(mem.confidence)} />
                    <MetaRow
                      label="Tags"
                      value={mem.tags?.length ? mem.tags.join(', ') : 'none'}
                    />
                    {supersedesIds.length > 0 && (
                      <MetaRow label="Supersedes" value={supersedesIds.join(', ')} mono />
                    )}
                    {supersededByIds.length > 0 && (
                      <MetaRow label="Superseded By" value={supersededByIds.join(', ')} mono />
                    )}
                  </div>

                  <div style={styles.actions}>
                    <button type="button" onClick={() => onViewLifecycle(mem.id)} style={styles.actionBtn}>
                      History
                    </button>
                    {mem.status !== 'deleted' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(mem.id)}
                        style={{ ...styles.actionBtn, color: '#fc8181' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {memories.length === 0 && <p style={{ color: '#a0aec0' }}>No memories found.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '960px', margin: '0 auto' },
  panel: { backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px' },
  title: { fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '600' },
  hint: { fontSize: '0.85rem', color: '#a0aec0', marginBottom: '1rem' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px', marginBottom: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  row: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  input: { flex: 1, minWidth: '140px', padding: '0.5rem', borderRadius: '4px', border: '1px solid #4a5568', backgroundColor: '#1a202c', color: 'white', fontSize: '0.9rem' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#e2e8f0' },
  submitBtn: { padding: '0.75rem', borderRadius: '4px', backgroundColor: '#4299e1', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer' },
  listHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: { backgroundColor: '#1a202c', border: '1px solid #4a5568', borderRadius: '8px', padding: '1rem', overflow: 'hidden' },
  statusBanner: { margin: '-1rem -1rem 1rem', padding: '0.5rem 1rem', color: '#1a202c', fontWeight: '800', fontSize: '0.85rem', letterSpacing: '0.04em' },
  content: { fontSize: '1.1rem', marginBottom: '1rem', lineHeight: '1.4' },
  metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem 1rem', marginBottom: '1rem', fontSize: '0.85rem' },
  metaRow: { display: 'flex', flexDirection: 'column', gap: '0.15rem' },
  metaLabel: { color: '#718096', textTransform: 'uppercase', fontSize: '0.7rem', fontWeight: '600' },
  metaValue: { color: '#e2e8f0' },
  metaValueMono: { color: '#90cdf4', fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' },
  actions: { display: 'flex', gap: '0.5rem', borderTop: '1px solid #2d3748', paddingTop: '0.5rem' },
  actionBtn: { backgroundColor: 'transparent', border: '1px solid #4a5568', color: '#e2e8f0', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' },
};
