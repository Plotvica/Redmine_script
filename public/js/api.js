export async function fetchHealth() {
  return requestJson("/api/health");
}

export async function fetchProjects() {
  return requestJson("/api/projects");
}

export async function fetchMetadata({ projectId }) {
  const params = new URLSearchParams();

  if (projectId) {
    params.set("project_id", projectId);
  }

  return requestJson(`/api/metadata?${params}`);
}

export async function fetchDashboard(dashboard) {
  const params = new URLSearchParams({
    period_mode: dashboard.period.mode,
    days: String(dashboard.period.days || 30),
  });

  if (dashboard.filters.statusId !== "open") {
    params.set("status_id", dashboard.filters.statusId || "*");
  }

  if (dashboard.projectId) {
    params.set("project_id", dashboard.projectId);
  }

  if (dashboard.period.from) {
    params.set("from", dashboard.period.from);
  }

  if (dashboard.period.to) {
    params.set("to", dashboard.period.to);
  }

  if (dashboard.period.versionId) {
    params.set("version_id", dashboard.period.versionId);
  }

  if (dashboard.period.sprintId) {
    params.set("sprint_id", dashboard.period.sprintId);
  }

  if (dashboard.period.sprintName) {
    params.set("sprint_name", dashboard.period.sprintName);
  }

  if (dashboard.filters.assigneeId) {
    params.set("assignee_id", dashboard.filters.assigneeId);
  }

  if (dashboard.filters.timeUserIds?.length) {
    params.set("time_user_ids", dashboard.filters.timeUserIds.join(","));
  }

  if (dashboard.filters.timeSource) {
    params.set("time_source", dashboard.filters.timeSource);
  }

  if (dashboard.filters.authorId) {
    params.set("author_id", dashboard.filters.authorId);
  }

  const trackerIds = dashboard.filters.trackerIds?.length
    ? dashboard.filters.trackerIds
    : dashboard.filters.trackerId
      ? [dashboard.filters.trackerId]
      : [];

  if (trackerIds.length) {
    params.set("tracker_ids", trackerIds.join(","));
  }

  if (dashboard.filters.priorityId) {
    params.set("priority_id", dashboard.filters.priorityId);
  }

  if (dashboard.features?.length) {
    params.set("features", dashboard.features.join(","));
  }

  for (const [key, value] of Object.entries(dashboard.filters.customFields || {})) {
    if (value) {
      params.set(key, value);
    }
  }

  return requestJson(`/api/dashboard?${params}`);
}

export async function fetchSavedDashboards() {
  return requestJson("/api/saved-dashboards");
}

export async function saveDashboardsToServer(dashboards) {
  return requestJson("/api/saved-dashboards", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dashboards }),
  });
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed: ${response.status}`);
  }

  return data;
}
