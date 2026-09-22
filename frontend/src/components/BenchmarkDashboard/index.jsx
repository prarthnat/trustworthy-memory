import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{ ...styles.summaryCard, borderColor: color || '#4a5568' }}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={{ ...styles.summaryValue, color: color || '#e2e8f0' }}>{value}</div>
      {sub && <div style={styles.summarySub}>{sub}</div>}
    </div>
  );
}

export default function BenchmarkDashboard() {
  const [benchmarks, setBenchmarks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [expandedFailures, setExpandedFailures] = useState({});

  useEffect(() => {
    loadBenchmarks();
  }, []);

  const loadBenchmarks = async () => {
    setLoading(true);
    try {
      const data = await apiClient.listBenchmarks();
      setBenchmarks(data);
      setError(null);
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
    } catch {
      // 207 partial failure — still refresh
    } finally {
      await loadBenchmarks();
      setRunning(false);
    }
  };

  const runOne = async (id) => {
    setRunning(true);
    try {
      await apiClient.runBenchmark(id);
    } catch {
      // refresh on partial failure
    } finally {
      await loadBenchmarks();
      setRunning(false);
    }
  };

  const toggleFailures = (id) => {
    setExpandedFailures((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalQueries = benchmarks.length;
  const passedCount = benchmarks.filter((b) => b.last_status === 'pass').length;
  const failedCount = benchmarks.filter((b) => b.last_status === 'fail' || b.last_status === 'error').length;
  const pendingCount = benchmarks.filter((b) => !b.last_status).length;
  const passRate =
    totalQueries > 0 ? `${Math.round((passedCount / totalQueries) * 100)}%` : '—';

  const totalDurationMs = benchmarks.reduce(
    (sum, b) => sum + (b.last_output?.duration_ms || 0),
    0
  );
  const lastRunAt = benchmarks
    .map((b) => b.last_run_at)
    .filter(Boolean)
    .sort((a, b) => b - a)[0];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>Deterministic Benchmark Suite</h2>
          <p style={styles.subtitle}>
            Each benchmark seeds fixtures, runs retrieval, compares expectations, then rolls back the DB.
          </p>
        </div>
        <button
          type="button"
          onClick={runAll}
          disabled={running || loading}
          style={running ? { ...styles.runBtn, opacity: 0.7 } : styles.runBtn}
        >
          {running ? 'Running...' : 'Run All Benchmarks'}
        </button>
      </div>

      <div style={styles.summaryRow}>
        <SummaryCard label="Total Queries" value={totalQueries} />
        <SummaryCard label="Passed" value={passedCount} color="#48bb78" sub={pendingCount ? `${pendingCount} pending` : undefined} />
        <SummaryCard label="Failed" value={failedCount} color="#fc8181" />
        <SummaryCard label="Pass Rate" value={passRate} color="#90cdf4" />
        <SummaryCard
          label="Runtime"
          value={totalDurationMs ? `${totalDurationMs} ms` : '—'}
          sub={lastRunAt ? `Latest run: ${new Date(lastRunAt).toLocaleString()}` : 'Not run yet'}
        />
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && <p style={{ color: '#a0aec0' }}>Loading benchmarks...</p>}

      <div style={styles.list}>
        {benchmarks.map((b) => {
          const failures = b.last_output?.failures || [];
          const hasFailures = failures.length > 0;
          const expanded = expandedFailures[b.id];

          return (
            <div
              key={b.id}
              style={{
                ...styles.card,
                borderColor:
                  b.last_status === 'pass'
                    ? '#48bb78'
                    : b.last_status === 'fail' || b.last_status === 'error'
                      ? '#fc8181'
                      : '#4a5568',
              }}
            >
              <div style={styles.cardHeader}>
                <div style={styles.cardTitle}>
                  {b.last_status === 'pass' && '✅ '}
                  {b.last_status === 'fail' && '❌ '}
                  {b.last_status === 'error' && '⚠️ '}
                  {!b.last_status && '⏸️ '}
                  {b.name}
                  <span style={styles.benchId}> ({b.id})</span>
                </div>
                <button type="button" onClick={() => runOne(b.id)} disabled={running} style={styles.runOneBtn}>
                  Run
                </button>
              </div>
              <p style={styles.description}>{b.description}</p>

              {b.last_status && (
                <div style={styles.results}>
                  <div style={styles.resultMeta}>
                    Status: <strong>{b.last_status.toUpperCase()}</strong>
                    {' · '}
                    Last run: {b.last_run_at ? new Date(b.last_run_at).toLocaleString() : '—'}
                    {' · '}
                    Duration: {b.last_output?.duration_ms != null ? `${b.last_output.duration_ms} ms` : '—'}
                  </div>

                  {hasFailures && (
                    <div style={styles.failuresWrap}>
                      <button type="button" onClick={() => toggleFailures(b.id)} style={styles.failToggle}>
                        {expanded ? '▼' : '▶'} Failures ({failures.length})
                      </button>
                      {expanded && (
                        <ul style={styles.failList}>
                          {failures.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {b.last_status === 'pass' && (
                    <div style={styles.passNote}>All expectations matched for this query scenario.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px', flexWrap: 'wrap' },
  title: { fontSize: '1.5rem', marginBottom: '0.35rem', fontWeight: 'bold' },
  subtitle: { margin: 0, fontSize: '0.9rem', color: '#a0aec0', maxWidth: '520px' },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' },
  summaryCard: { backgroundColor: '#1a202c', border: '2px solid', borderRadius: '8px', padding: '1rem' },
  summaryLabel: { fontSize: '0.75rem', textTransform: 'uppercase', color: '#718096', fontWeight: '700', marginBottom: '0.35rem' },
  summaryValue: { fontSize: '1.75rem', fontWeight: '800' },
  summarySub: { fontSize: '0.75rem', color: '#a0aec0', marginTop: '0.35rem' },
  runBtn: { padding: '0.75rem 1.5rem', borderRadius: '4px', backgroundColor: '#805ad5', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px' },
  list: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  card: { backgroundColor: '#1a202c', border: '1px solid #4a5568', borderRadius: '8px', padding: '1.25rem', borderLeftWidth: '4px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '0.5rem' },
  cardTitle: { fontSize: '1.1rem', fontWeight: 'bold' },
  benchId: { fontWeight: 'normal', color: '#718096', fontSize: '0.85rem' },
  runOneBtn: { padding: '0.25rem 0.75rem', borderRadius: '4px', backgroundColor: '#4a5568', color: 'white', border: 'none', cursor: 'pointer' },
  description: { color: '#a0aec0', fontSize: '0.95rem', marginBottom: '1rem' },
  results: { backgroundColor: '#2d3748', padding: '1rem', borderRadius: '4px', fontSize: '0.85rem' },
  resultMeta: { color: '#cbd5e0', marginBottom: '0.5rem' },
  failuresWrap: { marginTop: '0.5rem' },
  failToggle: { background: 'none', border: 'none', color: '#fc8181', cursor: 'pointer', fontWeight: 'bold', padding: 0, fontSize: '0.9rem' },
  failList: { paddingLeft: '1.25rem', margin: '0.5rem 0 0', color: '#fed7d7' },
  passNote: { color: '#9ae6b4', marginTop: '0.25rem' },
};
