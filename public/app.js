import {
  fetchDashboard,
  fetchHealth,
  fetchMetadata,
  fetchProjects,
  fetchSavedDashboards,
  saveDashboardsToServer,
} from "./js/api.js";
import { elements } from "./js/dom.js";
import {
  addCard,
  createDashboard,
  getCurrentDashboard,
  loadDashboards,
  moveCard,
  removeCard,
  removeDashboard,
  saveDashboards,
  updateCard,
  updateDashboard,
} from "./js/dashboard-store.js";
import {
  renderCardEditorList,
  renderCardTypeSelect,
  renderDashboardTabs,
  syncDashboardForm,
  syncModeButtons,
} from "./js/render/controls.js";
import { renderDashboardData, renderLoading, renderSetupError } from "./js/render/dashboard-view.js";

const state = {
  dashboards: loadDashboards(),
  currentDashboardId: null,
  mode: "view",
  projects: [],
  metadata: emptyMetadata(),
  dashboardData: null,
  cardData: null,
  metadataCache: new Map(),
};

state.currentDashboardId = getCurrentDashboard(state.dashboards, state.currentDashboardId).id;

elements.dashboardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCurrentDashboard();
});
elements.dashboardList.addEventListener("click", handleDashboardClick);
elements.cardEditorList.addEventListener("change", handleCardEditorChange);
elements.cardEditorList.addEventListener("click", handleCardEditorClick);
elements.addCardButton.addEventListener("click", async () => {
  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  addCard(dashboard, elements.cardTypeSelect.value);
  await persistAndRenderControls();
  await loadCurrentDashboard();
});
elements.newDashboardButton.addEventListener("click", async () => {
  const dashboard = createDashboard(state.dashboards.length + 1);
  state.dashboards.push(dashboard);
  state.currentDashboardId = dashboard.id;
  await persistAndRenderControls();
  await loadCurrentDashboard();
});
elements.deleteDashboardButton.addEventListener("click", async () => {
  state.dashboards = removeDashboard(state.dashboards, state.currentDashboardId);
  state.currentDashboardId = getCurrentDashboard(state.dashboards).id;
  await persistAndRenderControls();
  await loadCurrentDashboard();
});
elements.viewModeButton.addEventListener("click", () => setMode("view"));
elements.editModeButton.addEventListener("click", () => setMode("edit"));
elements.refreshButton.addEventListener("click", () => loadCurrentDashboard());
elements.quickProjectSelect.addEventListener("change", handleQuickScopeChange);
elements.quickUnitSelect.addEventListener("change", handleQuickScopeChange);
elements.quickSprintSelect.addEventListener("change", handleQuickScopeChange);

init();

async function init() {
  renderLoading(elements);
  renderStaticControls();

  try {
    const health = await fetchHealth();
    elements.connectionStatus.textContent = health.configured
      ? `Підключено до ${health.redmineUrl}`
      : "Перевір .env";

    if (!health.configured) {
      renderSetupError(elements, health.configIssues.join(" "));
      renderControls();
      return;
    }

    await hydrateSavedDashboards();
    const projectData = await fetchProjects();
    state.projects = projectData.projects || [];
    state.metadata = await getMetadataForProject("");
    renderControls();
    await loadCurrentDashboard();
  } catch (error) {
    elements.connectionStatus.textContent = "Помилка підключення";
    renderSetupError(elements, error.message);
  }
}

async function hydrateSavedDashboards() {
  try {
    const saved = await fetchSavedDashboards();
    if (saved.dashboards?.length) {
      state.dashboards = saved.dashboards;
      state.currentDashboardId = getCurrentDashboard(state.dashboards, state.currentDashboardId).id;
      saveDashboards(state.dashboards);
    }
  } catch {
    // Local storage remains the offline fallback.
  }
}

async function saveCurrentDashboard() {
  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  updateDashboard(state.dashboards, state.currentDashboardId, {
    ...dashboard,
    name: elements.dashboardName.value.trim() || "Новий дашборд",
  });

  await persistAndRenderControls();
  await loadCurrentDashboard();
}

async function loadCurrentDashboard() {
  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  state.currentDashboardId = dashboard.id;
  await ensureMetadataForDashboard(dashboard);
  syncDashboardForm(elements, dashboard);
  renderQuickScopeControls(dashboard);
  renderDashboardTabs(elements.dashboardList, state.dashboards, state.currentDashboardId);
  renderCardEditorList(elements.cardEditorList, dashboard, state.metadata, getCardMetadata);
  renderLoading(elements, dashboard.name);

  try {
    state.cardData = await fetchCardData(dashboard);
    state.dashboardData = firstDashboardData(state.cardData);
    renderDashboardData(elements, dashboard, state.dashboardData, { mode: state.mode, cardData: state.cardData });
  } catch (error) {
    renderSetupError(elements, error.message);
  }
}

function renderStaticControls() {
  renderCardTypeSelect(elements.cardTypeSelect);
  syncModeButtons(elements, state.mode);
}

function renderControls() {
  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  syncDashboardForm(elements, dashboard);
  renderQuickScopeControls(dashboard);
  renderDashboardTabs(elements.dashboardList, state.dashboards, state.currentDashboardId);
  renderCardEditorList(elements.cardEditorList, dashboard, state.metadata, getCardMetadata);
}

function renderQuickScopeControls(dashboard) {
  const scope = getQuickScope(dashboard);
  const metadata = state.metadataCache.get(scope.projectId || "") || state.metadata;
  const unitField = findUnitField(metadata);

  fillSelect(elements.quickProjectSelect, state.projects, "Усі проєкти", scope.projectId);
  fillSelect(
    elements.quickUnitSelect,
    (unitField?.possibleValues || []).map((item) => ({ id: item.value, name: item.label })),
    "Усі Unit",
    scope.unitValue,
  );
  fillSelect(elements.quickSprintSelect, metadata.sprints || [], "Усі sprint", scope.sprintId);

  elements.quickUnitSelect.disabled = !unitField;
  elements.quickSprintSelect.disabled = !scope.projectId || !(metadata.sprints || []).length;
}

function fillSelect(select, items, emptyLabel, value) {
  select.replaceChildren(new Option(emptyLabel, ""));

  for (const item of items || []) {
    select.append(new Option(item.name, String(item.id)));
  }

  select.value = [...select.options].some((option) => option.value === value) ? value : "";
}

function getQuickScope(dashboard) {
  const projectId = dashboard.projectId || sharedCardValue(dashboard.cards, (card) => card.scope?.projectId) || "";
  const metadata = state.metadataCache.get(projectId || "") || state.metadata;
  const unitField = findUnitField(metadata);
  const unitFieldKey = unitField?.key || findSharedUnitFieldKey(dashboard);

  return {
    projectId,
    unitFieldKey,
    unitValue: dashboard.filters?.customFields?.[unitFieldKey]
      || sharedCardValue(dashboard.cards, (card) => card.scope?.filters?.customFields?.[unitFieldKey])
      || "",
    sprintId: dashboard.period?.sprintId
      || sharedCardValue(dashboard.cards, (card) => card.scope?.period?.sprintId)
      || "",
  };
}

function applyQuickScope(dashboard, scope) {
  dashboard.projectId = scope.projectId || "";
  dashboard.period = {
    ...dashboard.period,
    mode: scope.sprintId ? "sprint" : dashboard.period.mode,
    sprintId: scope.sprintId || "",
    from: "",
    to: "",
  };
  dashboard.filters = {
    ...dashboard.filters,
    customFields: setCustomFieldValue(dashboard.filters?.customFields, scope.unitFieldKey, scope.unitValue),
  };

  for (const card of dashboard.cards) {
    const cardScope = card.scope || {};
    const cardPeriod = cardScope.period || {};
    const cardFilters = cardScope.filters || {};
    card.scope = {
      ...cardScope,
      projectId: scope.projectId || "",
      period: {
        ...cardPeriod,
        mode: scope.sprintId ? "sprint" : cardPeriod.mode,
        sprintId: scope.sprintId || "",
        from: "",
        to: "",
      },
      filters: {
        ...cardFilters,
        customFields: setCustomFieldValue(cardFilters.customFields, scope.unitFieldKey, scope.unitValue),
      },
    };
  }
}

function setCustomFieldValue(customFields = {}, key, value) {
  const next = { ...customFields };
  if (!key) {
    return next;
  }
  if (value) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

function findUnitField(metadata) {
  return (metadata.customFields || []).find((field) => field.name === "Posbox_Unit")
    || (metadata.customFields || []).find((field) => /unit/i.test(field.name));
}

function findSharedUnitFieldKey(dashboard) {
  for (const card of dashboard.cards || []) {
    const key = Object.keys(card.scope?.filters?.customFields || {}).find((item) => /^cf_/.test(item));
    if (key) {
      return key;
    }
  }
  return "";
}

function sharedCardValue(cards, read) {
  const values = [...new Set((cards || []).map(read).filter(Boolean).map(String))];
  return values.length === 1 ? values[0] : "";
}

function keepIfAvailable(value, items) {
  return (items || []).some((item) => String(item.id ?? item.value) === value) ? value : "";
}

async function persistAndRenderControls() {
  saveDashboards(state.dashboards);
  try {
    await saveDashboardsToServer(state.dashboards);
  } catch {
    // Keep local storage as a durable-enough fallback if the JSON file cannot be written.
  }
  renderControls();
}

function handleDashboardClick(event) {
  const button = event.target.closest("[data-dashboard-id]");
  if (!button || button.dataset.dashboardId === state.currentDashboardId) {
    return;
  }

  state.currentDashboardId = button.dataset.dashboardId;
  loadCurrentDashboard();
}

async function handleQuickScopeChange(event) {
  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  const previousScope = getQuickScope(dashboard);
  const projectId = elements.quickProjectSelect.value;
  const metadata = await getMetadataForProject(projectId);
  const unitField = findUnitField(metadata);
  const unitValue = event.target === elements.quickProjectSelect
    ? keepIfAvailable(previousScope.unitValue, unitField?.possibleValues || [])
    : elements.quickUnitSelect.value;
  const sprintId = event.target === elements.quickProjectSelect
    ? keepIfAvailable(previousScope.sprintId, metadata.sprints || [])
    : elements.quickSprintSelect.value;

  applyQuickScope(dashboard, {
    projectId,
    unitFieldKey: unitField?.key || previousScope.unitFieldKey,
    unitValue,
    sprintId,
  });

  await persistAndRenderControls();
  await loadCurrentDashboard();
}

async function handleCardEditorChange(event) {
  const control = event.target.closest("[data-card-action]");
  const cardNode = event.target.closest("[data-card-id]");
  if (!control || !cardNode) {
    return;
  }

  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  const action = control.dataset.cardAction;
  const patch = {};

  if (["title", "size", "chartType"].includes(action)) {
    patch[action] = control.value;
  }

  if (action === "customFieldKey") {
    patch.settings = { customFieldKey: control.value };
  }

  if (action.startsWith("scope.")) {
    patch.scope = patchCardScope(action, control);
  }

  updateCard(dashboard, cardNode.dataset.cardId, patch);
  if (action === "scope.projectId") {
    await getMetadataForProject(control.value);
  }
  await persistAndRenderControls();
  state.cardData = await fetchCardData(dashboard, state.dashboardData);
  state.dashboardData = firstDashboardData(state.cardData);
  renderDashboardData(elements, dashboard, state.dashboardData, { mode: state.mode, cardData: state.cardData });
}

async function handleCardEditorClick(event) {
  const button = event.target.closest("button[data-card-action]");
  const cardNode = event.target.closest("[data-card-id]");
  if (!button || !cardNode) {
    return;
  }

  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  const action = button.dataset.cardAction;

  if (action === "delete") {
    removeCard(dashboard, cardNode.dataset.cardId);
  } else if (action === "up") {
    moveCard(dashboard, cardNode.dataset.cardId, -1);
  } else if (action === "down") {
    moveCard(dashboard, cardNode.dataset.cardId, 1);
  }

  await persistAndRenderControls();
  state.cardData = await fetchCardData(dashboard, state.dashboardData);
  state.dashboardData = firstDashboardData(state.cardData);
  renderDashboardData(elements, dashboard, state.dashboardData, { mode: state.mode, cardData: state.cardData });
}

async function getMetadataForProject(projectId = "") {
  const key = projectId || "";
  if (state.metadataCache.has(key)) {
    return state.metadataCache.get(key);
  }

  const metadata = await fetchMetadata({ projectId: key });
  metadata.projects = state.projects;
  state.metadataCache.set(key, metadata);
  if (!key) {
    state.metadata = metadata;
  }
  return metadata;
}

async function ensureMetadataForDashboard(dashboard) {
  await getMetadataForProject("");
  const projectIds = [...new Set(dashboard.cards.map((card) => card.scope?.projectId || ""))].filter(Boolean);
  await Promise.all(projectIds.map((projectId) => getMetadataForProject(projectId)));
}

function getCardMetadata(card) {
  return state.metadataCache.get(card.scope?.projectId || "") || state.metadata;
}

function setMode(mode) {
  state.mode = mode;
  syncModeButtons(elements, state.mode);
  const dashboard = getCurrentDashboard(state.dashboards, state.currentDashboardId);
  if (state.dashboardData) {
    renderDashboardData(elements, dashboard, state.dashboardData, { mode: state.mode, cardData: state.cardData });
  }
}

async function fetchCardData(dashboard) {
  await ensureMetadataForDashboard(dashboard);
  const scopedDashboards = new Map();

  for (const card of dashboard.cards) {
    const scopedDashboard = dashboardFromCardScope(dashboard, card);
    const key = JSON.stringify({
      projectId: scopedDashboard.projectId,
      period: scopedDashboard.period,
      filters: scopedDashboard.filters,
    });
    if (!scopedDashboards.has(key)) {
      scopedDashboards.set(key, {
        dashboard: scopedDashboard,
        cardIds: [],
      });
    }
    scopedDashboards.get(key).cardIds.push(card.id);
  }

  const loaded = await Promise.all([...scopedDashboards.values()].map(async (entry) => ({
    cardIds: entry.cardIds,
    data: await fetchDashboard(entry.dashboard),
  })));
  const entries = loaded.flatMap((entry) => entry.cardIds.map((cardId) => [cardId, entry.data]));

  return Object.fromEntries(entries);
}

function dashboardFromCardScope(dashboard, card) {
  const period = resolveCardPeriod(card.scope.period, card.scope.projectId);
  const filters = { ...card.scope.filters };

  if (card.type === "pos-worklog-user") {
    filters.timeSource = "pos_worklog";
  }

  return {
    ...dashboard,
    projectId: card.scope.projectId,
    period,
    filters,
  };
}

function resolveCardPeriod(period, projectId = "") {
  if (period.mode !== "sprint") {
    return period;
  }

  const metadata = getCardMetadata({ scope: { projectId } });
  const sprint = metadata.sprints.find((item) => item.id === period.sprintId);
  if (sprint) {
    return {
      ...period,
      from: period.from || sprint.startDate || "",
      to: period.to || sprint.endDate || "",
    };
  }

  if (!period.versionId) {
    return period;
  }

  const version = metadata.versions.find((item) => item.id === period.versionId);
  return {
    ...period,
    from: period.from || inferSprintStart(version) || "",
    to: period.to || version?.dueDate || "",
  };
}

function inferSprintStart(version) {
  if (!version) {
    return "";
  }

  const created = version.createdOn?.slice(0, 10) || "";
  const due = version.dueDate || "";
  if (!due) {
    return created;
  }

  const createdDate = new Date(created);
  const dueDate = new Date(due);
  if (created && Number.isFinite(createdDate.getTime()) && ((dueDate - createdDate) / 86400000) >= 3) {
    return created;
  }

  dueDate.setDate(dueDate.getDate() - 13);
  return dueDate.toISOString().slice(0, 10);
}

function patchCardScope(action, control) {
  const path = action.split(".").slice(1);
  const value = control.multiple
    ? [...control.selectedOptions].map((option) => option.value)
    : control.type === "checkbox"
      ? control.checked
      : control.value;
  const scope = {};
  let target = scope;

  for (const segment of path.slice(0, -1)) {
    target[segment] = {};
    target = target[segment];
  }

  target[path[path.length - 1]] = value;
  return scope;
}

function firstDashboardData(cardData) {
  return Object.values(cardData || {})[0] || null;
}

function emptyMetadata() {
  return {
    trackers: [],
    statuses: [],
    priorities: [],
    users: [],
    customFields: [],
    versions: [],
    sprints: [],
    warnings: [],
  };
}
