# tessera-ext

[English version](README.md)

Реестр проверенных необязательных плагинов для [Tessera](https://github.com/idex-eclipse/Tessera) —
модульного веб-интерфейса для Klipper.

Каждый плагин опубликован здесь дважды: исходники в `plugins/<имя>/` и готовый архив
на каждую версию в `registry/`. `registry/registry.json` хранит sha256 каждого
архива. На принтере ничего не собирается: менеджер расширений Tessera скачивает
архив, сверяет хеш и распаковывает его в `~/tessera/extensions/`.

## Плагины

| Плагин | Версия | Что делает | Что нужно |
|---|---|---|---|
| [**Spoolman**](plugins/spoolman/README.md) (`tessera/spoolman`) | 0.1.0 | катушка на каждый инструмент на дашборде, страница Spoolman, проверка материала и остатка филамента перед печатью | `[spoolman]` в Moonraker; для нескольких экструдеров — `[save_variables]` в Klipper и макросы `T0…Tn` |

## Установка плагина

Менеджер расширений входит в Tessera. Если Tessera ещё не установлен, сначала
установите его ([инструкция](https://github.com/idex-eclipse/Tessera/blob/main/README.ru.md#installation)).

Проще всего поставить плагин в интерфейсе: **Settings → Plugins → Реестр плагинов** →
**Install**. Плагин сразу включится в этом браузере; в других браузерах его включают
кнопкой **Install** в каталоге.

То же в терминале:

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
   ║  S) [Settings]   │                                    ║
   ║  R) [Refresh]    │                                    ║
   ╟──────────────────┼────────────────────────────────────╢
   ║ Branch: main     │ Registry: idex-eclipse/Tessera-Ext ║
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

В интерфейсе те же действия — кнопки **Update** и **Remove** в **Settings → Plugins →
Реестр плагинов**. Плагины, положенные вручную, через интерфейс не заменяются и не удаляются.

После обновления перезагрузите страницу UI (F5): до этого браузер использует старый
код плагина. Удаление стирает файлы плагина. **Remove** в интерфейсе сразу убирает плагин
и из этого браузера; в остальных браузерах, а также после `tessera-ext remove`, уберите
его в **Settings → Plugins**.

## Доверие

- Плагины работают внутри страницы Tessera и получают полный доступ к принтеру через
  Moonraker. Реестр нужен для того, чтобы вы ставили код, который кто-то проверил.
- Менеджер расширений отказывается ставить архив, если:
  - sha256 не совпадает с `registry.json`;
  - внутри есть симлинки, абсолютные пути или `..`;
  - он распаковывается больше чем в 100 МБ или 5000 записей;
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
| плагина нет в **Settings → Plugins** | нажмите **Refresh**; если всё равно нет — `tessera-ext sync` |
| в **Settings → Plugins** нет блока «Реестр плагинов» | выключена служба установки: `tessera` → **S) Settings** → **3) Plugins from UI**. Проверка: `systemctl status tessera-ext.socket`. Без неё плагины ставятся через `tessera-ext` |
| плагин обновлён, а в UI старая версия | перезагрузите страницу (F5) |

## Ветки и другие реестры

Менеджер расширений читает `registry/registry.json` из ветки **main** этого
репозитория. Чтобы попробовать ещё не выпущенные плагины, переключите ветку:

- в меню: **S) Settings** → **1) [Branch]**. Менеджер покажет ветки с GitHub, выберите
  номером или именем;
- или командой: `tessera-ext branch dev` (`tessera-ext branch` показывает текущую и
  доступные ветки).

Выбор сохраняется в `~/.config/tessera/tessera-ext.conf` и виден внизу главного меню.
Он не зависит от ветки самого Tessera, которая задаётся в меню `tessera`. Уже
установленные плагины после переключения продолжают работать. Меню Update покажет,
какие из них отличаются от выбранной ветки, в том числе более старые версии.

Только на один запуск: `TESSERA_EXT_BRANCH=dev tessera-ext`.

`TESSERA_REGISTRY_URL` указывает менеджеру любой другой `registry.json`: форк или
локальный файл для проверки. Переменная главнее ветки, в меню отображается
`Branch: custom`.

```bash
TESSERA_REGISTRY_URL=https://raw.githubusercontent.com/<вы>/Tessera-Ext/<ветка>/registry/registry.json tessera-ext
```

## Для авторов плагинов

### Структура

```
plugins/<имя>/                  исходники плагина: package.json, manifest.json, src/, тесты
registry/registry.json          индекс: id, dir, name, version, pluginApi, url, sha256, size
registry/<dir>-<version>.tar.gz архив: manifest.json + собранные файлы в корне
```

Исходники и архивы лежат в одном репозитории: любой может пересобрать архив из
`plugins/<имя>/` того же коммита и получить тот же sha256. Архив воспроизводим: записи
отсортированы, время и владелец обнулены.

`url` указан относительно `registry.json`, поэтому архивы скачиваются оттуда же,
откуда индекс (raw.githubusercontent.com). GitHub Releases не нужны. `.gitattributes`
помечает архивы как бинарные: git не должен менять в них ни байта, иначе проверка
sha256 не пройдёт.

### Разработка

Склонируйте Tessera рядом с этим репозиторием — плагины берут оттуда типы SDK,
упаковщик и dev-сервер:

```
…/Tessera/
…/Tessera-Ext/
```

```bash
cd Tessera-Ext/plugins/spoolman
npm install
npm run dev        # пересборка при изменениях, результат копируется в Tessera/extensions/spoolman/
npm test
```

Запустите dev-сервер Tessera (`npm run dev` в `Tessera/`) и один раз выполните там
`node tools/extensions-sync.cjs` — плагин появится в **Settings → Plugins**.
`TESSERA_ROOT=/путь/к/Tessera` переопределяет соседнее расположение для скриптов
сборки. Полный пример — [плагин Spoolman](plugins/spoolman/README.md).

### Публикация версии

1. Поднимите `version` в `manifest.json` плагина.
2. В папке плагина выполните `npm run pack`. Скрипт соберёт плагин и запишет архив и
   его запись в `registry/` этого репозитория. Он использует
   `tools/registry-pack.cjs` из Tessera.
3. Перед отправкой проверьте доставку локально (из папки Tessera):

   ```bash
   TESSERA_EXTENSIONS_DIR=/tmp/ext-test \
   TESSERA_REGISTRY_URL=../Tessera-Ext/registry/registry.json \
     python3 deploy/tessera-ext.py install <плагин>
   ```

   Нужен Python 3.7 или новее; на Windows команда называется `python`.

4. Закоммитьте исходники, новый архив и `registry.json` **вместе**. Старый архив
   удалите, если на нём не должны оставаться какие-то принтеры.

CI (`.github/workflows/verify.yml`) на каждый push и pull request запускает тесты плагина,
пересобирает его из исходников и сверяет результат с архивом и `registry.json`. Та же
проверка локально, из корня репозитория: `node scripts/verify-registry.mjs --rebuild`.

Чтобы сначала проверить выпуск на своих принтерах, опубликуйте его в ветке (например,
`dev`) и переключите эти принтеры на неё: `tessera-ext branch dev`.

Как собрать плагин и какой контракт с хостом он должен соблюдать — в
[руководстве по плагинам Tessera](https://github.com/idex-eclipse/Tessera/blob/main/docs/ru/plugin-development.md).
