# Tessera plugin: Obico

[Русская версия](README.ru.md)

Optional Tessera plugin for [Obico](https://www.obico.io) (AI failure detection and remote
access). Written in [Lit](https://lit.dev).

It works on two levels:

- **Through Moonraker only.** Works with **Obico Cloud** and a **self-hosted** server. The
  **Obico** tab of the core *Machine* page (`@core/system#tabs`) shows the link, the
  `moonraker-obico` service and its log, and the Obico tunnel.
- **Through the Obico server API.** Needs a **self-hosted** server and an access token. This
  level adds the failure probability, alerts, statistics and the reaction settings.

  The Obico server sends no CORS headers, so the browser cannot call it directly. Every API
  request goes through Tessera's service proxy (`api.services`, plugin API 0.13), which keeps
  the token on the printer. Obico Cloud has no personal tokens, so the API level is not
  available there.

## Requirements

- Tessera with plugin API **0.13** or newer and `@core/system` **4.0.0** or newer, with the
  `tessera-ext` service enabled. It is on by default. A Tessera installed before 0.13 needs
  one `tessera update` on the printer.
- [moonraker-obico](https://www.obico.io/docs/user-guides/klipper-setup/) installed on the
  printer. Without it the tab only says how to install it.
- For the API level: a self-hosted Obico server and an access token.

## Setting up the API

1. Open `http://<your Obico server>/admin/oauth2_provider/accesstoken/add/` in the admin of
   your server. The **Open the token page** link in the tab leads there.
2. Fill in the form:
   - **User**: your user;
   - **Token**: a long random string;
   - **Expires**: a far date;
   - **Scope**: `read write`.
3. Save.
4. In Tessera open *Machine* → **Obico** → **Obico API**. Enter the server address (prefilled
   from `moonraker-obico.cfg`) and the token, then press **Save**.

The same in a terminal on the printer: `tessera-ext service set obico obico http://<server>`. It
asks for the token.

The token is stored on the printer in `~/.config/tessera/services/`, readable by the owner
only. It is never sent back to the browser: the tab only shows that a token is saved.

## What it adds

| Where | What |
| --- | --- |
| *Machine* → **Obico** tab | **Moonraker:** link state, link code and link page, **Open in Obico**, **Re-link**; the `moonraker-obico` service, **Restart** and the end of its log; where the Obico tunnel leads and the `[tunnel]` lines that make it open Tessera. **API:** server and token; reaction settings of this printer (watching on or off, pause or only alert, sensitivity, retract and Z lift on pause, hotends and bed off on pause); the latest Obico events of this printer |
| Widget **Failure detection** | the latest frame Obico analysed and Obico's semicircular gauge under it (green below 33 %, yellow up to 67 %, red above; grey with the reason when Obico does not watch); the card header has the **Do not watch this print** switch |
| Widget **Obico stats** | 7 days, 30 days or 12 months, for this printer or all printers of the account: prints, finished, cancelled, print hours, filament; alerts, real failures, false alarms, not answered |
| Quick access chip **Obico** | the failure probability of the active printer in its zone colour, an eye that lights up while Obico watches and turns red while an alert waits; a click opens the tab |
| Alert window | on every page, when a printer of this Tessera has an alert nobody answered. It sends a critical notification and shows the frame, the gauge and the file. **Not a failure**: resumes the print if Obico paused it, and can also stop watching the rest of the print. **Cancel print**: asks once more. **Later**: closes the window for now. Pause, resume and cancel go through Moonraker, so Tessera's guards see them; the verdict is recorded in Obico, which learns from it |
| Fleet card | the gauge of each printer, a red line and the **Obico alert** fleet filter tag while an alert waits |
| Print banner | **Obico: stop watching**: mutes failure detection for the rest of the current print |

The plugin asks the server once per poll for all printers of the account: every 10 s while a
printer of this Tessera prints, every 60 s otherwise. That stays well inside the server limit
of 3600 requests per hour. A Tessera printer is matched to its Obico printer by the id
moonraker-obico writes into the Moonraker database.

## Where the data comes from

| What | Source |
| --- | --- |
| Server, link token (only whether it is set), log path, tunnel | `moonraker-obico.cfg` in the config folder, read through Moonraker's file API |
| Link code and link state | Klipper macro `OBICO_LINK_STATUS` (from `moonraker_obico_macros.cfg`, which the installer includes) |
| Re-link | Klipper macro `_OBICO_RELINK` |
| Printer id on the Obico server | Moonraker database, `obico` / `printer_id` |
| Service state, restart | `machine.system_info`, `machine.services.restart` (the service must be in `moonraker.asvc`) |
| Probability, frame, alerts, reaction settings | Obico `api/v1/printers/` (and `PATCH`), `acknowledge_alert`, `mute_current_print`, `media/…` |
| Statistics | Obico `api/v1/prints/stats/` and `api/v1/prints/` |
| Events | Obico `api/v1/printer_events/` |

The plugin never shows or sends the agent's own auth token.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run dev    # rebuilds into <Tessera>/extensions/obico/ on every change
npm run pack   # builds and publishes the archive into ../../registry/
```
