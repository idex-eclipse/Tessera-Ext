import { nothing } from 'lit';

import { TesseraElement } from '../base-element';

/**
 * <tessera-shaketune-bridge> — an overlay that renders NOTHING.
 *
 * Overlays are persistent surfaces: the host mounts them at app start, on every
 * page, and keeps them mounted. That is the only reason this element exists:
 * TesseraElement stores the api for the guard on connect (api-ref.ts), so the
 * guard can check Shake&Tune commands typed in the console even if the user
 * never opened the Input Shaper tab.
 *
 * An overlay that shows nothing must render nothing: the host's overlay layer
 * is full-screen with pointer-events re-enabled for our content, so an empty
 * render is also what keeps clicks going to the page underneath.
 */
export class ShakeTuneBridge extends TesseraElement {
  override render(): typeof nothing {
    return nothing;
  }
}
