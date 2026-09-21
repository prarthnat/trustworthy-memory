import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';

export default function BenchmarkDashboard() {
  const [benchmarks, setBenchmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadBenchmarks();
  }, []);

  const loadBenchmarks = async () => {
    setLoading(true);
    try {
      const data = await apiClient.listBenchmarks();
      setBenchmarks(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runAll = async () => {
    setRunning(true);
    try {
      await apiClient.runAllBenchmarks();
      await loadBenchmarks(); // refresh data
    } catch (err) {
      // 207 Multi-Status also falls here if we aren't careful, but our API client throws on !success.
      // We still want to refresh to see failures.
      await loadBenchmarks();
    } finally {
      setRunning(false);
    }
  };

  const runOne = async (id) => {
    setRunning(true);
    try {
      await apiClient.runBenchmark(id);
      await loadBenchmarks();
    } catch (err) {
      await loadBenchmarks();
    } finally {
      setRunning(false);
    }
  };

  const passedCount = benchmarks.filter(b => b.last_status === 'pass').length;
  const failedCount = benchmarks.filter(b => b.last_status === 'fail' || b.last_status === 'error').length;
  const pendingCount = benchmarks.filter(b => !b.last_status).length;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Deterministic Benchmark Suite</h2>
          <div style={styles.stats}>
            <span style={{color: '#48bb78'}}>Passed: {passedCount}</span>
            <span style={{color: '#fc8181'}}>Failed: {failedCount}</span>
            <span style={{color: '#a0aec0'}}>Pending: {pendingCount}</span>
            <span>Total: {benchmarks.length}</span>
          </div>
        </div>
        <button 
          onClick={runAll} 
          disabled={running || loading} 
          style={running ? {...styles.runBtn, opacity: 0.7} : styles.runBtn}
        >
          {running ? 'Running...' : 'Run All Benchmarks'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.list}>
        {benchmarks.map(b => (
          <div key={b.id} style={{...styles.card, borderColor: b.last_status === 'pass' ? '#48bb78' : b.last_status === 'fail' || b.last_status === 'error' ? '#fc8181' : '#4a5568'}}>
            <div style={styles.cardHeader}>
              <div style={styles.cardTitle}>
                {b.last_status === 'pass' && '✅ '}
                {b.last_status === 'fail' && '❌ '}
                {b.last_status === 'error' && '⚠️ '}
                {!b.last_status && '⏸️ '}
                {b.name}
              </div>
              <button 
                onClick={() => runOne(b.id)} 
                disabled={running} 
                style={styles.runOneBtn}
              >
                Run
              </button>
            </div>
            <p style={styles.description}>{b.description}</p>
            
            {b.last_status && (
              <div style={styles.results}>
                <div style={styles.resultMeta}>
                  Last run: {new Date(b.last_run_at).toLocaleString()} 
                  ({b.last_output?.duration_ms}ms)
                </div>
                
                {b.last_output?.failures?.length > 0 && (
                  <div style={styles.failures}>
                    <div style={{fontWeight: 'bold', marginBottom: '0.25rem'}}>Failures:</div>
                    <ul style={{paddingLeft: '1.5rem', margin: 0}}>
                      {b.last_output.failures.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1000px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px' },
  title: { fontSize: '1.5rem', marginBottom: '0.5rem', fontWeight: 'bold' },
  stats: { display: 'flex', gap: '1rem', fontSize: '0.9rem', fontWeight: 'bold' },
  runBtn: { padding: '0.75rem 1.5rem', borderRadius: '4px', backgroundColor: '#805ad5', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: { backgroundColor: '#1a202c', border: '1px solid #4a5568', borderRadius: '8px', padding: '1.25rem', borderLeftWidth: '4px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  cardTitle: { fontSize: '1.1rem', fontWeight: 'bold' },
  runOneBtn: { padding: '0.25rem 0.75rem', borderRadius: '4px', backgroundColor: '#4a5568', color: 'white', border: 'none', cursor: 'pointer' },
  description: { color: '#a0aec0', fontSize: '0.95rem', marginBottom: '1rem' },
  results: { backgroundColor: '#2d3748', padding: '1rem', borderRadius: '4px', fontSize: '0.85rem' },
  resultMeta: { color: '#cbd5e0', marginBottom: '0.5rem' },
  failures: { color: '#fc8181', backgroundColor: 'rgba(252, 129, 129, 0.1)', padding: '0.75rem', borderRadius: '4px', marginTop: '0.5rem' }
};
