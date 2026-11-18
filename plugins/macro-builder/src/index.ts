import en from './locales/en';
import ru from './locales/ru';
import { MacroBuilderDialog } from './ui';
import { isBuilderSession, type BuilderApi, type BuilderSession } from './session';

let dialog: MacroBuilderDialog | null = null;
let pending: { session: BuilderSession; api: BuilderApi } | null = null;

/** Config calls this action with the bounded buffer session. */
export function openMacroBuilder(api: BuilderApi, context: unknown): void {
  if (!isBuilderSession(context)) return;
  if (dialog) void dialog.open(context, api);
  else pending = { session: context, api };
}

/** The host mounts this custom element for the lifetime of the plugin. */
class BuilderOverlay extends MacroBuilderDialog {
  override connectedCallback(): void {
    super.connectedCallback();
    dialog = this;
    if (pending) {
      const request = pending;
      pending = null;
      void this.open(request.session, request.api);
    }
  }

  override disconnectedCallback(): void {
    if (dialog === this) dialog = null;
    super.disconnectedCallback();
  }
}

if (!customElements.get('tessera-macro-builder-dialog')) {
  customElements.define('tessera-macro-builder-dialog', BuilderOverlay);
}

export const locales = { en, ru };
