import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// One fixed secure origin keeps localStorage across launches and lets the
// File System Access API run, so saveFile.ts needs no desktop branch.
const ORIGIN = 'app://edentext';
const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : fileURLToPath(new URL('../dist', import.meta.url));

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// The native dialogs follow the system language, mapped like the app's first-run locale
// (resolveBrowserLocale). app.getLocale() is only filled once the app is ready.
const TEXT = {
  en: { discard: 'Discard unsaved changes?', discardButtons: ['Discard', 'Cancel'], available: (v) => `EdenText ${v} is available.`, installed: (v) => `You have ${v}.`, updateButtons: ['Download', 'Later', 'Skip This Version'], menu: ['About %', 'Hide %', 'Hide Others', 'Show All', 'Quit %', 'Edit', 'Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All', 'Window', 'Minimize', 'Zoom', 'Close'] },
  de: { discard: 'Ungespeicherte Änderungen verwerfen?', discardButtons: ['Verwerfen', 'Abbrechen'], available: (v) => `EdenText ${v} ist verfügbar.`, installed: (v) => `Installiert ist ${v}.`, updateButtons: ['Herunterladen', 'Später', 'Diese Version überspringen'], menu: ['Über %', '% ausblenden', 'Andere ausblenden', 'Alle einblenden', '% beenden', 'Bearbeiten', 'Widerrufen', 'Wiederholen', 'Ausschneiden', 'Kopieren', 'Einsetzen', 'Alles auswählen', 'Fenster', 'Im Dock ablegen', 'Zoomen', 'Schließen'] },
  es: { discard: '¿Descartar los cambios sin guardar?', discardButtons: ['Descartar', 'Cancelar'], available: (v) => `EdenText ${v} está disponible.`, installed: (v) => `Versión instalada: ${v}.`, updateButtons: ['Descargar', 'Más tarde', 'Omitir esta versión'], menu: ['Acerca de %', 'Ocultar %', 'Ocultar otros', 'Mostrar todo', 'Salir de %', 'Edición', 'Deshacer', 'Rehacer', 'Cortar', 'Copiar', 'Pegar', 'Seleccionar todo', 'Ventana', 'Minimizar', 'Zoom', 'Cerrar'] },
  fr: { discard: 'Abandonner les modifications non enregistrées ?', discardButtons: ['Abandonner', 'Annuler'], available: (v) => `EdenText ${v} est disponible.`, installed: (v) => `Version installée : ${v}.`, updateButtons: ['Télécharger', 'Plus tard', 'Ignorer cette version'], menu: ['À propos de %', 'Masquer %', 'Masquer les autres', 'Tout afficher', 'Quitter %', 'Édition', 'Annuler', 'Rétablir', 'Couper', 'Copier', 'Coller', 'Tout sélectionner', 'Fenêtre', 'Placer dans le Dock', 'Réduire/agrandir', 'Fermer'] },
  it: { discard: 'Ignorare le modifiche non salvate?', discardButtons: ['Ignora', 'Annulla'], available: (v) => `È disponibile EdenText ${v}.`, installed: (v) => `Versione installata: ${v}.`, updateButtons: ['Scarica', 'Più tardi', 'Salta questa versione'], menu: ['Informazioni su %', 'Nascondi %', 'Nascondi altre', 'Mostra tutte', 'Esci da %', 'Composizione', 'Annulla', 'Ripeti', 'Taglia', 'Copia', 'Incolla', 'Seleziona tutto', 'Finestra', 'Contrai', 'Zoom', 'Chiudi'] },
  pt: { discard: 'Descartar as alterações não guardadas?', discardButtons: ['Descartar', 'Cancelar'], available: (v) => `O EdenText ${v} está disponível.`, installed: (v) => `Versão instalada: ${v}.`, updateButtons: ['Transferir', 'Mais tarde', 'Ignorar esta versão'], menu: ['Acerca do %', 'Ocultar %', 'Ocultar outros', 'Mostrar tudo', 'Sair do %', 'Edição', 'Desfazer', 'Refazer', 'Cortar', 'Copiar', 'Colar', 'Selecionar tudo', 'Janela', 'Minimizar', 'Zoom', 'Fechar'] },
  el: { discard: 'Απόρριψη των μη αποθηκευμένων αλλαγών;', discardButtons: ['Απόρριψη', 'Ακύρωση'], available: (v) => `Το EdenText ${v} είναι διαθέσιμο.`, installed: (v) => `Έχετε την έκδοση ${v}.`, updateButtons: ['Λήψη', 'Αργότερα', 'Παράλειψη αυτής της έκδοσης'], menu: ['Σχετικά με το %', 'Απόκρυψη %', 'Απόκρυψη άλλων', 'Εμφάνιση όλων', 'Τερματισμός %', 'Επεξεργασία', 'Αναίρεση', 'Επανάληψη', 'Αποκοπή', 'Αντιγραφή', 'Επικόλληση', 'Επιλογή όλων', 'Παράθυρο', 'Ελαχιστοποίηση', 'Ζουμ', 'Κλείσιμο'] },
  ru: { discard: 'Отказаться от несохранённых изменений?', discardButtons: ['Отказаться', 'Отмена'], available: (v) => `Доступна версия EdenText ${v}.`, installed: (v) => `Установлена версия ${v}.`, updateButtons: ['Скачать', 'Позже', 'Пропустить эту версию'], menu: ['О программе %', 'Скрыть %', 'Скрыть остальные', 'Показать все', 'Завершить %', 'Правка', 'Отменить', 'Повторить', 'Вырезать', 'Скопировать', 'Вставить', 'Выбрать все', 'Окно', 'Свернуть', 'Изменить масштаб', 'Закрыть'] },
  uk: { discard: 'Відкинути незбережені зміни?', discardButtons: ['Відкинути', 'Скасувати'], available: (v) => `Доступна версія EdenText ${v}.`, installed: (v) => `Встановлено версію ${v}.`, updateButtons: ['Завантажити', 'Пізніше', 'Пропустити цю версію'], menu: ['Про %', 'Сховати %', 'Сховати інші', 'Показати всі', 'Вийти з %', 'Редагування', 'Відмінити', 'Повторити', 'Вирізати', 'Скопіювати', 'Вставити', 'Вибрати все', 'Вікно', 'Згорнути', 'Масштаб', 'Закрити'] },
  ja: { discard: '保存されていない変更を破棄しますか?', discardButtons: ['破棄', 'キャンセル'], available: (v) => `EdenText ${v} が利用可能です。`, installed: (v) => `インストール済みのバージョン: ${v}`, updateButtons: ['ダウンロード', '後で', 'このバージョンをスキップ'], menu: ['%について', '%を非表示', 'ほかを非表示', 'すべてを表示', '%を終了', '編集', '取り消す', 'やり直す', 'カット', 'コピー', 'ペースト', 'すべてを選択', 'ウインドウ', 'しまう', '拡大/縮小', '閉じる'] },
  'zh-Hans': { discard: '放弃未保存的更改？', discardButtons: ['放弃', '取消'], available: (v) => `EdenText ${v} 已发布。`, installed: (v) => `当前版本：${v}`, updateButtons: ['下载', '稍后', '跳过此版本'], menu: ['关于%', '隐藏%', '隐藏其他', '全部显示', '退出%', '编辑', '撤销', '重做', '剪切', '拷贝', '粘贴', '全选', '窗口', '最小化', '缩放', '关闭'] },
  'zh-Hant': { discard: '放棄未儲存的變更？', discardButtons: ['放棄', '取消'], available: (v) => `EdenText ${v} 已推出。`, installed: (v) => `目前版本：${v}`, updateButtons: ['下載', '稍後', '略過此版本'], menu: ['關於%', '隱藏%', '隱藏其他', '顯示全部', '結束%', '編輯', '還原', '重做', '剪下', '拷貝', '貼上', '全選', '視窗', '縮到最小', '縮放', '關閉'] },
};
// macOS needs a menu for its standard shortcuts; elsewhere the ribbon has every command and
// Chromium handles the editing keys itself. Labels: menu in TEXT, % for the app name.
function labels() {
  const [about, hide, hideOthers, showAll, quit, edit, undo, redo, cut, copy, paste, selectAll, window, minimize, zoom, close] =
    text().menu.map((l) => l.replace('%', app.name));
  return { about, hide, hideOthers, showAll, quit, edit, undo, redo, cut, copy, paste, selectAll, window, minimize, zoom, close };
}

function setMenu() {
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null);
  const { about, hide, hideOthers, showAll, quit, edit, undo, redo, cut, copy, paste, selectAll, window, minimize, zoom, close } = labels();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: about }, { type: 'separator' },
      { role: 'hide', label: hide }, { role: 'hideOthers', label: hideOthers }, { role: 'unhide', label: showAll },
      { type: 'separator' }, { role: 'quit', label: quit },
    ] },
    { label: edit, submenu: [
      { role: 'undo', label: undo }, { role: 'redo', label: redo }, { type: 'separator' },
      { role: 'cut', label: cut }, { role: 'copy', label: copy }, { role: 'paste', label: paste }, { role: 'selectAll', label: selectAll },
    ] },
    { label: window, submenu: [{ role: 'minimize', label: minimize }, { role: 'zoom', label: zoom }, { role: 'close', label: close }] },
  ]));
}

function text() {
  const tag = app.getLocale().toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-')) return TEXT[/^zh-(hant|tw|hk|mo)\b/.test(tag) ? 'zh-Hant' : 'zh-Hans'];
  return TEXT[tag.slice(0, 2)] ?? TEXT.en;
}

// Points at a newer release instead of installing it: an unsigned macOS app cannot
// update itself. Offline or rate-limited, the app simply starts without asking;
// under Flatpak, Flathub delivers the updates.
const RELEASES = 'https://github.com/stffnb/edentext/releases/latest';
// The one release the user chose to skip; the next one asks again.
const skippedFile = () => path.join(app.getPath('userData'), 'skipped-version');
const skipped = () => { try { return readFileSync(skippedFile(), 'utf8'); } catch { return ''; } };
async function checkForUpdate(win) {
  if (!app.isPackaged || process.env.FLATPAK_ID) return;
  const res = await net.fetch('https://api.github.com/repos/stffnb/edentext/releases/latest');
  if (!res.ok) return;
  const latest = String((await res.json()).tag_name ?? '').replace(/^v/, '');
  if (latest === skipped() || latest.localeCompare(app.getVersion(), undefined, { numeric: true }) <= 0) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    message: text().available(latest),
    detail: text().installed(app.getVersion()),
    buttons: text().updateButtons,
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) void shell.openExternal(RELEASES);
  if (response === 2) writeFileSync(skippedFile(), latest);
}

// Documents the system opened with the app (double-click, Open With). The page may read
// and write these paths and no others; the list outlives the launch for the recent list.
const DOC = /\.(odt|ott|docx|dotx)$/i;
const grantedFile = () => path.join(app.getPath('userData'), 'opened-files.json');
let granted = null;
function isGranted(file) {
  granted ??= (() => { try { return JSON.parse(readFileSync(grantedFile(), 'utf8')); } catch { return []; } })();
  return granted.includes(file);
}
function grant(file) {
  if (isGranted(file)) return;
  granted = [file, ...granted].slice(0, 100);
  writeFileSync(grantedFile(), JSON.stringify(granted));
}
const docArgs = (argv, cwd) => argv.slice(1).filter((a) => DOC.test(a) && !a.startsWith('-')).map((a) => path.resolve(cwd, a));
// The file each window was opened for, until its page takes it.
const pending = new Map();

ipcMain.handle('desktop:take-file', (e) => {
  const file = pending.get(e.sender.id) ?? null;
  pending.delete(e.sender.id);
  return file;
});
ipcMain.handle('desktop:read', async (_e, file) => {
  if (!isGranted(file)) throw new Error('EACCES: not a document opened with the app');
  const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
  return { bytes: new Uint8Array(bytes), modified: Math.floor(info.mtimeMs) };
});
// Through a temporary file, so a failed write never leaves half a document behind.
ipcMain.handle('desktop:write', async (_e, file, bytes) => {
  if (!isGranted(file)) throw new Error('EACCES: not a document opened with the app');
  const tmp = `${file}.edentext-${process.pid}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
});

// Vector PDF without the print dialog: the page's print HTML, served on the app origin so
// its fonts and pictures resolve, rendered in a hidden window. Size and margins are @page's.
const printPages = new Map();
ipcMain.handle('desktop:print-pdf', async (_e, html) => {
  const id = randomUUID();
  printPages.set(id, html);
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`${ORIGIN}/__print/${id}`);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    return new Uint8Array(await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    printPages.delete(id);
    win.destroy();
  }
});

// What the page asks the browser for: saving through the file pickers, installed fonts,
// the clipboard. Anything else (camera, location, notifications…) is refused.
const PERMISSIONS = new Set(['fileSystem', 'local-fonts', 'clipboard-read', 'clipboard-sanitized-write']);
const allowed = (permission, url) => PERMISSIONS.has(permission) && String(url ?? '').startsWith(ORIGIN);

function createWindow(file) {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'EdenText',
    show: false,
    webPreferences: { preload: fileURLToPath(new URL('preload.cjs', import.meta.url)) },
  });
  // Shown once the page has painted its theme, not as an empty native window first.
  win.once('ready-to-show', () => win.show());
  if (file) {
    grant(file);
    pending.set(win.webContents.id, file);
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${ORIGIN}/`)) return { action: 'allow' };
    if (/^(https?|mailto|tel):/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A file dropped outside the editor would otherwise replace the app.
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  // The page's beforeunload guard blocks closing silently; ask instead.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, { type: 'question', message: text().discard, buttons: text().discardButtons, defaultId: 1, cancelId: 1 });
    if (choice === 0) e.preventDefault();
  });
  // A browser's menu for fields and selected text, spelling suggestions first; the
  // editor opens its own and suppresses this one.
  win.webContents.on('context-menu', (_e, p) => {
    if (!p.isEditable && !p.selectionText) return;
    const { cut, copy, paste, selectAll } = labels();
    const spelling = p.dictionarySuggestions.map((w) => ({ label: w, click: () => win.webContents.replaceMisspelling(w) }));
    Menu.buildFromTemplate([
      ...spelling, ...(spelling.length ? [{ type: 'separator' }] : []),
      { role: 'cut', label: cut, enabled: p.editFlags.canCut }, { role: 'copy', label: copy, enabled: p.editFlags.canCopy },
      { role: 'paste', label: paste, enabled: p.editFlags.canPaste }, { role: 'selectAll', label: selectAll },
    ]).popup({ window: win });
  });
  void win.loadURL(`${ORIGIN}/index.html`);
  win.webContents.once('did-finish-load', () => checkForUpdate(win).catch(() => {}));
}

// A second process on the same profile loses its localStorage writes, so a second launch
// opens a window here instead: a new document, as a new browser tab would be.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', (_e, argv, cwd) => {
  if (!app.isReady()) return;
  const files = docArgs(argv, cwd);
  if (files.length) files.forEach(createWindow);
  else createWindow();
});

// Windows and Linux pass a document as an argument, macOS as open-file, often before
// the app is ready.
let launchFile = docArgs(process.argv, process.cwd())[0];
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (app.isReady()) createWindow(file);
  else launchFile = file;
});

app.whenReady().then(() => {
  setMenu();
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(allowed(permission, details.requestingUrl ?? wc?.getURL())));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowed(permission, origin));
  protocol.handle('app', (req) => {
    const print = /^\/__print\/([\w-]+)$/.exec(new URL(req.url).pathname);
    // The print page is static markup: it runs no script and loads only the app's files.
    if (print) return new Response(printPages.get(print[1]) ?? '', { headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self' data: blob:; script-src 'none'; style-src 'self' 'unsafe-inline' data: blob:; object-src 'none'; base-uri 'none'",
    } });
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url).pathname));
    if (!file.startsWith(ROOT)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow(launchFile);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
