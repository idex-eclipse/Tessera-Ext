/**
 * Pure rules around Obico's failure detection, shared by the chip, the widgets, the fleet
 * panel and the alert overlay. Unit-tested without a server.
 */
import type { DateRange, ObicoPrint, ObicoPrinter } from './obico-api';

/** The three zones of Obico's own gauge (frontend FailureDetectionGauge.vue: 0–33, 33–67, 67–100). */
export type Level = 'good' | 'fishy' | 'failing';

export function level(p: number): Level {
  if (p >= 0.67) return 'failing';
  if (p >= 0.33) return 'fishy';
  return 'good';
}

/**
 * Geometry of the semicircular gauge (ui/parts.ts gauge()). Pure and unit-tested here,
 * next to the zone thresholds it visualises.
 *
 * The arc is a half circle over the baseline y = GAUGE.cy, from p = 0 at the left end to
 * p = 1 at the right end (screen coordinates, y grows downward). Like every chart in
 * Tessera it is not mirrored in RTL: probability is not a directional quantity.
 */
export const GAUGE = { cx: 50, cy: 56, r: 40 } as const;

/** Zone boundaries of the arc, as fractions of the half circle (see level()). */
export const GAUGE_ZONES: ReadonlyArray<{ from: number; to: number; level: Level }> = [
  { from: 0, to: 1 / 3, level: 'good' },
  { from: 1 / 3, to: 2 / 3, level: 'fishy' },
  { from: 2 / 3, to: 1, level: 'failing' },
];

function clamp01(p: number): number {
  return Math.min(1, Math.max(0, p));
}

/** A point of the arc at probability `p` (0 left, 1 right) on radius `r`. */
export function gaugePoint(p: number, r: number = GAUGE.r): { x: number; y: number } {
  const a = Math.PI * (1 - clamp01(p));
  return { x: GAUGE.cx + r * Math.cos(a), y: GAUGE.cy - r * Math.sin(a) };
}

/** SVG path of the arc segment between two probabilities (`from` < `to`). */
export function gaugeArcPath(from: number, to: number, r: number = GAUGE.r): string {
  const s = gaugePoint(from, r);
  const e = gaugePoint(to, r);
  // sweep 1: with y growing downward the arc goes over the top from left to right.
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

/** A print session is going on (Obico keeps `current_print` until the print ends). */
export function isPrinting(printer: ObicoPrinter | null | undefined): boolean {
  return Boolean(printer?.current_print);
}

/**
 * The current print has an alert nobody answered yet: the same test as Obico's web app
 * (normalizers.js alertUnacknowledged): alerted after the last acknowledgement. A muted
 * print raises no new alerts, and a muted alert is not asked about again.
 */
export function alertPending(print: ObicoPrint | null | undefined): boolean {
  if (!print?.alerted_at || print.alert_muted_at) return false;
  const alerted = Date.parse(print.alerted_at);
  const acked = print.alert_acknowledged_at ? Date.parse(print.alert_acknowledged_at) : 0;
  return alerted > acked;
}

/** Identity of one alert: a new alert of the same print gets a new key. */
export function alertKey(print: ObicoPrint): string {
  return `${print.id}@${print.alerted_at ?? ''}`;
}

/**
 * Known `not_watching_reason` texts of the server (app/models/other_models.py) → i18n keys.
 * An unknown text is shown as is: it is already a sentence.
 */
const REASONS: Record<string, string> = {
  'AI failure detection is disabled': 'obico.reason.disabled',
  'You have run out of AI Detection Hours': 'obico.reason.noHours',
  'Printer is not actively printing': 'obico.reason.notPrinting',
  'Alerts are muted for current print': 'obico.reason.muted',
};

export function reasonKey(reason: string | null | undefined): string | null {
  return reason ? (REASONS[reason] ?? null) : null;
}

/** Periods of the statistics widget. */
export type Period = 'week' | 'month' | 'year';

/** `YYYY-MM-DD` of a date in the given time zone (en-CA formats dates this way). */
export function isoDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** The last 7 days, 30 days or 12 months up to today, in the browser's time zone. */
export function periodRange(period: Period, now: Date, timeZone: string): DateRange {
  const days = period === 'week' ? 6 : period === 'month' ? 29 : 364;
  const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return {
    groupBy: period === 'year' ? 'month' : 'day',
    timeZone,
    from: isoDay(from, timeZone),
    to: isoDay(now, timeZone),
  };
}

/** How the alerts of a period were answered. */
export interface AlertSummary {
  /** Prints with at least one alert. */
  alerted: number;
  /** The user confirmed a real failure. */
  failures: number;
  /** The user said it was not a failure. */
  falseAlarms: number;
  /** Alerted, but nobody answered. */
  unanswered: number;
}

export function summarizeAlerts(prints: readonly ObicoPrint[]): AlertSummary {
  const s: AlertSummary = { alerted: 0, failures: 0, falseAlarms: 0, unanswered: 0 };
  for (const p of prints) {
    if (!p.alerted_at) continue;
    s.alerted++;
    if (p.alert_overwrite === 'FAILED') s.failures++;
    else if (p.alert_overwrite === 'NOT_FAILED') s.falseAlarms++;
    else s.unanswered++;
  }
  return s;
}

/** A point of the failure probability graph of the current print. */
export interface Sample {
  t: number;
  p: number;
}

/**
 * SVG polyline points of the samples in a 100×30 box: time left to right, p bottom to top.
 * The time axis stays left-to-right in RTL too, like every chart in Tessera.
 */
export function sparkline(samples: readonly Sample[]): string {
  if (samples.length === 0) return '';
  const t0 = samples[0]!.t;
  const span = Math.max(1, samples[samples.length - 1]!.t - t0);
  return samples
    .map((s) => `${(((s.t - t0) / span) * 100).toFixed(1)},${(30 - Math.min(1, Math.max(0, s.p)) * 30).toFixed(1)}`)
    .join(' ');
}
