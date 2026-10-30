import type { Issue } from '../check';
import type { PluginApi } from '../sdk';
import type { Spool } from '../types';

type T = PluginApi['i18n']['t'];

export function grams(t: T, value: number): string {
  return t('spoolman.common.grams', { value: Math.round(value) });
}

function amount(t: T, unit: 'g' | 'mm', value: number): string {
  return unit === 'g' ? grams(t, value) : t('spoolman.common.metres', { value: (value / 1000).toFixed(1) });
}

export function issueText(t: T, issue: Issue): string {
  switch (issue.kind) {
    case 'no-spool':
      return t('spoolman.issue.noSpool');
    case 'material':
      return t('spoolman.issue.material', { expected: issue.expected, actual: issue.actual });
    case 'insufficient':
      return t('spoolman.issue.insufficient', {
        required: amount(t, issue.unit, issue.required),
        remaining: amount(t, issue.unit, issue.remaining),
      });
    case 'unavailable':
      return t('spoolman.issue.unavailable', { message: issue.message });
  }
}

export function spoolTitle(spool: Spool): string {
  const parts = [spool.filament.vendor?.name, spool.filament.name].filter(Boolean);
  return `#${spool.id} ${parts.join(' ') || spool.filament.material || ''}`.trim();
}

/** Colour swatch + name + material/remaining + remaining bar. */
export function SpoolLine({ t, spool, loading }: { t: T; spool: Spool | null | undefined; loading?: boolean }) {
  if (spool === undefined || loading) {
    return (
      <div class="spm-spool">
        <span class="spm-swatch spm-swatch-empty" />
        <span class="spm-muted">{t('spoolman.common.loading')}</span>
      </div>
    );
  }
  if (spool === null) {
    return (
      <div class="spm-spool">
        <span class="spm-swatch spm-swatch-empty" />
        <span class="spm-muted">{t('spoolman.widget.empty')}</span>
      </div>
    );
  }

  const color = spool.filament.color_hex ? `#${spool.filament.color_hex.replace(/^#/, '')}` : undefined;
  const full = spool.filament.weight;
  const left = spool.remaining_weight;
  const ratio = full && left !== undefined ? Math.max(0, Math.min(1, left / full)) : null;

  return (
    <div class="spm-spool">
      <span class={color ? 'spm-swatch' : 'spm-swatch spm-swatch-empty'} style={color ? { background: color } : undefined} />
      <div class="spm-spool-text">
        <span class="spm-spool-name" title={spoolTitle(spool)}>{spoolTitle(spool)}</span>
        <span class="spm-muted">
          {[spool.filament.material, left !== undefined ? t('spoolman.widget.left', { value: grams(t, left) }) : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {ratio !== null && (
          <div class={ratio < 0.15 ? 'spm-bar low' : 'spm-bar'}>
            <span style={{ width: `${(ratio * 100).toFixed(1)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
