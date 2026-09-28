import { LogLevel } from '../types.js';

/**
 * Normalizes provider-specific log levels into unified LogLevel type
 */
export function normalizeLogLevel(raw: string | undefined): LogLevel {
  if (!raw) return 'Information';
  const val = raw.toLowerCase().trim();

  if (val.includes('fatal') || val.includes('emerg') || val.includes('crit')) return 'Fatal';
  if (val.includes('err')) return 'Error';
  if (val.includes('warn')) return 'Warning';
  if (val.includes('deb')) return 'Debug';
  if (val.includes('verb') || val.includes('trace')) return 'Verbose';
  return 'Information';
}

/**
 * Parses time expressions such as '15m', '1h', '24h', '7d' into an ISO 8601 UTC date string
 */
export function parseTimeBound(input?: string): string | undefined {
  if (!input) return undefined;

  // If already an ISO string
  if (input.includes('T') || input.includes('-')) {
    const d = new Date(input);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Relative notation: e.g. "15m", "2h", "1d"
  const match = input.trim().match(/^(\d+)\s*(m|h|d|w)$/i);
  if (match) {
    const count = parseInt(match[1] || '0', 10);
    const unit = (match[2] || '').toLowerCase();
    const now = Date.now();
    let ms = 0;
    if (unit === 'm') ms = count * 60 * 1000;
    else if (unit === 'h') ms = count * 3600 * 1000;
    else if (unit === 'd') ms = count * 86400 * 1000;
    else if (unit === 'w') ms = count * 7 * 86400 * 1000;

    return new Date(now - ms).toISOString();
  }

  return undefined;
}
