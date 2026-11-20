import pg from 'pg';

const { Pool } = pg;
const VERSION = 1;
const today = () => new Date().toISOString().slice(0, 10);
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;

export function createPersistence(runtime, connectionString) {
  const baseQuestionIds = new Set(runtime.questions.map(question => question.id));
  const pool = new Pool({ connectionString });
  pool.on('error', error => console.warn('local Postgres pool:', error.message));
  let schemaReady = null;

  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
        CREATE TABLE IF NOT EXISTS generated_questions (id text PRIMARY KEY, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS papers (
          id text PRIMARY KEY, device_id text NOT NULL, status text, created_at timestamptz, payload jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS papers_device_created ON papers (device_id, created_at);
        CREATE TABLE IF NOT EXISTS attempts (
          id text PRIMARY KEY, paper_instance_id text, question_id text, device_id text, payload jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS attempts_paper ON attempts (paper_instance_id);
        CREATE TABLE IF NOT EXISTS wrong_book (
          device_id text NOT NULL, question_id text NOT NULL, payload jsonb NOT NULL,
          PRIMARY KEY (device_id, question_id)
        );
        CREATE TABLE IF NOT EXISTS reports (id text PRIMARY KEY, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS device_sessions (device_id text PRIMARY KEY, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_settings (
          device_id text PRIMARY KEY, base_url text NOT NULL, api_key text NOT NULL, model text NOT NULL, payload jsonb NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage (key text PRIMARY KEY, value integer NOT NULL);
        CREATE TABLE IF NOT EXISTS agent_states (device_id text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz);
      `);
    }
    return schemaReady;
  }

  async function load() {
    try {
      await ensureSchema();
      const generated = (await pool.query('SELECT payload FROM generated_questions')).rows.map(row => parse(row.payload));
      const byId = new Map(runtime.questions.map(question => [question.id, question]));
      for (const question of generated) {
        if (question?.id) byId.set(question.id, question);
      }
      runtime.questions = [...byId.values()];
      runtime.papers = (await pool.query('SELECT payload FROM papers')).rows.map(row => parse(row.payload));
      runtime.attempts = (await pool.query('SELECT payload FROM attempts')).rows.map(row => parse(row.payload));
      runtime.wrongBook = (await pool.query('SELECT payload FROM wrong_book')).rows.map(row => parse(row.payload));
      runtime.reports = (await pool.query('SELECT payload FROM reports')).rows.map(row => parse(row.payload));
      runtime.deviceSessions = new Map((await pool.query('SELECT device_id, payload FROM device_sessions')).rows
        .map(row => [row.device_id, parse(row.payload)]));
      runtime.aiSettings = new Map((await pool.query('SELECT device_id, payload FROM ai_settings')).rows
        .map(row => [row.device_id, parse(row.payload)]));
      runtime.agentStates = new Map((await pool.query('SELECT device_id, payload FROM agent_states')).rows
        .map(row => [row.device_id, parse(row.payload)]));
      const meta = new Map((await pool.query('SELECT key, value FROM meta')).rows.map(row => [row.key, row.value]));
      if (meta.get('version') !== String(VERSION)) return;
      if (meta.get('saved_date') === today()) {
        runtime.usage = new Map((await pool.query('SELECT key, value FROM usage')).rows
          .filter(row => String(row.key).endsWith(today()))
          .map(row => [row.key, Number(row.value) || 0]));
        runtime.generatedToday = Number(meta.get('generated_today')) || 0;
      }
      const stats = meta.get('compose_stats') ? JSON.parse(meta.get('compose_stats')) : null;
      if (stats) runtime.composeStats = { success: Number(stats.success) || 0, failure: Number(stats.failure) || 0 };
      if (meta.get('dataset')) runtime.dataset = meta.get('dataset');
    } catch (error) {
      console.warn('local Postgres load failed:', error.message);
    }
  }

  async function save() {
    let client;
    try {
      client = await pool.connect();
      await ensureSchema();
      await client.query('BEGIN');
      await client.query('DELETE FROM generated_questions; DELETE FROM papers; DELETE FROM attempts; DELETE FROM wrong_book; DELETE FROM reports; DELETE FROM device_sessions; DELETE FROM ai_settings; DELETE FROM usage; DELETE FROM meta; DELETE FROM agent_states;');
      for (const question of runtime.questions.filter(item => !baseQuestionIds.has(item.id))) {
        await client.query('INSERT INTO generated_questions (id, payload) VALUES ($1, $2::jsonb)', [question.id, JSON.stringify(question)]);
      }
      for (const paper of runtime.papers) {
        await client.query('INSERT INTO papers (id, device_id, status, created_at, payload) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [paper.id, paper.device_id, paper.status || null, paper.created_at || null, JSON.stringify(paper)]);
      }
      for (const attempt of runtime.attempts) {
        await client.query('INSERT INTO attempts (id, paper_instance_id, question_id, device_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [attempt.id, attempt.paper_instance_id || null, attempt.question_id || null, attempt.device_id || null, JSON.stringify(attempt)]);
      }
      for (const wrong of runtime.wrongBook) {
        await client.query('INSERT INTO wrong_book (device_id, question_id, payload) VALUES ($1, $2, $3::jsonb)',
          [wrong.device_id, wrong.question_id, JSON.stringify(wrong)]);
      }
      for (const report of runtime.reports) {
        await client.query('INSERT INTO reports (id, payload) VALUES ($1, $2::jsonb)', [report.id, JSON.stringify(report)]);
      }
      for (const [deviceId, session] of runtime.deviceSessions.entries()) {
        await client.query('INSERT INTO device_sessions (device_id, payload) VALUES ($1, $2::jsonb)', [deviceId, JSON.stringify(session)]);
      }
      for (const [deviceId, settings] of runtime.aiSettings.entries()) {
        await client.query('INSERT INTO ai_settings (device_id, base_url, api_key, model, payload) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [deviceId, settings.base_url, settings.api_key, settings.model, JSON.stringify(settings)]);
      }
      for (const [deviceId, state] of runtime.agentStates.entries()) {
        await client.query('INSERT INTO agent_states (device_id, payload, updated_at) VALUES ($1, $2::jsonb, $3)',
          [deviceId, JSON.stringify(state), state.updated_at || new Date().toISOString()]);
      }
      for (const [key, value] of runtime.usage.entries()) {
        await client.query('INSERT INTO usage (key, value) VALUES ($1, $2)', [key, Number(value) || 0]);
      }
      const meta = {
        version: String(VERSION),
        saved_at: new Date().toISOString(),
        saved_date: today(),
        generated_today: String(runtime.generatedToday || 0),
        compose_stats: JSON.stringify(runtime.composeStats || { success: 0, failure: 0 }),
        ...(runtime.dataset ? { dataset: String(runtime.dataset) } : {}),
      };
      for (const [key, value] of Object.entries(meta)) {
        await client.query('INSERT INTO meta (key, value) VALUES ($1, $2)', [key, value]);
      }
      await client.query('COMMIT');
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      console.warn('local Postgres save failed:', error.message);
    } finally {
      client?.release();
    }
  }

  return { load, save };
}
