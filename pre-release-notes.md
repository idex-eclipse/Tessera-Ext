# Pre-release notes

## English

- **Macro Builder 0.1.4** — `C`, `M`, `Alt+C`, and `L` insert command, macro call, condition, and loop blocks after the last edit. The next block enters a newly added condition or loop. Shortcuts work with Russian keyboard layouts and leave text fields alone. Update the plugin through the registry and reload the UI.

- **Macro Builder 0.1.3** — new comment blocks begin with `#`; variable command blocks use short toolbox previews and expand to editable templates on the canvas. Command fields open with a caret instead of full selection, and Config suggestions appear as soon as the caret reaches a value after `=`. Update the plugin through the registry and reload the UI.

- **Macro Builder 0.1.2** — the editor fills the screen and its Blockly canvas, toolbox, scrollbars, and fields follow Tessera's light, dark, and high-contrast themes, including live changes. Update the plugin through the registry and reload the UI.

- **Macro Builder 0.1.1** — all matching macros, variables, commands, and other suggestions remain available in a scrollable list. Update the plugin through the registry and reload the UI.

- **Macro Builder command parsing and variable hints** — inline Jinja now stays in command blocks, including `SET_GCODE_VARIABLE` and `SAVE_VARIABLE`. Macro, variable, and typed `VALUE=` suggestions come from Config's completion source.

- **Macro Builder 0.1.0** — optional visual editor for Config 4.1.0. Builds and edits Klipper macros with expanding fields, multiline Jinja blocks, local `variable_*` options, and `SET_GCODE_VARIABLE`/`SAVE_VARIABLE` blocks. Config supplies contextual completion. Untouched Jinja and whitespace stay exact; Apply uses Config's undoable unsaved buffer. Install after updating Tessera, then reload the UI.

## Русский

- **Macro Builder 0.1.4** — `C`, `M`, `Alt+C` и `L` вставляют команду, вызов макроса, условие и цикл после последней правки. Следующий блок попадает внутрь нового условия или цикла. Клавиши работают при русской раскладке и не мешают вводу текста. Обновите плагин через реестр и перезагрузите UI.

- **Macro Builder 0.1.3** — новые блоки комментариев начинаются с `#`; команды переменных занимают меньше места в панели блоков и раскрываются в редактируемые шаблоны на поле. Поле команды открывается с кареткой без выделения всего текста, а подсказки Config появляются сразу после установки каретки за `=`. Обновите плагин через реестр и перезагрузите UI.

- **Macro Builder 0.1.2** — редактор открывается на весь экран; поле Blockly, панель блоков, полосы прокрутки и поля ввода используют светлую, тёмную и контрастную тему Tessera, включая переключение без закрытия. Обновите плагин через реестр и перезагрузите UI.

- **Macro Builder 0.1.1** — все подходящие макросы, переменные, команды и другие подсказки доступны в прокручиваемом списке. Обновите плагин через реестр и перезагрузите UI.

- **Команды с Jinja и подсказки переменных** — Jinja внутри строки остаётся в командном блоке, включая `SET_GCODE_VARIABLE` и `SAVE_VARIABLE`. Имена макросов, переменных и типизированные подсказки после `VALUE=` поступают из автодополнения Config.

- **Macro Builder 0.1.0** — необязательный визуальный редактор для Config 4.1.0. Создаёт и правит макросы Klipper блоками с расширяемыми полями, многострочным Jinja, локальными `variable_*` и командами `SET_GCODE_VARIABLE`/`SAVE_VARIABLE`. Контекстные подсказки поступают из Config. Неизменённые Jinja и пробелы сохраняются точно; применение идёт в буфер Config с возможностью отмены. Установите после обновления Tessera и перезагрузите UI.
