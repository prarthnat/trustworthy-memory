// Thin API client for communicating with the backend.

const API_BASE = '/api';

async function fetchJSON(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'API Request Failed');
  }

  return data.data;
}

export const apiClient = {
  // Memories
  listMemories: (filters = {}) => {
    const params = new URLSearchParams(filters);
    return fetchJSON(`/memories?${params.toString()}`);
  },
  createMemory: (memoryData) => fetchJSON('/memories', {
    method: 'POST',
    body: JSON.stringify(memoryData)
  }),
  updateMemory: (id, updates) => fetchJSON(`/memories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  }),
  deleteMemory: (id) => fetchJSON(`/memories/${id}`, { method: 'DELETE' }),
  restoreMemory: (id) => fetchJSON(`/memories/${id}/restore`, { method: 'POST' }),
  getMemory: (id) => fetchJSON(`/memories/${id}`),
  getSupersessions: (id) => fetchJSON(`/memories/${id}/supersessions`),
  correctMemory: (memoryData) => fetchJSON('/memories/correct', {
    method: 'POST',
    body: JSON.stringify(memoryData),
  }),

  // Retrieval
  retrieve: (queryData) => fetchJSON('/retrieve', {
    method: 'POST',
    body: JSON.stringify(queryData)
  }),
  getRetrievalLog: (id) => fetchJSON(`/retrieve/log/${id}`),

  // Lifecycle
  getLifecycle: (id) => fetchJSON(`/lifecycle/${id}`),
  getRecentEvents: () => fetchJSON('/lifecycle/recent'),

  // Benchmarks
  listBenchmarks: () => fetchJSON('/benchmarks'),
  runAllBenchmarks: () => fetchJSON('/benchmarks/run', { method: 'POST' }),
  runBenchmark: (id) => fetchJSON(`/benchmarks/run/${id}`, { method: 'POST' }),
};
