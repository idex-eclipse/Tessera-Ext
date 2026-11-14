import { useEffect, useState } from 'preact/hooks';

import type { SurfaceProps } from '../element';
import { getSpoolmanServer } from '../moonraker';
import { resolveSpoolmanUrl } from '../parse';
import { useActivePrinter, useT } from './hooks';

/** settingsFor key: Spoolman address typed by the user (per printer). */
const URL_KEY = 'spoolmanUrl';

/**
 * Plugin page (manifest.json → pages): Spoolman's own web UI in an iframe.
 *
 * Unlike the rest of the plugin this is a direct browser → Spoolman
 * connection (an iframe cannot go through Moonraker's proxy), so the address
 * must be reachable from the browser. Default: Moonraker's `[spoolman] server`
 * with a loopback host replaced by the printer host; the user can override it.
 *
 * Settings: `api.settingsFor(printer.id)` is scoped to the displayed printer (or shared, if the
 * user turned on "sync settings" for this plugin) — the host decides, the
 * plugin just reads/writes keys. It is re-read when the printer changes.
 */
export function Page({ api }: SurfaceProps) {
  const t = useT(api);
  const printer = useActivePrinter(api);
  const [manual, setManual] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [server, setServer] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!printer.id) return;
    const saved = api.settingsFor(printer.id).get<string>(URL_KEY) || undefined;
    setManual(saved);
    setDraft(saved ?? '');

    let alive = true;
    getSpoolmanServer(api.moonrakerFor(printer.id))
      .then((s) => alive && setServer(s))
      .catch(() => alive && setServer(undefined));
    return () => {
      alive = false;
    };
  }, [api, printer.id]);

  if (!printer.id) return <div class="spm-page"><p class="spm-muted">{t('spoolman.common.noPrinter')}</p></div>;

  const url = resolveSpoolmanUrl(manual, server, printer.url);

  function save() {
    const value = draft.trim();
    api.settingsFor(printer.id).set(URL_KEY, value || null);
    setManual(value || undefined);
  }

  function reset() {
    api.settingsFor(printer.id).set(URL_KEY, null);
    setManual(undefined);
    setDraft('');
  }

  return (
    <div class="spm-page spm-root">
      <div class="spm-page-bar">
        <input
          class="spm-input"
          type="url"
          aria-label={t('spoolman.page.url')}
          placeholder={url ?? 'http://printer.local:7912'}
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button type="button" class="spm-btn spm-btn-primary" onClick={save}>{t('spoolman.page.save')}</button>
        {manual && <button type="button" class="spm-btn" onClick={reset}>{t('spoolman.page.reset')}</button>}
        {url && (
          <a class="spm-btn" href={url} target="_blank" rel="noopener noreferrer">{t('spoolman.page.openTab')}</a>
        )}
      </div>
      {url ? (
        <>
          <iframe class="spm-frame" src={url} title="Spoolman" />
          <p class="spm-muted">{t('spoolman.page.frameHint')}</p>
        </>
      ) : (
        <p class="spm-muted">{t('spoolman.page.unknownUrl')}</p>
      )}
    </div>
  );
}
