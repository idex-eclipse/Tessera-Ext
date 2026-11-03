import { nothing } from 'lit';

import { TesseraElement } from '../base-element';

/**
 * <tessera-pa-tester-bridge> — an overlay that renders NOTHING.
 *
 * Overlays are persistent surfaces: the host mounts them at app start, on every
 * page. TesseraElement stores the api for the guard on connect (api-ref.ts), so
 * the guard can check pa_tester commands typed in the console even if the user
 * never opened our tab. An overlay that shows nothing must render nothing: the
 * host's overlay layer re-enables pointer events for our content.
 */
export class PaTesterBridge extends TesseraElement {
  override render(): typeof nothing {
    return nothing;
  }
}
