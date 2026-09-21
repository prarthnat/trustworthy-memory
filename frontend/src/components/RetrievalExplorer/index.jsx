import React, { useState } from 'react';
import { apiClient } from '../../api/client';

export default function RetrievalExplorer() {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [tags, setTags] = useState('');
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        query,
        topic: topic || undefined,
        tags: tags ? tags.split(',').map(t => t.trim()) : undefined,
        include_superseded: includeSuperseded
      };
      const data = await apiClient.retrieve(payload);
      setResults(data);
      setError(null);
    } catch (err) {
      setError(err.message);
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const ScoreBreakdown = ({ exp }) => (
    <div style={styles.breakdown}>
      <div>Topic Match: {exp.topic_match_type} ({exp.topic_score})</div>
      <div>Tags Match: {exp.tag_matches.length > 0 ? exp.tag_matches.join(',') : 'none'} ({exp.tag_score})</div>
      <div>Keywords: {exp.keyword_matches.length > 0 ? exp.keyword_matches.join(',') : 'none'} ({exp.keyword_score})</div>
      <div>Recency: {exp.recency_days} days ago ({exp.recency_score})</div>
      <div>Confidence Wt: {exp.confidence_weight}</div>
      {exp.status_penalty > 0 && <div style={{color: '#fc8181'}}>Status Penalty: -{exp.status_penalty}</div>}
      <div style={{fontWeight: 'bold', marginTop: '0.25rem', borderTop: '1px solid #4a5568', paddingTop: '0.25rem'}}>
        Final Score: {exp.final_score}
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Query Memories</h2>
        <form onSubmit={handleSearch} style={styles.form}>
          <input
            type="text"
            placeholder="Search query..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{...styles.input, fontSize: '1.1rem'}}
          />
          <div style={styles.row}>
            <input
              type="text"
              placeholder="Topic filter"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              style={styles.input}
            />
            <input
              type="text"
              placeholder="Tags (comma separated)"
              value={tags}
              onChange={e => setTags(e.target.value)}
              style={styles.input}
            />
          </div>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={includeSuperseded}
              onChange={e => setIncludeSuperseded(e.target.checked)}
            />
            Include superseded memories
          </label>
          <button type="submit" style={styles.submitBtn}>
            {loading ? 'Searching...' : 'Retrieve'}
          </button>
        </form>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      {results && (
        <div style={styles.resultsPanel}>
          <div style={styles.resultsHeader}>
            <h3 style={styles.title}>Results</h3>
            <span style={styles.stats}>
              Showing top {results.results.length} of {results.total_candidates} candidates (Log ID: {results.retrieval_log_id})
            </span>
          </div>
          
          <div style={styles.list}>
            {results.results.map((r, i) => (
              <div key={r.memory_id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div style={styles.rank}>#{i + 1}</div>
                  <div style={styles.score}>{r.score.toFixed(4)}</div>
                  {r.status !== 'active' && <span style={styles.badge}>{r.status}</span>}
                </div>
                <p style={styles.content}>{r.content}</p>
                <div style={styles.meta}>
                  <span style={styles.topic}>{r.topic}</span>
                  <span>{r.source} ({r.source_type})</span>
                </div>
                <div style={styles.explanationSection}>
                  <h4 style={{fontSize: '0.85rem', marginBottom: '0.5rem', color: '#a0aec0'}}>Scoring Explanation</h4>
                  <ScoreBreakdown exp={r.explanation} />
                </div>
              </div>
            ))}
            {results.results.length === 0 && <p style={{color: '#a0aec0'}}>No matching memories found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '900px', margin: '0 auto' },
  panel: { backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px' },
  resultsPanel: { padding: '0', borderRadius: '8px' },
  title: { fontSize: '1.25rem', marginBottom: '1rem', fontWeight: '600' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px', marginTop: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  row: { display: 'flex', gap: '1rem' },
  input: { flex: 1, padding: '0.75rem', borderRadius: '4px', border: '1px solid #4a5568', backgroundColor: '#1a202c', color: 'white' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: '#e2e8f0', cursor: 'pointer' },
  submitBtn: { padding: '0.75rem', borderRadius: '4px', backgroundColor: '#48bb78', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' },
  resultsHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' },
  stats: { fontSize: '0.85rem', color: '#a0aec0' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: { backgroundColor: '#1a202c', border: '1px solid #4a5568', borderRadius: '8px', padding: '1.5rem', position: 'relative' },
  cardHeader: { display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' },
  rank: { backgroundColor: '#4a5568', color: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' },
  score: { color: '#48bb78', fontWeight: 'bold', fontSize: '1.2rem' },
  badge: { padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', backgroundColor: '#ed8936', color: 'black' },
  content: { fontSize: '1.2rem', marginBottom: '1rem', lineHeight: '1.4' },
  meta: { display: 'flex', gap: '1rem', fontSize: '0.85rem', color: '#a0aec0', marginBottom: '1.5rem', borderBottom: '1px solid #2d3748', paddingBottom: '1rem' },
  topic: { fontFamily: 'monospace', color: '#90cdf4' },
  explanationSection: { backgroundColor: '#2d3748', padding: '1rem', borderRadius: '4px' },
  breakdown: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', color: '#cbd5e0', fontFamily: 'monospace' }
};
