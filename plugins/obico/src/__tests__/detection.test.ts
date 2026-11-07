/** Unit tests of the failure detection rules (core/detection.ts). */
import { describe, expect, it } from 'vitest';

import { alertKey, alertPending, isoDay, level, periodRange, reasonKey, sparkline, summarizeAlerts } from '../core/detection';
import type { ObicoPrint } from '../core/obico-api';

const print = (patch: Partial<ObicoPrint> = {}): ObicoPrint => ({
  id: 1,
  filename: 'a.gcode',
  started_at: null,
  finished_at: null,
  cancelled_at: null,
  alerted_at: null,
  alert_acknowledged_at: null,
  alert_muted_at: null,
  paused_at: null,
  alert_overwrite: null,
  ...patch,
});

describe('detection rules', () => {
  it('uses the zones of Obico’s gauge', () => {
    expect([0, 0.32, 0.33, 0.66, 0.67, 1].map(level)).toEqual(['good', 'good', 'fishy', 'fishy', 'failing', 'failing']);
  });

  it('a pending alert is one raised after the last acknowledgement and not muted', () => {
    expect(alertPending(print())).toBe(false);
    expect(alertPending(print({ alerted_at: '2026-01-01T10:00:00Z' }))).toBe(true);
    expect(alertPending(print({ alerted_at: '2026-01-01T10:00:00Z', alert_acknowledged_at: '2026-01-01T10:01:00Z' }))).toBe(false);
    // A second alert after an earlier acknowledgement asks again.
    expect(alertPending(print({ alerted_at: '2026-01-01T11:00:00Z', alert_acknowledged_at: '2026-01-01T10:01:00Z' }))).toBe(true);
    expect(alertPending(print({ alerted_at: '2026-01-01T10:00:00Z', alert_muted_at: '2026-01-01T10:00:30Z' }))).toBe(false);
    expect(alertPending(null)).toBe(false);
    expect(alertKey(print({ id: 5, alerted_at: 'T' }))).toBe('5@T');
  });

  it('translates the known reasons only', () => {
    expect(reasonKey('Printer is not actively printing')).toBe('obico.reason.notPrinting');
    expect(reasonKey('Something new')).toBeNull();
    expect(reasonKey(null)).toBeNull();
  });

  it('builds periods in the given time zone', () => {
    const now = new Date('2026-11-07T23:30:00Z');
    expect(isoDay(now, 'UTC')).toBe('2026-11-07');
    expect(isoDay(now, 'Europe/Moscow')).toBe('2026-11-08');
    expect(periodRange('week', now, 'UTC')).toEqual({ groupBy: 'day', timeZone: 'UTC', from: '2026-11-01', to: '2026-11-07' });
    expect(periodRange('year', now, 'UTC').groupBy).toBe('month');
  });

  it('summarizes how alerts were answered', () => {
    expect(
      summarizeAlerts([
        print(),
        print({ alerted_at: 'x', alert_overwrite: 'FAILED' }),
        print({ alerted_at: 'x', alert_overwrite: 'NOT_FAILED' }),
        print({ alerted_at: 'x' }),
      ]),
    ).toEqual({ alerted: 3, failures: 1, falseAlarms: 1, unanswered: 1 });
  });

  it('draws the sparkline left to right, p bottom to top', () => {
    expect(sparkline([])).toBe('');
    expect(sparkline([{ t: 0, p: 0 }, { t: 10, p: 1 }])).toBe('0.0,30.0 100.0,0.0');
  });
});
