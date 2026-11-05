import { LitElement, type PropertyValues } from 'lit';

import type { MaintenanceRuntime } from './core/runtime';
import { runtimeFor } from './hub';
import type { PluginApi } from './sdk';

/**
 * Lit base class of every element of this plugin.
 *
 * The host knows nothing about Lit. For a contribution it creates the element with
 * `document.createElement(tag)`, sets `api` (the PluginApi of THIS plugin) and `params`,
 * and appends it. The element may be removed at any time (the user switches the Machine
 * tab), so everything is released in `disconnectedCallback`.
 *
 * Reactive properties are declared with `static properties` + `declare` instead of
 * decorators (see tsconfig.json). Shadow DOM stays on: the host theme arrives as CSS custom
 * properties, which inherit through the shadow boundary.
 */
export abstract class TesseraElement extends LitElement {
  static override properties = {
    api: { attribute: false },
    params: { attribute: false },
  };

  declare api: PluginApi | null;
  declare params: Record<string, string>;

  #off: Array<() => void> = [];

  constructor() {
    super();
    this.api = null;
    this.params = {};
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.api) this.attachApi(this.api);
  }

  override willUpdate(changed: PropertyValues): void {
    // An api assigned after connection (a contract violation, but cheap to tolerate).
    if (changed.has('api') && this.api && this.#off.length === 0 && this.isConnected) this.attachApi(this.api);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const off of this.#off) off();
    this.#off = [];
  }

  /** Subclasses extend this to bind to the api; the returned unsubscribers are released on disconnect. */
  protected attachApi(api: PluginApi): void {
    // Host strings change with the language.
    this.#off.push(api.onLocaleChange(() => this.requestUpdate()));
  }

  protected track(off: () => void): void {
    this.#off.push(off);
  }

  /** Translation through the HOST dictionary (our `locales` export is merged into it). */
  protected t(key: string, params?: Record<string, string | number>): string {
    return this.api ? this.api.i18n.t(key, params) : key;
  }
}

/**
 * A top-level element (tab, widget) that renders the runtime of the ACTIVE printer and
 * re-renders whenever it changes. A printer switch rebinds it.
 */
export abstract class RuntimeElement extends TesseraElement {
  static override properties = {
    ...TesseraElement.properties,
    runtime: { state: true },
  };

  declare runtime: MaintenanceRuntime | null;
  #unsub: (() => void) | null = null;

  constructor() {
    super();
    this.runtime = null;
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    this.#bind(runtimeFor(api, api.printer.id));
    this.track(api.onPrinterChange((p) => this.#bind(runtimeFor(api, p.id))));
    this.track(() => {
      this.#unsub?.();
      this.#unsub = null;
    });
  }

  #bind(rt: MaintenanceRuntime): void {
    this.#unsub?.();
    this.runtime = rt;
    this.#unsub = rt.subscribe(() => this.requestUpdate());
  }
}

/**
 * customElements.define() throws if the tag is taken. The host may import the module
 * again (plugin update without a page reload) and tags are global for the whole page, so
 * registration is idempotent.
 */
export function defineElement(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}
