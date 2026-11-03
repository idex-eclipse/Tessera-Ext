/**
 * English strings. The host merges `locales` into ONE shared dictionary, so
 * everything lives under the plugin's own namespace `paautotune.*`.
 * `{name}` placeholders are filled by api.i18n.t(key, params).
 */
export default {
  paautotune: {
    tabTitle: 'PA Autotune',
    title: 'PA Autotune',
    common: {
      loading: 'Looking for installed providers…',
      noPrinter: 'No active printer',
      klipperNotReady: 'Cannot ask the printer which providers are installed. Is Klipper ready?',
    },
    none: {
      title: 'No Pressure Advance autotune provider found',
      intro:
        'This tab embeds the web UI of autopa or KAPAT: both measure Pressure Advance with a load cell in the nozzle. Neither is installed on this printer (AUTOPA_SWEEP and KAPAT_SWEEP are not known to Klipper). Install one of them:',
      noLoadCell: 'No [load_cell] or [load_cell_probe] in the printer config. Both providers need a load cell in the nozzle.',
      recheck: 'Check again',
      checking: 'Checking…',
      repo: 'Repository',
      stepClone: 'On the printer, download it:',
      stepInstall: 'Run the installer:',
      stepConfig:
        'Add the {section} section to printer.cfg (options: see the repository README) and, in [extruder], max_extrude_cross_section: 200.',
      stepRestart:
        'Restart Klipper completely: sudo systemctl restart klipper. The RESTART command is not enough for a new module.',
      stepCheck: 'Press “Check again”: the tab shows the provider as soon as Klipper knows its command.',
    },
    provider: {
      autopa: 'Sweeps extrusion and builds Pressure Advance profiles per material and temperature (AUTOPA_SWEEP).',
      kapat: 'Searches the K / Pressure Advance value by grid or bisection (KAPAT_SWEEP) and applies it.',
    },
    frame: {
      reload: 'Reload',
      openTab: 'Open in a new tab',
      address: 'Address',
      addressLabel: 'Address of the web UI',
      addressPlaceholder: 'http://printer.local{path}',
      save: 'Save',
      reset: 'Reset',
      custom: 'your address',
      resolving: 'Looking for the web UI of {name}…',
      unreachableTitle: 'The web UI of {name} does not answer',
      unreachableBody:
        'Tried: {tried}. The installer puts it on the first nginx site it finds, which may be on another port than Tessera. Check that the web UI of the provider opens in the browser and, if its address differs, type it in “Address”.',
      mixedTitle: 'The browser blocks this address',
      mixedBody:
        'Tessera is opened over HTTPS, the web UI of {name} over HTTP: browsers do not embed HTTP pages into HTTPS ones. Open it in a new tab, or serve it over HTTPS too.',
      hint: 'If the frame stays empty, the address is wrong or the site forbids embedding. Use “Open in a new tab” then.',
      kapatChart:
        'KAPAT draws its live graph over a direct connection to port 7125 (/klippysocket). Behind a reverse proxy that does not forward it, the rest of the UI works but the graph stays empty.',
      guardNote:
        'Sweeps started inside this web UI go straight to Moonraker: the print-time protection of Tessera applies only to commands typed in the Tessera console.',
    },
    guard: {
      printing: 'A Pressure Advance sweep is not allowed while printing.',
    },
  },
};
