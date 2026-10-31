import {DatabaseSync} from 'node:sqlite';
// Local development and integration tests only. Production uses the native D1 binding.
export class SQLiteD1 {
  constructor(path = ':memory:') { this.database = new DatabaseSync(path); }
  exec(sql) { this.database.exec(sql); }
  prepare(sql) {
    const database = this.database;
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() { return database.prepare(sql).get(...params) || null; },
      async all() { return {results: database.prepare(sql).all(...params)}; },
      async run() { const result = database.prepare(sql).run(...params); return {success: true, meta: {changes: result.changes}}; }
    };
  }
  async batch(statements) {
    this.database.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec('COMMIT'); return results; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}
