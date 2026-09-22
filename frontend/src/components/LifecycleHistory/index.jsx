import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import {
  buildSupersessionChainSummary,
  formatChainCompact,
  eventTypeLabel,
  formatTimestamp,
  getStatusColor,
  statusLabel,
} from '../../utils/reviewerHelpers';

export default function LifecycleHistory({ memoryId }) {
  const [history, setHistory] = useState(null);
  const [chain, setChain] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inputId, setInputId] = useState(memoryId || '');

  useEffect(() => {
    if (memoryId) {
      setInputId(memoryId);
      loadHistory(memoryId);
    }
  }, [memoryId]);

  const loadHistory = async (id) => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiClient.getLifecycle(id);
      setHistory(data);
      const chainSummary = await buildSupersessionChainSummary(id, apiClient);
      setChain(chainSummary);
      setError(null);
    } catch (err) {
      setError(err.message);
      setHistory(null);
      setChain([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadHistory(inputId);
  };

  const activeNode = chain.find((n) => n.status === 'active') || chain[chain.length - 1];

  const EventCard = ({ event }) => {
    const isLifecycle =
      event.event_type === 'created' ||
      event.event_type === 'superseded' ||
      event.event_type === 'deleted';

    return (
      <div
        style={{
          ...styles.eventCard,
          borderLeft: isLifecycle ? `4px solid ${getStatusColor(event.event_type === 'deleted' ? 'deleted' : event.event_type === 'superseded' ? 'superseded' : 'active')}` : '4px solid #4299e1',
        }}
      >
        <div style={styles.eventHeader}>
          <span style={styles.eventType(event.event_type)}>{eventTypeLabel(event.event_type)}</span>
          <span style={styles.eventTime}>{formatTimestamp(event.event_at)}</span>
        </div>
        <div style={styles.eventActor}>Actor: {event.actor}</div>
        {event.notes && <div style={styles.eventNotes}>Note: {event.notes}</div>}

        {(event.old_value || event.new_value) && (
          <div style={styles.diffContainer}>
            {event.old_value && (
              <div style={styles.diffCol}>
                <div style={styles.diffLabel}>Before</div>
                <pre style={styles.diffPre}>{JSON.stringify(event.old_value, null, 2)}</pre>
              </div>
            )}
            {event.new_value && (
              <div style={styles.diffCol}>
                <div style={styles.diffLabel}>After</div>
                <pre style={styles.diffPre}>{JSON.stringify(event.new_value, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <h2 style={styles.title}>Memory Lifecycle Audit Trail</h2>
        <form onSubmit={handleSearch} style={styles.form}>
          <input
            type="text"
            placeholder="Enter Memory ID..."
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            style={styles.input}
          />
          <button type="submit" style={styles.submitBtn}>View History</button>
        </form>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      {loading && <p>Loading timeline...</p>}

      {history && (
        <div style={styles.timelineContainer}>
          <div style={styles.memorySummary}>
            <h3 style={{ marginBottom: '0.5rem', color: '#90cdf4' }}>Target Memory</h3>
            <div style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>ID: {history.memory.id}</div>
            <div style={{ fontSize: '1.1rem', margin: '0.5rem 0' }}>{history.memory.content}</div>
            <div
              style={{
                display: 'inline-block',
                padding: '0.35rem 0.75rem',
                borderRadius: '4px',
                backgroundColor: getStatusColor(history.memory.status),
                color: '#1a202c',
                fontWeight: '800',
                fontSize: '0.85rem',
              }}
            >
              Current status: {statusLabel(history.memory.status)}
            </div>
          </div>

          {chain.length > 0 && (
            <div style={styles.chainPanel}>
              <h3 style={styles.chainTitle}>Supersession Chain Summary</h3>
              <p style={styles.chainMeta}>
                Chain length: {chain.length} memory(ies)
                {activeNode && (
                  <>
                    {' '}
                    · Active memory: <span style={styles.mono}>{activeNode.id}</span>
                  </>
                )}
              </p>
              <pre style={styles.chainCompact}>{formatChainCompact(chain)}</pre>
              <div style={styles.chainVisual}>
                {chain.map((node, idx) => (
                  <React.Fragment key={node.id}>
                    <div
                      style={{
                        ...styles.chainNode,
                        borderColor: getStatusColor(node.status),
                        backgroundColor: node.status === 'active' ? 'rgba(72, 187, 120, 0.15)' : '#2d3748',
                      }}
                    >
                      <div style={styles.chainContent}>{node.content}</div>
                      <div style={styles.chainStatus}>
                        {statusLabel(node.status)}
                        {node.status === 'active' && ' ← CURRENT ACTIVE'}
                      </div>
                      <div style={styles.chainId}>{node.id}</div>
                    </div>
                    {idx < chain.length - 1 && <div style={styles.chainArrow}>↓</div>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          <h3 style={{ color: '#cbd5e0', marginBottom: '0.5rem' }}>Lifecycle events (oldest → newest)</h3>
          <div style={styles.timeline}>
            {history.events.map((evt, idx) => (
              <div key={evt.id} style={styles.timelineItem}>
                <div style={styles.timelineLine}>
                  <div style={styles.timelineDot(evt.event_type)} />
                  {idx !== history.events.length - 1 && <div style={styles.timelineConnector} />}
                </div>
                <div style={styles.timelineContent}>
                  <EventCard event={evt} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '900px', margin: '0 auto' },
  panel: { backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px' },
  title: { fontSize: '1.25rem', marginBottom: '1rem', fontWeight: '600' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px', marginTop: '1rem' },
  form: { display: 'flex', gap: '1rem' },
  input: { flex: 1, padding: '0.75rem', borderRadius: '4px', border: '1px solid #4a5568', backgroundColor: '#1a202c', color: 'white' },
  submitBtn: { padding: '0.75rem 1.5rem', borderRadius: '4px', backgroundColor: '#4299e1', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer' },

  timelineContainer: { display: 'flex', flexDirection: 'column', gap: '2rem' },
  memorySummary: { backgroundColor: '#1a202c', padding: '1.5rem', borderRadius: '8px', borderLeft: '4px solid #4299e1' },

  chainPanel: { backgroundColor: '#1a202c', padding: '1.5rem', borderRadius: '8px', border: '1px solid #4a5568' },
  chainTitle: { margin: '0 0 0.5rem', color: '#f6e05e', fontSize: '1.1rem' },
  chainMeta: { margin: '0 0 1rem', color: '#a0aec0', fontSize: '0.9rem' },
  mono: { fontFamily: 'monospace', color: '#90cdf4' },
  chainCompact: {
    margin: '0 0 1rem',
    padding: '1rem',
    backgroundColor: '#2d3748',
    borderRadius: '6px',
    border: '1px solid #4a5568',
    color: '#f7fafc',
    fontSize: '1.05rem',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    fontFamily: 'inherit',
  },
  chainVisual: { display: 'flex', flexDirection: 'column', alignItems: 'stretch' },
  chainNode: { border: '2px solid', borderRadius: '8px', padding: '1rem' },
  chainContent: { fontSize: '1.05rem', marginBottom: '0.35rem' },
  chainStatus: { fontSize: '0.8rem', fontWeight: '700', color: '#48bb78' },
  chainId: { fontSize: '0.75rem', fontFamily: 'monospace', color: '#718096', marginTop: '0.35rem' },
  chainArrow: { textAlign: 'center', fontSize: '1.5rem', color: '#4299e1', lineHeight: 1.2, padding: '0.25rem 0' },

  timeline: { display: 'flex', flexDirection: 'column' },
  timelineItem: { display: 'flex', gap: '1.5rem', minHeight: '100px' },
  timelineLine: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '20px' },
  timelineDot: (type) => ({
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor:
      type === 'created' ? '#48bb78' : type === 'deleted' ? '#e53e3e' : type === 'superseded' ? '#718096' : '#4299e1',
    zIndex: 2,
  }),
  timelineConnector: { width: '2px', flex: 1, backgroundColor: '#4a5568', margin: '4px 0' },
  timelineContent: { flex: 1, paddingBottom: '2rem' },

  eventCard: { backgroundColor: '#2d3748', borderRadius: '8px', padding: '1rem', border: '1px solid #4a5568' },
  eventHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' },
  eventType: (type) => ({
    padding: '0.2rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    backgroundColor:
      type === 'created' ? '#48bb78' : type === 'deleted' ? '#e53e3e' : type.includes('supers') ? '#718096' : '#4299e1',
    color: 'white',
  }),
  eventTime: { fontSize: '0.85rem', color: '#a0aec0' },
  eventActor: { fontSize: '0.85rem', color: '#cbd5e0', marginBottom: '0.5rem' },
  eventNotes: { fontSize: '0.9rem', color: '#f6ad55', fontStyle: 'italic', marginBottom: '1rem' },

  diffContainer: { display: 'flex', gap: '1rem', marginTop: '1rem', backgroundColor: '#1a202c', padding: '0.5rem', borderRadius: '4px', flexWrap: 'wrap' },
  diffCol: { flex: 1, minWidth: '200px' },
  diffLabel: { fontSize: '0.75rem', color: '#a0aec0', textTransform: 'uppercase', marginBottom: '0.25rem' },
  diffPre: { margin: 0, fontSize: '0.8rem', color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
};
