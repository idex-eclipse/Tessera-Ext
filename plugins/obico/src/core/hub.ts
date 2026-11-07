/**
 * One shared view of the Obico server for the whole page.
 *
 * The chip, the widgets, the fleet panels, the tab and the alert overlay all read this hub;
 * only the hub talks to the server. One `GET printers/` answers for every printer of the
 * account, so the page makes one request per poll however many Tessera printers and
 * elements there are, well inside the server's limit of 3600 requests per hour.
 *
 * Each Tessera printer is matched to its Obico printer by the id moonraker-obico writes
 * into its own Moonraker database (`obico` / `printer_id`).
 *
 * Polling: every 10 s while a matched printer prints (alerts must arrive quickly), every
 * 60 s otherwise, and not at all while the service is not set up.
 */
import type { PluginApi, ServiceError } from '../sdk';
import { alertKey, alertPending, isPrinting, type Sample } from './detection';
import { ObicoClient, ObicoHttpError, type ObicoPrinter, SERVICE } from './obico-api';

const FAST_POLL_MS = 10_000;
const SLOW_POLL_MS = 60_000;
/** Printer links (Moonraker DB) are re-read this often: a printer may be linked meanwhile. */
const LINKS_TTL_MS = 5 * 60_000;
const MAX_SAMPLES = 2000;

/**
 * - `unknown`: not asked yet;
 * - `unavailable`: this Tessera has no service proxy (tessera-ext service off, dev server);
 * - `unconfigured`: no address saved;
 * - `ready`: the last request succeeded;
 * - `error`: the last request failed (`error` tells why).
 */
export type HubStatus = 'unknown' | 'unavailable' | 'unconfigured' | 'ready' | 'error';

/** An alert of a Tessera printer that nobody answered yet. */
export interface PendingAlert {
  key: string;
  tesseraId: string;
  printer: ObicoPrinter;
}

function isServiceError(e: unknown): e is ServiceError {
  return e instanceof Error && e.name === 'ServiceError';
}

export class ObicoHub {
  readonly client: ObicoClient;
  status: HubStatus = 'unknown';
  /** Why the last request failed, '' when it did not. */
  error = '';
  /** Saved address of the service, null when not configured. */
  url: string | null = null;
  hasSecret = false;
  /** Printers of the account from the last poll, by Obico id. */
  printers = new Map<number, ObicoPrinter>();
  /** Tessera printer id → Obico printer id; null = the agent there is not linked. */
  links = new Map<string, number | null>();
  lastPoll = 0;

  #api: PluginApi;
  #listeners = new Set<() => void>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #linksAt = 0;
  /** Failure probability over the current print, per Obico printer. */
  #history = new Map<number, { printId: number; samples: Sample[] }>();
  /** Alert keys the user closed with "Later" in this session. */
  #dismissed = new Set<string>();

  constructor(api: PluginApi) {
    this.#api = api;
    this.client = new ObicoClient(api.services);
    api.onPrintersChange(() => {
      this.#linksAt = 0;
      void this.refresh();
    });
    void this.refresh();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const l of this.#listeners) l();
  }

  /** The Obico printer of a Tessera printer, null when unknown or not in this account. */
  printerFor(tesseraId: string): ObicoPrinter | null {
    const id = this.links.get(tesseraId);
    return id == null ? null : (this.printers.get(id) ?? null);
  }

  /** The Obico id of a Tessera printer: undefined = not read yet, null = not linked. */
  obicoIdFor(tesseraId: string): number | null | undefined {
    return this.links.get(tesseraId);
  }

  samples(obicoId: number): readonly Sample[] {
    return this.#history.get(obicoId)?.samples ?? [];
  }

  /** Unanswered alerts of the Tessera printers, oldest first, without the dismissed ones. */
  pendingAlerts(): PendingAlert[] {
    const out: PendingAlert[] = [];
    for (const [tesseraId, id] of this.links) {
      const printer = id == null ? null : this.printers.get(id);
      if (!printer?.current_print || !alertPending(printer.current_print)) continue;
      const key = alertKey(printer.current_print);
      if (!this.#dismissed.has(key)) out.push({ key, tesseraId, printer });
    }
    return out.sort((a, b) => Date.parse(a.printer.current_print!.alerted_at!) - Date.parse(b.printer.current_print!.alerted_at!));
  }

  /** "Later": the alert stays unanswered on the server, but this page stops asking. */
  dismiss(key: string): void {
    this.#dismissed.add(key);
    this.#emit();
  }

  /** Reads the service config, then polls. Called on start, after a config change and by "retry". */
  async refresh(): Promise<void> {
    try {
      const st = await this.#api.services.status(SERVICE);
      this.url = st.url;
      this.hasSecret = st.hasSecret;
      if (!st.configured) {
        this.status = 'unconfigured';
        this.printers.clear();
        this.#schedule(null);
        this.#emit();
        return;
      }
    } catch (e) {
      this.#fail(e);
      return;
    }
    await this.poll();
  }

  /** One poll: links when stale, then the printers of the account. */
  async poll(): Promise<void> {
    if (Date.now() - this.#linksAt > LINKS_TTL_MS) await this.#readLinks();
    try {
      const list = await this.client.printers();
      this.printers = new Map(list.map((p) => [p.id, p]));
      this.status = 'ready';
      this.error = '';
      this.lastPoll = Date.now();
      this.#record();
      // A matched printer is missing from the account: maybe it was linked again (new id).
      if ([...this.links.values()].some((id) => id != null && !this.printers.has(id))) this.#linksAt = 0;
    } catch (e) {
      this.#fail(e);
      return;
    }
    this.#emit();
    this.#schedule(this.#anyPrinting() ? FAST_POLL_MS : SLOW_POLL_MS);
  }

  /** Saves the address and the token (omitted: keep the saved one), then reconnects. */
  async configure(url: string, secret?: string): Promise<void> {
    await this.#api.services.configure(SERVICE, secret === undefined ? { url } : { url, secret });
    await this.refresh();
  }

  async forget(): Promise<void> {
    await this.#api.services.remove(SERVICE);
    await this.refresh();
  }

  /** Runs a command against the server and polls at once, so every view shows its effect. */
  async run(action: (client: ObicoClient) => Promise<unknown>): Promise<void> {
    await action(this.client);
    await this.poll();
  }

  #fail(e: unknown): void {
    if (isServiceError(e) && e.unavailable) {
      this.status = 'unavailable';
      this.#schedule(null);
    } else if (isServiceError(e) && e.status === 409) {
      this.status = 'unconfigured';
      this.#schedule(null);
    } else {
      this.status = 'error';
      this.#schedule(SLOW_POLL_MS);
    }
    if (e instanceof ObicoHttpError && (e.status === 401 || e.status === 403)) {
      this.error = 'obico.api.tokenRejected';
    } else {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.#emit();
  }

  #schedule(ms: number | null): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = ms === null ? null : setTimeout(() => void this.poll(), ms);
  }

  #anyPrinting(): boolean {
    for (const id of this.links.values()) if (id != null && isPrinting(this.printers.get(id))) return true;
    return false;
  }

  /** Reads `obico/printer_id` from the Moonraker DB of every Tessera printer. */
  async #readLinks(): Promise<void> {
    const entries = await Promise.all(
      this.#api.printers.map(async (p): Promise<[string, number | null]> => {
        try {
          const r = await this.#api
            .moonrakerFor(p.id)
            .request<{ value?: unknown }>('server.database.get_item', { namespace: 'obico', key: 'printer_id' });
          const id = Number(r?.value);
          return [p.id, Number.isInteger(id) && id > 0 ? id : null];
        } catch {
          // No such namespace (agent never linked) or the printer is offline.
          return [p.id, this.links.get(p.id) ?? null];
        }
      }),
    );
    this.links = new Map(entries);
    this.#linksAt = Date.now();
  }

  /** Appends the probability of every printing printer; a new print starts a new graph. */
  #record(): void {
    const now = Date.now();
    for (const p of this.printers.values()) {
      const print = p.current_print;
      if (!print) {
        this.#history.delete(p.id);
        continue;
      }
      let h = this.#history.get(p.id);
      if (!h || h.printId !== print.id) {
        h = { printId: print.id, samples: [] };
        this.#history.set(p.id, h);
      }
      h.samples.push({ t: now, p: p.normalized_p });
      if (h.samples.length > MAX_SAMPLES) h.samples.splice(0, h.samples.length - MAX_SAMPLES);
    }
  }
}

let hub: ObicoHub | null = null;

/**
 * The hub of this page, created by the first element that asks. The api object is the same
 * for every element of the plugin (the host caches it per plugin), so keeping it is safe.
 */
export function hubFor(api: PluginApi): ObicoHub {
  hub ??= new ObicoHub(api);
  return hub;
}

/** For tests: forget the page-wide hub. */
export function resetHub(): void {
  hub = null;
}
