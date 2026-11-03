import { LitElement, type PropertyValues } from 'lit';

import { setApi } from './api-ref';
import type { MpuParams, PluginApi } from './sdk';

/**
 * Lit base class for every surface of this plugin — the whole integration
 * contract between Tessera and a Lit element.
 *
 * The host knows nothing about Lit. For a contribution to an extension point it
 * does exactly what it does for a page or a widget (PluginElementHost):
 *
 *   const el = document.createElement(tag);   // tag = manifest "element"
 *   el.api = pluginApi;                       // PluginApi of THIS plugin,
 *                                             //   even though we live inside
 *                                             //   the Calibrations page
 *   el.params = params;                       // Record<string, string> from the
 *                                             //   point's owner (empty here)
 *   container.appendChild(el);                // → connectedCallback
 *
 * Guarantees we rely on (docs/en/plugin-development.md, "Custom Element contract"):
 * - `api` and `params` are set BEFORE connectedCallback;
 * - `api` is stable while the element lives;
 * - `params` MAY be re-assigned on a live element (no event, the setter is the
 *   only signal) — a Lit reactive property turns that into a re-render;
 * - the host may disconnect the element at any time: here the user switching
 *   the calibration tab, leaving the page, or choosing "Original" in the host's
 *   chooser. Everything is released in disconnectedCallback / hostDisconnected.
 *
 * Reactive properties are declared with `static properties` + `declare` instead
 * of decorators (see tsconfig.json). `attribute: false`: these are objects and
 * are only ever set as properties, never as HTML attributes.
 *
 * "Lazy property" upgrade (a property assigned before the class was defined
 * shadows the accessor) — the Preact adapter of the Spoolman plugin handles it
 * by hand; Lit's ReactiveElement already saves such instance properties in its
 * constructor and replays them before the first update. They are therefore
 * visible only from the first update on, which is why StController binds
 * lazily (hostConnected OR the first hostUpdate that has an api).
 *
 * SHADOW DOM (Lit's default) is fine for an extension:
 * - the host theme comes as CSS custom properties (--bg-surface, --accent,
 *   --space-*, …), and custom properties inherit through the shadow boundary,
 *   so light/dark theme and the user's accent apply with no extra work;
 * - our CSS cannot leak into the Calibrations page, and its CSS cannot reach us;
 * - the host's chooser is opened by `contextmenu` on the point wrapper around
 *   us. `contextmenu` is a composed event, so a right-click anywhere inside our
 *   shadow tree still reaches it; an element of ours that wants its own context
 *   menu calls preventDefault() and the host leaves it alone.
 * (The Spoolman plugin renders into light DOM because its overlay depends on a
 * host selector; nothing like that applies to an extension.)
 */
export abstract class TesseraElement extends LitElement {
  static override properties = {
    api: { attribute: false },
    params: { attribute: false },
  };

  declare api: PluginApi | null;
  declare params: MpuParams;

  #off: Array<() => void> = [];

  constructor() {
    super();
    this.api = null;
    this.params = {};
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.api) this.#attach(this.api);
  }

  override willUpdate(changed: PropertyValues): void {
    // First update after a lazy upgrade, or (contract violation, but cheap to
    // tolerate) an api assigned later.
    if (changed.has('api') && this.api && this.#off.length === 0 && this.isConnected) {
      this.#attach(this.api);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const off of this.#off) off();
    this.#off = [];
  }

  #attach(api: PluginApi): void {
    setApi(api);
    // Host strings change with the language: re-render. The theme needs no
    // listener (CSS custom properties), the active printer is handled by
    // StController (it re-binds Moonraker subscriptions).
    this.#off.push(api.onLocaleChange(() => this.requestUpdate()));
  }

  /** Translation through the HOST dictionary (our `locales` export is merged into it). */
  protected t(key: string, params?: Record<string, string | number>): string {
    return this.api ? this.api.i18n.t(key, params) : key;
  }
}

/**
 * customElements.define() throws if the tag is taken. The host may import the
 * module again (plugin update without a page reload) and tags are global for
 * the whole page, so registration is idempotent.
 */
export function defineElement(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) customElements.define(tag, ctor);
}
