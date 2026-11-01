<p align="center">
  <img src="../../public/favicon.svg" width="80" alt="">
</p>

<h1 align="center">
  <img src="../../public/EdenText.png" height="40" alt="EdenText">
</h1>

<p align="center">
  <strong>Повноцінний текстовий процесор просто в браузері</strong><br>
  Безкоштовно · Відкритий код · Private by Design
</p>

<p align="center">
  <a href="https://github.com/stffnb/edentext/actions/workflows/ci.yml"><img src="https://github.com/stffnb/edentext/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="../../LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="Ліцензія: AGPL-3.0"></a>
  <a href="../../CHANGELOG.md"><img src="https://img.shields.io/github/package-json/v/stffnb/edentext" alt="Версія"></a>
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Статус: бета">
</p>

<p align="center">
  <a href="https://edentext.app"><strong>▶ Відкрити EdenText</strong></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> · <a href="README.de.md">Deutsch</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a> · <a href="README.el.md">Ελληνικά</a> · <a href="README.ru.md">Русский</a> · <b>Українська</b> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../hero-dark.webp">
  <img src="../hero-light.webp" alt="EdenText редагує бюлетень у дві колонки, позначено його можливості">
</picture>

---

EdenText — потужний текстовий процесор у браузері для всього: від швидких нотаток до цілих книжок. Без сервера й без облікового запису — усе обробляється локально, і документи ніколи не залишають комп’ютера. Досить відкрити посилання або встановити EdenText як застосунок і працювати офлайн. Для більшості мов під час першого запуску завантажується близько 2 МБ, а словники й шрифти довантажуються за потреби[^1]. Інтерфейс доступний англійською, німецькою, іспанською, французькою, португальською, грецькою, російською, українською, японською та китайською (спрощеною й традиційною) мовами.

> [!NOTE]
> EdenText поки що в **беті** й активно розвивається. Тести й перевірки обміну
> підтверджують його роботу. Проте на цьому етапі помилки не виключені, тож зберігайте резервні копії важливих документів. Крім того, браузер зберігає три
> останні версії відкритого документа на випадок, якщо він не завантажиться.
>
> **Знайшли помилку або документ виглядає не так, як має?** Будь ласка,
> [створіть issue](https://github.com/stffnb/edentext/issues), це дуже допомагає.
> Особливо цінні документи, які в EdenText виглядають інакше, ніж у Word, LibreOffice чи
> WPS Office: додайте файл (або скорочену копію), і він стане тестовим прикладом.

<a href="https://edentext.app"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../showcase/thesis-dark.png">
  <img src="../showcase/thesis.png" alt="EdenText редагує дисертацію: нумеровані розділи, формули й колонтитул">
</picture></a>

## Можливості

- **Справжня верстка сторінок** — сторінки A4/Letter, поля, колонтитули, виноски, колонки,
  нумерація сторінок і рядків, водяні знаки; для книжок — дзеркальні поля й розділи, що
  починаються з правої сторінки
- **Відкриває та зберігає `.odt` і `.docx`**, експортує в PDF; шаблони (`.ott`/`.dotx`)
  і галерея листів (DIN 5008); захищені паролем файли в обох форматах
- **Сумісність із Word, LibreOffice і WPS Office** — документи зберігають верстку;
  автоматичні тести обміну й верстки перевіряють це за LibreOffice
- **Стилі** — стилі абзаців, символів, таблиць і списків зі спадкуванням, нумерація розділів
- **Таблиці** зі стилями, сортуванням і формулами, як в електронних таблицях
- **Усе для дипломної роботи чи дисертації** — зміст, підписи, перехресні посилання,
  цитування й список літератури, предметний покажчик, формули (LaTeX)
- **Рецензування** — відстеження змін і гілки коментарів у виносках на полях, порівняння й об’єднання з іншим файлом, друк
  виправлень, перевірка орфографії (англійська, німецька, іспанська, французька,
  португальська, грецька, російська та українська), синоніми (усі ці мови, крім
  грецької), перевірка граматики (англійська)
- **Необов’язковий ШІ-асистент** — з будь-яким провайдером на вибір або локальною моделлю;
  відповідає на запитання про документ і редагує його з відстеженням змін. Його можна
  вимкнути; запити йдуть безпосередньо до провайдера, без сервера EdenText
- **Private by Design** — документи ніколи не залишають комп’ютера, усе обробляється
  локально; після встановлення застосунок працює офлайн. edentext.app рахує анонімні відвідування
  (GoatCounter, хостинг у ЄС, без cookie; власні встановлення та настільний застосунок нічого не рахують); сам редактор нічого не надсилає, окрім запитів
  до обраного провайдера, коли ввімкнено ШІ-асистента. Документи автоматично зберігаються
  в браузері; в «Останніх документах» можна налаштувати, щоб закриті документи видалялися
  під час наступного запуску або взагалі не зберігалися. Приватне вікно після закриття не
  залишає слідів
- **Будь-який сучасний браузер** — у Chrome і Edge «Зберегти» записує зміни у відкритий
  файл, у Brave теж — після ввімкнення `brave://flags/#file-system-access-api`; в інших
  випадках кожне збереження — це завантаження. Щоб обирати місце, увімкніть у
  налаштуваннях браузера «Запитувати, де зберігати кожен файл перед завантаженням»

Де браузер не дає EdenText точно відтворити Word чи LibreOffice, описано в розділі
[Known limitations](../../CHANGELOG.md#known-limitations) (англійською).

## Галерея

Документи, з яких зроблено ці зображення, лежать у [`docs/showcase/`](../showcase/)
у форматах `.odt` і `.docx` — їх можна одразу відкрити в EdenText, LibreOffice чи Word.
Їх створює скрипт `scripts/showcase/run.mjs`; фотографії належать NASA, а книжка —
Льюїсу Керроллу, усе це суспільне надбання.

<table>
<tr>
<td width="50%" valign="top"><a href="../showcase/thesis-review.png"><img src="../showcase/thesis-review.png" alt="Відстеження змін і коментарі" width="100%"></a><br><b>Рецензування</b> — відстеження змін, гілки коментарів на полях, водяний знак «чернетка»</td>
<td width="50%" valign="top"><a href="../showcase/book-spread.png"><img src="../showcase/book-spread.png" alt="Книжка на розвороті" width="100%"></a><br><b>Книжка</b> — A5 із дзеркальними полями. Кожен розділ починається з правої сторінки, у верхньому колонтитулі на лівих сторінках стоїть назва книжки, на правих — назва розділу, а нумерація сторінок починається з першого розділу</td>
</tr>
<tr>
<td width="50%" valign="top"><a href="../showcase/newsletter.png"><img src="../showcase/newsletter.png" alt="Бюлетень у дві колонки" width="100%"></a><br><b>Бюлетень</b> — колонки, зображення з підписами, бічна врізка</td>
<td width="50%" valign="top"><a href="../showcase/newsletter-tables.png"><img src="../showcase/newsletter-tables.png" alt="Таблиці з формулами" width="100%"></a><br><b>Таблиці</b> — стилі таблиць і формули, як в електронних таблицях</td>
</tr>
</table>

## Настільний застосунок

До кожного релізу також додаються непідписані інсталятори, зібрані на Electron:

- **macOS** — `EdenText-<version>-arm64.dmg` (Apple Silicon) або `EdenText-<version>.dmg` (Intel).
  Перетягніть застосунок у «Програми». Оскільки він не підписаний, уперше відкрийте його
  через правий клік → «Відкрити» або виконайте `xattr -d com.apple.quarantine /Applications/EdenText.app`.
- **Windows** — `EdenText-Setup-<version>.exe`. SmartScreen попередить про невідомого
  видавця: «Докладніше» → «Усе одно запустити».
- **Linux** — `EdenText-<version>.AppImage` (`chmod +x`, потім запустіть) або `.deb`
  (`sudo apt install ./edentext_*.deb`).

Настільний застосунок відкриває документи з файлового менеджера й зберігає зміни просто в
той самий файл, записує PDF напряму без діалогу друку й під час запуску повідомляє про
вихід нової версії.

## Розробка

```bash
npm install
npm run dev      # dev-сервер із гарячим перезавантаженням
npm test         # набір тестів
npm run build    # продакшн-збірка → dist/
cd desktop && npm install && npm start   # настільний застосунок на тій самій збірці
```

Створено на Svelte 5, TypeScript, Vite і TipTap 3 (ProseMirror).

## Власний хостинг

EdenText не потребує бекенду й нічого не зберігає на сервері; документи залишаються в
браузері. Для кожного релізу публікується образ контейнера (amd64 і arm64):

```bash
docker run -p 8080:80 ghcr.io/stffnb/edentext
```

Крім того, до кожного релізу додається файл `edentext-<tag>.zip` зі зібраним застосунком;
`npm run build` створює ті самі файли в `dist/`. Цю теку можна розмістити на будь-якому
вебсервері. Образ контейнера можна також зібрати локально командою
`docker build -t edentext .`.
Для Kubernetes у [`charts/edentext`](../../charts/edentext) є Helm-чарт, який підтримує спільнота.

Під час оновлення скопіюйте нові файли поверх старих, не очищаючи теку заздалегідь.
Вкладки, відкриті до оновлення, і далі завантажують файли своєї версії, доки їх не
перезавантажать. На запит відсутнього файлу сервер має відповідати 404, а не `index.html`,
щоб такі вкладки могли запропонувати перезавантаження.

Радимо розміщувати EdenText через HTTPS. Через звичайний HTTP редактор теж працює, але
браузери тоді вимикають деякі функції: роботу офлайн, встановлення як застосунку,
збереження просто у відкритий файл (натомість він завантажується) і кнопки копіювання. На
localhost усе працює так само, як через HTTPS.

## Архітектура

```mermaid
flowchart TD
  Browser[Браузер: локальний застосунок, що працює офлайн] --> App[Оболонка застосунку й інтерфейс на Svelte]
  App --> Editor[Редактор TipTap / ProseMirror]
  Editor <--> Document[Структурований документ і розширення редактора]
  Document --> Layout[Стилі, верстка, розбиття на сторінки й рамки]
  Document <--> Storage[localStorage: документи, налаштування й резервні копії]
  Document <--> Interchange[Імпорт та експорт ODT і DOCX]
  Interchange --> Files[Файлові API браузера, завантаження й шаблони]
  Editor --> Tools[Орфографія, граматика, формули й рецензування]
  Layout --> Render[Сторінки в браузері, які можна редагувати]
```

EdenText працює повністю в браузері: `App.svelte` будує інтерфейс навколо моделі
документа TipTap та її розширень. Стилі й верстка перетворюють цю модель на сторінки,
які можна редагувати; сховище тримає локальний стан і резервні копії. Імпорт та експорт
перекладають ту саму модель у ODT і DOCX, а файлові API браузера зберігають або
завантажують отримані файли. Докладніше про формати й верстку — в
[архітектурній документації](../architecture/) (англійською).

## Участь у розробці

Внески вітаються — див. [CONTRIBUTING.md](../../CONTRIBUTING.md) (англійською). Для злиття
потрібно підписати [CLA](../../CLA.md); це автоматично перевіряється в кожному pull request.

### Подяки

Дякую всім, хто допоміг ідеями, повідомленнями про помилки, тестуванням і відгуками. Окрім учасників, зазначених на GitHub, хочу також подякувати:

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

## Ліцензія

Copyright © 2026 Steffen Becker · Зроблено в Німеччині

[AGPL-3.0](../../LICENSE). Якщо AGPL не підходить, є
[комерційна ліцензія](../../LICENSE.commercial.md). Шрифти й мовні дані з комплекту зберігають
власні ліцензії — див. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

*EdenText — незалежний проєкт, не пов’язаний із Microsoft чи The Document Foundation.
Формати `.docx` і `.odt` підтримуються для сумісності.*

*Це переклад англійського [README](../../README.md); у разі розбіжностей чинною є англійська версія.*

[^1]: Обсяг передачі мережею в стиснутому вигляді: ~1,0 МБ коду застосунку, решта —
    перевірка орфографії зі словником мови браузера та шрифти, які показує сторінка;
    грецький і український словники додають ~2,5 і ~1,5 МБ. Усе інше завантажується,
    щойно знадобиться, і зберігається для роботи офлайн; усі шрифти, словники й тезауруси
    разом займають ~18 МБ, а з перевіркою граматики англійської — ~26 МБ.
