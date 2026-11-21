import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeAiQuestions } from '../functions/ai-question-pool.mjs';

const VERSION = 1;
const today = () => new Date().toISOString().slice(0, 10);

function parse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function withDb(file, work) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generated_questions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY, device_id TEXT NOT NULL, status TEXT, created_at TEXT, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS papers_device_created ON papers (device_id, created_at);
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, paper_instance_id TEXT, question_id TEXT, device_id TEXT, payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attempts_paper ON attempts (paper_instance_id);
      CREATE TABLE IF NOT EXISTS wrong_book (
        device_id TEXT NOT NULL, question_id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY (device_id, question_id)
      );
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS device_sessions (device_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_settings (device_id TEXT PRIMARY KEY, base_url TEXT NOT NULL, api_key TEXT NOT NULL, model TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_states (device_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT);
      CREATE TABLE IF NOT EXISTS daily_questions (device_id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (device_id, date));
    `);
    return work(db);
  } finally {
    db.close();
  }
}

export function createPersistence(runtime, file) {
  const baseQuestionIds = new Set(runtime.questions.map(question => question.id));

  function load() {
    try {
      withDb(file, db => {
        const generated = db.prepare('SELECT payload FROM generated_questions').all()
          .map(row => parse(row.payload, null)).filter(Boolean);
        const byId = new Map(runtime.questions.map(question => [question.id, question]));
        for (const question of generated) byId.set(question.id, question);
        runtime.questions = normalizeAiQuestions([...byId.values()]);
        runtime.papers = db.prepare('SELECT payload FROM papers').all().map(row => parse(row.payload, null)).filter(Boolean);
        runtime.attempts = db.prepare('SELECT payload FROM attempts').all().map(row => parse(row.payload, null)).filter(Boolean);
        runtime.wrongBook = db.prepare('SELECT payload FROM wrong_book').all().map(row => parse(row.payload, null)).filter(Boolean);
        runtime.reports = db.prepare('SELECT payload FROM reports').all().map(row => parse(row.payload, null)).filter(Boolean);
        runtime.deviceSessions = new Map(db.prepare('SELECT device_id, payload FROM device_sessions').all()
          .map(row => [row.device_id, parse(row.payload, null) || {}]));
        runtime.aiSettings = new Map(db.prepare('SELECT device_id, payload FROM ai_settings').all()
          .map(row => [row.device_id, parse(row.payload, null) || {}]));
        runtime.agentStates = new Map(db.prepare('SELECT device_id, payload FROM agent_states').all()
          .map(row => [row.device_id, parse(row.payload, null) || {}]));
        runtime.dailyQuestions = new Map(db.prepare('SELECT device_id, date, payload FROM daily_questions').all()
          .map(row => [`${row.device_id}:${row.date}`, parse(row.payload, null) || {}]));
        const meta = new Map(db.prepare('SELECT key, value FROM meta').all().map(row => [row.key, row.value]));
        if (meta.get('version') !== String(VERSION)) return;
        if (meta.get('saved_date') === today()) {
          runtime.usage = new Map(db.prepare('SELECT key, value FROM usage').all()
            .filter(row => String(row.key).endsWith(today()))
            .map(row => [row.key, Number(row.value) || 0]));
          runtime.generatedToday = Number(meta.get('generated_today')) || 0;
        }
        const stats = parse(meta.get('compose_stats'), null);
        if (stats) runtime.composeStats = { success: Number(stats.success) || 0, failure: Number(stats.failure) || 0 };
        if (meta.get('dataset')) runtime.dataset = meta.get('dataset');
      });
    } catch (error) {
      console.warn('local database load failed:', error.message);
    }
  }

  function save() {
    try {
      withDb(file, db => {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.exec('DELETE FROM generated_questions; DELETE FROM papers; DELETE FROM attempts; DELETE FROM wrong_book; DELETE FROM reports; DELETE FROM device_sessions; DELETE FROM ai_settings; DELETE FROM usage; DELETE FROM meta; DELETE FROM agent_states; DELETE FROM daily_questions;');
          const insertQuestion = db.prepare('INSERT INTO generated_questions (id, payload) VALUES (?, ?)');
          for (const question of runtime.questions.filter(item => !baseQuestionIds.has(item.id))) {
            insertQuestion.run(question.id, JSON.stringify(question));
          }
          const insertPaper = db.prepare('INSERT INTO papers (id, device_id, status, created_at, payload) VALUES (?, ?, ?, ?, ?)');
          for (const paper of runtime.papers) {
            insertPaper.run(paper.id, paper.device_id, paper.status || null, paper.created_at || null, JSON.stringify(paper));
          }
          const insertAttempt = db.prepare('INSERT INTO attempts (id, paper_instance_id, question_id, device_id, payload) VALUES (?, ?, ?, ?, ?)');
          for (const attempt of runtime.attempts) {
            insertAttempt.run(attempt.id, attempt.paper_instance_id || null, attempt.question_id || null, attempt.device_id || null, JSON.stringify(attempt));
          }
          const insertWrong = db.prepare('INSERT INTO wrong_book (device_id, question_id, payload) VALUES (?, ?, ?)');
          for (const wrong of runtime.wrongBook) {
            insertWrong.run(wrong.device_id, wrong.question_id, JSON.stringify(wrong));
          }
          const insertReport = db.prepare('INSERT INTO reports (id, payload) VALUES (?, ?)');
          for (const report of runtime.reports) insertReport.run(report.id, JSON.stringify(report));
          const insertSession = db.prepare('INSERT INTO device_sessions (device_id, payload) VALUES (?, ?)');
          for (const [deviceId, session] of runtime.deviceSessions.entries()) {
            insertSession.run(deviceId, JSON.stringify(session));
          }
          const insertAiSettings = db.prepare('INSERT INTO ai_settings (device_id, base_url, api_key, model, payload) VALUES (?, ?, ?, ?, ?)');
          for (const [deviceId, settings] of runtime.aiSettings.entries()) {
            insertAiSettings.run(deviceId, settings.base_url, settings.api_key, settings.model, JSON.stringify(settings));
          }
          const insertAgentState = db.prepare('INSERT INTO agent_states (device_id, payload, updated_at) VALUES (?, ?, ?)');
          for (const [deviceId, state] of runtime.agentStates.entries()) {
            insertAgentState.run(deviceId, JSON.stringify(state), state.updated_at || null);
          }
          const insertDailyQuestion = db.prepare('INSERT INTO daily_questions (device_id, date, payload) VALUES (?, ?, ?)');
          for (const record of runtime.dailyQuestions.values()) {
            insertDailyQuestion.run(record.device_id, record.date, JSON.stringify(record));
          }
          const insertUsage = db.prepare('INSERT INTO usage (key, value) VALUES (?, ?)');
          for (const [key, value] of runtime.usage.entries()) insertUsage.run(key, Number(value) || 0);
          const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
          insertMeta.run('version', String(VERSION));
          insertMeta.run('saved_at', new Date().toISOString());
          insertMeta.run('saved_date', today());
          insertMeta.run('generated_today', String(runtime.generatedToday || 0));
          insertMeta.run('compose_stats', JSON.stringify(runtime.composeStats || { success: 0, failure: 0 }));
          if (runtime.dataset) insertMeta.run('dataset', String(runtime.dataset));
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
    } catch (error) {
      console.warn('local database save failed:', error.message);
    }
  }

  return { load, save };
}
