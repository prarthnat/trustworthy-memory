import React, { useState } from 'react';
import MemoryManager from './components/MemoryManager';
import RetrievalExplorer from './components/RetrievalExplorer';
import LifecycleHistory from './components/LifecycleHistory';
import BenchmarkDashboard from './components/BenchmarkDashboard';

const tabs = [
  { id: 'memory', label: 'Memory Manager' },
  { id: 'retrieval', label: 'Retrieval Explorer' },
  { id: 'lifecycle', label: 'Lifecycle History' },
  { id: 'benchmark', label: 'Benchmark Dashboard' }
];

export default function App() {
  const [activeTab, setActiveTab] = useState('memory');
  const [selectedMemoryId, setSelectedMemoryId] = useState(null);

  const navigateToLifecycle = (memoryId) => {
    setSelectedMemoryId(memoryId);
    setActiveTab('lifecycle');
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Caygnus Long-Term Memory</h1>
        <nav style={styles.nav}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              style={activeTab === tab.id ? { ...styles.tabBtn, ...styles.activeTabBtn } : styles.tabBtn}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main style={styles.main}>
        {activeTab === 'memory' && <MemoryManager onViewLifecycle={navigateToLifecycle} />}
        {activeTab === 'retrieval' && <RetrievalExplorer />}
        {activeTab === 'lifecycle' && <LifecycleHistory memoryId={selectedMemoryId} />}
        {activeTab === 'benchmark' && <BenchmarkDashboard />}
      </main>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
  },
  header: {
    padding: '1.5rem',
    borderBottom: '1px solid #2d3748',
    backgroundColor: '#1a202c',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: '1rem',
  },
  nav: {
    display: 'flex',
    gap: '0.5rem',
  },
  tabBtn: {
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#2d3748',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
  },
  activeTabBtn: {
    backgroundColor: '#4299e1',
    color: 'white',
  },
  main: {
    flex: 1,
    padding: '1.5rem',
    overflowY: 'auto',
  },
};
