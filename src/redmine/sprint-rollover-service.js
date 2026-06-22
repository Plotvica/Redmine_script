const MAX_ROLLOVER_ISSUES = 500;
const { getAgileSprintIds, primeAgileSprintIds } = require("./agile-membership-service");

async function previewSprintRollover({ rootDir, redmine, config, projectId, targetSprintId, customFields = {} }) {
  validateScope({ projectId, targetSprintId, customFields });
  const { sourceSprint, targetSprint } = await resolveSprintPair({ redmine, projectId, targetSprintId });
  const issues = await fetchOpenScopeIssues({ redmine, config, projectId, customFields });
  const sprintIds = await getAgileSprintIds({ rootDir, redmine, issues });
  const sourceIssues = issues
    .filter((issue) => sprintIds.get(Number(issue.id)) === String(sourceSprint.id))
    .map((issue) => summarizeIssue(issue, config.redmine.url));

  return {
    projectId: String(projectId),
    sourceSprint: summarizeSprint(sourceSprint),
    targetSprint: summarizeSprint(targetSprint),
    customFields,
    scannedIssues: issues.length,
    issues: sourceIssues.sort((a, b) => a.id - b.id),
  };
}

async function executeSprintRollover({
  redmine,
  config,
  rootDir,
  projectId,
  targetSprintId,
  customFields = {},
  issueIds = [],
}) {
  validateScope({ projectId, targetSprintId, customFields });
  const requestedIds = normalizeIssueIds(issueIds);
  if (!requestedIds.length) {
    throw badRequest("Не вибрано жодної задачі для перенесення.");
  }
  if (requestedIds.length > MAX_ROLLOVER_ISSUES) {
    throw badRequest(`За один раз можна перенести не більше ${MAX_ROLLOVER_ISSUES} задач.`);
  }

  const { sourceSprint, targetSprint } = await resolveSprintPair({ redmine, projectId, targetSprintId });
  const closedStatusIds = await fetchClosedStatusIds(redmine);
  const moved = [];
  const skipped = [];
  const failed = [];

  for (const issueId of requestedIds) {
    try {
      const response = await redmine.get(`/issues/${encodeURIComponent(issueId)}.json`);
      const issue = response.issue;
      const agileData = await fetchAgileData(redmine, issueId);
      const reason = rolloverSkipReason({
        issue,
        agileData,
        projectId,
        sourceSprintId: sourceSprint.id,
        customFields,
        closedStatusIds,
      });

      if (reason) {
        skipped.push({ id: issueId, subject: issue?.subject || "", reason });
        continue;
      }

      await redmine.put(`/issues/${encodeURIComponent(issueId)}.json`, {
        issue: {
          agile_data_attributes: {
            agile_sprint_id: Number(targetSprint.id),
          },
        },
      });

      const verification = await fetchAgileData(redmine, issueId);
      if (Number(verification.agile_sprint_id) !== Number(targetSprint.id)) {
        throw new Error("Redmine не підтвердив новий sprint.");
      }

      moved.push(summarizeIssue(issue, config.redmine.url));
    } catch (error) {
      failed.push({ id: issueId, error: error.message });
    }
  }

  if (moved.length) {
    await primeAgileSprintIds(rootDir, moved.map((issue) => issue.id), targetSprint.id);
  }

  return {
    projectId: String(projectId),
    sourceSprint: summarizeSprint(sourceSprint),
    targetSprint: summarizeSprint(targetSprint),
    moved,
    skipped,
    failed,
  };
}

async function resolveSprintPair({ redmine, projectId, targetSprintId }) {
  const response = await redmine.get(`/projects/${encodeURIComponent(projectId)}/agile_sprints.json`);
  const sprints = [...(response.sprints || [])].sort(compareSprints);
  const targetIndex = sprints.findIndex((sprint) => String(sprint.id) === String(targetSprintId));

  if (targetIndex < 0) {
    throw badRequest("Вибраний поточний sprint не знайдено у проєкті.");
  }
  if (targetIndex === 0) {
    throw badRequest("Для вибраного sprint немає попереднього sprint.");
  }

  return {
    sourceSprint: sprints[targetIndex - 1],
    targetSprint: sprints[targetIndex],
  };
}

async function fetchOpenScopeIssues({ redmine, config, projectId, customFields }) {
  return redmine.fetchPaginated(
    "/issues.json",
    {
      project_id: projectId,
      status_id: "open",
      sort: "id:asc",
      ...customFields,
    },
    "issues",
    config.redmine.pageLimit,
  );
}

async function fetchAgileData(redmine, issueId) {
  const response = await redmine.get(`/issues/${encodeURIComponent(issueId)}/agile_data.json`);
  return response.agile_data || {};
}

async function fetchClosedStatusIds(redmine) {
  const response = await redmine.get("/issue_statuses.json");
  return new Set(
    (response.issue_statuses || [])
      .filter((status) => status.is_closed)
      .map((status) => Number(status.id)),
  );
}

function rolloverSkipReason({
  issue,
  agileData,
  projectId,
  sourceSprintId,
  customFields,
  closedStatusIds,
}) {
  if (!issue) {
    return "Задачу не знайдено.";
  }
  if (String(issue.project?.id || "") !== String(projectId)) {
    return "Задача належить іншому проєкту.";
  }
  if (closedStatusIds.has(Number(issue.status?.id))) {
    return `Закритий статус: ${issue.status?.name || issue.status?.id}.`;
  }
  if (Number(agileData.agile_sprint_id) !== Number(sourceSprintId)) {
    return "Задача вже не належить попередньому sprint.";
  }
  if (!matchesCustomFields(issue.custom_fields, customFields)) {
    return "Задача більше не відповідає вибраному Unit.";
  }
  return "";
}

function matchesCustomFields(issueFields = [], expectedFields = {}) {
  const values = new Map(issueFields.map((field) => [
    `cf_${field.id}`,
    normalizeFieldValue(field.value),
  ]));

  return Object.entries(expectedFields).every(([key, value]) => (
    values.get(key) === normalizeFieldValue(value)
  ));
}

function normalizeFieldValue(value) {
  return Array.isArray(value)
    ? value.map(String).sort().join(",")
    : String(value ?? "").trim();
}

function validateScope({ projectId, targetSprintId, customFields }) {
  if (!projectId) {
    throw badRequest("Спочатку вибери проєкт.");
  }
  if (!targetSprintId) {
    throw badRequest("Спочатку вибери поточний sprint.");
  }
  if (!Object.keys(customFields).length) {
    throw badRequest("Спочатку вибери Posbox_Unit.");
  }
  for (const key of Object.keys(customFields)) {
    if (!/^cf_\d+$/.test(key)) {
      throw badRequest(`Некоректний custom field: ${key}.`);
    }
  }
}

function normalizeIssueIds(issueIds) {
  return [...new Set(
    (Array.isArray(issueIds) ? issueIds : [])
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )];
}

function summarizeIssue(issue, baseUrl) {
  return {
    id: Number(issue.id),
    subject: issue.subject || "",
    tracker: issue.tracker?.name || "",
    status: issue.status?.name || "",
    priority: issue.priority?.name || "",
    assignee: issue.assigned_to?.name || "",
    url: `${baseUrl}/issues/${issue.id}`,
  };
}

function summarizeSprint(sprint) {
  return {
    id: String(sprint.id),
    name: sprint.name || String(sprint.id),
    startDate: sprint.start_date || "",
    endDate: sprint.end_date || "",
  };
}

function compareSprints(left, right) {
  return String(left.start_date || "").localeCompare(String(right.start_date || ""))
    || String(left.end_date || "").localeCompare(String(right.end_date || ""))
    || Number(left.id) - Number(right.id);
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

module.exports = {
  executeSprintRollover,
  previewSprintRollover,
  resolveSprintPair,
};
