# tessera-ext

[Русская версия](README.ru.md)

Registry of reviewed, optional plugins for [Tessera](https://github.com/idex-eclipse/Tessera),
the modular web UI for Klipper.

Nothing is built on the printer. Every plugin version is published here as a prebuilt
archive, and `registry/registry.json` records each archive's sha256. Tessera's plugin
manager downloads an archive, checks the hash and unpacks it into
`~/tessera/extensions/`.

## Plugins

| Plugin | Version | What it does | Needs |
|---|---|---|---|
| **Spoolman** (`tessera/spoolman`) | 0.1.0 | spool per tool on the dashboard, Spoolman page, pre-print check of material and remaining filament | Moonraker `[spoolman]`; for several extruders Klipper `[save_variables]` and `T0…Tn` macros |

## Installing a plugin

The plugin manager comes with Tessera. If Tessera is not installed yet, install it
first ([instructions](https://github.com/idex-eclipse/Tessera#installation)).

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
   ║  R) [Refresh]    │                                    ║
   ╟──────────────────┼────────────────────────────────────╢
   ║ Plugin API v1    │ Registry: idex-eclipse/Tessera-Ext ║
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

After an update, reload the UI page (F5): the browser keeps the old plugin code until
then. Removing a plugin deletes its files; also remove it in **Settings → Plugins** in
each browser where it was enabled.

## Trust

- Plugins run inside the Tessera page and get full access to the printer through
  Moonraker. This registry exists so that you install code someone has reviewed.
- The plugin manager refuses an archive if:
  - its sha256 does not match `registry.json`;
  - it contains symlinks, absolute paths or `..`;
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
| plugin is not in **Settings → Plugins** | press **Refresh**; if still missing, run `node ~/tessera/tools/extensions-sync.cjs` |
| plugin is installed but the UI shows the old version | reload the page (F5) |

## Other registries

`TESSERA_REGISTRY_URL` points the plugin manager at another `registry.json`: a fork, a
branch of this repository, or a local file for testing.

```bash
TESSERA_REGISTRY_URL=https://raw.githubusercontent.com/<you>/Tessera-Ext/<branch>/registry/registry.json tessera-ext
```

## For plugin authors

### Layout

```
registry/registry.json          index: id, dir, name, version, pluginApi, url, sha256, size
registry/<dir>-<version>.tar.gz archive: manifest.json + built files at its root
```

`url` is relative to `registry.json`, so archives are downloaded from the same place as
the index (raw.githubusercontent.com). No GitHub Releases are needed. `.gitattributes`
marks archives as binary: git must not change a single byte, or the sha256 check
fails.

### Publishing a version

1. Bump `version` in the plugin's `manifest.json`.
2. In the plugin folder inside a Tessera checkout (`Tessera/extensions/<plugin>`), run:

   ```bash
   npm run pack -- . <path-to>/tessera-ext/registry
   ```

   This builds the plugin, writes the archive and adds or replaces its entry in
   `registry.json`. The plugin's `pack` script calls Tessera's
   `tools/registry-pack.cjs`. The archive is reproducible: the same sources give the
   same sha256.
3. Check the delivery locally before pushing:

   ```bash
   TESSERA_EXTENSIONS_DIR=/tmp/ext-test \
   TESSERA_REGISTRY_URL=<path-to>/tessera-ext/registry/registry.json \
     node <path-to>/Tessera/tools/tessera-ext.cjs install <plugin>
   ```

4. Commit the new archive **together with** `registry.json`. Delete the old archive
   unless some printers should stay on that version.

How to build a plugin, and the host contract it must follow, are described in
[Tessera's plugin guide](https://github.com/idex-eclipse/Tessera/blob/main/docs/en/plugin-development.md).
