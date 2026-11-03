import { html, nothing, type TemplateResult } from 'lit';

import type { ShaperRec, ShaperRecKind, StResult } from '../parse';

/**
 * Result cards of the last run, as plain Lit template functions.
 *
 * Template functions (not more custom elements) are Lit's lightweight way to
 * split a view: no extra tags in the global registry, no property plumbing —
 * the tab passes what they need, events call back into the tab.
 */

export interface ResultView {
  t(key: string, params?: Record<string, string | number>): string;
  /** Chosen recommendation per axis (performance / low vibrations / best). */
  pick: Partial<Record<'X' | 'Y', ShaperRecKind>>;
  onPick(axis: 'X' | 'Y', kind: ShaperRecKind): void;
  damping: boolean;
  onDamping(on: boolean): void;
  canApply: boolean;
  onApply(): void;
  onCopy(text: string, id: string): void;
  copied: string | null;
}

const AXES = ['X', 'Y'] as const;

/** The recommendation used for an axis: the user's pick, else performance, else the first. */
export function pickedRec(recs: readonly ShaperRec[], kind: ShaperRecKind | undefined): ShaperRec | null {
  return (
    recs.find((r) => r.kind === kind) ??
    recs.find((r) => r.kind === 'performance') ??
    recs[0] ??
    null
  );
}

/**
 * SET_INPUT_SHAPER for the picked recommendations. Note the parameter names:
 * SHAPER_FREQ_X (not FREQ_X). DAMPING_RATIO_X only when asked for — Shake&Tune
 * reports the damping it MEASURED; Klipper's default 0.1 is what most configs use.
 */
export function applyCommand(result: StResult, pick: ResultView['pick'], damping: boolean): string | null {
  const parts: string[] = [];
  for (const axis of AXES) {
    const rec = pickedRec(result.shaper[axis]?.recs ?? [], pick[axis]);
    if (!rec) continue;
    parts.push(`SHAPER_TYPE_${axis}=${rec.name}`, `SHAPER_FREQ_${axis}=${rec.freq}`);
    if (damping && rec.damping !== null) parts.push(`DAMPING_RATIO_${axis}=${rec.damping}`);
  }
  return parts.length ? `SET_INPUT_SHAPER ${parts.join(' ')}` : null;
}

/**
 * The same values for printer.cfg. SET_INPUT_SHAPER changes the running
 * firmware only and SAVE_CONFIG does NOT persist it (it saves what
 * SHAPER_CALIBRATE recorded, not runtime changes), so the user pastes this.
 */
export function configSnippet(result: StResult, pick: ResultView['pick'], damping: boolean): string {
  const lines = ['[input_shaper]'];
  for (const axis of AXES) {
    const rec = pickedRec(result.shaper[axis]?.recs ?? [], pick[axis]);
    if (!rec) continue;
    const a = axis.toLowerCase();
    lines.push(`shaper_type_${a}: ${rec.name}`, `shaper_freq_${a}: ${rec.freq}`);
    if (damping && rec.damping !== null) lines.push(`damping_ratio_${a}: ${rec.damping}`);
  }
  return lines.join('\n');
}

function copyButton(v: ResultView, text: string, id: string, labelKey: string): TemplateResult {
  return html`<button class="btn" @click=${() => v.onCopy(text, id)}>
    ${v.copied === id ? v.t('shaketune.common.copied') : v.t(labelKey)}
  </button>`;
}

function shaperCard(r: StResult, v: ResultView): TemplateResult | typeof nothing {
  const axes = AXES.filter((a) => (r.shaper[a]?.recs.length ?? 0) > 0);
  if (axes.length === 0) return nothing;
  const anyDamping = axes.some((a) => r.shaper[a]!.recs.some((rec) => rec.damping !== null));
  return html`
    <div class="card">
      <h4>${v.t('shaketune.result.shaperTitle')}</h4>
      <table>
        <thead>
          <tr>
            <th>${v.t('shaketune.result.axis')}</th>
            <th>${v.t('shaketune.result.recommendation')}</th>
            <th>${v.t('shaketune.result.shaper')}</th>
            <th>${v.t('shaketune.result.freq')}</th>
            <th>${v.t('shaketune.result.damping')}</th>
          </tr>
        </thead>
        <tbody>
          ${axes.flatMap((axis) => {
            const recs = r.shaper[axis]!.recs;
            const chosen = pickedRec(recs, v.pick[axis]);
            return recs.map(
              (rec) => html`
                <tr>
                  <td>${axis}</td>
                  <td>
                    <label class="row">
                      <input
                        type="radio"
                        name=${`pick-${axis}`}
                        .checked=${rec === chosen}
                        @change=${() => v.onPick(axis, rec.kind)}
                      />
                      ${v.t(`shaketune.rec.${rec.kind}`)}
                    </label>
                  </td>
                  <td class="mono">${rec.name.toUpperCase()}</td>
                  <td class="mono">${rec.freq.toFixed(1)}</td>
                  <td class="mono">${rec.damping !== null ? rec.damping.toFixed(3) : '—'}</td>
                </tr>
              `,
            );
          })}
        </tbody>
      </table>
      ${axes.map((a) =>
        r.shaper[a]!.peaks ? html`<p class="muted">${a}: ${v.t('shaketune.result.peaks', { peaks: r.shaper[a]!.peaks! })}</p>` : nothing,
      )}
      <div class="row">
        ${anyDamping
          ? html`<label class="row muted">
              <input type="checkbox" .checked=${v.damping} @change=${(e: Event) => v.onDamping((e.target as HTMLInputElement).checked)} />
              ${v.t('shaketune.result.includeDamping')}
            </label>`
          : nothing}
      </div>
      <div class="row">
        <button class="btn primary" ?disabled=${!v.canApply} @click=${v.onApply}>${v.t('shaketune.result.apply')}</button>
        ${copyButton(v, configSnippet(r, v.pick, v.damping), 'shaper', 'shaketune.result.copyConfig')}
      </div>
      <p class="muted">${v.t('shaketune.result.applyHint')}</p>
    </div>
  `;
}

function beltsCard(r: StResult, v: ResultView): TemplateResult | typeof nothing {
  if (!r.belts || (r.belts.similarity === null && !r.belts.health)) return nothing;
  return html`
    <div class="card">
      <h4>${v.t('shaketune.result.beltsTitle')}</h4>
      ${r.belts.similarity !== null
        ? html`<p>${v.t('shaketune.result.similarity')}: <strong class="mono">${r.belts.similarity.toFixed(1)}%</strong></p>`
        : nothing}
      ${r.belts.health ? html`<p>${v.t('shaketune.result.health')}: <strong>${r.belts.health}</strong></p>` : nothing}
      <p class="muted">${v.t('shaketune.result.beltsHint')}</p>
    </div>
  `;
}

function vibrationsCard(r: StResult, v: ResultView): TemplateResult | typeof nothing {
  const vib = r.vibrations;
  if (!vib || (vib.symmetry === null && !vib.speeds.length && !vib.motor)) return nothing;
  return html`
    <div class="card">
      <h4>${v.t('shaketune.result.vibrationsTitle')}</h4>
      ${vib.symmetry !== null
        ? html`<p>${v.t('shaketune.result.symmetry')}: <strong class="mono">${vib.symmetry.toFixed(1)}%</strong></p>`
        : nothing}
      ${vib.peaks ? html`<p class="muted">${v.t('shaketune.result.vibPeaks', { peaks: vib.peaks })}</p>` : nothing}
      ${vib.speeds.length
        ? html`<p>${v.t('shaketune.result.lowSpeeds')}:</p><ul>${vib.speeds.map((s) => html`<li class="mono">${s}</li>`)}</ul>`
        : nothing}
      ${vib.angles.length
        ? html`<p>${v.t('shaketune.result.lowAngles')}:</p><ul>${vib.angles.map((s) => html`<li class="mono">${s}</li>`)}</ul>`
        : nothing}
      ${vib.motor ? html`<p class="muted">${v.t('shaketune.result.motor', { value: vib.motor })}</p>` : nothing}
    </div>
  `;
}

function axesMapCard(r: StResult, v: ResultView): TemplateResult | typeof nothing {
  const m = r.axesMap;
  if (!m || (!m.detected && m.ok === null)) return nothing;
  const value = m.suggestion ?? m.detected;
  return html`
    <div class="card">
      <h4>${v.t('shaketune.result.axesMapTitle')}</h4>
      ${m.detected ? html`<p>${v.t('shaketune.result.detected')}: <strong class="mono">${m.detected}</strong></p>` : nothing}
      ${m.ok === true ? html`<p class="ok">${v.t('shaketune.result.axesMapOk')}</p>` : nothing}
      ${m.ok === false ? html`<p class="warn">${v.t('shaketune.result.axesMapMismatch')}</p>` : nothing}
      ${value && m.ok !== true ? html`<div class="row">${copyButton(v, `axes_map: ${value}`, 'axes', 'shaketune.result.copyAxesMap')}</div>` : nothing}
    </div>
  `;
}

function excitateCard(r: StResult, v: ResultView): TemplateResult | typeof nothing {
  if (!r.excitate) return nothing;
  return html`
    <div class="card">
      <h4>${v.t('shaketune.result.excitateTitle')}</h4>
      <p class="mono">
        ${v.t('shaketune.result.excitate', { axis: r.excitate.axis.toUpperCase(), freq: r.excitate.freq, seconds: r.excitate.seconds })}
      </p>
    </div>
  `;
}

export function resultCards(r: StResult, v: ResultView): TemplateResult {
  return html`${shaperCard(r, v)}${beltsCard(r, v)}${vibrationsCard(r, v)}${axesMapCard(r, v)}${excitateCard(r, v)}`;
}
