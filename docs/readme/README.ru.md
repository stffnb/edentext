<p align="center">
  <img src="../../public/favicon.svg" width="80" alt="">
</p>

<h1 align="center">
  <img src="../../public/EdenText.png" height="40" alt="EdenText">
</h1>

<p align="center">
  <strong>Полноценный текстовый процессор прямо в браузере</strong><br>
  Бесплатно · Открытый исходный код · Private by Design
</p>

<p align="center">
  <a href="https://github.com/stffnb/edentext/actions/workflows/ci.yml"><img src="https://github.com/stffnb/edentext/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="Лицензия: AGPL-3.0"></a>
  <a href="../../CHANGELOG.md"><img src="https://img.shields.io/github/package-json/v/stffnb/edentext" alt="Версия"></a>
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Статус: бета">
</p>

<p align="center">
  <a href="https://edentext.app"><strong>▶ Открыть EdenText</strong></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a> · <a href="README.el.md">Ελληνικά</a> · <b>Русский</b> · <a href="README.uk.md">Українська</a> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../hero-dark.webp">
  <img src="../hero-light.webp" alt="EdenText редактирует информационный бюллетень в две колонки, отмечены его возможности">
</picture>

---

EdenText — мощный текстовый процессор в браузере для всего: от быстрых заметок до целых книг. Без сервера и без учётной записи — вся обработка идёт локально, и документы никогда не покидают компьютер. Достаточно открыть ссылку или установить EdenText как приложение и работать офлайн. Для большинства языков при первом запуске загружается около 2 МБ, словари и шрифты подгружаются по мере необходимости[^1]. Интерфейс доступен на английском, немецком, испанском, французском, португальском, греческом, русском, украинском, японском и китайском (упрощённом и традиционном) языках.

> [!NOTE]
> EdenText пока в **бете** и активно развивается. Тесты и проверки обмена
> подтверждают его работу. Тем не менее на текущем этапе ошибки не исключены, поэтому храните
> резервные копии важных документов. Кроме того, браузер хранит три последние версии
> открытого документа на случай, если он не загрузится.
>
> **Нашли ошибку или документ выглядит не так, как надо?** Пожалуйста,
> [создайте issue](https://github.com/stffnb/edentext/issues), это очень помогает.
> Особенно ценны документы, которые в EdenText выглядят иначе, чем в Word, LibreOffice
> или WPS Office: приложите файл (или сокращённую копию), и он станет тестовым примером.

<a href="https://edentext.app"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../showcase/thesis-dark.png">
  <img src="../showcase/thesis.png" alt="EdenText редактирует диссертацию: нумерованные главы, формулы и колонтитул">
</picture></a>

## Возможности

- **Настоящая вёрстка страниц** — страницы A4/Letter, поля, колонтитулы, сноски,
  колонки, нумерация страниц и строк, водяные знаки; зеркальные поля и главы,
  начинающиеся с правой страницы, для книг
- **Открывает и сохраняет `.odt` и `.docx`**, экспортирует в PDF; шаблоны (`.ott`/`.dotx`)
  и галерея писем (DIN 5008); защищённые паролем файлы в обоих форматах
- **Совместимость с Word, LibreOffice и WPS Office** — документы сохраняют вёрстку;
  автоматические тесты обмена и вёрстки проверяют это по LibreOffice
- **Стили** — стили абзацев, символов, таблиц и списков с наследованием,
  нумерация глав
- **Таблицы** со стилями, сортировкой и формулами как в электронных таблицах
- **Всё, что нужно для диссертации** — оглавление, подписи, перекрёстные ссылки,
  цитаты и список литературы, алфавитный указатель, формулы (LaTeX)
- **Инструменты рецензирования** — отслеживание изменений и ветки комментариев
  с выносками на полях, сравнение и объединение с другим файлом, печать исправлений, проверка орфографии (английский,
  немецкий, испанский, французский, португальский, греческий, русский и украинский),
  синонимы (все эти языки, кроме греческого), проверка грамматики (английский)
- **Необязательный ИИ-ассистент** — с любым провайдером на выбор или локальной
  моделью; отвечает на вопросы о документе и редактирует его в режиме отслеживания
  изменений. Его можно отключить; запросы идут напрямую провайдеру, без сервера EdenText
- **Private by Design** — документы никогда не покидают компьютер, вся обработка идёт
  локально; после установки приложение работает офлайн. edentext.app считает анонимные
  посещения (GoatCounter, хостинг в ЕС, без cookie; собственные установки и настольное приложение ничего не считают); сам редактор ничего не отправляет,
  кроме запросов выбранному провайдеру при включённом ИИ-ассистенте. Документы
  автоматически сохраняются в браузере; в «Последних документах» можно настроить, чтобы
  закрытые документы удалялись при следующем запуске или вовсе не сохранялись.
  Приватное окно после закрытия не оставляет следов
- **Любой современный браузер** — в Chrome и Edge «Сохранить» записывает изменения
  в открытый файл, в Brave тоже — после включения
  `brave://flags/#file-system-access-api`; в остальных случаях каждое сохранение —
  это загрузка. Чтобы выбирать место сохранения, включите в настройках браузера
  «Всегда указывать место для скачивания»

Где браузер не позволяет EdenText в точности повторить Word или LibreOffice,
описано в разделе [Known limitations](../../CHANGELOG.md#known-limitations) (на английском).

## Галерея

Документы, по которым сделаны эти изображения, лежат в [`docs/showcase/`](../showcase/)
в форматах `.odt` и `.docx` — их можно сразу открыть в EdenText, LibreOffice или Word.
Они создаются скриптом `scripts/showcase/run.mjs`; фотографии принадлежат NASA, а книга —
Льюису Кэрроллу, всё это общественное достояние.

<table>
<tr>
<td width="50%" valign="top"><a href="../showcase/thesis-review.png"><img src="../showcase/thesis-review.png" alt="Отслеживание изменений и комментарии" width="100%"></a><br><b>Рецензирование</b> — отслеживание изменений, ветки комментариев на полях, водяной знак «черновик»</td>
<td width="50%" valign="top"><a href="../showcase/book-spread.png"><img src="../showcase/book-spread.png" alt="Книга на развороте" width="100%"></a><br><b>Книга</b> — A5 с зеркальными полями. Каждая глава начинается с правой страницы, в верхнем колонтитуле на левых страницах стоит название книги, на правых — название главы, а нумерация страниц начинается с первой главы</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="../showcase/newsletter.png"><img src="../showcase/newsletter.png" alt="Бюллетень в две колонки" width="100%"></a><br><b>Бюллетень</b> — колонки, изображения с подписями, врезка на полях</td>
<td width="50%" valign="top"><a href="../showcase/newsletter-tables.png"><img src="../showcase/newsletter-tables.png" alt="Таблицы с формулами" width="100%"></a><br><b>Таблицы</b> — стили таблиц и формулы как в электронных таблицах</td>
</tr>
</table>

## Настольное приложение

К каждому релизу также прилагаются неподписанные установщики, собранные на Electron:

- **macOS** — `EdenText-<version>-arm64.dmg` (Apple silicon) или `EdenText-<version>.dmg` (Intel).
  Перетащите приложение в «Программы». Поскольку оно не подписано, в первый раз откройте
  его через правый клик → «Открыть» или выполните `xattr -d com.apple.quarantine /Applications/EdenText.app`.
- **Windows** — `EdenText-Setup-<version>.exe`. SmartScreen предупредит о неизвестном
  издателе: «Подробнее» → «Выполнить в любом случае».
- **Linux** — `EdenText-<version>.AppImage` (`chmod +x`, затем запустить) или `.deb`
  (`sudo apt install ./edentext_*.deb`).

Настольное приложение открывает документы из файлового менеджера и сохраняет изменения
прямо в тот же файл, записывает PDF напрямую без диалога печати и при запуске сообщает о
выходе новой версии.

## Разработка

```bash
npm install
npm run dev      # dev-сервер с горячей перезагрузкой
npm test         # набор тестов
npm run build    # продакшен-сборка → dist/
cd desktop && npm install && npm start   # настольное приложение на той же сборке
```

Создано на Svelte 5, TypeScript, Vite и TipTap 3 (ProseMirror).

## Собственный хостинг

EdenText не нужен бэкенд, и он ничего не хранит на сервере; документы остаются в браузере.
Для каждого релиза публикуется образ контейнера (amd64 и arm64):

```bash
docker run -p 8080:80 ghcr.io/stffnb/edentext
```

Кроме того, к каждому релизу прилагается файл `edentext-<tag>.zip` с собранным
приложением; `npm run build` создаёт те же файлы в `dist/`. Эту папку можно разместить на
любом веб-сервере. Образ контейнера можно также собрать локально командой
`docker build -t edentext .`.
Для Kubernetes в [`charts/edentext`](../../charts/edentext) есть Helm-чарт, поддерживаемый сообществом.

При обновлении скопируйте новые файлы поверх старых, не очищая папку заранее. Вкладки,
открытые до обновления, продолжают загружать файлы своей версии, пока их не перезагрузят.
На запрос отсутствующего файла сервер должен отвечать 404, а не `index.html`, чтобы такие
вкладки могли предложить перезагрузку.

Рекомендуем размещать EdenText по HTTPS. По обычному HTTP редактор тоже работает, но
браузеры тогда отключают некоторые функции: работу офлайн, установку в виде приложения,
сохранение прямо в открытый файл (вместо этого он скачивается) и кнопки копирования. На
localhost всё работает так же, как по HTTPS.

## Архитектура

```mermaid
flowchart TD
  Browser[Браузер: локальное приложение, работающее офлайн] --> App[Оболочка приложения и интерфейс на Svelte]
  App --> Editor[Редактор TipTap / ProseMirror]
  Editor <--> Document[Структурированный документ и расширения редактора]
  Document --> Layout[Стили, вёрстка страниц, разбивка на страницы и врезки]
  Document <--> Storage[localStorage: документы, настройки и резервные копии]
  Document <--> Interchange[Импорт и экспорт ODT и DOCX]
  Interchange --> Files[Файловые API браузера, загрузки и шаблоны]
  Editor --> Tools[Орфография, грамматика, формулы и рецензирование]
  Layout --> Render[Редактируемые страницы в браузере]
```

EdenText работает целиком в браузере: `App.svelte` строит интерфейс вокруг модели
документа TipTap и её расширений. Стили и вёрстка превращают эту модель в редактируемые
страницы; хранилище держит локальное состояние и резервные копии. Импорт и экспорт
переводят ту же модель в ODT и DOCX, а файловые API браузера сохраняют или загружают
полученные файлы. Подробнее о форматах и вёрстке — в
[архитектурной документации](../architecture/) (на английском).

## Участие в разработке

Будем рады вашему участию — см. [CONTRIBUTING.md](../../CONTRIBUTING.md) (на английском). Для слияния
нужно подписать [CLA](../../CLA.md); это автоматически проверяется в каждом pull request.

### Участники

Спасибо всем, кто помог идеями, сообщениями об ошибках, тестированием и отзывами. Помимо участников, указанных на GitHub, хочу также поблагодарить:

Patrick R., [@Deleh](https://github.com/Deleh), [@lukasmwerner](https://github.com/lukasmwerner), [@JinJieBeWater](https://github.com/JinJieBeWater), [@farragoo](https://github.com/farragoo), [@sbvelinga](https://github.com/sbvelinga)

<p>
<a href="https://github.com/stffnb"><img src="https://github.com/stffnb.png?size=96" width="48" alt="@stffnb"/></a>
<a href="https://github.com/Camthalion77"><img src="https://github.com/Camthalion77.png?size=96" width="48" alt="@Camthalion77"/></a>
<a href="https://github.com/ehrensperger-niklas"><img src="https://github.com/ehrensperger-niklas.png?size=96" width="48" alt="@ehrensperger-niklas"/></a>
<a href="https://github.com/farragoo"><img src="https://github.com/farragoo.png?size=96" width="48" alt="@farragoo"/></a>
<a href="https://github.com/blairhoddinott"><img src="https://github.com/blairhoddinott.png?size=96" width="48" alt="@blairhoddinott"/></a>
<a href="https://github.com/Deleh"><img src="https://github.com/Deleh.png?size=96" width="48" alt="@Deleh"/></a>
<a href="https://github.com/lukasmwerner"><img src="https://github.com/lukasmwerner.png?size=96" width="48" alt="@lukasmwerner"/></a>
<a href="https://github.com/JinJieBeWater"><img src="https://github.com/JinJieBeWater.png?size=96" width="48" alt="@JinJieBeWater"/></a>
<a href="https://github.com/sbvelinga"><img src="https://github.com/sbvelinga.png?size=96" width="48" alt="@sbvelinga"/></a>
</p>

## Лицензия

Copyright © 2026 Steffen Becker · Сделано в Германии

[AGPL-3.0](../../LICENSE). Если AGPL не подходит, есть
[коммерческая лицензия](../../LICENSE.commercial.md). Входящие в комплект шрифты и языковые
данные сохраняют свои лицензии — см. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

*EdenText — независимый проект, не связанный с Microsoft или The Document Foundation.
Форматы `.docx` и `.odt` поддерживаются для совместимости.*

*Это перевод английского [README](../../README.md); при расхождениях действует английская версия.*

[^1]: Объём передачи по сети в сжатом виде: ~1,0 МБ кода приложения, остальное — модуль
    проверки орфографии со словарём языка браузера и шрифты, которые показывает страница;
    греческий и украинский словари добавляют ~2,5 и ~1,5 МБ. Всё остальное загружается
    при первой необходимости и сохраняется для работы офлайн; все шрифты, словари
    и тезаурусы вместе занимают ~18 МБ, а с проверкой грамматики английского — ~26 МБ.
