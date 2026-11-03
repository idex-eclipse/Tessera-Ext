/**
 * The providers this plugin can embed, as data.
 *
 * A third tool (say, `pa_tester`'s own UI) is one more row here plus its i18n
 * strings: detection, address building, the switcher and the install
 * instructions are all driven by this table.
 *
 * Both providers are separate projects (AGPL-3.0). Nothing of theirs is copied
 * into this plugin: it only opens their web UI in an iframe and watches for
 * their G-code commands.
 */

export type ProviderId = 'autopa' | 'kapat';

export interface Provider {
  id: ProviderId;
  name: string;
  /** Location of the web UI on the printer's nginx site. Leading and trailing slash. */
  path: string;
  /** G-code command whose presence in `gcode/help` means "installed". */
  detectCommand: string;
  /** Name of the Klipper status object, if the extra publishes one (secondary hint). */
  objectName: string;
  repoUrl: string;
  /** `git clone` URL used in the install instructions. */
  cloneUrl: string;
  /** Directory `git clone` creates. */
  cloneDir: string;
  /** Section the user adds to printer.cfg. */
  section: string;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: 'autopa',
    name: 'autopa',
    path: '/autopa/',
    detectCommand: 'AUTOPA_SWEEP',
    objectName: 'autopa',
    repoUrl: 'https://github.com/G0BL1N/autopa',
    cloneUrl: 'https://github.com/G0BL1N/autopa.git',
    cloneDir: 'autopa',
    section: '[autopa]',
  },
  {
    id: 'kapat',
    name: 'KAPAT',
    path: '/kapat/',
    detectCommand: 'KAPAT_SWEEP',
    objectName: 'kapat',
    repoUrl: 'https://github.com/vzagranichnyy/KAPAT',
    cloneUrl: 'https://github.com/vzagranichnyy/KAPAT.git',
    cloneDir: 'KAPAT',
    section: '[kapat]',
  },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Commands that move the head, heat and extrude. The guard watches exactly
 * these: starting a sweep during a print would ruin it.
 */
export const GUARDED_COMMANDS: ReadonlySet<string> = new Set(['AUTOPA_SWEEP', 'AUTOPA_DECAY', 'KAPAT_SWEEP']);

/** First word of every G-code line of a script, upper-cased (comments skipped). */
export function scriptCommands(script: string): string[] {
  const out: string[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    out.push(line.split(/\s+/)[0]!.toUpperCase());
  }
  return out;
}
