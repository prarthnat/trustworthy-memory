import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';

export default function LifecycleHistory({ memoryId }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inputId, setInputId] = useState(memoryId || '');

  useEffect(() => {
    if (memoryId) {
      loadHistory(memoryId);
    }
  }, [memoryId]);

  const loadHistory = async (id) => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiClient.getLifecycle(id);
      setHistory(data);
      setError(null);
    } catch (err) {
      setError(err.message);
      setHistory(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadHistory(inputId);
  };

  const EventCard = ({ event }) => (
    <div style={styles.eventCard}>
      <div style={styles.eventHeader}>
        <span style={styles.eventType(event.event_type)}>{event.event_type}</span>
        <span style={styles.eventTime}>{new Date(event.event_at).toLocaleString()}</span>
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
            <h3 style={{marginBottom: '0.5rem', color: '#90cdf4'}}>Target Memory</h3>
            <div style={{fontFamily: 'monospace', fontSize: '0.9rem'}}>ID: {history.memory.id}</div>
            <div style={{fontSize: '1.1rem', margin: '0.5rem 0'}}>{history.memory.content}</div>
            <div style={{fontSize: '0.9rem', color: '#a0aec0'}}>Current Status: {history.memory.status}</div>
          </div>

          <div style={styles.timeline}>
            {history.events.map((evt, idx) => (
              <div key={evt.id} style={styles.timelineItem}>
                <div style={styles.timelineLine}>
                  <div style={styles.timelineDot}></div>
                  {idx !== history.events.length - 1 && <div style={styles.timelineConnector}></div>}
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
  container: { display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '800px', margin: '0 auto' },
  panel: { backgroundColor: '#2d3748', padding: '1.5rem', borderRadius: '8px' },
  title: { fontSize: '1.25rem', marginBottom: '1rem', fontWeight: '600' },
  error: { color: '#fc8181', backgroundColor: '#742a2a', padding: '0.5rem', borderRadius: '4px', marginTop: '1rem' },
  form: { display: 'flex', gap: '1rem' },
  input: { flex: 1, padding: '0.75rem', borderRadius: '4px', border: '1px solid #4a5568', backgroundColor: '#1a202c', color: 'white' },
  submitBtn: { padding: '0.75rem 1.5rem', borderRadius: '4px', backgroundColor: '#4299e1', color: 'white', border: 'none', fontWeight: 'bold', cursor: 'pointer' },
  
  timelineContainer: { display: 'flex', flexDirection: 'column', gap: '2rem' },
  memorySummary: { backgroundColor: '#1a202c', padding: '1.5rem', borderRadius: '8px', borderLeft: '4px solid #4299e1' },
  
  timeline: { display: 'flex', flexDirection: 'column' },
  timelineItem: { display: 'flex', gap: '1.5rem', minHeight: '100px' },
  timelineLine: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '20px' },
  timelineDot: { width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#4299e1', zIndex: 2 },
  timelineConnector: { width: '2px', flex: 1, backgroundColor: '#4a5568', margin: '4px 0' },
  timelineContent: { flex: 1, paddingBottom: '2rem' },
  
  eventCard: { backgroundColor: '#2d3748', borderRadius: '8px', padding: '1rem', border: '1px solid #4a5568' },
  eventHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  eventType: (type) => ({
    padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase',
    backgroundColor: type === 'created' ? '#48bb78' : type === 'deleted' ? '#e53e3e' : type.includes('contradict') ? '#ed8936' : '#4299e1',
    color: 'white'
  }),
  eventTime: { fontSize: '0.85rem', color: '#a0aec0' },
  eventActor: { fontSize: '0.85rem', color: '#cbd5e0', marginBottom: '0.5rem' },
  eventNotes: { fontSize: '0.9rem', color: '#f6ad55', fontStyle: 'italic', marginBottom: '1rem' },
  
  diffContainer: { display: 'flex', gap: '1rem', marginTop: '1rem', backgroundColor: '#1a202c', padding: '0.5rem', borderRadius: '4px' },
  diffCol: { flex: 1 },
  diffLabel: { fontSize: '0.75rem', color: '#a0aec0', textTransform: 'uppercase', marginBottom: '0.25rem' },
  diffPre: { margin: 0, fontSize: '0.8rem', color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
};
