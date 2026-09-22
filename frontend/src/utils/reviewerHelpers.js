/** Shared formatting and explainability helpers for reviewer-facing UI. */

export function formatTimestamp(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  return new Date(Number(ms)).toLocaleString();
}

export function getStatusColor(status) {
  switch (status) {
    case 'active':
      return '#48bb78';
    case 'superseded':
      return '#718096';
    case 'contradicted':
      return '#ed8936';
    case 'deleted':
      return '#e53e3e';
    default:
      return '#cbd5e0';
  }
}

export function statusLabel(status) {
  return (status || 'unknown').toUpperCase();
}

/**
 * Plain-English retrieval rationale for reviewers.
 * @param {object} result — API retrieval result row
 * @param {{ topicFilter?: string, tagsFilter?: string[] }} [queryContext] — form filters
 */
export function explainWhySelected(result, queryContext = {}) {
  const exp = result.explanation || {};
  const evidence = result.evidence || [];
  const sentences = [];
  const { topicFilter, tagsFilter } = queryContext;

  // Topic
  if (topicFilter) {
    if (exp.topic_match_type && exp.topic_match_type !== 'none') {
      const topicMsg = {
        exact: `Topic match: filter "${topicFilter}" exactly matches memory topic "${result.topic}".`,
        prefix: `Topic match: filter "${topicFilter}" is a parent of memory topic "${result.topic}".`,
        parent: `Topic match: memory topic "${result.topic}" is broader than filter "${topicFilter}".`,
        partial: `Topic match: partial overlap between filter "${topicFilter}" and "${result.topic}".`,
      };
      sentences.push(topicMsg[exp.topic_match_type] || 'Topic filter contributed to the score.');
    } else {
      sentences.push(
        `Topic match: filter "${topicFilter}" did not strongly match memory topic "${result.topic}".`
      );
    }
  } else {
    sentences.push(
      `Topic match: no topic filter — neutral category score (${exp.topic_score ?? 'n/a'}).`
    );
  }

  // Keywords
  if (exp.keyword_matches?.length) {
    sentences.push(`Keyword match: ${exp.keyword_matches.join(', ')} appear in the memory content.`);
  } else {
    sentences.push('Keyword match: no query terms overlapped with content (after stop-word removal).');
  }

  // Tags
  if (tagsFilter?.length) {
    if (exp.tag_matches?.length) {
      sentences.push(`Tag match: shared tags ${exp.tag_matches.join(', ')} with query tags.`);
    } else {
      sentences.push('Tag match: query tags were provided but none overlapped with this memory.');
    }
  } else if (exp.tag_matches?.length) {
    sentences.push(`Tag match: memory tags ${exp.tag_matches.join(', ')} (no tag filter on query).`);
  } else {
    sentences.push('Tag match: no tag filter on query; tag score from general overlap only.');
  }

  // Recency
  if (exp.recency_days != null) {
    sentences.push(
      `Recency: memory is ~${exp.recency_days} day(s) old (recency score ${exp.recency_score ?? 'n/a'}).`
    );
  }

  if (result.source_type === 'user') {
    sentences.push('Provenance is user-asserted, which increases trust weight in scoring.');
  } else if (result.source_type === 'system') {
    sentences.push('Provenance is system-recorded (moderate trust weight).');
  } else if (result.source_type === 'inferred') {
    sentences.push('Provenance is inferred (lower trust weight than direct user input).');
  }

  if (result.status === 'active') {
    sentences.push('Status is active, so this is eligible as current truth with no supersession penalty.');
  } else if (result.status === 'superseded') {
    sentences.push(
      `Status is superseded; a ${exp.status_penalty ?? 0.5} penalty was applied (visible only when superseded memories are included).`
    );
  }

  if (typeof result.score === 'number') {
    sentences.push(`Combined factors produced retrieval score ${result.score.toFixed(4)}.`);
  }

  if (Array.isArray(evidence) && evidence.length) {
    sentences.push(`Structured evidence: ${evidence.join(', ')}.`);
  }

  return sentences.join(' ');
}

export function formatRetrievalEvidence(result) {
  const re = result.retrieval_evidence;
  if (!re) {
    return (result.evidence || []).join(', ') || 'No structured evidence payload.';
  }
  const lines = [
    `Scorer: ${re.scorer_version || 'unknown'}`,
    `Category: ${re.category?.type} (${re.category?.score})`,
    `Keywords: ${(re.keywords?.matched || []).join(', ') || 'none'} (${re.keywords?.score})`,
    `Tags: ${(re.tags?.matched || []).join(', ') || 'none'} (${re.tags?.score})`,
    `Recency: ${re.recency?.age_days}d (${re.recency?.score})`,
    `Provenance (${re.provenance?.source_type}): ${re.provenance?.score}`,
    `Status penalty: ${re.status?.penalty ?? 0}`,
    `Raw → final: ${re.raw_score} → ${re.final_score}`,
  ];
  return lines.join('\n');
}

/**
 * Walk supersession edges to build an ordered chain from oldest predecessor to newest successor.
 */
export async function buildSupersessionChainSummary(memoryId, apiClient) {
  if (!memoryId) return [];

  let rootId = memoryId;
  const backSeen = new Set();
  while (rootId && !backSeen.has(rootId)) {
    backSeen.add(rootId);
    const { supersedes } = await apiClient.getSupersessions(rootId);
    if (!supersedes?.length) break;
    rootId = supersedes[0].old_memory_id;
  }

  const chain = [];
  let currentId = rootId;
  const forwardSeen = new Set();
  while (currentId && !forwardSeen.has(currentId)) {
    forwardSeen.add(currentId);
    const mem = await apiClient.getMemory(currentId);
    if (!mem) break;
    chain.push({
      id: mem.id,
      content: mem.content,
      status: mem.status,
      topic: mem.topic,
    });
    const { superseded_by: supersededBy } = await apiClient.getSupersessions(currentId);
    if (!supersededBy?.length) break;
    currentId = supersededBy[0].new_memory_id;
  }

  return chain;
}

/** Demo-style chain text, e.g. Pune → Mumbai → Pune (ACTIVE) */
export function formatChainCompact(chain) {
  if (!chain?.length) return '';
  return chain
    .map((node) => {
      const line = String(node.content || '').trim();
      return node.status === 'active' ? `${line} (ACTIVE)` : line;
    })
    .join('\n↓\n');
}

export function eventTypeLabel(eventType) {
  const labels = {
    created: 'Created',
    updated: 'Updated',
    superseded: 'Superseded',
    deleted: 'Deleted (soft)',
    restored: 'Restored',
    conflict_recorded: 'Conflict recorded',
  };
  return labels[eventType] || eventType;
}
