const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /e[-_]?mail/i, type: 'email' },
  { pattern: /phone|mobile|cell|telephone|fax/i, type: 'phone' },
  { pattern: /\bssn\b|social[-_]?security/i, type: 'ssn' },
  { pattern: /credit[-_]?card|card[-_]?num(ber)?|cc[-_]?num/i, type: 'credit_card' },
  { pattern: /\bpassword\b|passwd|pwd/i, type: 'password' },
  { pattern: /\bsecret\b/i, type: 'secret' },
  { pattern: /\btoken\b|access[-_]?token|refresh[-_]?token/i, type: 'token' },
  { pattern: /api[-_]?key|apikey/i, type: 'api_key' },
];

export function detectSensitiveColumnType(columnName: string): string | null {
  for (const { pattern, type } of SENSITIVE_PATTERNS) {
    if (pattern.test(columnName)) {
      return type;
    }
  }
  return null;
}

export function detectSensitiveColumn(columnName: string): boolean {
  return detectSensitiveColumnType(columnName) !== null;
}

export function isSensitiveColumn(name: string): boolean {
  return detectSensitiveColumn(name);
}

export function maskValue(value: string, columnName: string): string {
  if (!value || value.length === 0) return value;

  const type = detectSensitiveColumnType(columnName);

  switch (type) {
    case 'email': {
      const atIdx = value.indexOf('@');
      if (atIdx > 0) {
        const local = value.substring(0, atIdx);
        const domain = value.substring(atIdx + 1);
        const dotIdx = domain.lastIndexOf('.');
        if (dotIdx > 0) {
          const domainName = domain.substring(0, dotIdx);
          const tld = domain.substring(dotIdx);
          return `${local[0]}***@${domainName[0]}***${tld}`;
        }
        return `${local[0]}***@${domain[0]}***`;
      }
      return maskDefault(value);
    }

    case 'phone': {
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 4) {
        return `***-${digits.slice(-4)}`;
      }
      return maskDefault(value);
    }

    case 'ssn': {
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 4) {
        return `***-**-${digits.slice(-4)}`;
      }
      return maskDefault(value);
    }

    case 'credit_card': {
      const digits = value.replace(/\D/g, '');
      if (digits.length >= 4) {
        return `****-****-****-${digits.slice(-4)}`;
      }
      return maskDefault(value);
    }

    case 'password':
    case 'secret':
    case 'token':
    case 'api_key':
      return '********';

    default:
      return maskDefault(value);
  }
}

function maskDefault(value: string): string {
  if (value.length <= 2) return '***';
  return `${value[0]}***${value[value.length - 1]}`;
}
