export function currentMetrics(runtime) {
  const published = runtime.questions.filter(q => q.status === 'published' && !q.is_fixture && (q.subject || 'math2') === 'math2');
  const real = published.filter(q => q.source === 'real').length;
  const ai = published.filter(q => q.source === 'ai').length;
  const success = runtime.composeStats?.success || 0;
  const failure = runtime.composeStats?.failure || 0;
  const totalCompose = success + failure;
  const mathPaperIds = new Set((runtime.papers || []).filter(paper => (paper.subject || 'math2') === 'math2').map(paper => paper.id));
  const attempts = runtime.attempts.filter(attempt => mathPaperIds.has(attempt.paper_instance_id));
  const wrongBookEntries = runtime.wrongBook.filter(entry => {
    const question = runtime.questions.find(item => item.id === entry.question_id);
    return (question?.subject || 'math2') === 'math2';
  });
  const recentPapers = (runtime.papers || []).filter(paper => (paper.subject || 'math2') === 'math2').slice(-8).reverse().map(paper => {
    const concepts = (paper.config_json?.concept_node_ids || [])
      .map(id => runtime.knowledge.find(node => node.id === id)?.name)
      .filter(Boolean);
    return {
      id: paper.id,
      mode: paper.mode,
      source_mode: paper.source_mode,
      origin: paper.config_json?.origin || null,
      concepts,
      title: paper.config_json?.origin === 'variant'
        ? '错题仿真练习'
        : concepts.length ? `${concepts.slice(0, 3).join(' · ')}${concepts.length > 3 ? ' 等' : ''}` : '综合练习',
      questions: paper.items_json.length,
      total_points: paper.total_score_x2 / 2,
      years: [...new Set(paper.items_json.map(item => item.question.year).filter(Boolean))].sort(),
      created_at: paper.created_at,
    };
  });
  return {
    metrics: [
      { key: 'question_bank_real', value: real, label: '真题数（当前数据集）' },
      { key: 'question_bank_ai', value: ai, label: 'AI 题数（当前数据集）' },
      { key: 'attempts', value: attempts.length, label: '作答记录' },
      { key: 'wrong_book', value: wrongBookEntries.length, label: '错题条目' },
    ],
    sample_sizes: { question_bank_real: real, question_bank_ai: ai, attempts: attempts.length, wrong_book: wrongBookEntries.length },
    generated_at: new Date().toISOString(),
    // Compatibility aliases for the working surface.
    question_bank: { real, ai }, attempts: attempts.length, wrong_book_entries: wrongBookEntries.length,
    compose: { success, failure, success_rate: totalCompose ? Math.round(success * 10000 / totalCompose) / 100 : null },
    recent_papers: recentPapers,
    note: '当前为本地运行指标；LLM 通过率与识别准确率待真实适配器接入后计算。',
  };
}
export function metricTrends(runtime) {
  const days = {};
  const mathPaperIds = new Set((runtime.papers || []).filter(paper => (paper.subject || 'math2') === 'math2').map(paper => paper.id));
  for (const a of runtime.attempts.filter(attempt => mathPaperIds.has(attempt.paper_instance_id))) {
    const day = a.created_at.slice(0, 10);
    days[day] ||= { date: day, attempts: 0, score_x2: 0, max_score_x2: 0 };
    days[day].attempts += 1;
    days[day].score_x2 += a.score_x2;
    days[day].max_score_x2 += a.max_score_x2;
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
}
