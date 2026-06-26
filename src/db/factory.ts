import type { DbTarget } from '../config.js';
import type { DbAdapter } from './adapter.js';
import { PostgresAdapter } from './postgres.js';
import { SqlServerAdapter } from './sqlserver.js';

export function createDbAdapter(target: DbTarget): DbAdapter {
  switch (target.dialect) {
    case 'postgres':
      return new PostgresAdapter(target.url);
    case 'sqlserver':
      return new SqlServerAdapter(target.url);
    case 'mysql':
      // Deferred until the first vertical ships on Postgres + SQL Server (see
      // DECISIONS.md §11). `mysql` stays a valid dialect so config still parses.
      throw new Error('MySQL adapter is not implemented yet (deferred — see ROADMAP.md).');
  }
}
