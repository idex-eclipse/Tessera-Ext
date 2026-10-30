# Tessera plugin: Spoolman

Optional Tessera plugin for [Spoolman](https://github.com/Donkie/Spoolman). It is also
the reference **remote plugin**: it is written in Preact + signals, not Svelte, so it
exercises the bare Custom Element contract. Nothing in it relies on the SDK wrapper
`defineMpuElement`.

| Surface | What it does |
|---|---|
| Page **Spoolman** | Spoolman web UI in an iframe |
| Widget **Spools** | spool per tool of the active printer: colour, vendor/name, material, remaining weight; *Change* opens the picker |
| Overlay + guard `printer.print.start` | before a print starts, checks the file against the loaded spools |

## Requirements

- Moonraker with the `[spoolman]` section (`server: http://…:7912`).
- Multi-tool printers: Klipper `[save_variables]` and tool macros `[gcode_macro T0]`,
  `[gcode_macro T1]`, …

## Pre-print check

The guard runs when **any** Tessera plugin starts a print. Prints started from other
clients (Mainsail, Fluidd, the printer screen) are not checked. The guard looks at
the file metadata from Moonraker and at the spool in every tool the file uses. It
opens a dialog when:

- a tool has no spool;
- the material differs (`filament_type` vs the spool's material; case and spaces are
  ignored, `PLA+` ≠ `PLA`);
- the spool has less filament than the file needs. Weight is compared when the file
  reports it per tool or for the only tool used; otherwise length is compared;
- Spoolman could not be asked (down, slow, misconfigured).

Otherwise the print starts without a dialog. In the dialog the user can change spools,
which re-runs the check, start anyway, or cancel. A printer without `[spoolman]` in
Moonraker is never checked.

## Spools per tool

Moonraker knows **one** active spool, the one it reports filament usage to. Per-tool
spools are stored in Klipper, not in the browser, so every client and every browser
sees the same assignment:

```
save_variables:  t0__spool_id = 12, t1__spool_id = 7, active_tool = 1
```

This is the same convention as Tessera's core *Tools* widget. Choosing a spool in the
plugin runs `SAVE_VARIABLE VARIABLE=t<n>__spool_id VALUE=<id>`. If that tool is the
active one, it also switches Moonraker's active spool. A single-tool printer without
`T<n>` macros just uses Moonraker's active spool.

To have filament usage booked to the right spool, the tool-change macros must switch
the active spool:

```ini
[gcode_macro SET_ACTIVE_SPOOL]
gcode:
  {% if params.ID %}
    {action_call_remote_method("spoolman_set_active_spool", spool_id=params.ID|int)}
  {% else %}
    {action_call_remote_method("spoolman_set_active_spool", spool_id=None)}
  {% endif %}

[gcode_macro T0]
gcode:
  # … your tool change …
  SAVE_VARIABLE VARIABLE=active_tool VALUE=0
  {% set sid = printer.save_variables.variables.t0__spool_id|default(none) %}
  {% if sid %} SET_ACTIVE_SPOOL ID={sid} {% endif %}
```

`active_tool` is optional. It tells the plugin which tool prints right now, so
changing that tool's spool also switches Moonraker's active spool.

## Development

The sources live in the registry repository, `Tessera-Ext/plugins/spoolman/`. Clone
Tessera next to it; the build and the type check expect this layout:

```
…/Tessera/                      host (dev server, plugin-sdk types, registry-pack.cjs)
…/Tessera-Ext/plugins/spoolman/ this plugin
```

`TESSERA_ROOT=/path/to/Tessera` overrides the location for the build and `pack`
scripts. `tsconfig.json` always uses the sibling path.

```bash
npm install
npm run dev        # vite build --watch → dist/ and Tessera/extensions/spoolman/
npm test           # check / parsing logic + host contract test
npm run typecheck
```

In Tessera, run `node tools/extensions-sync.cjs` once so the catalog lists the
plugin. Then `npm run dev` → Settings → Plugins → Install "Spoolman", and F5 after
code changes.

`dist/` is exactly what a printer receives: `manifest.json` (`"entry": "index.js"`)
and `index.js`. Host types come from Tessera's `plugin-sdk/src/types.ts` as
`import type`, so no host code ends up in the bundle.

## Publishing

1. Bump `version` in `manifest.json`.
2. Run `npm run pack`. It builds the plugin and runs Tessera's `tools/registry-pack.cjs`,
   which writes `registry/spoolman-<version>.tar.gz` in this repository and the
   entry in `registry/registry.json` with its sha256. The archive is reproducible:
   the same sources give the same sha256.
3. Check the delivery locally (from the Tessera folder):

   ```bash
   TESSERA_EXTENSIONS_DIR=/tmp/ext-test \
   TESSERA_REGISTRY_URL=../Tessera-Ext/registry/registry.json \
     node tools/tessera-ext.cjs install spoolman
   ```

4. Commit the sources, the archive and `registry.json` together.

## How it plugs into Tessera

| File | Integration point |
|---|---|
| `src/element.ts` | Custom Element ↔ Preact adapter: the host sets `api` and `params` before `connectedCallback`, and `params` may change on a live element |
| `src/api-ref.ts` | why guards take `api` from module state: the host passes it only to elements |
| `src/guard.ts` | `allow` / `freeze` → `api.guards.resume(token, …)`, the 10-second decision limit, and why the handler never throws |
| `src/tracker.ts` | state of every printer for `ctx.targetPrinterId`, through `api.moonrakerFor` and `onPrintersChange` |
| `src/moonraker.ts` | Spoolman through `server.spoolman.proxy`: no CORS and no second address |
| `src/ui/Overlay.tsx` | always-mounted overlay: renders nothing while closed |
| `src/index.ts` | named exports the host reads: `locales`, `pageIcons`, guard handler |
