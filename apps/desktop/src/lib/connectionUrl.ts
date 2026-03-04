import type { DatabaseType } from './types';

interface ParsedConnectionUrl {
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

const SCHEME_MAP: Record<string, DatabaseType> = {
  'mysql': 'mysql',
  'mariadb': 'mysql',
  'postgres': 'postgres',
  'postgresql': 'postgres',
  'sqlite': 'sqlite',
};

export function parseConnectionUrl(url: string): ParsedConnectionUrl | null {
  try {
    // Handle sqlite:// separately
    if (url.startsWith('sqlite://') || url.startsWith('sqlite:')) {
      const dbPath = url.replace(/^sqlite:\/\//, '').replace(/^sqlite:/, '');
      return {
        db_type: 'sqlite',
        host: '',
        port: 0,
        username: '',
        password: '',
        database: dbPath,
      };
    }

    // Extract scheme
    const schemeMatch = url.match(/^(\w+):\/\//);
    if (!schemeMatch) return null;

    const scheme = schemeMatch[1].toLowerCase();
    const dbType = SCHEME_MAP[scheme];
    if (!dbType) return null;

    // Use URL parser (replace scheme with http for parsing)
    const fakeUrl = url.replace(/^\w+:\/\//, 'http://');
    const parsed = new URL(fakeUrl);

    return {
      db_type: dbType,
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port) : (dbType === 'mysql' ? 3306 : 5432),
      username: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '') || '',
    };
  } catch {
    return null;
  }
}
