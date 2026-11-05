import { css, html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import type { PluginApi } from '../sdk';
import { styles } from './styles';

/** What the dialog needs of a Moonraker webcam record. */
export interface Webcam {
  name: string;
  service: string;
  snapshotUrl: string;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/** Same defaults as the camera widget (plugins/widgets-core/camera/use-cameras.svelte.ts). */
export function parseWebcams(response: unknown): Webcam[] {
  const list = (response as { webcams?: unknown } | null | undefined)?.webcams;
  if (!Array.isArray(list)) return [];
  return list
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && (c as { enabled?: unknown }).enabled !== false)
    .map((c) => ({
      name: String(c.name ?? ''),
      service: String(c.service ?? ''),
      snapshotUrl: String(c.snapshot_url ?? '/webcam/?action=snapshot'),
      rotation: Number(c.rotation ?? 0),
      flipH: Boolean(c.flip_horizontal),
      flipV: Boolean(c.flip_vertical),
    }))
    .filter((c) => c.name && c.snapshotUrl);
}

/**
 * Relative camera URLs belong to the web server in front of Moonraker (nginx on port 80), so
 * they resolve against its origin WITHOUT the Moonraker port, exactly like the camera widget.
 */
export function resolveCameraUrl(url: string, httpBaseUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    const base = new URL(httpBaseUrl);
    base.port = '';
    return base.origin + (url.startsWith('/') ? url : `/${url}`);
  } catch {
    return url;
  }
}

/** A new frame is requested this often, and only after the previous one arrived. */
const REFRESH_MS = 1000;

/**
 * <tessera-maint-cameras> - live frames of the printer's cameras for the pre-print dialog.
 *
 * Snapshots are polled instead of opening video streams: they work for every camera service
 * that has a snapshot URL (including the ones that need WebRTC or HLS for video), cost one
 * small request per second, and need no codecs. A camera that fails shows a note; the
 * dialog never depends on it, because the bed check can also be confirmed without a picture.
 */
export class MaintCameras extends TesseraElement {
  static override styles = [
    styles,
    css`
      :host {
        display: block;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: var(--space-sm);
      }
      figure {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .frame {
        position: relative;
        aspect-ratio: 16 / 9;
        background: var(--bg-surface-hover);
        border-radius: var(--radius-sm);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      img {
        max-inline-size: 100%;
        max-block-size: 100%;
        object-fit: contain;
      }
      figcaption {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        overflow-wrap: anywhere;
      }
      .off {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-sm);
        text-align: center;
        color: var(--text-muted);
        font-size: var(--font-size-sm);
        background: var(--bg-surface-hover);
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    printerId: { type: String },
    cameras: { state: true },
    failed: { state: true },
    loaded: { state: true },
    frames: { state: true },
  };

  declare printerId: string;
  declare cameras: Webcam[];
  declare failed: Record<string, boolean>;
  declare loaded: boolean;
  /** Current frame URL per camera name. */
  declare frames: Record<string, string>;

  #timer: ReturnType<typeof setInterval> | null = null;
  #inFlight = new Set<string>();

  constructor() {
    super();
    this.printerId = '';
    this.cameras = [];
    this.failed = {};
    this.loaded = false;
    this.frames = {};
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    void this.#load();
    this.track(() => this.#stop());
  }

  async #load(): Promise<void> {
    const api = this.api;
    if (!api) return;
    try {
      const res = await api.moonrakerFor(this.printerId || api.printer.id).request('server.webcams.list');
      this.cameras = parseWebcams(res);
    } catch {
      this.cameras = [];
    }
    this.loaded = true;
    if (this.cameras.length > 0) this.#start();
  }

  #start(): void {
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), REFRESH_MS);
  }

  #stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  #tick(): void {
    const api = this.api;
    if (!api) return;
    const base = api.moonrakerFor(this.printerId || api.printer.id).httpBaseUrl;
    const next = { ...this.frames };
    for (const cam of this.cameras) {
      // One request at a time per camera, otherwise a slow camera piles requests up.
      if (this.#inFlight.has(cam.name)) continue;
      this.#inFlight.add(cam.name);
      const url = resolveCameraUrl(cam.snapshotUrl, base);
      next[cam.name] = `${url}${url.includes('?') ? '&' : '?'}_cb=${Date.now()}`;
    }
    this.frames = next;
  }

  #done(name: string, ok: boolean): void {
    this.#inFlight.delete(name);
    if (this.failed[name] === !ok) return;
    this.failed = { ...this.failed, [name]: !ok };
  }

  override render(): TemplateResult {
    if (!this.loaded) return html``;
    const tr = (k: string): string => this.t(k);
    if (this.cameras.length === 0) return html`<p class="muted">${tr('maintenance.guard.noCamera')}</p>`;
    return html`<div class="grid">
      ${this.cameras.map((c) => {
        const transform = [c.rotation ? `rotate(${c.rotation}deg)` : '', c.flipH ? 'scaleX(-1)' : '', c.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
        return html`<figure>
          <div class="frame">
            ${this.frames[c.name]
              ? html`<img
                  src=${this.frames[c.name]!}
                  alt=${c.name}
                  style=${transform ? `transform:${transform}` : ''}
                  @load=${() => this.#done(c.name, true)}
                  @error=${() => this.#done(c.name, false)}
                />`
              : nothing}
            ${this.failed[c.name] ? html`<div class="off">${tr('maintenance.guard.cameraOff')}</div>` : nothing}
          </div>
          <figcaption class="ltr">${c.name}</figcaption>
        </figure>`;
      })}
    </div>`;
  }
}
