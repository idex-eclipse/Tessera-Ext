# tessera-ext

[Русская версия](README.ru.md)

Registry of reviewed, optional plugins for [Tessera](https://github.com/idex-eclipse/Tessera),
the modular web UI for Klipper.

Every plugin is published here twice: its sources in `plugins/<name>/` and a prebuilt
archive per version in `registry/`. `registry/registry.json` records each archive's
sha256. Nothing is built on the printer: Tessera's plugin manager downloads an
archive, checks the hash and unpacks it into `~/tessera/extensions/`.

## Plugins

| Plugin | Version | What it does | Needs |
|---|---|---|---|
| [**Spoolman**](plugins/spoolman/README.md) (`tessera/spoolman`) | 0.1.0 | spool per tool on the dashboard, Spoolman page, pre-print check of material and remaining filament | Moonraker `[spoolman]`; for several extruders Klipper `[save_variables]` and `T0…Tn` macros |
| [**Shake&Tune**](plugins/shaketune/README.md) (`tessera/shaketune`) | 0.1.3 | Klippain Shake&Tune in the Input Shaper tab of Calibrations: tests with their parameters, recommended shapers with Apply, belts, vibrations, axes map, graphs | Klipper `[shaketune]` (Shake&Tune v4+), `[resonance_tester]` and an accelerometer |
| [**Pressure Advance tester**](plugins/pa-tester/README.md) (`tessera/pa-tester`) | 0.3.0 | Klipper `pa_tester` in a Pressure Advance tab of Calibrations: `TEST_PRESSURE_ADVANCE` / `PA_CALIBRATE` with their parameters, result, live load cell graph | Klipper `[pa_tester]` (generic-cartesian branch of the dmbutyugin fork), NumPy and a load cell; Tessera with plugin API 0.9 |
| [**PA Autotune**](plugins/pa-autotune/README.md) (`tessera/pa-autotune`) | 0.1.0 | web UI of [autopa](https://github.com/G0BL1N/autopa) / [KAPAT](https://github.com/vzagranichnyy/KAPAT) in a PA Autotune tab of Calibrations: picks the installed provider, switcher for both, installation instructions when neither is installed | Klipper `autopa` and/or `kapat` with a load cell in the nozzle; their web UI on nginx; Tessera with plugin API 0.8 |

## Installing a plugin

The plugin manager comes with Tessera. If Tessera is not installed yet, install it
first ([instructions](https://github.com/idex-eclipse/Tessera#installation)).

The easiest way is in the UI: **Settings → Plugins → Plugin registry** → **Install**. The
plugin is enabled in this browser at once; other browsers enable it with **Install** in the
catalog.

The same in a terminal:

1. On the printer, open the plugin manager: `tessera-ext`, or `tessera` → **E) Extensions**.

   ```
   ╔═══════════════════════════════════════════════════════╗
   ║ ~~~~~~~~~~~~~~~~~~~ [ Main Menu ] ~~~~~~~~~~~~~~~~~~~ ║
   ╟──────────────────┬────────────────────────────────────╢
   ║                  │                                    ║
   ║  1) [Install]    │ Spoolman: Not installed            ║
   ║  2) [Update]     │                                    ║
   ║  3) [Remove]     │                                    ║
   ║                  │                                    ║
   ║  S) [Settings]   │                                    ║
   ║  R) [Refresh]    │                                    ║
   ╟──────────────────┼────────────────────────────────────╢
   ║ Branch: main     │ Registry: idex-eclipse/Tessera-Ext ║
   ╟──────────────────┴────────────────────────────────────╢
   ║                        Q) Quit                        ║
   ╚═══════════════════════════════════════════════════════╝
   ###### Perform action:
   ```

2. Choose **1) Install**, then the plugin's number, and press Enter.
3. In the Tessera UI open **Settings → Plugins**, press **Refresh**, then **Install**
   next to the plugin (marked *Verified*). Plugins are enabled per browser, like any
   other Tessera setting.

The same without the menu:

```bash
tessera-ext install spoolman     # short name or full id: tessera/spoolman
tessera-ext list                 # registry plugins and what is installed
```

## Updating and removing

| Task | Menu | Command |
|---|---|---|
| update one plugin | **2) Update** → number | `tessera-ext update spoolman` |
| update everything | **2) Update** → **A) Update all** | `tessera-ext update --all` |
| remove a plugin | **3) Remove** → number → `y` | `tessera-ext remove spoolman` |

In the UI the same actions are the **Update** and **Remove** buttons in **Settings →
Plugins → Plugin registry**. Plugins put in place by hand cannot be replaced or deleted there.

After an update, reload the UI page (F5): the browser keeps the old plugin code until
then. Removing a plugin deletes its files. **Remove** in the UI also removes it from this
browser at once; in other browsers, and after `tessera-ext remove`, remove it in
**Settings → Plugins**.

## Trust

- Plugins run inside the Tessera page and get full access to the printer through
  Moonraker. This registry exists so that you install code someone has reviewed.
- The plugin manager refuses an archive if:
  - its sha256 does not match `registry.json`;
  - it contains symlinks, absolute paths or `..`;
  - it unpacks to more than 100 MB or 5000 entries;
  - its manifest `id`/`version` differs from the registry entry;
  - it needs a newer plugin API than your Tessera provides.
- Archives are unpacked into a hidden staging folder and swapped in at once, so a failed
  update leaves the previous version working.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `tessera-ext: command not found` | Tessera was installed before the menu existed: run `bash ~/tessera/deploy/install.sh` → **2) Update** (creates the command), or use `bash ~/tessera/deploy/install-ext.sh` |
| `Registry: unreachable` in the menu | no internet, or GitHub is unavailable. **R) Refresh** retries; removing plugins works offline |
| `sha256 mismatch` | the archive and `registry.json` come from different commits. Report it; do not install |
| plugin is not in **Settings → Plugins** | press **Refresh**; if still missing, run `tessera-ext sync` |
| no "Plugin registry" block in **Settings → Plugins** | the install service is off: `tessera` → **S) Settings** → **3) Plugins from UI**. To check: `systemctl status tessera-ext.socket`. Without it, plugins are installed with `tessera-ext` |
| plugin is installed but the UI shows the old version | reload the page (F5) |

## Branches and other registries

The plugin manager reads `registry/registry.json` from the **main** branch of this
repository. To try plugins that are not released yet, switch the branch:

- in the menu: **S) Settings** → **1) [Branch]**. It lists the branches on GitHub; pick
  one by number or name;
- or with a command: `tessera-ext branch dev` (`tessera-ext branch` shows the current
  one and the available ones).

The choice is saved in `~/.config/tessera/tessera-ext.conf` and shown at the bottom of
the main menu. It is independent of the Tessera branch, which is set in the `tessera`
menu. Plugins already installed keep working after a switch. The Update menu shows
which ones differ from the selected branch, older versions included.

For one run only: `TESSERA_EXT_BRANCH=dev tessera-ext`.

`TESSERA_REGISTRY_URL` points the plugin manager at any other `registry.json`: a fork,
or a local file for testing. It overrides the branch, and the menu shows
`Branch: custom`.

```bash
TESSERA_REGISTRY_URL=https://raw.githubusercontent.com/<you>/Tessera-Ext/<branch>/registry/registry.json tessera-ext
```

## For plugin authors

### Layout

```
plugins/<name>/                 plugin sources: package.json, manifest.json, src/, tests
registry/registry.json          index: id, dir, name, version, pluginApi, url, sha256, size
registry/<dir>-<version>.tar.gz archive: manifest.json + built files at its root
```

Sources and archives live in the same repository: anyone can rebuild an archive from
`plugins/<name>/` at the same commit and get the same sha256. The archive is
reproducible: entries are sorted, timestamps and owners are zeroed.

`url` is relative to `registry.json`, so archives are downloaded from the same place
as the index (raw.githubusercontent.com). No GitHub Releases are needed.
`.gitattributes` marks archives as binary: git must not change a single byte, or the
sha256 check fails.

### Development

Clone Tessera next to this repository; plugins take the SDK types, the packer and
the dev server from there:

```
…/Tessera/
…/Tessera-Ext/
```

```bash
cd Tessera-Ext/plugins/spoolman
npm install
npm run dev        # rebuilds on change and copies the result to Tessera/extensions/spoolman/
npm test
```

Run Tessera's dev server (`npm run dev` in `Tessera/`) and run
`node tools/extensions-sync.cjs` there once. The plugin then appears in
**Settings → Plugins**. `TESSERA_ROOT=/path/to/Tessera` overrides the sibling layout
for the build scripts. See [the Spoolman plugin](plugins/spoolman/README.md) as a
complete example.

### Publishing a version

1. Bump `version` in the plugin's `manifest.json`.
2. In the plugin folder run `npm run pack`. It builds the plugin and writes the archive
   and its entry into this repository's `registry/`. It uses Tessera's
   `tools/registry-pack.cjs`.
3. Check the delivery locally before pushing (from the Tessera folder):

   ```bash
   TESSERA_EXTENSIONS_DIR=/tmp/ext-test \
   TESSERA_REGISTRY_URL=../Tessera-Ext/registry/registry.json \
     python3 deploy/tessera-ext.py install <plugin>
   ```

   This needs Python 3.7 or newer; on Windows the command is `python`.

4. Commit the sources, the new archive and `registry.json` **together**. Delete the
   old archive unless some printers should stay on that version.

CI (`.github/workflows/verify.yml`) runs the plugin's tests on every push and pull request,
rebuilds it from the sources and compares the result with the archive and `registry.json`.
The same check locally, from the repository root: `node scripts/verify-registry.mjs --rebuild`.

To test a release on printers first, publish it on a branch (for example `dev`) and
switch those printers to it: `tessera-ext branch dev`.

How to build a plugin, and the host contract it must follow, are described in
[Tessera's plugin guide](https://github.com/idex-eclipse/Tessera/blob/main/docs/en/plugin-development.md).
