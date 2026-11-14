# Tessera plugin: Shake&Tune

Optional Tessera plugin for [Klippain Shake&Tune](https://github.com/Frix-x/klippain-shaketune).
It is the reference **extension plugin**: its main UI does not get a page of its own —
it replaces the **Input Shaper** tab of the core *Calibrations* plugin through the
extension point `@core/calibrations#shaper`. It is written in [Lit](https://lit.dev)
(the Spoolman plugin is Preact, the core is Svelte), so it also shows that the
extension contract is framework-independent.

| Surface | What it does |
|---|---|
| Extension of `@core/calibrations#shaper` (tab, alternative) | Shake&Tune commands with their parameters, live progress, parsed results (recommended shapers with Apply, belts similarity, vibrations profile, axes map), and the graphs from `ShakeTune_results` |
| Overlay (empty) | keeps the plugin api available to the guard from app start |
| Guard `printer.gcode.script` | Shake&Tune commands from other plugins (console, macros) are refused while printing or with axes not homed |

## Requirements

- Shake&Tune v4 or newer installed in Klipper: the `[shaketune]` section in
  `printer.cfg` (and `[resonance_tester]` + an accelerometer, as Shake&Tune needs).
- `result_folder` inside `~/printer_data/config` (the default) — Moonraker serves graphs
  only from its roots.

## How it appears

Calibrations declares the point `shaper` in mode `alternative` with
`default: 'extension'`. On a printer with `[shaketune]` the plugin's `available` export
returns true and the host shows Shake&Tune in the Input Shaper tab at once. Right-click
the tab (long press on touch) to open the host's chooser and switch to Klipper's own
content and back; the choice is stored per printer. On a printer without `[shaketune]`
nothing changes.

## Commands

| Button | Command | Results folder |
|---|---|---|
| Input shaper | `AXES_SHAPER_CALIBRATION` | `input_shaper/` |
| Belts | `COMPARE_BELTS_RESPONSES` (CoreXY / CoreXZ) | `belts/` |
| Vibrations | `CREATE_VIBRATIONS_PROFILE` | `vibrations/` |
| Axes map | `AXES_MAP_CALIBRATION` | `axes_map/` |
| Excitate axis | `EXCITATE_AXIS_AT_FREQ` | `static_freq/` |

Only the parameters you fill in are sent; empty ones use Shake&Tune's defaults or your
`[resonance_tester]`. **Apply** sends `SET_INPUT_SHAPER` (lost on restart, and
`SAVE_CONFIG` does not keep it); **Copy for printer.cfg** gives the `[input_shaper]`
block to paste.

Shake&Tune has no status object, so everything is read from the console: live from
`notify_gcode_response`, and from `server.gcode_store` when the tab is opened during a
run that was started elsewhere (console, macro, another client, before a page reload).

## Development

The sources live in the registry repository, `Tessera-Ext/plugins/shaketune/`. Clone
Tessera next to it; the build and the type check expect this layout:

```
…/Tessera/                       host (dev server, plugin-sdk types, registry-pack.cjs)
…/Tessera-Ext/plugins/shaketune/ this plugin
```

`TESSERA_ROOT=/path/to/Tessera` overrides the location for the build and `pack`
scripts. `tsconfig.json` always uses the sibling path.

```bash
npm install
npm run dev        # vite build --watch → dist/ and Tessera/extensions/shaketune/
npm test           # parser, commands, guard, run state + host contract test
npm run typecheck
```

In Tessera, run `node tools/extensions-sync.cjs` once so the catalog lists the plugin.
Then Settings → Plugins → Install "Shake&Tune", and F5 after code changes.

## Publishing

Same as the Spoolman plugin: bump `version` in `manifest.json`, run `npm run pack`
(builds and writes `registry/shaketune-<version>.tar.gz` and its `registry.json` entry),
check the delivery with `deploy/tessera-ext.py install shaketune`, commit sources,
archive and `registry.json` together. The plugin extends only a core point, so its
registry entry needs no `requires`.

`pluginApi` in `manifest.json` is `"1.0"`: the plugin uses printer-bound Moonraker
and settings handles. An older Tessera refuses to install the plugin.

## How it plugs into Tessera

| File | Integration point |
|---|---|
| `manifest.json` | `extensions[]`: point address, kind `tab`, contract `version`, `available` export |
| `src/base-element.ts` | Custom Element ↔ Lit: `api`/`params` as reactive properties, lazy upgrade, why shadow DOM is fine for an extension (theme tokens inherit, `contextmenu` is composed) |
| `src/availability.ts` | `available(api, params)`: what makes the alternative "on by default when installed" |
| `src/ui/st-tab.ts` | the contribution itself: what kind `tab` + mode `alternative` mean for us |
| `src/ui/st-controller.ts` | Lit ReactiveController: Moonraker subscriptions bound to the element's lifetime and the active printer |
| `src/run-store.ts` | why run state lives at module level (the host unmounts the tab whenever the user leaves it) |
| `src/parse.ts` | Shake&Tune's console output → results; run boundaries; history restore |
| `src/guard.ts` | own guard for commands the core guard does not know; own requests skip own guards |
| `src/ui/bridge.ts` | the empty always-mounted overlay that hands the api to the guard |
| `src/ui/styles.ts` | host theme tokens in a shadow root; why the lightbox is a native `<dialog>` and the help a `[popover]` (top layer) |
| `src/index.ts` | named exports the host reads: `locales`, `hasShakeTune`, `guardShakeTune` |
