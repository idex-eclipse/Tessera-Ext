# tessera-ext

[English version](README.md)

Реестр проверенных необязательных плагинов для [Tessera](https://github.com/idex-eclipse/Tessera) —
модульного веб-интерфейса для Klipper.

На принтере ничего не собирается. Каждая версия плагина лежит здесь готовым архивом,
а `registry/registry.json` хранит sha256 каждого архива. Менеджер расширений Tessera
скачивает архив, сверяет хеш и распаковывает его в `~/tessera/extensions/`.

## Плагины

| Плагин | Версия | Что делает | Что нужно |
|---|---|---|---|
| **Spoolman** (`tessera/spoolman`) | 0.1.0 | катушка на каждый инструмент на дашборде, страница Spoolman, проверка материала и остатка филамента перед печатью | `[spoolman]` в Moonraker; для нескольких экструдеров — `[save_variables]` в Klipper и макросы `T0…Tn` |

## Установка плагина

Менеджер расширений входит в Tessera. Если Tessera ещё не установлен, сначала
установите его ([инструкция](https://github.com/idex-eclipse/Tessera/blob/main/README.ru.md#installation)).

1. На принтере откройте менеджер расширений: `tessera-ext` или `tessera` → **E) Extensions**.

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

2. Выберите **1) Install**, затем номер плагина, нажмите Enter.
3. В интерфейсе Tessera откройте **Settings → Plugins**, нажмите **Refresh**, затем
   **Install** у плагина (с бейджем *Проверен*). Плагины включаются в каждом браузере
   отдельно, как и остальные настройки Tessera.

То же без меню:

```bash
tessera-ext install spoolman     # короткое имя или полный id: tessera/spoolman
tessera-ext list                 # плагины реестра и что установлено
```

## Обновление и удаление

| Задача | В меню | Командой |
|---|---|---|
| обновить один плагин | **2) Update** → номер | `tessera-ext update spoolman` |
| обновить всё | **2) Update** → **A) Update all** | `tessera-ext update --all` |
| удалить плагин | **3) Remove** → номер → `y` | `tessera-ext remove spoolman` |

После обновления перезагрузите страницу UI (F5): до этого браузер использует старый
код плагина. Удаление стирает файлы плагина; уберите его и в **Settings → Plugins** в
каждом браузере, где он был включён.

## Доверие

- Плагины работают внутри страницы Tessera и получают полный доступ к принтеру через
  Moonraker. Реестр нужен для того, чтобы вы ставили код, который кто-то проверил.
- Менеджер расширений отказывается ставить архив, если:
  - sha256 не совпадает с `registry.json`;
  - внутри есть симлинки, абсолютные пути или `..`;
  - `id`/`version` в манифесте отличаются от записи реестра;
  - плагину нужна более новая версия plugin API, чем у вашего Tessera.
- Архив распаковывается в скрытую временную папку и подменяется разом, поэтому
  неудачное обновление оставляет рабочей прежнюю версию.

## Если что-то не так

| Симптом | Причина и решение |
|---|---|
| `tessera-ext: command not found` | Tessera установлен до появления меню: `bash ~/tessera/deploy/install.sh` → **2) Update** (создаст команду) или `bash ~/tessera/deploy/install-ext.sh` |
| `Registry: unreachable` в меню | нет интернета или GitHub недоступен. **R) Refresh** — повторить; удалять плагины можно и офлайн |
| `sha256 mismatch` | архив и `registry.json` из разных коммитов. Сообщите об этом и не ставьте |
| плагина нет в **Settings → Plugins** | нажмите **Refresh**; если всё равно нет — `node ~/tessera/tools/extensions-sync.cjs` |
| плагин обновлён, а в UI старая версия | перезагрузите страницу (F5) |

## Другие реестры

`TESSERA_REGISTRY_URL` указывает менеджеру расширений другой `registry.json`: форк,
ветку этого репозитория или локальный файл для проверки.

```bash
TESSERA_REGISTRY_URL=https://raw.githubusercontent.com/<вы>/Tessera-Ext/<ветка>/registry/registry.json tessera-ext
```

## Для авторов плагинов

### Структура

```
registry/registry.json          индекс: id, dir, name, version, pluginApi, url, sha256, size
registry/<dir>-<version>.tar.gz архив: manifest.json + собранные файлы в корне
```

`url` указан относительно `registry.json`, поэтому архивы скачиваются оттуда же, откуда
индекс (raw.githubusercontent.com). GitHub Releases не нужны. `.gitattributes` помечает
архивы как бинарные: git не должен менять в них ни байта, иначе проверка sha256 не
пройдёт.

### Публикация версии

1. Поднимите `version` в `manifest.json` плагина.
2. В папке плагина внутри Tessera (`Tessera/extensions/<плагин>`) выполните:

   ```bash
   npm run pack -- . <путь>/tessera-ext/registry
   ```

   Скрипт соберёт плагин, запишет архив и добавит или заменит его запись в
   `registry.json`. Скрипт `pack` плагина вызывает `tools/registry-pack.cjs` из
   Tessera. Архив воспроизводим: те же исходники дают тот же sha256.
3. Перед отправкой проверьте доставку локально:

   ```bash
   TESSERA_EXTENSIONS_DIR=/tmp/ext-test \
   TESSERA_REGISTRY_URL=<путь>/tessera-ext/registry/registry.json \
     node <путь>/Tessera/tools/tessera-ext.cjs install <плагин>
   ```

4. Закоммитьте новый архив **вместе с** `registry.json`. Старый архив удалите, если
   на нём не должны оставаться какие-то принтеры.

Как собрать плагин и какой контракт с хостом он должен соблюдать — в
[руководстве по плагинам Tessera](https://github.com/idex-eclipse/Tessera/blob/main/docs/ru/plugin-development.md).
