/**
 * The Obico server REST API, as far as this plugin uses it, called through Tessera's
 * service proxy (`api.services`, manifest.services → "obico").
 *
 * Why the proxy: the Obico server sends no CORS headers (django-cors-headers is installed
 * but not configured), so the browser cannot call it from the Tessera page. The proxy on
 * the printer adds `Authorization: Bearer <token>`; the token is an OAuth access token
 * created in the admin of a self-hosted server (`/admin/oauth2_provider/accesstoken/add/`).
 *
 * Endpoints and fields follow obico-server (api/urls.py, api/viewsets.py, api/serializers.py)
 * and https://www.obico.io/docs/api/. Trailing slashes matter: Django would redirect a path
 * without one, and the proxy refuses redirects.
 */
import type { PluginServicesApi } from '../sdk';

/** Name of the service in manifest.json → services. */
export const SERVICE = 'obico';

/** `print` of the Printer object: the current print session, null when idle. */
export interface ObicoPrint {
  id: number;
  filename: string;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  alerted_at: string | null;
  alert_acknowledged_at: string | null;
  alert_muted_at: string | null;
  paused_at: string | null;
  /** The user's verdict on an alert: a real failure or a false alarm; null when not given. */
  alert_overwrite: 'FAILED' | 'NOT_FAILED' | null;
  print_time?: number | null;
  filament_used?: number | null;
}

/** The fields of the Printer object this plugin reads or writes. */
export interface ObicoPrinter {
  id: number;
  name: string;
  /** Failure probability shown by Obico's gauge, 0…1. */
  normalized_p: number;
  watching_enabled: boolean;
  /** Why the printer is not watched now (server text, English), null when it is. */
  not_watching_reason: string | null;
  action_on_failure: 'PAUSE' | 'NONE';
  /** 0.8 (least sensitive) … 1.2 (most sensitive). */
  detective_sensitivity: number;
  tools_off_on_pause: boolean;
  bed_off_on_pause: boolean;
  /** mm; 0 = none. */
  retract_on_pause: number;
  lift_z_on_pause: number;
  agent_connected?: boolean;
  pic?: { img_url?: string | null } | null;
  status?: { state?: { text?: string; flags?: Record<string, boolean> } } | null;
  current_print: ObicoPrint | null;
}

/** Writable reaction settings of a printer (PATCH printers/<id>/). */
export type ReactionSettings = Pick<
  ObicoPrinter,
  | 'watching_enabled'
  | 'action_on_failure'
  | 'detective_sensitivity'
  | 'tools_off_on_pause'
  | 'bed_off_on_pause'
  | 'retract_on_pause'
  | 'lift_z_on_pause'
>;

export interface ObicoEvent {
  id: number;
  printer: number;
  print: number | null;
  event_type: string;
  event_class: 'ERROR' | 'WARNING' | 'SUCCESS' | 'INFO';
  event_title: string | null;
  event_text: string | null;
  created_at: string;
}

/** Answer of prints/stats/ (api/print_stats.py summarize_prints). */
export interface ObicoStats {
  total_print_count: number;
  total_succeeded_print_count: number;
  total_cancelled_print_count: number;
  /** Seconds. */
  total_print_time: number;
  /** Millimetres: the agent sends Klipper's print_stats.filament_used. */
  total_filament_used: number;
}

/** The answer of the Obico server was not 2xx. */
export class ObicoHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ObicoHttpError';
  }
}

/** Every event class and type: the list endpoint returns nothing for an empty filter. */
const EVENT_CLASSES = ['ERROR', 'WARNING', 'SUCCESS', 'INFO'];
const EVENT_TYPES = [
  'STARTED',
  'ENDED',
  'PAUSED',
  'RESUMED',
  'FAILURE_ALERTED',
  'ALERT_MUTED',
  'ALERT_UNMUTED',
  'FILAMENT_CHANGE',
  'PRINTER_ERROR',
];

/** A query string; `[]` keys repeat, as Django's `getlist` expects. */
function query(params: Record<string, string | number | string[]>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const item of v) q.append(k, item);
    else q.append(k, String(v));
  }
  return q.toString();
}

/** A thin client: every call is one proxied request, errors are thrown. */
export class ObicoClient {
  constructor(private readonly services: PluginServicesApi) {}

  async #json<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const res = await this.services.fetch(SERVICE, path, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const data = (await res.json()) as { detail?: unknown };
        if (typeof data.detail === 'string') detail = data.detail;
      } catch {
        // not JSON (an HTML error page of the server)
      }
      throw new ObicoHttpError(detail || `Obico answered HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** All printers of the token's user: one request serves every Tessera printer. */
  printers(): Promise<ObicoPrinter[]> {
    return this.#json('api/v1/printers/');
  }

  patchPrinter(id: number, patch: Partial<ReactionSettings>): Promise<ObicoPrinter> {
    return this.#json(`api/v1/printers/${id}/`, { method: 'PATCH', body: patch });
  }

  /**
   * "It was / was not a failure" for the current alert. It only records the verdict: pausing,
   * resuming and cancelling go through Moonraker, so Tessera's guards see them.
   */
  acknowledge(id: number, overwrite: 'FAILED' | 'NOT_FAILED'): Promise<unknown> {
    return this.#json(`api/v1/printers/${id}/acknowledge_alert/?${query({ alert_overwrite: overwrite })}`, { method: 'POST' });
  }

  /** Stops (or resumes) failure detection for the rest of the current print. */
  mute(id: number, muted = true): Promise<unknown> {
    return this.#json(`api/v1/printers/${id}/mute_current_print/?${query({ mute_alert: muted ? 'true' : 'false' })}`, {
      method: 'POST',
    });
  }

  /**
   * The latest events of the user's printers, newest first. The endpoint has no printer
   * filter, so the caller filters by `printer`.
   */
  events(limit = 50): Promise<ObicoEvent[]> {
    return this.#json(
      `api/v1/printer_events/?${query({
        'filter_by_classes[]': EVENT_CLASSES,
        'filter_by_types[]': EVENT_TYPES,
        start: 0,
        limit,
      })}`,
    );
  }

  /** Totals of a period; dates are `YYYY-MM-DD` in `timeZone`. */
  stats(range: DateRange, printerIds: number[]): Promise<ObicoStats> {
    return this.#json(
      `api/v1/prints/stats/?${query({
        group_by: range.groupBy,
        timezone: range.timeZone,
        from_date: range.from,
        to_date: range.to,
        'filter_by_printer_ids[]': printerIds.map(String),
      })}`,
    );
  }

  /** Prints started in a period, newest first, at most `max` (pages of 100). */
  async prints(range: DateRange, printerIds: number[], max = 500): Promise<ObicoPrint[]> {
    const all: ObicoPrint[] = [];
    while (all.length < max) {
      const page = await this.#json<ObicoPrint[]>(
        `api/v1/prints/?${query({
          timezone: range.timeZone,
          from_date: range.from,
          to_date: range.to,
          'filter_by_printer_ids[]': printerIds.map(String),
          sorting: 'date_desc',
          start: all.length,
          limit: 100,
        })}`,
      );
      all.push(...page);
      if (page.length < 100) break;
    }
    return all;
  }

  /**
   * The latest webcam snapshot as an object URL (revoke it when replaced). The server
   * returns a signed absolute URL built from its own site domain, which may not be the
   * address the proxy uses, so only its path and query are taken.
   */
  async image(imgUrl: string): Promise<string> {
    const u = new URL(imgUrl);
    const res = await this.services.fetch(SERVICE, `${u.pathname.replace(/^\/+/, '')}${u.search}`);
    if (!res.ok) throw new ObicoHttpError(`Obico answered HTTP ${res.status}`, res.status);
    return URL.createObjectURL(await res.blob());
  }
}

/** A period for prints/stats/ and prints/. */
export interface DateRange {
  groupBy: 'day' | 'week' | 'month' | 'year';
  timeZone: string;
  from: string;
  to: string;
}
