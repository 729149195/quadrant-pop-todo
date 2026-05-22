const api = window.quadrantTodo || {
  async load() {
    const raw = localStorage.getItem('quadrant-pop-todo');
    const stored = raw ? JSON.parse(raw) : { tasks: [], preferences: {} };
    return { ...stored, system: { shortcut: 'Preview' } };
  },
  async save(payload) {
    localStorage.setItem('quadrant-pop-todo', JSON.stringify(payload));
  },
  async hide() {},
  async setPinned() {},
  async resizeWindow() {},
  async openDataFolder() {},
  onShown(callback) {
    window.addEventListener('focus', callback);
  },
  onReminder() {
  }
};

const quadrants = [
  { id: 'do', title: '重要且紧急', subtitle: '现在处理', shortTitle: '重/急', empty: '暂无紧急重点', important: true, urgent: true, color: 'var(--red)' },
  { id: 'plan', title: '重要不紧急', subtitle: '安排时间', shortTitle: '重/缓', empty: '暂无计划项', important: true, urgent: false, color: 'var(--blue)' },
  { id: 'delegate', title: '不重要但紧急', subtitle: '尽快清理', shortTitle: '轻/急', empty: '暂无待清理事项', important: false, urgent: true, color: 'var(--orange)' },
  { id: 'later', title: '不重要不紧急', subtitle: '以后再说', shortTitle: '轻/缓', empty: '暂无低优先级事项', important: false, urgent: false, color: 'var(--green)' }
];

const state = {
  tasks: [],
  editingTaskId: null,
  preferences: {
    important: true,
    urgent: true,
    filter: 'active',
    search: '',
    pinned: false
  },
  system: {}
};

const refs = {
  title: document.getElementById('taskTitle'),
  note: document.getElementById('taskNote'),
  important: document.getElementById('importantToggle'),
  urgent: document.getElementById('urgentToggle'),
  add: document.getElementById('addTaskBtn'),
  grid: document.getElementById('quadrantGrid'),
  search: document.getElementById('searchInput'),
  filters: document.querySelectorAll('[data-filter]'),
  archiveDone: document.getElementById('archiveDoneBtn'),
  activeCount: document.getElementById('activeCount'),
  doneCount: document.getElementById('doneCount'),
  nextTask: document.getElementById('nextTask'),
  shortcutLabel: document.getElementById('shortcutLabel'),
  minimize: document.getElementById('minimizeBtn'),
  close: document.getElementById('closeBtn'),
  pin: document.getElementById('pinBtn'),
  openData: document.getElementById('openDataBtn'),
  reminderOverlay: document.getElementById('reminderOverlay'),
  reminderTime: document.getElementById('reminderTime'),
  reminderTaskTitle: document.getElementById('reminderTaskTitle'),
  reminderTaskNote: document.getElementById('reminderTaskNote'),
  reminderSnooze: document.getElementById('reminderSnoozeBtn'),
  reminderDone: document.getElementById('reminderDoneBtn'),
  reminderDismiss: document.getElementById('reminderDismissBtn'),
  statusToast: document.getElementById('statusToast'),
  statusText: document.getElementById('statusText'),
  statusAction: document.getElementById('statusAction'),
  resizeGrip: document.getElementById('resizeGrip'),
};

let saveTimer = null;
let statusTimer = null;
let statusActionHandler = null;
let activeQuadrantMenu = null;
let activeReminderMenu = null;
let activeReminderTaskId = null;
let dragState = null;
let resizeState = null;

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function quadrantFromFlags(important, urgent) {
  return quadrants.find((quadrant) => quadrant.important === important && quadrant.urgent === urgent).id;
}

function normalizeTask(task, index = 0) {
  const reminderAt = typeof task.reminderAt === 'string' && !Number.isNaN(Date.parse(task.reminderAt)) ? task.reminderAt : '';
  const remindedAt = typeof task.remindedAt === 'string' && !Number.isNaN(Date.parse(task.remindedAt)) ? task.remindedAt : '';
  return {
    id: task.id || createId(),
    title: typeof task.title === 'string' ? task.title : '',
    note: typeof task.note === 'string' ? task.note : '',
    quadrant: quadrants.some((quadrant) => quadrant.id === task.quadrant) ? task.quadrant : 'do',
    done: Boolean(task.done),
    reminderAt,
    remindedAt,
    order: Number.isFinite(task.order) ? task.order : index,
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || task.createdAt || new Date().toISOString()
  };
}

function formatShortcut(shortcut) {
  if (!shortcut) {
    return '快捷键未注册';
  }
  return shortcut
    .replace('CommandOrControl', 'Ctrl')
    .replaceAll('+', ' + ');
}

function cloneTasks(tasks = state.tasks) {
  return tasks.map((task) => ({ ...task }));
}

function compactText(text, maxLength = 22) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) {
    return value || '未命名待办';
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function hideStatus() {
  clearTimeout(statusTimer);
  statusTimer = null;
  statusActionHandler = null;
  refs.statusToast.classList.add('hidden');
  refs.statusToast.classList.remove('danger');
  refs.statusText.textContent = '';
  refs.statusAction.textContent = '';
  refs.statusAction.hidden = true;
}

function showStatus(message, options = {}) {
  clearTimeout(statusTimer);
  statusActionHandler = typeof options.action === 'function' ? options.action : null;
  refs.statusText.textContent = message;
  refs.statusAction.hidden = !statusActionHandler;
  refs.statusAction.textContent = statusActionHandler ? options.actionLabel || '撤销' : '';
  refs.statusToast.classList.toggle('danger', options.tone === 'danger');
  refs.statusToast.classList.remove('hidden');

  if (options.timeout !== 0) {
    statusTimer = setTimeout(hideStatus, options.timeout || 5200);
  }
}

async function persistState(options = {}) {
  try {
    await api.save({ tasks: state.tasks, preferences: state.preferences });
    if (options.notify) {
      showStatus('已保存');
    }
  } catch (error) {
    console.error('Failed to save state:', error);
    showStatus('保存失败，当前改动暂未写入磁盘', { tone: 'danger', timeout: 0 });
  }
}

function scheduleSave(options = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistState(options);
  }, 180);
}

function setPreference(key, value) {
  state.preferences[key] = value;
  scheduleSave();
}

function updateToggleVisuals() {
  refs.important.classList.toggle('active', state.preferences.important);
  refs.urgent.classList.toggle('active', state.preferences.urgent);
  refs.important.setAttribute('aria-pressed', String(state.preferences.important));
  refs.urgent.setAttribute('aria-pressed', String(state.preferences.urgent));
}

function updateComposerState() {
  refs.add.disabled = refs.title.value.trim().length === 0;
}

function setComposerQuadrant(quadrant, options = {}) {
  state.preferences.important = quadrant.important;
  state.preferences.urgent = quadrant.urgent;
  updateToggleVisuals();
  scheduleSave();
  if (options.focus !== false) {
    refs.title.focus();
  }
}

function compareTaskOrder(first, second) {
  const firstOrder = Number.isFinite(first.order) ? first.order : 0;
  const secondOrder = Number.isFinite(second.order) ? second.order : 0;
  if (firstOrder !== secondOrder) {
    return firstOrder - secondOrder;
  }
  return new Date(second.createdAt) - new Date(first.createdAt);
}

function getTopOrderForQuadrant(quadrantId) {
  const orders = state.tasks
    .filter((task) => task.quadrant === quadrantId)
    .map((task) => Number.isFinite(task.order) ? task.order : 0);
  if (orders.length === 0) {
    return 0;
  }
  return Math.min(...orders) - 1;
}

function getVisibleTasks(quadrantId) {
  const query = state.preferences.search.trim().toLowerCase();
  return state.tasks
    .filter((task) => task.quadrant === quadrantId)
    .filter((task) => {
      if (state.preferences.filter === 'active') {
        return !task.done;
      }
      if (state.preferences.filter === 'done') {
        return task.done;
      }
      return true;
    })
    .filter((task) => {
      if (!query) {
        return true;
      }
      return `${task.title} ${task.note}`.toLowerCase().includes(query);
    })
    .sort((first, second) => {
      if (first.done !== second.done) {
        return Number(first.done) - Number(second.done);
      }
      return compareTaskOrder(first, second);
    });
}

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function createIcon(name) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M7 7l10 10M17 7 7 17"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    bell: '<path d="M10 20a2 2 0 0 0 4 0"/><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16l-2-2Z"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>'
  };
  const wrapper = createElement('span', 'icon-wrap');
  wrapper.innerHTML = `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  return wrapper;
}

function getQuadrant(id) {
  return quadrants.find((quadrant) => quadrant.id === id) || quadrants[0];
}

function padTime(value) {
  return String(value).padStart(2, '0');
}

function toDateTimeLocalValue(iso) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())}T${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
}

function fromDateTimeLocalValue(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function formatReminderTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '未设置';
  }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const time = `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
  if (target === today) {
    return `今天 ${time}`;
  }
  if (target === today + 86_400_000) {
    return `明天 ${time}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

function getReminderState(task) {
  if (!task.reminderAt) {
    return 'none';
  }
  if (!Number.isNaN(Date.parse(task.remindedAt || '')) && Date.parse(task.remindedAt) >= Date.parse(task.reminderAt)) {
    return 'done';
  }
  return Date.parse(task.reminderAt) <= Date.now() ? 'due' : 'pending';
}

function clearDropIndicators() {
  refs.grid.querySelectorAll('.drop-before, .drop-after').forEach((card) => {
    card.classList.remove('drop-before', 'drop-after');
  });
  refs.grid.querySelectorAll('.drop-at-end').forEach((list) => {
    list.classList.remove('drop-at-end');
  });
}

function finishDrag() {
  refs.grid.querySelectorAll('.dragging').forEach((card) => card.classList.remove('dragging'));
  clearDropIndicators();
  dragState = null;
}

function reorderTaskWithinQuadrant(taskId, targetId, position, quadrantId) {
  const source = state.tasks.find((task) => task.id === taskId);
  if (!source || source.quadrant !== quadrantId) {
    return false;
  }

  const ordered = state.tasks
    .filter((task) => task.quadrant === quadrantId)
    .sort(compareTaskOrder)
    .filter((task) => task.id !== taskId);

  let insertIndex = ordered.length;
  if (targetId && targetId !== taskId) {
    const targetIndex = ordered.findIndex((task) => task.id === targetId);
    if (targetIndex >= 0) {
      insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    }
  }

  ordered.splice(insertIndex, 0, source);
  ordered.forEach((task, index) => {
    task.order = index;
  });
  source.updatedAt = new Date().toISOString();
  return true;
}

function closeQuadrantMenu(options = {}) {
  if (!activeQuadrantMenu) {
    return;
  }
  const anchor = activeQuadrantMenu.anchor;
  activeQuadrantMenu.anchor?.setAttribute('aria-expanded', 'false');
  activeQuadrantMenu.node.classList.add('closing');
  const menu = activeQuadrantMenu.node;
  activeQuadrantMenu = null;
  setTimeout(() => menu.remove(), 120);
  if (options.restoreFocus) {
    setTimeout(() => anchor?.focus(), 0);
  }
}

function openQuadrantMenu(task, anchor) {
  if (activeQuadrantMenu?.taskId === task.id) {
    closeQuadrantMenu();
    return;
  }
  closeQuadrantMenu();
  closeReminderMenu();

  const menu = createElement('div', 'quadrant-menu');
  menu.dataset.taskId = task.id;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '选择象限');

  for (const quadrant of quadrants) {
    const item = createElement('button', `quadrant-menu-item${quadrant.id === task.quadrant ? ' active' : ''}`);
    item.type = 'button';
    item.dataset.action = 'set-quadrant';
    item.dataset.quadrant = quadrant.id;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', quadrant.id === task.quadrant ? 'true' : 'false');

    const dot = createElement('span', 'menu-dot');
    dot.style.background = quadrant.color;
    const label = createElement('span', 'menu-label');
    label.append(createElement('strong', '', quadrant.title), createElement('small', '', quadrant.subtitle));
    const check = createElement('span', 'menu-check', quadrant.id === task.quadrant ? '✓' : '');

    item.append(dot, label, check);
    menu.append(item);
  }

  document.body.append(menu);

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 10;
  const left = Math.min(Math.max(anchorRect.right - menuRect.width, margin), window.innerWidth - menuRect.width - margin);
  const top = Math.min(Math.max(anchorRect.bottom + 6, margin), window.innerHeight - menuRect.height - margin);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  activeQuadrantMenu = { taskId: task.id, node: menu, anchor };
  requestAnimationFrame(() => {
    menu.querySelector('.quadrant-menu-item.active')?.focus();
  });
}

function closeReminderMenu() {
  if (!activeReminderMenu) {
    return;
  }
  activeReminderMenu.anchor?.setAttribute('aria-expanded', 'false');
  activeReminderMenu.node.classList.add('closing');
  const menu = activeReminderMenu.node;
  activeReminderMenu = null;
  setTimeout(() => menu.remove(), 120);
}

function openReminderMenu(task, anchor) {
  if (activeReminderMenu?.taskId === task.id) {
    closeReminderMenu();
    return;
  }
  closeReminderMenu();
  closeQuadrantMenu();

  const menu = createElement('div', 'reminder-menu');
  menu.dataset.taskId = task.id;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '设置提醒时间');

  const label = createElement('label', 'reminder-menu-label');
  label.append(createElement('span', '', '提醒时间'));
  const input = createElement('input', 'reminder-menu-input');
  input.type = 'datetime-local';
  input.value = toDateTimeLocalValue(task.reminderAt);
  input.min = toDateTimeLocalValue(new Date().toISOString());
  label.append(input);

  const quick = createElement('div', 'reminder-quick');
  for (const [text, minutes] of [['15 分钟', 15], ['30 分钟', 30], ['明天 9 点', 'tomorrow-9'], ['下周一 9 点', 'next-monday-9']]) {
    const button = createElement('button', '', text);
    button.type = 'button';
    button.dataset.action = 'quick-reminder';
    button.dataset.minutes = String(minutes);
    quick.append(button);
  }

  const actions = createElement('div', 'reminder-menu-actions');
  const clear = createElement('button', 'subtle-button', '清除');
  clear.type = 'button';
  clear.dataset.action = 'clear-reminder';
  const save = createElement('button', 'primary-button', '保存');
  save.type = 'button';
  save.dataset.action = 'save-reminder';
  actions.append(clear, save);

  menu.append(label, quick, actions);
  document.body.append(menu);

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 10;
  const left = Math.min(Math.max(anchorRect.right - menuRect.width, margin), window.innerWidth - menuRect.width - margin);
  const top = Math.min(Math.max(anchorRect.bottom + 6, margin), window.innerHeight - menuRect.height - margin);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  activeReminderMenu = { taskId: task.id, node: menu, anchor };
  requestAnimationFrame(() => input.focus());
}

function playShellIntro() {
  document.body.classList.remove('is-visible');
  void document.body.offsetWidth;
  document.body.classList.add('is-visible');
}

function renderTask(task) {
  const card = createElement('article', `task-card${task.done ? ' done' : ''}${task.note ? ' has-note' : ''}${state.editingTaskId === task.id ? ' expanded' : ''}`);
  card.dataset.id = task.id;
  card.dataset.quadrant = task.quadrant;

  const dragHandle = createElement('button', 'drag-handle');
  dragHandle.type = 'button';
  dragHandle.draggable = true;
  dragHandle.title = '拖动排序';
  dragHandle.setAttribute('aria-label', '拖动排序');
  dragHandle.append(createIcon('grip'));

  const check = createElement('button', `check-button${task.done ? ' done' : ''}`);
  check.type = 'button';
  check.dataset.action = 'toggle-done';
  check.title = task.done ? '标记为进行中' : '标记完成';
  check.setAttribute('aria-label', check.title);
  if (task.done) {
    check.append(createIcon('check'));
  }

  const body = createElement('div', 'task-body');
  const title = createElement('textarea', 'task-title');
  title.value = task.title;
  title.title = task.title;
  title.placeholder = '待办';
  title.dataset.field = 'title';
  title.maxLength = 120;
  title.rows = 1;
  title.spellcheck = false;
  title.setAttribute('aria-label', '待办标题');

  const note = createElement('textarea', 'task-note');
  note.value = task.note;
  note.title = task.note;
  note.placeholder = '备注';
  note.dataset.field = 'note';
  note.maxLength = 600;
  note.rows = 1;
  note.spellcheck = false;
  note.setAttribute('aria-label', '备注');

  const meta = createElement('div', `task-meta${task.reminderAt ? '' : ' hidden'}`);
  if (task.reminderAt) {
    const reminderState = getReminderState(task);
    meta.classList.toggle('due', reminderState === 'due');
    meta.textContent = `${reminderState === 'due' ? '已到时' : '提醒'} ${formatReminderTime(task.reminderAt)}`;
  }

  body.append(title, note, meta);

  const currentQuadrant = getQuadrant(task.quadrant);
  const reminderState = getReminderState(task);
  const reminderButton = createElement('button', `reminder-button${task.reminderAt ? ' active' : ''}${reminderState === 'due' ? ' due' : ''}`);
  reminderButton.type = 'button';
  reminderButton.dataset.action = 'open-reminder-menu';
  reminderButton.disabled = task.done;
  reminderButton.title = task.done ? '已完成事项不提醒' : task.reminderAt ? `提醒：${formatReminderTime(task.reminderAt)}` : '设置提醒';
  reminderButton.setAttribute('aria-haspopup', 'dialog');
  reminderButton.setAttribute('aria-expanded', 'false');
  reminderButton.setAttribute('aria-label', reminderButton.title);
  reminderButton.append(createIcon('bell'));

  const quadrantButton = createElement('button', 'task-quadrant-button');
  quadrantButton.type = 'button';
  quadrantButton.dataset.action = 'open-quadrant-menu';
  quadrantButton.title = currentQuadrant.title;
  quadrantButton.setAttribute('aria-haspopup', 'menu');
  quadrantButton.setAttribute('aria-expanded', 'false');
  quadrantButton.setAttribute('aria-label', `移动到其他象限，当前：${currentQuadrant.title}`);
  quadrantButton.append(createElement('span', 'task-quadrant-dot'), createElement('span', 'task-quadrant-text', currentQuadrant.shortTitle), createIcon('chevron'));
  quadrantButton.querySelector('.task-quadrant-dot').style.background = currentQuadrant.color;

  const remove = createElement('button', 'delete-button');
  remove.type = 'button';
  remove.dataset.action = 'delete';
  remove.title = '删除';
  remove.setAttribute('aria-label', '删除');
  remove.append(createIcon('close'));

  card.append(dragHandle, check, body, reminderButton, quadrantButton, remove);
  return card;
}

function syncTextAreaHeight(node) {
  if (!node?.matches?.('.task-title, .task-note')) {
    return;
  }
  const style = window.getComputedStyle(node);
  const borderY = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
  node.style.height = 'auto';
  node.style.height = `${Math.ceil(node.scrollHeight + borderY)}px`;
}

function syncTaskTextAreas() {
  refs.grid.querySelectorAll('.task-title, .task-note').forEach(syncTextAreaHeight);
}

function renderQuadrants() {
  refs.grid.replaceChildren();
  for (const quadrant of quadrants) {
    const section = createElement('section', 'quadrant');
    section.dataset.quadrant = quadrant.id;

    const tasks = getVisibleTasks(quadrant.id);
    const header = createElement('div', 'quadrant-header');
    const accent = createElement('div', 'accent');
    accent.style.background = quadrant.color;

    const title = createElement('div', 'quadrant-title');
    title.append(createElement('strong', '', quadrant.title), createElement('span', '', quadrant.subtitle));

    const count = createElement('span', 'quadrant-count', String(tasks.length));
    const addHere = createElement('button', 'icon-button');
    addHere.type = 'button';
    addHere.dataset.action = 'select-quadrant';
    addHere.dataset.quadrant = quadrant.id;
    addHere.title = '添加到此象限';
    addHere.setAttribute('aria-label', '添加到此象限');
    addHere.append(createIcon('plus'));

    header.append(accent, title, count, addHere);

    const list = createElement('div', 'task-list');
    if (tasks.length === 0) {
      const emptyText = state.preferences.search.trim()
        ? '无匹配待办'
        : state.preferences.filter === 'done'
          ? '暂无已完成事项'
          : quadrant.empty;
      list.append(createElement('div', 'empty-state', emptyText));
    } else {
      for (const task of tasks) {
        list.append(renderTask(task));
      }
    }

    section.append(header, list);
    refs.grid.append(section);
  }
  requestAnimationFrame(syncTaskTextAreas);
}

function renderStats() {
  const active = state.tasks.filter((task) => !task.done);
  const done = state.tasks.filter((task) => task.done);
  const next = [...active].sort((first, second) => {
    const rank = { do: 0, plan: 1, delegate: 2, later: 3 };
    if (rank[first.quadrant] !== rank[second.quadrant]) {
      return rank[first.quadrant] - rank[second.quadrant];
    }
    return compareTaskOrder(first, second);
  })[0];

  refs.activeCount.textContent = active.length;
  refs.doneCount.textContent = done.length;
  refs.archiveDone.disabled = done.length === 0;
  refs.archiveDone.title = done.length > 0 ? `清理 ${done.length} 条已完成事项` : '暂无可清理事项';
  const nextLabel = next ? next.title || '未命名待办' : '暂无';
  const tooltip = next ? nextLabel : '';
  refs.nextTask.textContent = nextLabel;
  refs.nextTask.title = tooltip;
  refs.nextTask.closest('.next-action')?.setAttribute('title', tooltip);
}

function renderFilters() {
  for (const button of refs.filters) {
    const active = button.dataset.filter === state.preferences.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
}

function renderPins() {
  refs.pin.classList.toggle('active', state.preferences.pinned);
  refs.pin.setAttribute('aria-pressed', String(state.preferences.pinned));
  refs.pin.title = state.preferences.pinned ? '取消固定窗口' : '固定窗口';
  refs.pin.setAttribute('aria-label', refs.pin.title);
}

function render() {
  updateToggleVisuals();
  updateComposerState();
  renderFilters();
  renderPins();
  renderStats();
  renderQuadrants();
}

function setExpandedTask(taskId) {
  if (state.editingTaskId === taskId) {
    return;
  }
  state.editingTaskId = taskId;
  for (const card of refs.grid.querySelectorAll('.task-card')) {
    card.classList.toggle('expanded', card.dataset.id === taskId);
  }
}

function collapseExpandedTask() {
  if (!state.editingTaskId) {
    return;
  }
  state.editingTaskId = null;
  refs.grid.querySelectorAll('.task-card.expanded').forEach((card) => card.classList.remove('expanded'));
}

function restoreTaskSnapshot(snapshot, message) {
  state.tasks = cloneTasks(snapshot);
  collapseExpandedTask();
  render();
  scheduleSave();
  showStatus(message || '已恢复');
}

function addTask() {
  const title = refs.title.value.trim();
  const note = refs.note.value.trim();
  if (!title) {
    refs.title.focus();
    showStatus('先输入待办标题');
    return;
  }

  const timestamp = new Date().toISOString();
  const quadrantId = quadrantFromFlags(state.preferences.important, state.preferences.urgent);
  const task = {
    id: createId(),
    title,
    note,
    quadrant: quadrantId,
    done: false,
    reminderAt: '',
    remindedAt: '',
    order: getTopOrderForQuadrant(quadrantId),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.tasks.unshift(task);

  refs.title.value = '';
  refs.note.value = '';
  refs.title.focus();
  render();
  scheduleSave();
  showStatus(`已加入「${compactText(task.title)}」`);
}

function deleteTask(task) {
  const previousTasks = cloneTasks();
  state.tasks = state.tasks.filter((item) => item.id !== task.id);
  collapseExpandedTask();
  render();
  scheduleSave();
  showStatus(`已删除「${compactText(task.title)}」`, {
    actionLabel: '撤销',
    action: () => restoreTaskSnapshot(previousTasks, '已恢复待办')
  });
}

function archiveCompletedTasks() {
  const doneCount = state.tasks.filter((task) => task.done).length;
  if (doneCount === 0) {
    showStatus('暂无可清理事项');
    return;
  }

  const previousTasks = cloneTasks();
  state.tasks = state.tasks.filter((task) => !task.done);
  collapseExpandedTask();
  render();
  scheduleSave();
  showStatus(`已清理 ${doneCount} 条完成事项`, {
    actionLabel: '撤销',
    action: () => restoreTaskSnapshot(previousTasks, '已恢复完成事项')
  });
}

function setTaskReminder(task, reminderAt) {
  task.reminderAt = reminderAt;
  task.remindedAt = '';
  task.updatedAt = new Date().toISOString();
  closeReminderMenu();
  render();
  scheduleSave();
  showStatus(reminderAt ? `已设置提醒：${formatReminderTime(reminderAt)}` : '已清除提醒');
}

function getQuickReminderValue(kind) {
  const date = new Date();
  if (kind === 'tomorrow-9') {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }
  if (kind === 'next-monday-9') {
    const day = date.getDay();
    const daysUntilMonday = (8 - day) % 7 || 7;
    date.setDate(date.getDate() + daysUntilMonday);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
  }
  const minutes = Number(kind);
  if (!Number.isNaN(minutes)) {
    date.setMinutes(date.getMinutes() + minutes);
    date.setSeconds(0, 0);
    return date.toISOString();
  }
  return '';
}

function markReminderSeen(task, reminderAt) {
  if (!task || task.reminderAt !== reminderAt) {
    return;
  }
  task.remindedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  render();
  scheduleSave();
}

function showReminderOverlay(reminder) {
  activeReminderTaskId = reminder.id;
  refs.reminderTime.textContent = formatReminderTime(reminder.reminderAt);
  refs.reminderTaskTitle.textContent = reminder.title || '未命名待办';
  refs.reminderTaskNote.textContent = reminder.note || '';
  refs.reminderTaskNote.classList.toggle('hidden', !reminder.note);
  refs.reminderOverlay.classList.remove('hidden');
  refs.reminderDismiss.focus();

  const task = state.tasks.find((item) => item.id === reminder.id);
  markReminderSeen(task, reminder.reminderAt);
}

function hideReminderOverlay() {
  refs.reminderOverlay.classList.add('hidden');
  activeReminderTaskId = null;
}

function findTaskFromEvent(event) {
  const card = event.target.closest('.task-card');
  if (!card) {
    return null;
  }
  return state.tasks.find((task) => task.id === card.dataset.id);
}

refs.statusAction.addEventListener('click', () => {
  if (statusActionHandler) {
    statusActionHandler();
  } else {
    hideStatus();
  }
});

refs.add.addEventListener('click', addTask);

refs.title.addEventListener('input', updateComposerState);

refs.title.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTask();
  }
});

refs.note.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTask();
  }
});

refs.important.addEventListener('click', () => {
  setPreference('important', !state.preferences.important);
  updateToggleVisuals();
});

refs.urgent.addEventListener('click', () => {
  setPreference('urgent', !state.preferences.urgent);
  updateToggleVisuals();
});

refs.search.addEventListener('input', () => {
  setPreference('search', refs.search.value);
  renderQuadrants();
});

for (const button of refs.filters) {
  button.addEventListener('click', () => {
    setPreference('filter', button.dataset.filter);
    render();
  });
}

refs.archiveDone.addEventListener('click', () => {
  archiveCompletedTasks();
});

refs.grid.addEventListener('click', (event) => {
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (action === 'select-quadrant') {
    const quadrant = quadrants.find((item) => item.id === actionElement.dataset.quadrant);
    if (quadrant) {
      setComposerQuadrant(quadrant);
    }
    return;
  }

  const task = findTaskFromEvent(event);
  if (!task) {
    return;
  }

  if (action === 'open-reminder-menu') {
    openReminderMenu(task, actionElement);
    return;
  }

  if (action === 'open-quadrant-menu') {
    openQuadrantMenu(task, actionElement);
    return;
  }

  if (action === 'toggle-done') {
    closeQuadrantMenu();
    closeReminderMenu();
    collapseExpandedTask();
    task.done = !task.done;
    task.updatedAt = new Date().toISOString();
    render();
    scheduleSave();
    showStatus(task.done ? `已完成「${compactText(task.title)}」` : `已恢复「${compactText(task.title)}」`);
    return;
  }

  if (action === 'delete') {
    closeQuadrantMenu();
    closeReminderMenu();
    deleteTask(task);
    return;
  }
});

refs.grid.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('.drag-handle');
  const card = handle?.closest('.task-card');
  const task = card ? state.tasks.find((item) => item.id === card.dataset.id) : null;
  if (!handle || !card || !task) {
    event.preventDefault();
    return;
  }

  closeQuadrantMenu();
  closeReminderMenu();
  collapseExpandedTask();
  dragState = { taskId: task.id, quadrant: task.quadrant };
  card.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', task.id);
});

refs.grid.addEventListener('dragover', (event) => {
  if (!dragState) {
    return;
  }
  const list = event.target.closest('.task-list');
  const quadrant = event.target.closest('.quadrant');
  if (!list || !quadrant || quadrant.dataset.quadrant !== dragState.quadrant) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearDropIndicators();

  const targetCard = event.target.closest('.task-card');
  if (targetCard?.dataset.id === dragState.taskId) {
    return;
  }
  if (!targetCard) {
    list.classList.add('drop-at-end');
    return;
  }

  const rect = targetCard.getBoundingClientRect();
  const position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  targetCard.classList.add(position === 'after' ? 'drop-after' : 'drop-before');
});

refs.grid.addEventListener('drop', (event) => {
  if (!dragState) {
    return;
  }
  const list = event.target.closest('.task-list');
  const quadrant = event.target.closest('.quadrant');
  if (!list || !quadrant || quadrant.dataset.quadrant !== dragState.quadrant) {
    finishDrag();
    return;
  }

  event.preventDefault();
  const taskId = event.dataTransfer.getData('text/plain') || dragState.taskId;
  const targetCard = event.target.closest('.task-card');
  if (targetCard?.dataset.id === taskId) {
    finishDrag();
    return;
  }
  let targetId = '';
  let position = 'end';
  if (targetCard && targetCard.dataset.id !== taskId) {
    const rect = targetCard.getBoundingClientRect();
    targetId = targetCard.dataset.id;
    position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  }

  if (reorderTaskWithinQuadrant(taskId, targetId, position, quadrant.dataset.quadrant)) {
    render();
    scheduleSave();
  }
  finishDrag();
});

refs.grid.addEventListener('dragend', finishDrag);

refs.grid.addEventListener('input', (event) => {
  const task = findTaskFromEvent(event);
  if (!task || !event.target.dataset.field) {
    return;
  }

  task[event.target.dataset.field] = event.target.value;
  event.target.title = event.target.value;
  syncTextAreaHeight(event.target);
  task.updatedAt = new Date().toISOString();
  event.target.closest('.task-card')?.classList.toggle('has-note', Boolean(task.note));
  renderStats();
  scheduleSave();
});

refs.grid.addEventListener('focusin', (event) => {
  if (!event.target.matches('.task-title, .task-note')) {
    return;
  }
  const task = findTaskFromEvent(event);
  if (task) {
    setExpandedTask(task.id);
  }
});

refs.grid.addEventListener('pointerdown', (event) => {
  if (!event.target.matches('.task-title, .task-note')) {
    return;
  }
  const task = findTaskFromEvent(event);
  if (task) {
    setExpandedTask(task.id);
  }
});

document.addEventListener('click', (event) => {
  if (!activeQuadrantMenu) {
    if (activeReminderMenu && !event.target.closest('.reminder-menu') && !event.target.closest('.reminder-button')) {
      closeReminderMenu();
    }
    return;
  }

  if (event.target.closest('.quadrant-menu') || event.target.closest('.task-quadrant-button')) {
    return;
  }
  closeQuadrantMenu();
  if (activeReminderMenu && !event.target.closest('.reminder-menu') && !event.target.closest('.reminder-button')) {
    closeReminderMenu();
  }
});

document.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.task-card') || event.target.closest('.quadrant-menu') || event.target.closest('.reminder-menu') || event.target.closest('.reminder-overlay')) {
    return;
  }
  collapseExpandedTask();
});

document.addEventListener('click', (event) => {
  const item = event.target.closest('[data-action="set-quadrant"]');
  if (!item || !activeQuadrantMenu) {
    return;
  }

  const task = state.tasks.find((candidate) => candidate.id === activeQuadrantMenu.taskId);
  if (!task) {
    closeQuadrantMenu();
    return;
  }

  const nextQuadrant = item.dataset.quadrant;
  const targetQuadrant = getQuadrant(nextQuadrant);
  task.order = getTopOrderForQuadrant(nextQuadrant);
  task.quadrant = nextQuadrant;
  task.updatedAt = new Date().toISOString();
  closeQuadrantMenu();
  render();
  scheduleSave();
  showStatus(`已移动到「${targetQuadrant.title}」`);
});

document.addEventListener('click', (event) => {
  const actionElement = event.target.closest('[data-action]');
  const action = actionElement?.dataset.action;
  if (!activeReminderMenu || !['save-reminder', 'clear-reminder', 'quick-reminder'].includes(action)) {
    return;
  }

  const task = state.tasks.find((candidate) => candidate.id === activeReminderMenu.taskId);
  if (!task) {
    closeReminderMenu();
    return;
  }

  if (action === 'clear-reminder') {
    setTaskReminder(task, '');
    return;
  }

  if (action === 'quick-reminder') {
    setTaskReminder(task, getQuickReminderValue(actionElement.dataset.minutes));
    return;
  }

  const input = activeReminderMenu.node.querySelector('.reminder-menu-input');
  setTaskReminder(task, fromDateTimeLocalValue(input.value));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const hadTransientUi = Boolean(
      activeQuadrantMenu ||
      activeReminderMenu ||
      state.editingTaskId ||
      !refs.reminderOverlay.classList.contains('hidden') ||
      !refs.statusToast.classList.contains('hidden')
    );
    closeQuadrantMenu({ restoreFocus: true });
    closeReminderMenu();
    hideReminderOverlay();
    hideStatus();
    collapseExpandedTask();
    event.preventDefault();
    if (!hadTransientUi) {
      api.hide();
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    refs.search.focus();
    refs.search.select();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    refs.title.focus();
    refs.title.select();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && (document.activeElement === refs.title || document.activeElement === refs.note)) {
    event.preventDefault();
    addTask();
    return;
  }

  if (activeReminderMenu && event.key === 'Enter' && event.target.closest('.reminder-menu')) {
    const task = state.tasks.find((candidate) => candidate.id === activeReminderMenu.taskId);
    const input = activeReminderMenu.node.querySelector('.reminder-menu-input');
    if (task && input) {
      event.preventDefault();
      setTaskReminder(task, fromDateTimeLocalValue(input.value));
    }
    return;
  }

  if (!activeQuadrantMenu || !['ArrowDown', 'ArrowUp'].includes(event.key)) {
    return;
  }

  const items = [...activeQuadrantMenu.node.querySelectorAll('.quadrant-menu-item')];
  const currentIndex = Math.max(0, items.indexOf(document.activeElement));
  const offset = event.key === 'ArrowDown' ? 1 : -1;
  const nextIndex = (currentIndex + offset + items.length) % items.length;
  event.preventDefault();
  items[nextIndex]?.focus();
});

refs.minimize.addEventListener('click', () => api.minimize());
refs.close.addEventListener('click', () => api.hide());

async function togglePinned() {
  const nextPinned = !state.preferences.pinned;
  try {
    const confirmed = await api.setPinned(nextPinned);
    state.preferences.pinned = typeof confirmed === 'boolean' ? confirmed : nextPinned;
    renderPins();
    scheduleSave();
    showStatus(state.preferences.pinned ? '窗口已固定' : '窗口已取消固定');
  } catch (error) {
    console.error('Failed to update pinned state:', error);
    state.preferences.pinned = !nextPinned;
    renderPins();
    showStatus('固定窗口失败', { tone: 'danger' });
  }
}

refs.pin.addEventListener('click', togglePinned);
refs.openData.addEventListener('click', () => api.openDataFolder());

refs.resizeGrip.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  resizeState = {
    pointerId: event.pointerId,
    startX: event.screenX,
    startY: event.screenY,
    startWidth: window.innerWidth,
    startHeight: window.innerHeight
  };
  refs.resizeGrip.setPointerCapture(event.pointerId);
  document.body.classList.add('is-resizing');
});

refs.resizeGrip.addEventListener('pointermove', (event) => {
  if (!resizeState) {
    return;
  }
  const width = resizeState.startWidth + event.screenX - resizeState.startX;
  const height = resizeState.startHeight + event.screenY - resizeState.startY;
  api.resizeWindow({ width, height });
});

function stopResize(event) {
  if (!resizeState) {
    return;
  }
  if (refs.resizeGrip.hasPointerCapture(resizeState.pointerId)) {
    refs.resizeGrip.releasePointerCapture(resizeState.pointerId);
  }
  resizeState = null;
  document.body.classList.remove('is-resizing');
}

refs.resizeGrip.addEventListener('pointerup', stopResize);
refs.resizeGrip.addEventListener('pointercancel', stopResize);

refs.reminderDismiss.addEventListener('click', hideReminderOverlay);

refs.reminderSnooze.addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === activeReminderTaskId);
  if (!task) {
    hideReminderOverlay();
    return;
  }
  setTaskReminder(task, getQuickReminderValue('10'));
  hideReminderOverlay();
});

refs.reminderDone.addEventListener('click', () => {
  const task = state.tasks.find((item) => item.id === activeReminderTaskId);
  if (!task) {
    hideReminderOverlay();
    return;
  }
  task.done = true;
  task.remindedAt = new Date().toISOString();
  task.updatedAt = new Date().toISOString();
  hideReminderOverlay();
  render();
  scheduleSave();
});

api.onShown((_event, payload = {}) => {
  if (payload.animate !== false) {
    playShellIntro();
  }
  closeQuadrantMenu();
  closeReminderMenu();
  if (payload.focusTitle === false) {
    return;
  }
  setTimeout(() => {
    refs.title.focus();
    refs.title.select();
  }, 30);
});

api.onReminder((_event, reminder) => {
  closeQuadrantMenu();
  closeReminderMenu();
  showReminderOverlay(reminder);
});

async function boot() {
  try {
    const payload = await api.load();
    state.tasks = (payload.tasks || []).map(normalizeTask);
    state.preferences = { ...state.preferences, ...(payload.preferences || {}) };
    state.system = payload.system || {};
    refs.shortcutLabel.textContent = formatShortcut(state.system.shortcut);
    refs.search.value = state.preferences.search || '';
    const confirmedPinned = await api.setPinned(state.preferences.pinned);
    if (typeof confirmedPinned === 'boolean') {
      state.preferences.pinned = confirmedPinned;
    }
    render();
    playShellIntro();
  } catch (error) {
    console.error('Failed to boot app:', error);
    refs.shortcutLabel.textContent = '本地预览';
    render();
    playShellIntro();
    showStatus('启动时未能读取本地数据', { tone: 'danger', timeout: 0 });
  }
}

boot();
