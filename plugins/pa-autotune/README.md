# Tessera plugin: PA Autotune

[Русская версия](README.ru.md)

Optional Tessera plugin that puts the web UIs of two Klipper Pressure Advance auto-calibration
modules into the core *Calibrations* page: **[autopa](https://github.com/G0BL1N/autopa)** and
**[KAPAT](https://github.com/vzagranichnyy/KAPAT)**. Both measure Pressure Advance with a load
cell in the nozzle and ship their own web UI. The plugin finds out which of them is installed on
the printer and shows its UI in an `<iframe>` in a **PA Autotune** tab. Written in
[Lit](https://lit.dev), like the Pressure Advance tester plugin.

| Surface | What it does |
|---|---|
| Extension of `@core/calibrations#tabs` (tab, append) | the installed provider's web UI in an iframe; a switcher when both are installed; installation instructions when neither is |
| Overlay (empty) | keeps the plugin api available to the guard from app start |
| Guard `printer.gcode.script` | `AUTOPA_SWEEP`, `AUTOPA_DECAY` and `KAPAT_SWEEP` from other plugins (the Tessera console, macros) are refused while printing or paused |

The tab is **always** in Calibrations. Without a provider it explains how to install each of them
(clone, `install.sh`, the `[autopa]` / `[kapat]` section, a full Klipper restart) and links to
the repositories.

## Requirements

- Klipper with `autopa` and/or `kapat` installed from their repositories, and a load cell
  (`[load_cell]` or `[load_cell_probe]`) in the nozzle. Their installers also put the web UI on an
  nginx site (`/autopa/`, `/kapat/`).
- Tessera with plugin API **0.8** or newer and `@core/calibrations` 3.0.0 or newer.

Nothing of the providers is copied into the plugin (both are AGPL-3.0): it only embeds their UI
and watches for their G-code commands.

## Which provider is shown

1. Installed providers are found by their command in Klipper's G-code help: `AUTOPA_SWEEP` means
   autopa, `KAPAT_SWEEP` means KAPAT. The `autopa` / `kapat` objects in `objects/list` are a
   second hint. The check runs when the tab opens, after a Klipper restart and on **Check again**.
2. One provider is shown at once. With two, a switcher appears; the last choice is remembered per
   printer (`api.settings`). By default autopa comes first.
3. None: the instructions for both.

## Where the web UI is

The iframe is a direct connection from the browser to the provider's site, not to Moonraker's
proxy. Both installers add `/autopa/` or `/kapat/` to the **first nginx site they find** — it may
be the Tessera site (port 8000 by default) or the Mainsail/Fluidd site (port 80). So the plugin
tries, in order:

1. the address you typed (**Address** button; saved per printer and provider, used as is);
2. `<this page's origin>/autopa/`;
3. `<printer host>/autopa/` on the default port of the page's scheme.

A candidate counts as found when:

- it is on the same origin as Tessera and returns a page that differs from the site's root (Tessera's
  own nginx may answer unknown paths with its `index.html`);
- it is on another origin and answers at all. The browser hides the status of such an answer, so a
  404 there cannot be told from a working UI: if the frame stays empty, type the right address.

If nothing answers, the tab lists what it tried.

**HTTPS.** A Tessera page opened over HTTPS cannot embed an HTTP page. The tab says so and offers
**Open in a new tab**. The same fallback helps when your nginx forbids framing
(`X-Frame-Options`, `Content-Security-Policy`); the provider installers do not set those headers.

**KAPAT live graph.** KAPAT's graph connects straight to `:7125/klippysocket`, past nginx. Tessera
proxies `/websocket` only, so behind a reverse proxy that does not forward port 7125 the KAPAT UI
works but its graph stays empty. This is not fixed here.

## Guard

The guard refuses `AUTOPA_SWEEP`, `AUTOPA_DECAY` and `KAPAT_SWEEP` typed in the Tessera console (or
sent by macros of other plugins) while a print is running or paused. It does not look at homing or
temperature: both modules heat and move by their own settings. It asks for no confirmation. If the
printer state cannot be read, the command is let through: Klipper still rejects what it cannot do.

Sweeps started **inside the provider's web UI** (our iframe) go straight to Moonraker and are not
seen by any Tessera guard. The tab says so.

## Development

The sources live in the registry repository, `Tessera-Ext/plugins/pa-autotune/`. Clone Tessera next
to it (`TESSERA_ROOT` overrides the layout for the build and `pack`):

```
…/Tessera/                          host (dev server, plugin-sdk types, registry-pack.cjs)
…/Tessera-Ext/plugins/pa-autotune/  this plugin
```

```bash
npm install
npm run dev        # vite build --watch → dist/ and Tessera/extensions/pa-autotune/
npm test           # detection, addresses, selection, guard + host contract test
npm run typecheck
```

In Tessera, run `node tools/extensions-sync.cjs` once so the catalog lists the plugin. Then
Settings → Plugins → Install "PA Autotune", and F5 after code changes.

A third tool is one more row in `src/providers.ts` plus its strings in `src/i18n/`.

## Publishing

Bump `version` in `manifest.json`, run `npm run pack` (builds and writes
`registry/pa-autotune-<version>.tar.gz` and its `registry.json` entry), run
`node scripts/verify-registry.mjs` in the repository root, commit sources, archive and
`registry.json` together.

## How it plugs into Tessera

| File | Integration point |
|---|---|
| `manifest.json` | `extensions[]`: point `@core/calibrations#tabs`, kind `tab`, no `available` (always shown); `pluginApi: "0.8"` |
| `src/ui/autotune-tab.ts` | the contribution itself: states none / one / several providers, iframe, address field |
| `src/providers.ts` | the providers as data: command, path, repository, install steps |
| `src/detect.ts` | `printer.gcode.help` + `printer.objects.list` → installed providers |
| `src/url.ts` | address candidates, probing, mixed-content check |
| `src/selection.ts` | which provider is shown first; settings keys |
| `src/guard.ts` | own guard; own requests skip own guards |
