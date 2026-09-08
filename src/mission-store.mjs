import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowIso, stableStringify } from './utils.mjs';

export class MissionStore {
  constructor(dataDir = process.env.BRAIN2_MISSION_DATA_DIR ?? './data') {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.resolve(dataDir, 'brain2shot-missions.sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_missions_project ON missions(project_id, updated_at DESC);
    `);
    this.upsertStmt = this.db.prepare(`
      INSERT INTO missions (id, project_id, project_name, source_fingerprint, engine_version, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_fingerprint=excluded.source_fingerprint,
        state_json=excluded.state_json,
        updated_at=excluded.updated_at
    `);
    this.getStmt = this.db.prepare('SELECT * FROM missions WHERE id = ?');
    this.latestStmt = this.db.prepare('SELECT * FROM missions WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1');
  }

  save(state) {
    const at = nowIso();
    const created = state.createdAt ?? at;
    state.createdAt = created;
    state.updatedAt = at;
    this.upsertStmt.run(state.missionId, state.projectId, state.projectName, state.sourceFingerprint, state.engineVersion, stableStringify(state), created, at);
    return state;
  }

  get(id) {
    const row = this.getStmt.get(id);
    return row ? JSON.parse(row.state_json) : null;
  }

  latest(projectId) {
    const row = this.latestStmt.get(projectId);
    return row ? JSON.parse(row.state_json) : null;
  }

  close() { this.db.close(); }
}
