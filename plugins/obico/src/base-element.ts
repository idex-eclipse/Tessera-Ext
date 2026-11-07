import { LitElement, type PropertyValues } from 'lit';

import { hubFor, type ObicoHub } from './core/hub';
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

  /**
   * Translation through the HOST dictionary (our `locales` export is merged into it). An
   * arrow property, not a method: the render helpers in ui/parts.ts receive it detached.
   */
  protected t = (key: string, params?: Record<string, string | number>): string =>
    this.api ? this.api.i18n.t(key, params) : key;
}

/**
 * An element that shows the page-wide Obico hub (core/hub.ts) and re-renders on every
 * change of it: a poll, a config change, an alert.
 */
export abstract class HubElement extends TesseraElement {
  static override properties = {
    ...TesseraElement.properties,
    tick: { state: true },
  };

  /** Bumped on every hub change; only its change matters (it triggers a render). */
  declare tick: number;
  protected hub: ObicoHub | null = null;

  constructor() {
    super();
    this.tick = 0;
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    this.hub = hubFor(api);
    this.track(this.hub.subscribe(() => this.tick++));
    // The active printer decides what most views show.
    this.track(api.onPrinterChange(() => this.tick++));
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
