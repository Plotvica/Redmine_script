const { addDays, parseDate, startOfToday, toDateOnly } = require("../utils/dates");
const { groupCount, groupHours, parseHours, roundHours, sumHours } = require("../utils/series");
const { createTtlCache, stableStringify } = require("../utils/ttl-cache");

const MOVEMENT_SCAN_LIMIT = 150;
const ISSUE_DETAIL_CACHE_MS = 30 * 60 * 1000;
const SPRINT_CACHE_MS = 10 * 60 * 1000;
const ISSUE_COLLECTION_CACHE_MS = 2 * 60 * 1000;
const TIME_ENTRIES_CACHE_MS = 5 * 60 * 1000;
const POS_WORKLOG_TRACKERS = ["POS_Worklog", "Posbox_Worklog"];
const DONE_STATUSES = ["done", "for deploy", "rejected"];
let trackerCachePromise = null;
const issueDetailCache = new Map();
const sprintCache = new Map();
const issueCollectionCache = createTtlCache({ ttlMs: ISSUE_COLLECTION_CACHE_MS, maxEntries: 100 });
const timeEntriesCache = createTtlCache({ ttlMs: TIME_ENTRIES_CACHE_MS, maxEntries: 50 });

async function buildDashboard({ config, redmine, filters }) {
  const now = new Date();
  const period = resolvePeriod(filters, now);
  const isPosWorklogSource = filters.timeSource === "pos_worklog";
  const features = normalizeFeatureSet(filters.features);
  const buildEverything = features.size === 0;
  const needsFlow = buildEverything || hasAnyFeature(features, ["burndown", "burnup"]);
  const needsMovement = buildEverything || features.has("sprint-movement");
  const needsTimeline = buildEverything || features.has("sprint-timeline");
  const needsEffort = buildEverything || features.has("effort-table");
  const needsTaskTimeDetails = buildEverything || features.has("time-user");
  const needsPosWorklogDetails = buildEverything || features.has("pos-worklog-user");
  const needsTimeEntries = buildEverything || hasAnyFeature(features, [
    "metrics",
    "effort-table",
    "time-user",
    "time-activity",
    "time-project",
    "pos-worklog-user",
  ]);
  const issueParams = {
    sort: "updated_on:desc",
  };

  if (isPosWorklogSource) {
    issueParams.status_id = "*";
  } else if (filters.statusId && filters.statusId !== "open") {
    issueParams.status_id = filters.statusId;
  }

  if (filters.projectId) {
    issueParams.project_id = filters.projectId;
  }

  if (!isPosWorklogSource && filters.assigneeId) {
    issueParams.assigned_to_id = filters.assigneeId;
  }

  if (!isPosWorklogSource && filters.authorId) {
    issueParams.author_id = filters.authorId;
  }

  if (!isPosWorklogSource && filters.priorityId) {
    issueParams.priority_id = filters.priorityId;
  }

  if (!isPosWorklogSource && filters.versionId) {
    issueParams.fixed_version_id = filters.versionId;
  }

  if (!isPosWorklogSource && period.from && period.to && !filters.versionId && !filters.sprintId) {
    issueParams.updated_on = `><${period.from}|${period.to}`;
  }

  if (!isPosWorklogSource) {
    Object.assign(issueParams, filters.customFields);
  }

  const trackerIds = await resolveTrackerIds({ redmine, filters });
  const rawIssues = await fetchIssueCollection({
    redmine,
    config,
    params: issueParams,
    trackerIds,
  });
  const sprintScope = filters.sprintId && !isPosWorklogSource
    ? await buildSprintScope({
        redmine,
        config,
        filters,
        period,
        issues: rawIssues,
      })
    : null;
  const issues = sprintScope?.issues || rawIssues;

  const openIssues = issues.filter((issue) => !isClosed(issue));
  const closedIssues = issues.filter(isClosed);
  const overdueIssues = openIssues
    .filter((issue) => issue.due_date && parseDate(issue.due_date) < startOfToday())
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const recentlyUpdated = issues
    .filter((issue) => parseDate(issue.updated_on) >= parseDate(period.from));
  const staleIssues = openIssues
    .filter((issue) => parseDate(issue.updated_on) < addDays(now, -14))
    .sort((a, b) => parseDate(a.updated_on) - parseDate(b.updated_on));

  const { timeEntries, timeError } = needsTimeEntries
    ? await fetchTimeEntries({
        redmine,
        config,
        projectId: filters.projectId,
        fromDate: parseDate(period.from),
        now,
        period,
        issues,
        timeUserIds: filters.timeUserIds,
      })
    : { timeEntries: [], timeError: null };
  const issueById = new Map(issues.map((issue) => [Number(issue.id), issue]));
  const posWorklogTimeEntries = timeEntries.filter((entry) => isPosWorklogEntry(entry, issueById));
  const taskTimeEntries = timeEntries.filter((entry) => !isPosWorklogEntry(entry, issueById));
  const flow = needsFlow ? buildFlowSeries(issues, period) : emptyFlow(period);
  const movement = needsMovement
    ? (sprintScope?.movement || await buildSprintMovement({
        redmine,
        config,
        filters,
        period,
        issues,
      }))
    : emptyMovement();
  const taskTimeDetails = needsTaskTimeDetails
    ? buildTimeDetails(taskTimeEntries, issues, config.redmine.url).byUser
    : {};
  const posWorklogTimeDetails = needsPosWorklogDetails
    ? buildTimeDetails(posWorklogTimeEntries, issues, config.redmine.url).byUser
    : {};

  return {
    generatedAt: now.toISOString(),
    filters: {
      ...filters,
      projectId: filters.projectId || null,
      period,
      pageLimit: config.redmine.pageLimit,
    },
    metrics: {
      totalIssues: issues.length,
      openIssues: openIssues.length,
      closedIssues: closedIssues.length,
      overdueIssues: overdueIssues.length,
      recentlyUpdated: recentlyUpdated.length,
      staleIssues: staleIssues.length,
      loggedHours: roundHours(sumHours(taskTimeEntries)),
      posWorklogHours: roundHours(sumHours(posWorklogTimeEntries)),
      addedIssues: movement.addedIssues.length,
      removedIssues: movement.removedIssues.length,
    },
    charts: {
      byStatus: groupCount(issues, (issue) => issue.status?.name || "Без статусу"),
      byPriority: groupCount(issues, (issue) => issue.priority?.name || "Без пріоритету"),
      byAssignee: groupCount(openIssues, (issue) => issue.assigned_to?.name || "Не призначено"),
      byAuthor: groupCount(issues, (issue) => issue.author?.name || "Без автора"),
      byProject: groupCount(issues, (issue) => issue.project?.name || "Без проєкту"),
      byTracker: groupCount(issues, (issue) => issue.tracker?.name || "Без трекера"),
      byVersion: groupCount(issues, (issue) => issue.fixed_version?.name || "Без версії"),
      bySprint: groupCount(issues, (issue) => issue.sprint?.name || "Без спринта"),
      overdueByAssignee: groupCount(overdueIssues, (issue) => issue.assigned_to?.name || "Не призначено"),
      aging: buildAgingBuckets(openIssues),
      timeByUser: groupHours(taskTimeEntries, (entry) => entry.user?.name || "Невідомий користувач"),
      timeByActivity: groupHours(taskTimeEntries, (entry) => entry.activity?.name || "Без активності"),
      timeByProject: groupHours(taskTimeEntries, (entry) => entry.project?.name || "Без проєкту"),
      posWorklogByUser: groupHours(posWorklogTimeEntries, (entry) => entry.user?.name || "Невідомий користувач"),
      posWorklogByActivity: groupHours(posWorklogTimeEntries, (entry) => entry.activity?.name || "Без активності"),
    },
    customFields: buildCustomFieldBreakdowns(issues),
    flow,
    movement,
    timeline: needsTimeline ? buildTimeline(issues, period, config.redmine.url) : [],
    timeDetails: {
      byUser: taskTimeDetails,
      posWorklogByUser: posWorklogTimeDetails,
    },
    tables: {
      issueEffort: needsEffort ? buildIssueEffortTable(issues, taskTimeEntries, config.redmine.url) : [],
    },
    lists: {
      allIssues: issues.map((issue) => summarizeIssue(issue, config.redmine.url)),
      overdueIssues: overdueIssues.map((issue) => summarizeIssue(issue, config.redmine.url)),
      recentlyUpdated: recentlyUpdated.map((issue) => summarizeIssue(issue, config.redmine.url)),
      staleIssues: staleIssues.map((issue) => summarizeIssue(issue, config.redmine.url)),
      addedIssues: movement.addedIssues,
      removedIssues: movement.removedIssues,
    },
    warnings: {
      timeEntries: timeError,
      movement: movement.error || sprintScope?.error || null,
    },
  };
}

function buildFlowSeries(issues, period) {
  const days = buildPeriodDays(period);
  const total = issues.length;
  const periodEnd = endOfDateLabel(days[days.length - 1]);
  const completedByPeriodEnd = filterCompletedIssues(issues, (completedOn) => completedOn <= periodEnd);
  const remainingByPeriodEnd = issues.filter((issue) => !completedByPeriodEnd.includes(issue));

  const burnup = [];
  const burndown = [];
  const idealBurndown = [];

  for (const [index, day] of days.entries()) {
    const pointStart = startOfDateLabel(day);
    const completedIssues = filterCompletedIssues(issues, (completedOn) => completedOn < pointStart);
    const remainingIssues = issues.filter((issue) => !completedIssues.includes(issue));

    const completed = completedIssues.length;
    const remaining = remainingIssues.length;
    const idealRemaining = days.length <= 1
      ? 0
      : Math.max(total - (total * (index / (days.length - 1))), 0);

    burnup.push({
      label: day,
      value: completed,
      total,
      remaining,
      issueIds: completedIssues.map((issue) => Number(issue.id)),
    });
    burndown.push({
      label: day,
      value: remaining,
      total,
      completed,
      issueIds: remainingIssues.map((issue) => Number(issue.id)),
    });
    idealBurndown.push({ label: day, value: Math.round(idealRemaining * 10) / 10 });
  }

  return {
    burnup,
    burndown,
    idealBurndown,
    summary: {
      total,
      completed: completedByPeriodEnd.length,
      remaining: remainingByPeriodEnd.length,
      startDate: days[0],
      endDate: days[days.length - 1],
      totalIssueIds: issues.map((issue) => Number(issue.id)),
      completedIssueIds: completedByPeriodEnd.map((issue) => Number(issue.id)),
      remainingIssueIds: remainingByPeriodEnd.map((issue) => Number(issue.id)),
    },
  };
}

function emptyFlow(period) {
  const days = buildPeriodDays(period);
  return {
    burnup: [],
    burndown: [],
    idealBurndown: [],
    summary: {
      total: 0,
      completed: 0,
      remaining: 0,
      startDate: days[0],
      endDate: days[days.length - 1],
    },
  };
}

function buildTimeline(issues, period, baseUrl) {
  const days = buildPeriodDays(period);
  const byDay = new Map(days.map((day) => [day, {
    date: day,
    created: [],
    completed: [],
    updated: [],
  }]));

  for (const issue of issues) {
    const summary = summarizeIssue(issue, baseUrl);
    const createdDay = dayWithinPeriod(issue.created_on, period);
    const completedDay = dayWithinPeriod(completionDate(issue), period);
    const updatedDay = dayWithinPeriod(issue.updated_on, period);

    if (createdDay) {
      byDay.get(createdDay)?.created.push(summary);
    }

    if (completedDay) {
      byDay.get(completedDay)?.completed.push(summary);
    }

    if (updatedDay && updatedDay !== createdDay && updatedDay !== completedDay) {
      byDay.get(updatedDay)?.updated.push(summary);
    }
  }

  return [...byDay.values()]
    .map((day) => ({
      ...day,
      total: day.created.length + day.completed.length + day.updated.length,
      created: day.created.sort(compareIssueId),
      completed: day.completed.sort(compareIssueId),
      updated: day.updated.sort(compareIssueId),
    }))
    .filter((day) => day.total > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function dayWithinPeriod(value, period) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!isDateWithin(date, period)) {
    return "";
  }
  return toDateOnly(date);
}

function filterCompletedIssues(issues, isInRange) {
  return issues.filter((issue) => {
    const completedOn = completionDate(issue);
    return completedOn.getTime() > 0 && isInRange(completedOn);
  });
}

function completionDate(issue) {
  if (!isClosed(issue)) {
    return new Date(0);
  }

  if (issue.closed_on) {
    return parseDate(issue.closed_on);
  }
  return parseDate(issue.updated_on);
}

function startOfDateLabel(label) {
  const date = parseDate(label);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfDateLabel(label) {
  const date = parseDate(label);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function buildPeriodDays(period) {
  const from = parseDate(period.from);
  const to = parseDate(period.to);
  const days = [];

  if (from.getTime() <= 0 || to.getTime() <= 0 || from > to) {
    return [toDateOnly(new Date())];
  }

  const cursor = new Date(from);
  while (cursor <= to && days.length < 370) {
    days.push(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function buildCustomFieldBreakdowns(issues) {
  const breakdowns = {};

  for (const issue of issues) {
    for (const field of issue.custom_fields || []) {
      const key = `cf_${field.id}`;
      const value = normalizeCustomFieldValue(field.value);
      const label = value || "Без значення";

      if (!breakdowns[key]) {
        breakdowns[key] = {
          id: String(field.id),
          key,
          name: field.name || key,
          series: [],
          values: new Map(),
        };
      }

      breakdowns[key].values.set(label, (breakdowns[key].values.get(label) || 0) + 1);
    }
  }

  return Object.fromEntries(
    Object.entries(breakdowns).map(([key, field]) => [
      key,
      {
        id: field.id,
        key: field.key,
        name: field.name,
        series: [...field.values.entries()]
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
      },
    ]),
  );
}

function normalizeCustomFieldValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return value ? String(value) : "";
}

async function fetchIssueCollection({ redmine, config, params, trackerIds = [], maxItems = Infinity }) {
  const ids = normalizeIdList(trackerIds);
  const cacheKey = stableStringify({
    endpoint: "/issues.json",
    ids,
    maxItems: String(maxItems),
    pageLimit: config.redmine.pageLimit,
    params,
  });

  return issueCollectionCache.getOrSet(cacheKey, async () => {
    if (!ids.length) {
      return redmine.fetchPaginated("/issues.json", params, "issues", config.redmine.pageLimit, maxItems);
    }

    const batches = [];
    for (const trackerId of ids) {
      batches.push(await redmine.fetchPaginated(
        "/issues.json",
        { ...params, tracker_id: trackerId },
        "issues",
        config.redmine.pageLimit,
        maxItems,
      ));
    }

    return uniqueIssues(batches.flat()).sort((a, b) => parseDate(b.updated_on) - parseDate(a.updated_on));
  });
}

function normalizeFeatureSet(features = []) {
  const list = Array.isArray(features) ? features : String(features || "").split(",");
  return new Set(list.map((item) => String(item).trim()).filter(Boolean));
}

function hasAnyFeature(features, expectedFeatures) {
  return expectedFeatures.some((feature) => features.has(feature));
}

function selectedTrackerIds(filters = {}) {
  const trackerIds = normalizeIdList(filters.trackerIds);
  return trackerIds.length ? trackerIds : normalizeIdList(filters.trackerId);
}

async function resolveTrackerIds({ redmine, filters }) {
  const trackerIds = selectedTrackerIds(filters);
  if (trackerIds.length || filters.timeSource !== "pos_worklog") {
    return trackerIds;
  }

  const posWorklogTrackerId = await findTrackerIdByNames(redmine, POS_WORKLOG_TRACKERS);
  return posWorklogTrackerId ? [posWorklogTrackerId] : [];
}

async function findTrackerIdByNames(redmine, trackerNames) {
  if (!trackerCachePromise) {
    trackerCachePromise = redmine.get("/trackers.json")
      .then((response) => response.trackers || [])
      .catch(() => []);
  }

  const trackers = await trackerCachePromise;
  return String(trackers.find((tracker) => matchesAnyText(tracker.name, trackerNames))?.id || "");
}

function normalizeIdList(value = []) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function uniqueIssues(issues) {
  const byId = new Map();
  for (const issue of issues || []) {
    if (issue?.id && !byId.has(Number(issue.id))) {
      byId.set(Number(issue.id), issue);
    }
  }
  return [...byId.values()];
}

function isPosWorklogEntry(entry, issueById) {
  const issue = issueById.get(Number(entry.issue?.id));
  return isPosWorklogIssue(issue) || matchesAnyText(entry.activity?.name, POS_WORKLOG_TRACKERS);
}

function isPosWorklogIssue(issue) {
  return matchesAnyText(issue?.tracker?.name, POS_WORKLOG_TRACKERS);
}

function matchesAnyText(value, expectedValues) {
  return expectedValues.some((expected) => sameText(value, expected));
}

function sameText(value, expected) {
  return String(value || "").trim().toLowerCase() === String(expected || "").trim().toLowerCase();
}

async function fetchTimeEntries({ redmine, config, projectId, fromDate, now, period, issues, timeUserIds = [] }) {
  const timeParams = {
    from: period.from || toDateOnly(fromDate),
    to: period.to || toDateOnly(now),
  };

  if (projectId) {
    timeParams.project_id = projectId;
  }

  try {
    const cacheKey = stableStringify({
      endpoint: "/time_entries.json",
      pageLimit: config.redmine.pageLimit,
      params: timeParams,
    });
    const timeEntries = await timeEntriesCache.getOrSet(cacheKey, () => (
      redmine.fetchPaginated(
        "/time_entries.json",
        timeParams,
        "time_entries",
        config.redmine.pageLimit,
      )
    ));
    const issueIds = new Set((issues || []).map((issue) => Number(issue.id)));
    const filteredEntries = issueIds.size
      ? timeEntries.filter((entry) => issueIds.has(Number(entry.issue?.id)))
      : timeEntries;
    const selectedUsers = new Set((timeUserIds || []).map((id) => String(id)));
    const userFilteredEntries = selectedUsers.size
      ? filteredEntries.filter((entry) => selectedUsers.has(String(entry.user?.id)))
      : filteredEntries;
    return { timeEntries: userFilteredEntries, timeError: null };
  } catch (error) {
    return { timeEntries: [], timeError: error.message };
  }
}

function buildIssueEffortTable(issues, timeEntries, baseUrl) {
  const spentByIssue = new Map();

  for (const entry of timeEntries || []) {
    const issueId = Number(entry.issue?.id);
    if (!issueId) {
      continue;
    }
    spentByIssue.set(issueId, (spentByIssue.get(issueId) || 0) + parseHours(entry.hours));
  }

  return issues
    .map((issue) => {
      const estimatedHours = roundHours(parseHours(issue.estimated_hours));
      const spentHours = roundHours(spentByIssue.get(Number(issue.id)) || 0);
      return {
        ...summarizeIssue(issue, baseUrl),
        estimatedHours,
        spentHours,
        remainingHours: roundHours(Math.max(estimatedHours - spentHours, 0)),
      };
    })
    .sort((a, b) => b.spentHours - a.spentHours || b.estimatedHours - a.estimatedHours || a.id - b.id);
}

function buildTimeDetails(timeEntries, issues, baseUrl) {
  const byUser = {};
  const issueSubjects = new Map((issues || []).map((issue) => [Number(issue.id), issue.subject || ""]));

  for (const entry of timeEntries || []) {
    const userName = entry.user?.name || "Невідомий користувач";
    const issueId = Number(entry.issue?.id || 0);
    const issueSubject = issueSubjects.get(issueId) || entry.issue?.subject || "";
    const detail = {
      id: entry.id,
      user: userName,
      issueId: issueId || null,
      issue: issueId ? `#${issueId}` : "Без задачі",
      issueSubject,
      issueUrl: issueId ? `${baseUrl}/issues/${issueId}` : "",
      project: entry.project?.name || "",
      activity: entry.activity?.name || "Без активності",
      spentOn: entry.spent_on || "",
      hours: roundHours(parseHours(entry.hours)),
      comments: entry.comments || "",
    };

    if (!byUser[userName]) {
      byUser[userName] = {
        user: userName,
        totalHours: 0,
        entries: [],
      };
    }

    byUser[userName].totalHours += detail.hours;
    byUser[userName].entries.push(detail);
  }

  for (const item of Object.values(byUser)) {
    item.totalHours = roundHours(item.totalHours);
    item.entries.sort((a, b) => String(b.spentOn).localeCompare(String(a.spentOn)) || b.hours - a.hours);
  }

  return { byUser };
}

async function buildSprintScope({ redmine, config, filters, period, issues }) {
  const sprint = await resolveSprintContext({ redmine, filters });
  if (!sprint) {
    return {
      issues,
      movement: emptyMovement(),
      error: "Sprint metadata is unavailable.",
    };
  }

  try {
    const detailedIssues = await fetchDetailedIssues(redmine, issues);
    return {
      issues: detailedIssues
        .filter((issue) => isIssueInSprintHistory(issue, sprint, period))
        .sort((a, b) => parseDate(b.updated_on) - parseDate(a.updated_on)),
      movement: buildSprintMovementFromDetailedIssues(detailedIssues, sprint, period, config.redmine.url),
      error: null,
    };
  } catch (error) {
    return {
      issues,
      movement: {
        ...emptyMovement(),
        error: error.message,
      },
      error: error.message,
    };
  }
}

async function resolveSprintContext({ redmine, filters }) {
  if (!filters.sprintId) {
    return null;
  }

  const sprint = {
    id: String(filters.sprintId),
    name: filters.sprintName || "",
  };

  if (sprint.name || !filters.projectId) {
    return sprint;
  }

  const sprints = await fetchProjectSprints(redmine, filters.projectId);
  const matched = sprints.find((item) => String(item.id) === sprint.id);
  return matched ? { ...sprint, name: matched.name || "" } : sprint;
}

async function fetchProjectSprints(redmine, projectId) {
  const cacheKey = String(projectId || "");
  const cached = sprintCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < SPRINT_CACHE_MS) {
    return cached.sprints;
  }

  try {
    const response = await redmine.get(`/projects/${encodeURIComponent(projectId)}/agile_sprints.json`);
    const sprints = response.sprints || [];
    sprintCache.set(cacheKey, { createdAt: Date.now(), sprints });
    return sprints;
  } catch {
    return [];
  }
}

async function fetchDetailedIssues(redmine, issues) {
  return mapWithConcurrency(issues, 2, (issue) => fetchDetailedIssue(redmine, issue));
}

async function fetchDetailedIssue(redmine, issue) {
  const issueId = Number(issue.id);
  const cached = issueDetailCache.get(issueId);
  if (
    cached
    && cached.updatedOn === issue.updated_on
    && Date.now() - cached.createdAt < ISSUE_DETAIL_CACHE_MS
  ) {
    return cached.issue;
  }

  const response = await redmine.get(`/issues/${encodeURIComponent(issue.id)}.json`, { include: "journals" });
  const detailedIssue = response.issue || issue;
  issueDetailCache.set(issueId, {
    createdAt: Date.now(),
    updatedOn: detailedIssue.updated_on || issue.updated_on || "",
    issue: detailedIssue,
  });
  return detailedIssue;
}

function buildSprintMovementFromDetailedIssues(issues, sprint, period, baseUrl) {
  const added = new Map();
  const removed = new Map();

  for (const issue of issues) {
    const summary = summarizeIssue(issue, baseUrl);
    const allChanges = sprintChangeEvents(issue, sprint);

    if (
      isDateWithin(issue.created_on, period)
      && (isIssueInSprintHistory(issue, sprint, period) || allChanges.length)
    ) {
      added.set(Number(issue.id), summary);
    }

    for (const change of allChanges.filter((item) => isDateWithin(item.date, period))) {
      if (change.type === "added") {
        added.set(Number(issue.id), summary);
      }
      if (change.type === "removed") {
        removed.set(Number(issue.id), summary);
      }
    }
  }

  return {
    addedIssues: [...added.values()].sort(compareIssueId),
    removedIssues: [...removed.values()].sort(compareIssueId),
    scannedIssues: issues.length,
    error: null,
  };
}

function isIssueInSprintHistory(issue, sprint, period) {
  const changes = sprintChangeEvents(issue, sprint);
  if (changes.length) {
    return sprintMembershipOverlapsPeriod(changes, period);
  }

  return directSprintMatches(issue, sprint) || isDateWithin(issue.created_on, period);
}

function sprintMembershipOverlapsPeriod(changes, period) {
  const periodStart = parseDate(period.from);
  const periodEnd = endOfDay(parseDate(period.to));
  if (periodStart.getTime() <= 0 || periodEnd.getTime() <= 0) {
    return true;
  }

  let inSprint = changes[0]?.type === "removed";
  let intervalStart = inSprint ? new Date(0) : null;

  for (const change of changes) {
    const changeDate = parseDate(change.date);
    if (changeDate.getTime() <= 0) {
      continue;
    }

    if (change.type === "added" && !inSprint) {
      inSprint = true;
      intervalStart = changeDate;
      continue;
    }

    if (change.type === "removed" && inSprint) {
      if (dateRangesOverlap(intervalStart, changeDate, periodStart, periodEnd)) {
        return true;
      }
      inSprint = false;
      intervalStart = null;
    }
  }

  return inSprint && dateRangesOverlap(intervalStart, new Date(8640000000000000), periodStart, periodEnd);
}

function dateRangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

function directSprintMatches(issue, sprint) {
  const values = [
    issue.sprint?.id,
    issue.sprint?.name,
    issue.agile_sprint?.id,
    issue.agile_sprint?.name,
    issue.agileSprint?.id,
    issue.agileSprint?.name,
  ];
  return values.some((value) => sprintValueMatches(value, sprint));
}

async function buildSprintMovement({ redmine, config, filters, period, issues }) {
  if (!filters.sprintId || !period.from || !period.to) {
    return emptyMovement();
  }

  const sprint = await resolveSprintContext({ redmine, filters });
  if (!sprint) {
    return {
      ...emptyMovement(),
      error: "Sprint metadata is unavailable.",
    };
  }

  const params = {
    status_id: "*",
    sort: "updated_on:desc",
    updated_on: `><${period.from}|${period.to}`,
  };

  if (filters.projectId) {
    params.project_id = filters.projectId;
  }

  if (filters.assigneeId) {
    params.assigned_to_id = filters.assigneeId;
  }

  if (filters.authorId) {
    params.author_id = filters.authorId;
  }

  if (filters.priorityId) {
    params.priority_id = filters.priorityId;
  }

  Object.assign(params, filters.customFields);

  try {
    const candidates = await fetchIssueCollection({
      redmine,
      config,
      params,
      trackerIds: selectedTrackerIds(filters),
      maxItems: MOVEMENT_SCAN_LIMIT,
    });
    return buildSprintMovementFromDetailedIssues(
      await fetchDetailedIssues(redmine, candidates),
      sprint,
      period,
      config.redmine.url,
    );
  } catch (error) {
    return {
      ...emptyMovement(),
      error: error.message,
    };
  }
}

function emptyMovement() {
  return {
    addedIssues: [],
    removedIssues: [],
    scannedIssues: 0,
    error: null,
  };
}

function sprintChangeEvents(issue, sprint, period) {
  const changes = [];

  for (const journal of issue.journals || []) {
    if (period && !isDateWithin(journal.created_on, period)) {
      continue;
    }

    for (const detail of journal.details || []) {
      if (!isSprintDetail(detail)) {
        continue;
      }

      const oldValue = String(detail.old_value ?? detail.oldValue ?? "");
      const newValue = String(detail.new_value ?? detail.newValue ?? "");
      const oldMatches = sprintValueMatches(oldValue, sprint);
      const newMatches = sprintValueMatches(newValue, sprint);

      if (newMatches && !oldMatches) {
        changes.push({ type: "added", date: journal.created_on });
      }
      if (oldMatches && !newMatches) {
        changes.push({ type: "removed", date: journal.created_on });
      }
    }
  }

  return changes.sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

function isSprintDetail(detail) {
  const name = String(detail.name || detail.prop_key || "");
  return name === "sprint_id" || name === "sprint" || name === "agile_sprint";
}

function sprintValueMatches(value, sprint) {
  const text = normalizeSprintText(value);
  const id = normalizeSprintText(sprint?.id);
  const name = normalizeSprintText(sprint?.name);

  if (!text) {
    return false;
  }

  if (id && text === id) {
    return true;
  }

  if (!name) {
    return false;
  }

  return text === name || text.startsWith(`${name} `) || text.startsWith(`${name} (`);
}

function normalizeSprintText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function mapWithConcurrency(items, limit, callback) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isDateWithin(value, period) {
  const date = parseDate(value);
  const from = parseDate(period.from);
  const to = parseDate(period.to);
  return date.getTime() > 0 && from.getTime() > 0 && to.getTime() > 0 && date >= from && date <= endOfDay(to);
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function compareIssueId(a, b) {
  return Number(a.id) - Number(b.id);
}

function resolvePeriod(filters, now) {
  if (filters.periodMode === "custom" && filters.from && filters.to) {
    return {
      mode: "custom",
      from: filters.from,
      to: filters.to,
      label: `${filters.from} - ${filters.to}`,
    };
  }

  if (filters.periodMode === "sprint" && filters.from && filters.to) {
    return {
      mode: "sprint",
      from: filters.from,
      to: filters.to,
      label: `${filters.from} - ${filters.to}`,
    };
  }

  const fromDate = addDays(now, -filters.days);
  return {
    mode: "last_days",
    from: toDateOnly(fromDate),
    to: toDateOnly(now),
    label: `Останні ${filters.days} днів`,
  };
}

function isClosed(issue) {
  const status = String(issue.status?.name || "").trim().toLowerCase();
  return DONE_STATUSES.includes(status);
  if (["closed", "resolved", "done", "for deploy", "закрито", "закрыта", "закрыто"].includes(status)) {
    return true;
  }

  return Boolean(issue.status?.is_closed);
}

function buildAgingBuckets(issues) {
  const now = new Date();
  const buckets = [
    { label: "0-7 днів", min: 0, max: 7, value: 0 },
    { label: "8-14 днів", min: 8, max: 14, value: 0 },
    { label: "15-30 днів", min: 15, max: 30, value: 0 },
    { label: "31-60 днів", min: 31, max: 60, value: 0 },
    { label: "60+ днів", min: 61, max: Infinity, value: 0 },
  ];

  for (const issue of issues) {
    const age = Math.max(0, Math.floor((now - parseDate(issue.created_on)) / 86400000));
    const bucket = buckets.find((item) => age >= item.min && age <= item.max);
    if (bucket) {
      bucket.value += 1;
    }
  }

  return buckets.map(({ label, value }) => ({ label, value }));
}

function summarizeIssue(issue, baseUrl) {
  return {
    id: issue.id,
    subject: issue.subject,
    project: issue.project?.name || "",
    tracker: issue.tracker?.name || "",
    status: issue.status?.name || "",
    priority: issue.priority?.name || "",
    version: issue.fixed_version?.name || "Без версії",
    sprint: issue.sprint?.name || "Без спринта",
    assignee: issue.assigned_to?.name || "Не призначено",
    author: issue.author?.name || "",
    startDate: issue.start_date || null,
    dueDate: issue.due_date || null,
    createdOn: issue.created_on || null,
    updatedOn: issue.updated_on || null,
    closedOn: issue.closed_on || null,
    doneRatio: Number(issue.done_ratio || 0),
    estimatedHours: roundHours(parseHours(issue.estimated_hours)),
    customFields: Object.fromEntries(
      (issue.custom_fields || []).map((field) => [
        `cf_${field.id}`,
        {
          id: String(field.id),
          name: field.name || `cf_${field.id}`,
          value: normalizeCustomFieldValue(field.value),
        },
      ]),
    ),
    url: `${baseUrl}/issues/${issue.id}`,
  };
}

module.exports = { buildDashboard };
