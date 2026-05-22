const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, Notification, screen, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_WINDOW_SIZE = { width: 780, height: 1200 };
const MIN_WINDOW_SIZE = { width: 560, height: 480 };
const MAX_WINDOW_SIZE = { width: 5000, height: 5000 };
const SHORTCUTS = ['CommandOrControl+Alt+Space', 'CommandOrControl+Shift+Space'];
const APP_USER_MODEL_ID = 'com.local.quadrant-pop-todo';
const SMOKE_TEST = process.argv.includes('--smoke-test');

if (SMOKE_TEST) {
  app.setPath('userData', path.join(app.getPath('temp'), 'quadrant-pop-todo-smoke'));
}

if (!SMOKE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showAtCursor());
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

let mainWindow;
let tray;
let dataFilePath;
let windowStateFilePath;
let registeredShortcut = null;
let pinned = false;
let isQuitting = false;
let showAnimation = null;
let windowSize = { ...DEFAULT_WINDOW_SIZE };
let saveWindowStateTimer = null;
const reminderTimers = new Map();
const firedReminderKeys = new Set();

function getTrayImage() {
  const iconPath = path.join(__dirname, 'build', 'tray.ico');
  return nativeImage.createFromPath(iconPath);
}

function clampNumber(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(Math.max(number, min), max);
}

function normalizeWindowSize(size = {}) {
  return {
    width: clampNumber(size.width, MIN_WINDOW_SIZE.width, MAX_WINDOW_SIZE.width),
    height: clampNumber(size.height, MIN_WINDOW_SIZE.height, MAX_WINDOW_SIZE.height)
  };
}

async function readWindowState() {
  try {
    const raw = await fs.readFile(windowStateFilePath, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return normalizeWindowSize({ ...DEFAULT_WINDOW_SIZE, ...parsed });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read window state:', error);
    }
    return { ...DEFAULT_WINDOW_SIZE };
  }
}

async function writeWindowState() {
  if (!windowStateFilePath) {
    return;
  }
  await fs.mkdir(path.dirname(windowStateFilePath), { recursive: true });
  const tempPath = `${windowStateFilePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(windowSize, null, 2), 'utf8');
  await fs.rename(tempPath, windowStateFilePath);
}

function scheduleWindowStateSave() {
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => {
    writeWindowState().catch((error) => console.error('Failed to save window state:', error));
  }, 250);
}

function captureWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const bounds = mainWindow.getBounds();
  windowSize = normalizeWindowSize(bounds);
  scheduleWindowStateSave();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: windowSize.width,
    height: windowSize.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('blur', () => {
    if (!pinned && !mainWindow.webContents.isDevToolsOpened()) {
      hideWindow();
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on('resize', captureWindowSize);
}

function stopShowAnimation() {
  if (showAnimation) {
    clearInterval(showAnimation);
    showAnimation = null;
  }
}

function hideWindow() {
  if (!mainWindow) {
    return;
  }
  stopShowAnimation();
  mainWindow.setOpacity(1);
  mainWindow.hide();
}

function animateWindowIn() {
  stopShowAnimation();
  const duration = 135;
  const startedAt = Date.now();
  mainWindow.setOpacity(0);
  showAnimation = setInterval(() => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    mainWindow.setOpacity(eased);
    if (progress >= 1) {
      stopShowAnimation();
      mainWindow.setOpacity(1);
    }
  }, 16);
}

function keepBoundsOnDisplay(point, display) {
  const margin = 12;
  const area = display.workArea;
  const size = mainWindow && !mainWindow.isDestroyed() ? normalizeWindowSize(mainWindow.getBounds()) : windowSize;
  const minX = area.x + margin;
  const minY = area.y + margin;
  const maxX = area.x + area.width - size.width - margin;
  const maxY = area.y + area.height - size.height - margin;
  return {
    x: Math.round(maxX < minX ? minX : Math.min(Math.max(point.x - 28, minX), maxX)),
    y: Math.round(maxY < minY ? minY : Math.min(Math.max(point.y - 24, minY), maxY))
  };
}

function showAtCursor(payload = {}) {
  if (!mainWindow) {
    createWindow();
  }

  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const position = keepBoundsOnDisplay(point, display);
  const wasVisible = mainWindow.isVisible();

  if (!wasVisible) {
    mainWindow.setOpacity(0);
  }
  mainWindow.setBounds({
    x: position.x,
    y: position.y,
    width: windowSize.width,
    height: windowSize.height
  });
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app:shown', { animate: !wasVisible, ...payload });
  if (!wasVisible) {
    animateWindowIn();
  } else {
    mainWindow.setOpacity(1);
  }
}

function getReminderKey(task) {
  return `${task.id}:${task.reminderAt || ''}`;
}

function hasValidReminder(task) {
  if (!task || task.done || !task.reminderAt) {
    return false;
  }
  const dueAt = Date.parse(task.reminderAt);
  if (Number.isNaN(dueAt)) {
    return false;
  }
  const remindedAt = Date.parse(task.remindedAt || '');
  return Number.isNaN(remindedAt) || remindedAt < dueAt;
}

function clearReminderTimers() {
  for (const timer of reminderTimers.values()) {
    clearTimeout(timer);
  }
  reminderTimers.clear();
}

function sendReminderWhenReady(task) {
  const reminder = {
    id: task.id,
    title: task.title,
    note: task.note,
    quadrant: task.quadrant,
    reminderAt: task.reminderAt
  };
  const send = () => mainWindow?.webContents.send('reminder:due', reminder);

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
    return;
  }
  setTimeout(send, 60);
}

function showNativeReminder(task) {
  if (SMOKE_TEST || !Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: task.title || '待办提醒',
    body: task.note || '提醒时间到了',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    silent: false
  });

  notification.on('click', () => {
    showAtCursor({ focusTitle: false, reminder: true });
  });
  notification.show();
}

function triggerReminder(task) {
  if (!hasValidReminder(task)) {
    return;
  }
  const key = getReminderKey(task);
  if (firedReminderKeys.has(key)) {
    return;
  }
  firedReminderKeys.add(key);
  reminderTimers.delete(key);

  showNativeReminder(task);
  showAtCursor({ focusTitle: false, reminder: true });
  mainWindow.flashFrame(true);
  sendReminderWhenReady(task);
}

function scheduleReminders(tasks = []) {
  clearReminderTimers();
  const now = Date.now();
  const maxDelay = 2_147_483_647;

  for (const task of tasks) {
    if (!hasValidReminder(task)) {
      continue;
    }
    const dueAt = Date.parse(task.reminderAt);
    const delay = Math.max(0, Math.min(dueAt - now, maxDelay));
    const key = getReminderKey(task);
    const snapshot = { ...task };
    const timer = setTimeout(() => triggerReminder(snapshot), delay);
    timer.unref?.();
    reminderTimers.set(key, timer);
  }
}

function setupShortcut() {
  registeredShortcut = null;
  for (const accelerator of SHORTCUTS) {
    if (globalShortcut.register(accelerator, () => showAtCursor())) {
      registeredShortcut = accelerator;
      break;
    }
  }
}

function setupTray() {
  tray = new Tray(getTrayImage());
  tray.setToolTip('Quadrant Pop Todo');
  refreshTrayMenu();
  tray.on('click', () => showAtCursor());
}

function refreshTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示', click: () => showAtCursor() },
    { label: pinned ? '窗口已固定' : '窗口未固定', enabled: false },
    { label: `快捷键：${registeredShortcut || '未注册'}`, enabled: false },
    { type: 'separator' },
    { label: '打开数据目录', click: () => shell.openPath(path.dirname(dataFilePath)) },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

async function readStore() {
  try {
    const raw = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      preferences: parsed.preferences && typeof parsed.preferences === 'object' ? parsed.preferences : {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read store:', error);
      const backupPath = `${dataFilePath}.corrupt-${Date.now()}`;
      fs.copyFile(dataFilePath, backupPath).catch((backupError) => {
        console.error('Failed to back up corrupt store:', backupError);
      });
    }
    return { tasks: [], preferences: {} };
  }
}

async function writeStore(payload) {
  const safePayload = {
    version: 1,
    savedAt: new Date().toISOString(),
    tasks: Array.isArray(payload?.tasks) ? payload.tasks : [],
    preferences: payload?.preferences && typeof payload.preferences === 'object' ? payload.preferences : {}
  };
  await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
  const tempPath = `${dataFilePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(safePayload, null, 2), 'utf8');
  await fs.rename(tempPath, dataFilePath);
  return true;
}

app.whenReady().then(async () => {
  dataFilePath = path.join(app.getPath('userData'), 'todos.json');
  windowStateFilePath = path.join(app.getPath('userData'), 'window-state.json');
  windowSize = await readWindowState();
  createWindow();
  setupShortcut();
  setupTray();

  if (SMOKE_TEST) {
    const quitAfterLoad = () => {
      setTimeout(() => {
        isQuitting = true;
        app.quit();
      }, 500);
    };

    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', quitAfterLoad);
    } else {
      quitAfterLoad();
    }
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearReminderTimers();
  clearTimeout(saveWindowStateTimer);
  writeWindowState().catch((error) => console.error('Failed to save window state on quit:', error));
});

app.on('window-all-closed', () => {});

app.on('activate', () => showAtCursor());

ipcMain.handle('store:load', async () => {
  const store = await readStore();
  scheduleReminders(store.tasks);
  return {
    ...store,
    system: {
      shortcut: registeredShortcut,
      dataFilePath
    }
  };
});

ipcMain.handle('store:save', async (_event, payload) => {
  await writeStore(payload);
  scheduleReminders(payload?.tasks || []);
  return true;
});

ipcMain.handle('window:hide', () => {
  hideWindow();
});

ipcMain.handle('window:minimize', () => {
  hideWindow();
});

ipcMain.handle('window:resize', (_event, nextSize) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return windowSize;
  }
  const nextWindowSize = normalizeWindowSize(nextSize);
  const bounds = mainWindow.getBounds();
  mainWindow.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: nextWindowSize.width,
    height: nextWindowSize.height
  });
  windowSize = nextWindowSize;
  scheduleWindowStateSave();
  return windowSize;
});

ipcMain.handle('window:setPinned', (_event, nextPinned) => {
  pinned = Boolean(nextPinned);
  mainWindow.setAlwaysOnTop(true, pinned ? 'screen-saver' : 'floating');
  refreshTrayMenu();
  return pinned;
});

ipcMain.handle('system:openDataFolder', () => shell.openPath(path.dirname(dataFilePath)));
