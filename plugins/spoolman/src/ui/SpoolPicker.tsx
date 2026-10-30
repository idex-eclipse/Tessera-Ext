import { useEffect, useMemo, useState } from 'preact/hooks';

import { sameMaterial } from '../check';
import { assignSpool } from '../guard';
import { fetchSpools } from '../moonraker';
import type { PluginApi } from '../sdk';
import type { Spool } from '../types';
import { SpoolLine, spoolTitle } from './SpoolLine';

interface Props {
  api: PluginApi;
  printerId: string;
  tool: string;
  currentId: number | null;
  /** Material the file needs: matching spools are listed first. */
  expectedMaterial?: string;
  onDone(): void;
}

/**
 * Lists spools from Spoolman and loads the chosen one into `tool`.
 * Writes go through assignSpool (save_variables + Moonraker active spool).
 */
export function SpoolPicker({ api, printerId, tool, currentId, expectedMaterial, onDone }: Props) {
  const t = (key: string, params?: Record<string, string | number>) => api.i18n.t(key, params);
  const [spools, setSpools] = useState<Spool[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true; // ignore the answer if the picker was closed meanwhile
    fetchSpools(api.moonrakerFor(printerId))
      .then((list) => alive && setSpools(list.filter((s) => !s.archived)))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [api, printerId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (spools ?? []).filter((s) => {
      if (!q) return true;
      const hay = `#${s.id} ${spoolTitle(s)} ${s.filament.material ?? ''} ${s.location ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
    const matches = (s: Spool) =>
      expectedMaterial && s.filament.material ? sameMaterial(expectedMaterial, s.filament.material) : false;
    return list.sort((a, b) => Number(matches(b)) - Number(matches(a)) || a.id - b.id);
  }, [spools, query, expectedMaterial]);

  async function pick(id: number | null) {
    setBusy(true);
    setSaveError(null);
    try {
      await assignSpool(api, printerId, tool, id);
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSaveError(message === 'save_variables'
        ? t('spoolman.picker.needsSaveVars')
        : t('spoolman.picker.saveFailed', { message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="spm-picker">
      <input
        class="spm-input"
        type="search"
        placeholder={t('spoolman.picker.search')}
        value={query}
        onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
      />
      {loadError && <p class="spm-error">{t('spoolman.picker.error', { message: loadError })}</p>}
      {saveError && <p class="spm-error">{saveError}</p>}
      {spools === null && !loadError && <p class="spm-muted">{t('spoolman.common.loading')}</p>}
      {spools !== null && visible.length === 0 && <p class="spm-muted">{t('spoolman.picker.empty')}</p>}
      <div class="spm-picker-list">
        {visible.map((s) => (
          <button
            type="button"
            key={s.id}
            class={s.id === currentId ? 'spm-picker-item current' : 'spm-picker-item'}
            disabled={busy}
            onClick={() => pick(s.id)}
          >
            <SpoolLine t={t} spool={s} />
          </button>
        ))}
      </div>
      {currentId !== null && (
        <div>
          <button type="button" class="spm-btn" disabled={busy} onClick={() => pick(null)}>
            {t('spoolman.picker.clear')}
          </button>
        </div>
      )}
    </div>
  );
}
