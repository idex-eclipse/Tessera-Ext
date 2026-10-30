import { createContext, h, render, type ComponentType } from 'preact';
import { useContext } from 'preact/hooks';

import { setApi } from './api-ref';
import type { MpuParams, PluginApi } from './sdk';

/**
 * Custom Element → Preact adapter.
 *
 * This is the whole integration contract between Tessera and a plugin that is
 * not written in Svelte. The host knows nothing about Preact; for every
 * surface in manifest.json (page, widget, widget header, overlay) it does:
 *
 *   const el = document.createElement(tag);   // tag = manifest "element"
 *   el.api = pluginApi;                       // PluginApi of THIS plugin
 *   el.params = params;                       // Record<string, string>
 *   container.appendChild(el);                // → connectedCallback
 *
 * Guarantees we rely on (see docs/en/plugin-development.md, "Custom Element contract"):
 * - `api` and `params` are set BEFORE connectedCallback;
 * - `api` is stable while the element lives (if the host needs another api it
 *   re-creates the element instead of re-assigning the property);
 * - `params` MAY be re-assigned on a live element (e.g. the page query string
 *   changes) and no event is fired — the setter is the only signal.
 * - the host may disconnect the element at any time (route change, fleet mode,
 *   dashboard edit), so everything is torn down in disconnectedCallback.
 */

export interface SurfaceProps {
  api: PluginApi;
  params: MpuParams;
}

/** PluginApi for deep components that do not get it via props. */
const ApiContext = createContext<PluginApi | null>(null);

export function useApi(): PluginApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('[spoolman] useApi() called outside a plugin surface');
  return api;
}

export function defineElement(tag: string, Component: ComponentType<SurfaceProps>): void {
  // customElements.define() throws if the tag is taken. The host may import
  // the module again (plugin update without reload), and tags are global for
  // the whole page, so registration must be idempotent.
  if (customElements.get(tag)) return;

  class SurfaceElement extends HTMLElement {
    #api: PluginApi | null = null;
    #params: MpuParams = {};
    #connected = false;

    constructor() {
      super();
      // "Lazy property" upgrade: if someone assigned `api`/`params` to the
      // element before this class was defined, the values sit as own
      // properties and shadow our setters. Re-assign them through the setters.
      // The host defines elements before creating them, but this keeps the
      // adapter correct for any creation order.
      for (const key of ['api', 'params'] as const) {
        if (Object.prototype.hasOwnProperty.call(this, key)) {
          const value = (this as Record<string, unknown>)[key];
          delete (this as Record<string, unknown>)[key];
          (this as Record<string, unknown>)[key] = value;
        }
      }
    }

    set api(value: PluginApi | null) {
      this.#api = value;
      if (value) setApi(value);
      if (this.#connected) this.#render();
    }

    get api(): PluginApi | null {
      return this.#api;
    }

    set params(value: MpuParams | null | undefined) {
      // All params are strings; structured data comes as JSON strings.
      this.#params = value ?? {};
      if (this.#connected) this.#render();
    }

    get params(): MpuParams {
      return this.#params;
    }

    connectedCallback(): void {
      this.#connected = true;
      this.#render();
    }

    disconnectedCallback(): void {
      this.#connected = false;
      // Unmounting runs every useEffect cleanup → Moonraker subscriptions and
      // host listeners (onPrinterChange, …) are released.
      render(null, this);
    }

    #render(): void {
      if (!this.#api) {
        console.error(`[spoolman] <${tag}> connected without api — host contract violated`);
        return;
      }
      // Light DOM on purpose (no shadow root). The overlay layer is
      // `pointer-events: none` and re-enables clicks with
      // `.plugin-overlay-item * { pointer-events: auto }`; that selector
      // matches our light-DOM nodes directly. (Inside a shadow root it would
      // only reach the host element and rely on inheritance.) Host theme
      // tokens (--bg-surface, --accent, …) are CSS custom properties and work
      // either way; our own classes are prefixed `spm-` to avoid collisions.
      render(
        h(ApiContext.Provider, { value: this.#api }, h(Component, { api: this.#api, params: this.#params })),
        this,
      );
    }
  }

  customElements.define(tag, SurfaceElement);
}
