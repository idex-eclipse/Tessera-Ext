# tessera-ext

Registry of reviewed plugins for [Tessera](https://github.com/idex-eclipse/Tessera).

The printer never builds anything. Every plugin is published here as a prebuilt
archive, and `registry/registry.json` records each archive's sha256. Tessera's CLI
downloads an archive, checks the hash and unpacks it into `~/tessera/extensions/`.

| Plugin | Version | What it does |
|---|---|---|
| `tessera/spoolman` | 0.1.0 | Spoolman integration: spool per tool, pre-print filament check, Spoolman page |

## Install a plugin on the printer

```bash
node ~/tessera/tools/tessera-ext.cjs list
node ~/tessera/tools/tessera-ext.cjs install tessera/spoolman
```

Then in the UI go to Settings → Plugins → Refresh → Install.

Other commands: `update --all`, `update <id>`, `remove <id>`. The CLI reads
`https://raw.githubusercontent.com/idex-eclipse/tessera-ext/main/registry/registry.json`.
Set `TESSERA_REGISTRY_URL` to use another registry: a fork, a branch, or a local file.

## Layout

```
registry/registry.json          index: id, dir, version, url, sha256, size, pluginApi
registry/<dir>-<version>.tar.gz archive: manifest.json + built files at its root
```

`url` is relative to `registry.json`, so the archives are downloaded from the same
place as the index (raw.githubusercontent.com). No releases are needed.

## Publish a plugin version

1. Bump `version` in the plugin's `manifest.json`.
2. In the plugin folder, inside a Tessera checkout (`Tessera/extensions/<plugin>`), run:

   ```bash
   npm run pack -- . <path-to>/tessera-ext/registry
   ```

   This builds the plugin, writes the archive and adds or replaces its entry in
   `registry.json`. The archive is reproducible: the same sources give the same sha256.
3. Commit the new archive and `registry.json`. Delete the old archive, unless some
   printers should stay on that version.

Archives must contain only regular files and folders. The CLI rejects symlinks,
absolute paths and `..`, as well as an archive whose manifest `id`/`version` does not
match its registry entry.
