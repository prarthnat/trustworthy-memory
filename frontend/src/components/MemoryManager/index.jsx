import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';

export default function MemoryManager({ onViewLifecycle }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');

  const [formData, setFormData] = useState({
    content: '',
    topic: '',
    source: '',
    source_type: 'user',
    confidence: 1.0,
    tags: ''
  });

  const loadMemories = async () => {
    setLoading(true);
    try {
      const data = await apiClient.listMemories({ status: filterStatus });
      setMemories(data);
      setError(null);
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
      const payload = {
        ...formData,
        confidence: parseFloat(formData.confidence),
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean)
      };
      await apiClient.createMemory(payload);
      setFormData({ content: '', topic: '', source: '', source_type: 'user', confidence: 1.0, tags: '' });
      loadMemories();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete memory?')) return;
    try {
      await apiClient.deleteMemory(id);
      loadMemories();
    } catch (err) {
      setError(err.message);
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'active': return '#48bb78';
      case 'superseded': return '#a0aec0';
      case 'contradicted': return '#ed8936';
      case 'deleted': return '#e53e3e';
      default: return '#cbd5e0';
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Add New Memory</h2>
        {error && <div style={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} style={styles.form}>
          <textarea 
            placeholder="Content..." 
            value={formData.content} 
            onChange={e => setFormData({...formData, content: e.target.value})} 
            required 
            style={{...styles.input, minHeight: '80px'}} 
          />
          <div style={styles.row}>
            <input 
              type="text" 
              placeholder="Topic (e.g. user.preferences)" 
              value={formData.topic} 
              onChange={e => setFormData({...formData, topic: e.target.value})} 
              required 
              style={styles.input}
            />
            <input 
              type="text" 
              placeholder="Source (e.g. settings-panel)" 
              value={formData.source} 
              onChange={e => setFormData({...formData, source: e.target.value})} 
              required 
              style={styles.input}
            />
          </div>
          <div style={styles.row}>
            <select 
              value={formData.source_type} 
              onChange={e => setFormData({...formData, source_type: e.target.value})} 
              style={styles.input}
            >
              <option value="user">User</option>
              <option value="system">System</option>
              <option value="inferred">Inferred</option>
            </select>
            <input 
              type="number" 
              placeholder="Confidence (0.0-1.0)" 
              step="0.1" min="0" max="1" 
              value={formData.confidence} 
              onChange={e => setFormData({...formData, confidence: e.target.value})} 
              required 
              style={styles.input}
            />
          </div>
          <input 
            type="text" 
            placeholder="Tags (comma separated)" 
            value={formData.tags} 
            onChange={e => setFormData({...formData, tags: e.target.value})} 
            style={styles.input}
          />
          <button type="submit" style={styles.submitBtn}>Add Memory</button>
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
        {loading ? <p>Loading...</p> : (
          <div style={styles.list}>
            {memories.map(mem => (
              <div key={mem.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <span style={{...styles.badge, backgroundColor: getStatusColor(mem.status)}}>{mem.status}</span>
                  <span style={styles.topic}>{mem.topic}</span>
                </div>
                <p style={styles.content}>{mem.content}</p>
                <div style={styles.meta}>
                  <span>Source: {mem.source} ({mem.source_type})</span>
                  <span>Conf: {mem.confidence}</span>
                  {mem.tags.length > 0 && <span>Tags: {mem.tags.join(', ')}</span>}
                </div>
                <div style={styles.actions}>
                  <button onClick={() => onViewLifecycle(mem.id)} style={styles.actionBtn}>History</button>
                  {mem.status !== 'deleted' && (
                    <button onClick={() => handleDelete(mem.id)} style={{...styles.actionBtn, color: '#fc8181'}}>Delete</button>
                  )}
                </div>
              </div>
            ))}
            {memories.length === 0 && <p style={{color: '#a0aec0'}}>No memories found.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px', margin: '0 auto' },
  panel: { backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px' },
  title: { fontSize: '1.25rem', marginBottom: '1rem', fontWeight: '600' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px', marginBottom: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  row: { display: 'flex', gap: '1rem' },
  input: { flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #4a5568', backgroundColor: '#1a202c', color: 'white', fontSize: '0.9rem' },
  submitBtn: { padding: '0.75rem', borderRadius: '4px', backgroundColor: '#4299e1', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer' },
  listHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: { backgroundColor: '#1a202c', border: '1px solid #4a5568', borderRadius: '8px', padding: '1rem' },
  cardHeader: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' },
  badge: { padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase' },
  topic: { fontFamily: 'monospace', color: '#90cdf4', fontSize: '0.85rem' },
  content: { fontSize: '1.1rem', marginBottom: '1rem', lineHeight: '1.4' },
  meta: { display: 'flex', gap: '1rem', fontSize: '0.85rem', color: '#a0aec0', marginBottom: '1rem', flexWrap: 'wrap' },
  actions: { display: 'flex', gap: '0.5rem', borderTop: '1px solid #2d3748', paddingTop: '0.5rem' },
  actionBtn: { backgroundColor: 'transparent', border: '1px solid #4a5568', color: '#e2e8f0', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }
};
