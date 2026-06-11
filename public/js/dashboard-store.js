import { DEFAULT_CARD_TYPES, getCardType } from "./widget-catalog.js";

const STORAGE_KEY = "redmine-dashboard-builder:v2";

export function loadDashboards() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(stored) && stored.length) {
      return stored.map(normalizeDashboard);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return [createDashboardFromTemplate("sprint-pm", 1)];
}

export function saveDashboards(dashboards) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dashboards.map(normalizeDashboard)));
}

export function createDashboard(index, name = `Дашборд ${index}`) {
  return createDashboardFromTemplate("blank", index, name);
}

export function createDashboardFromTemplate(templateId, index = 1, customName) {
  const template = DASHBOARD_TEMPLATES.find((item) => item.id === templateId) || DASHBOARD_TEMPLATES[0];

  return normalizeDashboard({
    id: createId(),
    name: customName || `${template.name} ${index > 1 ? index : ""}`.trim(),
    projectId: "",
    period: {
      mode: "last_days",
      days: 30,
      from: "",
      to: "",
      versionId: "",
    },
    filters: emptyFilters(),
    cards: template.cards.map(createCard),
  });
}

export function getCurrentDashboard(dashboards, dashboardId) {
  return dashboards.find((dashboard) => dashboard.id === dashboardId) || dashboards[0];
}

export function updateDashboard(dashboards, dashboardId, patch) {
  const dashboard = getCurrentDashboard(dashboards, dashboardId);
  Object.assign(dashboard, normalizeDashboard({ ...dashboard, ...patch }));
  return dashboard;
}

export function addCard(dashboard, type) {
  dashboard.cards.push(createCard(type));
  return dashboard;
}

export function updateCard(dashboard, cardId, patch) {
  const card = dashboard.cards.find((item) => item.id === cardId);
  if (card) {
    Object.assign(card, normalizeCard({
      ...card,
      ...patch,
      settings: { ...card.settings, ...patch.settings },
      scope: mergeScope(card.scope, patch.scope),
    }));
  }
  return card;
}

export function removeCard(dashboard, cardId) {
  dashboard.cards = dashboard.cards.filter((card) => card.id !== cardId);
}

export function moveCard(dashboard, cardId, direction) {
  const index = dashboard.cards.findIndex((card) => card.id === cardId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= dashboard.cards.length) {
    return;
  }
  const [card] = dashboard.cards.splice(index, 1);
  dashboard.cards.splice(nextIndex, 0, card);
}

export function removeDashboard(dashboards, dashboardId) {
  if (dashboards.length <= 1) {
    return [createDashboardFromTemplate("sprint-pm", 1)];
  }

  return dashboards.filter((dashboard) => dashboard.id !== dashboardId);
}

export const DASHBOARD_TEMPLATES = [
  {
    id: "blank",
    name: "Порожній дашборд",
    cards: ["metrics"],
  },
  {
    id: "team-overview",
    name: "Огляд команди",
    cards: ["metrics", "status", "assignees", "overdue", "stale", "time-user"],
  },
  {
    id: "sprint-review",
    name: "Спринт",
    cards: ["metrics", "sprint-progress", "status", "overdue-by-assignee", "recent-table"],
  },
  {
    id: "posbox",
    name: "Posbox",
    cards: ["metrics", "tracker", "custom-field", "overdue", "time-activity"],
  },
  {
    id: "sprint-pm",
    name: "Sprint PM",
    cards: [
      { type: "burndown", title: "Burndown задач", size: "wide", scope: { filters: { trackerIds: ["15", "18"] } } },
      { type: "burndown", title: "Burndown багів", size: "wide", scope: { filters: { trackerIds: ["17", "24"] } } },
      { type: "priority", title: "Пріоритети відкритих багів", chartType: "pie", scope: { filters: { trackerIds: ["17", "24"], statusId: "open" } } },
      { type: "overdue", title: "Прострочені задачі / баги", size: "wide" },
      { type: "stale", title: "Задачі без руху", size: "wide" },
      { type: "effort-table", title: "Оцінка vs витрачено", size: "wide" },
      { type: "sprint-movement", title: "Додано / вилучено", size: "medium" },
      { type: "sprint-timeline", title: "Лог спринту", size: "wide" },
      { type: "time-user", title: "Затреканий час по людях", size: "medium" },
      { type: "pos-worklog-user", title: "POS_Worklog по людях", size: "medium" },
    ],
  },
];

function normalizeDashboard(dashboard) {
  const period = dashboard.period || {
    mode: "last_days",
    days: Number(dashboard.days || 30),
    from: "",
    to: "",
    versionId: "",
  };
  const filters = dashboard.filters || {};
  const cards = Array.isArray(dashboard.cards)
    ? dashboard.cards
    : migrateWidgetsToCards(dashboard.widgets);

  return {
    id: String(dashboard.id || createId()),
    name: String(dashboard.name || "Дашборд").slice(0, 64),
    projectId: dashboard.projectId ? String(dashboard.projectId) : "",
    period: {
      mode: ["last_days", "custom", "sprint"].includes(period.mode) ? period.mode : "last_days",
      days: Number(period.days || 30),
      from: period.from || "",
      to: period.to || "",
      versionId: period.versionId ? String(period.versionId) : "",
      sprintId: period.sprintId ? String(period.sprintId) : "",
    },
    filters: {
      assigneeId: filters.assigneeId ? String(filters.assigneeId) : "",
      timeUserIds: normalizeIdList(filters.timeUserIds),
      authorId: filters.authorId ? String(filters.authorId) : "",
      trackerId: filters.trackerId ? String(filters.trackerId) : "",
      trackerIds: normalizeTrackerIds(filters),
      statusId: normalizeStatusId(filters.statusId),
      priorityId: filters.priorityId ? String(filters.priorityId) : "",
      customFields: normalizeCustomFields(filters.customFields),
    },
    cards: cards.map(normalizeCard).filter((card) => getCardType(card.type)),
  };
}

function normalizeCard(card) {
  const type = typeof card === "string" ? card : card.type;
  const definition = getCardType(type) || getCardType("metrics");

  return {
    id: typeof card === "string" ? createId() : String(card.id || createId()),
    type: definition.id,
    title: typeof card === "string" ? definition.title : String(card.title || definition.title).slice(0, 80),
    size: ["small", "medium", "wide"].includes(card.size) ? card.size : definition.defaultSize,
    chartType: ["bar", "donut", "pie"].includes(card.chartType) ? card.chartType : definition.defaultChartType,
    settings: {
      groupBy: card.settings?.groupBy || definition.defaultGroupBy || "",
      customFieldKey: card.settings?.customFieldKey || "",
      sort: card.settings?.sort || "value_desc",
    },
    scope: normalizeCardScope(card.scope),
  };
}

function normalizeCardScope(scope = {}) {
  const period = scope.period || {};
  const filters = scope.filters || {};

  return {
    projectId: scope.projectId ? String(scope.projectId) : "",
    period: {
      mode: ["last_days", "custom", "sprint"].includes(period.mode) ? period.mode : "last_days",
      days: Number(period.days || 30),
      from: period.from || "",
      to: period.to || "",
      versionId: period.versionId ? String(period.versionId) : "",
      sprintId: period.sprintId ? String(period.sprintId) : "",
    },
    filters: {
      assigneeId: filters.assigneeId ? String(filters.assigneeId) : "",
      timeUserIds: normalizeIdList(filters.timeUserIds),
      authorId: filters.authorId ? String(filters.authorId) : "",
      trackerId: filters.trackerId ? String(filters.trackerId) : "",
      trackerIds: normalizeTrackerIds(filters),
      statusId: normalizeStatusId(filters.statusId),
      priorityId: filters.priorityId ? String(filters.priorityId) : "",
      customFields: normalizeCustomFields(filters.customFields),
    },
  };
}

function mergeScope(current = {}, patch = {}) {
  const filters = {
    ...current.filters,
    ...patch.filters,
    customFields: {
      ...current.filters?.customFields,
      ...patch.filters?.customFields,
    },
  };

  if (Object.prototype.hasOwnProperty.call(patch.filters || {}, "trackerIds")) {
    filters.trackerId = "";
  }

  return {
    ...current,
    ...patch,
    period: { ...current.period, ...patch.period },
    filters,
  };
}

function createCard(card) {
  return normalizeCard(typeof card === "string" ? { id: createId(), type: card } : { id: createId(), ...card });
}

function migrateWidgetsToCards(widgets) {
  const widgetIds = Array.isArray(widgets) && widgets.length ? widgets : DEFAULT_CARD_TYPES;
  return widgetIds.map((type) => ({ id: createId(), type }));
}

function emptyFilters() {
  return {
    assigneeId: "",
    timeUserIds: [],
    authorId: "",
    trackerId: "",
    trackerIds: [],
    statusId: "*",
    priorityId: "",
    customFields: {},
  };
}

function normalizeStatusId(statusId) {
  const value = statusId ? String(statusId) : "*";
  return value === "open" ? "open" : value;
}

function normalizeCustomFields(customFields = {}) {
  return Object.fromEntries(
    Object.entries(customFields)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
}

function normalizeIdList(value = []) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeTrackerIds(filters = {}) {
  const trackerIds = normalizeIdList(filters.trackerIds);
  return trackerIds.length ? trackerIds : normalizeIdList(filters.trackerId);
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
