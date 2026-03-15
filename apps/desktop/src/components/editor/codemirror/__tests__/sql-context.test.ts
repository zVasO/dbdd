import { describe, it, expect } from 'vitest';
import {
  detectSqlContext,
  parseAliases,
  parseTablePrefixes,
  SQL_KEYWORDS,
  SQL_FUNCTIONS,
  SQL_TYPES,
  KEYWORD_SET,
  CLAUSE_SNIPPETS,
} from '../sql-context';

// ---------------------------------------------------------------------------
// Static data sanity checks
// ---------------------------------------------------------------------------

describe('SQL_KEYWORDS', () => {
  it('contains expected core keywords', () => {
    expect(SQL_KEYWORDS).toContain('SELECT');
    expect(SQL_KEYWORDS).toContain('FROM');
    expect(SQL_KEYWORDS).toContain('WHERE');
    expect(SQL_KEYWORDS).toContain('JOIN');
  });

  it('has no duplicates', () => {
    const unique = new Set(SQL_KEYWORDS);
    expect(unique.size).toBe(SQL_KEYWORDS.length);
  });
});

describe('SQL_FUNCTIONS', () => {
  it('each entry has label, detail, and insertText', () => {
    for (const fn of SQL_FUNCTIONS) {
      expect(fn.label).toBeTruthy();
      expect(fn.detail).toBeTruthy();
      expect(fn.insertText).toBeTruthy();
    }
  });
});

describe('SQL_TYPES', () => {
  it('contains common types', () => {
    expect(SQL_TYPES).toContain('INT');
    expect(SQL_TYPES).toContain('VARCHAR');
    expect(SQL_TYPES).toContain('BOOLEAN');
    expect(SQL_TYPES).toContain('JSON');
  });
});

describe('KEYWORD_SET', () => {
  it('is a superset of SQL_KEYWORDS', () => {
    for (const kw of SQL_KEYWORDS) {
      expect(KEYWORD_SET.has(kw)).toBe(true);
    }
  });

  it('includes extra entries ON, WHERE, AND, OR, SET', () => {
    expect(KEYWORD_SET.has('ON')).toBe(true);
    expect(KEYWORD_SET.has('WHERE')).toBe(true);
    expect(KEYWORD_SET.has('AND')).toBe(true);
    expect(KEYWORD_SET.has('OR')).toBe(true);
    expect(KEYWORD_SET.has('SET')).toBe(true);
  });
});

describe('CLAUSE_SNIPPETS', () => {
  it('each entry has label, insertText, and detail', () => {
    for (const s of CLAUSE_SNIPPETS) {
      expect(s.label).toBeTruthy();
      expect(s.insertText).toBeTruthy();
      expect(s.detail).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// detectSqlContext
// ---------------------------------------------------------------------------

describe('detectSqlContext', () => {
  describe('keyword contexts', () => {
    it('returns select after SELECT', () => {
      expect(detectSqlContext('SELECT ')).toBe('select');
    });

    it('returns select after SELECT DISTINCT', () => {
      expect(detectSqlContext('SELECT DISTINCT ')).toBe('select');
    });

    it('returns from after FROM', () => {
      expect(detectSqlContext('SELECT id FROM ')).toBe('from');
    });

    it('returns from after JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users JOIN ')).toBe('from');
    });

    it('returns from after LEFT JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users LEFT JOIN ')).toBe('from');
    });

    it('returns from after RIGHT JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users RIGHT JOIN ')).toBe('from');
    });

    it('returns from after INNER JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users INNER JOIN ')).toBe('from');
    });

    it('returns from after CROSS JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users CROSS JOIN ')).toBe('from');
    });

    it('returns from after FULL OUTER JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users FULL OUTER JOIN ')).toBe('from');
    });

    it('returns from after NATURAL JOIN', () => {
      expect(detectSqlContext('SELECT id FROM users NATURAL JOIN ')).toBe('from');
    });

    it('returns from after INSERT INTO', () => {
      expect(detectSqlContext('INSERT INTO ')).toBe('from');
    });

    it('returns from after UPDATE', () => {
      expect(detectSqlContext('UPDATE ')).toBe('from');
    });

    it('returns from after DELETE FROM', () => {
      expect(detectSqlContext('DELETE FROM ')).toBe('from');
    });

    it('returns condition after WHERE', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE ')).toBe('condition');
    });

    it('returns condition after AND', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE id = 1 AND ')).toBe('condition');
    });

    it('returns condition after OR', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE id = 1 OR ')).toBe('condition');
    });

    it('returns condition after HAVING', () => {
      expect(detectSqlContext('SELECT COUNT(*) FROM users GROUP BY status HAVING ')).toBe('condition');
    });

    it('returns condition after ON', () => {
      expect(detectSqlContext('SELECT id FROM users JOIN orders ON ')).toBe('condition');
    });

    it('returns condition after NOT', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE NOT ')).toBe('condition');
    });

    it('returns order_group after ORDER BY', () => {
      expect(detectSqlContext('SELECT id FROM users ORDER BY ')).toBe('order_group');
    });

    it('returns order_group after GROUP BY', () => {
      expect(detectSqlContext('SELECT id FROM users GROUP BY ')).toBe('order_group');
    });

    it('returns set after SET', () => {
      expect(detectSqlContext('UPDATE users SET ')).toBe('set');
    });

    it('returns ddl after CREATE', () => {
      expect(detectSqlContext('CREATE ')).toBe('ddl');
    });

    it('returns ddl after ALTER', () => {
      expect(detectSqlContext('ALTER ')).toBe('ddl');
    });

    it('returns ddl after DROP', () => {
      expect(detectSqlContext('DROP ')).toBe('ddl');
    });
  });

  describe('after_table context', () => {
    it('returns after_table after FROM table', () => {
      expect(detectSqlContext('SELECT id FROM users')).toBe('after_table');
    });

    it('returns after_table after FROM table with alias', () => {
      expect(detectSqlContext('SELECT id FROM users u')).toBe('after_table');
    });

    it('returns after_table after FROM table with AS alias', () => {
      expect(detectSqlContext('SELECT id FROM users AS u')).toBe('after_table');
    });

    it('returns after_table after JOIN table', () => {
      expect(detectSqlContext('SELECT id FROM users JOIN orders')).toBe('after_table');
    });

    it('returns after_table after comparison with number', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE id = 1')).toBe('after_table');
    });

    it('returns after_table after comparison with string', () => {
      expect(detectSqlContext("SELECT id FROM users WHERE name = 'alice'")).toBe('after_table');
    });

    it('returns after_table after comparison with column ref', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE u.id = o.user_id')).toBe('after_table');
    });

    it('returns after_table after IS NULL', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE name IS NULL')).toBe('after_table');
    });

    it('returns after_table after IS NOT NULL', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE name IS NOT NULL')).toBe('after_table');
    });

    it('returns after_table after LIKE expression', () => {
      expect(detectSqlContext("SELECT id FROM users WHERE name LIKE '%test%'")).toBe('after_table');
    });

    it('returns after_table after IN list', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE id IN (1, 2, 3)')).toBe('after_table');
    });

    it('returns after_table after != comparison', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE status != 0')).toBe('after_table');
    });

    it('returns after_table after <> comparison', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE status <> 0')).toBe('after_table');
    });

    it('returns after_table after >= comparison', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE age >= 18')).toBe('after_table');
    });

    it('returns after_table after <= comparison', () => {
      expect(detectSqlContext('SELECT id FROM users WHERE age <= 65')).toBe('after_table');
    });
  });

  describe('comma continuation', () => {
    it('returns select for comma after SELECT columns', () => {
      expect(detectSqlContext('SELECT id, name,')).toBe('select');
    });

    it('returns from for comma after FROM tables', () => {
      expect(detectSqlContext('SELECT id FROM users, orders,')).toBe('from');
    });

    it('returns order_group for comma after ORDER BY columns', () => {
      expect(detectSqlContext('SELECT id FROM users ORDER BY id,')).toBe('order_group');
    });

    it('returns order_group for comma after GROUP BY columns', () => {
      expect(detectSqlContext('SELECT id FROM users GROUP BY status,')).toBe('order_group');
    });

    it('returns set for comma after SET assignments', () => {
      expect(detectSqlContext('UPDATE users SET name = \'x\',')).toBe('set');
    });

    it('defaults to select when no clause keyword found', () => {
      expect(detectSqlContext(',')).toBe('select');
    });
  });

  describe('general context', () => {
    it('returns general for empty string', () => {
      expect(detectSqlContext('')).toBe('general');
    });

    it('returns general after semicolon', () => {
      expect(detectSqlContext('SELECT 1;')).toBe('general');
    });

    it('returns general after semicolon with whitespace', () => {
      expect(detectSqlContext('SELECT 1;  ')).toBe('general');
    });

    it('returns general for unrecognized input', () => {
      expect(detectSqlContext('something random')).toBe('general');
    });
  });

  describe('string stripping', () => {
    it('ignores keywords inside string literals', () => {
      // The keyword FROM is inside a string, so the real context is after SELECT
      expect(detectSqlContext("SELECT 'FROM' FROM ")).toBe('from');
    });

    it('strips string content before context detection', () => {
      // WHERE is the last keyword, string content should not interfere
      expect(detectSqlContext("SELECT id FROM users WHERE name = 'test' AND ")).toBe('condition');
    });
  });

  describe('comment stripping', () => {
    it('strips single-line comments', () => {
      expect(detectSqlContext('SELECT id -- comment\nFROM ')).toBe('from');
    });

    it('strips multi-line comments', () => {
      expect(detectSqlContext('SELECT id /* block comment */ FROM ')).toBe('from');
    });

    it('strips comments that contain keywords', () => {
      expect(detectSqlContext('SELECT id -- FROM fake\nFROM ')).toBe('from');
    });
  });
});

// ---------------------------------------------------------------------------
// parseAliases
// ---------------------------------------------------------------------------

describe('parseAliases', () => {
  it('parses a simple alias (space-separated)', () => {
    const result = parseAliases('SELECT u.id FROM users u');
    expect(result).toEqual({ u: 'users' });
  });

  it('parses an AS alias', () => {
    const result = parseAliases('SELECT u.id FROM users AS u');
    expect(result).toEqual({ u: 'users' });
  });

  it('parses multiple aliases from FROM and JOIN', () => {
    const result = parseAliases('SELECT u.id FROM users u JOIN orders o ON u.id = o.user_id');
    expect(result).toEqual({ u: 'users', o: 'orders' });
  });

  it('rejects SQL keywords used as aliases', () => {
    // WHERE is a keyword and should not be treated as an alias
    const result = parseAliases('SELECT id FROM users WHERE id = 1');
    expect(result).toEqual({});
  });

  it('rejects ON as an alias after JOIN', () => {
    const result = parseAliases('SELECT id FROM users JOIN orders ON users.id = orders.user_id');
    expect(result).toEqual({});
  });

  it('returns empty object when no aliases present', () => {
    const result = parseAliases('SELECT id FROM users');
    expect(result).toEqual({});
  });

  it('lowercases both alias and table name', () => {
    const result = parseAliases('SELECT U.id FROM Users AS U');
    expect(result).toEqual({ u: 'users' });
  });
});

// ---------------------------------------------------------------------------
// parseTablePrefixes
// ---------------------------------------------------------------------------

describe('parseTablePrefixes', () => {
  it('maps table to its alias when alias exists', () => {
    const result = parseTablePrefixes('SELECT u.id FROM users u');
    expect(result).toEqual({ users: 'u' });
  });

  it('maps table to itself when no alias', () => {
    const result = parseTablePrefixes('SELECT id FROM users');
    expect(result).toEqual({ users: 'users' });
  });

  it('handles AS alias syntax', () => {
    const result = parseTablePrefixes('SELECT u.id FROM users AS u');
    expect(result).toEqual({ users: 'u' });
  });

  it('handles multiple tables with mixed alias styles', () => {
    const result = parseTablePrefixes(
      'SELECT u.id FROM users u JOIN orders AS o ON u.id = o.user_id'
    );
    expect(result).toEqual({ users: 'u', orders: 'o' });
  });

  it('self-maps when keyword follows table (not a real alias)', () => {
    const result = parseTablePrefixes('SELECT id FROM users WHERE id = 1');
    expect(result).toEqual({ users: 'users' });
  });

  it('lowercases table names as keys', () => {
    const result = parseTablePrefixes('SELECT id FROM Users');
    expect(result).toEqual({ users: 'Users' });
  });
});
