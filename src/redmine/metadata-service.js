const customFieldCache = new Map();
const CUSTOM_FIELD_CACHE_MS = 10 * 60 * 1000;

async function buildMetadata({ redmine, config, projectId }) {
  const warnings = [];
  const [trackers, statuses, priorities, users, customFields, versions, sprints] = await Promise.all([
    safeCollection(() => redmine.get("/trackers.json"), "trackers", warnings, "Trackers"),
    safeCollection(() => redmine.get("/issue_statuses.json"), "issue_statuses", warnings, "Issue statuses"),
    safeCollection(() => redmine.get("/enumerations/issue_priorities.json"), "issue_priorities", warnings, "Issue priorities"),
    fetchUsers({ redmine, config, projectId, warnings }),
    fetchCustomFields({ redmine, config, projectId, warnings }),
    fetchVersions({ redmine, config, projectId, warnings }),
    fetchAgileSprints({ redmine, projectId, warnings }),
  ]);

  return {
    trackers: trackers.map(toOption),
    statuses: statuses.map((status) => ({ ...toOption(status), isClosed: Boolean(status.is_closed) })),
    priorities: priorities.map(toOption),
    users: users.map(toUserOption),
    customFields: mergeCustomFields(customFields, config.redmine.manualCustomFields),
    versions: versions.map(toVersionOption),
    sprints: sprints.map(toSprintOption),
    warnings,
  };
}

async function fetchCustomFields({ redmine, config, projectId, warnings }) {
  const apiFields = await safeCollection(() => redmine.get("/custom_fields.json"), "custom_fields", warnings, "Custom fields");
  const normalizedApiFields = apiFields
    .filter((field) => field.customized_type === "issue")
    .map(toCustomField);

  if (normalizedApiFields.length) {
    return normalizedApiFields;
  }

  const inferredFields = await fetchCustomFieldsFromIssues({ redmine, config, projectId, warnings });
  if (!projectId) {
    return inferredFields;
  }

  return mergeCustomFields(readCachedCustomFields(""), inferredFields);
}

async function fetchCustomFieldsFromIssues({ redmine, config, projectId, warnings }) {
  const cacheKey = projectId || "__all__";
  const cached = customFieldCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < CUSTOM_FIELD_CACHE_MS) {
    return cached.fields;
  }

  const params = {
    status_id: "*",
    sort: "updated_on:desc",
  };

  if (projectId) {
    params.project_id = projectId;
  }

  try {
    const issues = await redmine.fetchPaginated(
      "/issues.json",
      params,
      "issues",
      config.redmine.pageLimit,
      config.redmine.metadataSampleLimit,
    );
    const fields = inferCustomFields(issues);
    customFieldCache.set(cacheKey, { createdAt: Date.now(), fields });
    return fields;
  } catch (error) {
    warnings.push(`Issue custom fields inference: ${error.message}`);
    return [];
  }
}

function readCachedCustomFields(projectId) {
  const cacheKey = projectId || "__all__";
  const cached = customFieldCache.get(cacheKey);
  if (!cached || Date.now() - cached.createdAt >= CUSTOM_FIELD_CACHE_MS) {
    return [];
  }
  return cached.fields;
}

function mergeCustomFields(apiFields, manualFields) {
  const fields = new Map();

  for (const field of apiFields) {
    fields.set(field.key, field);
  }

  for (const field of manualFields || []) {
    const existing = fields.get(field.key);
    fields.set(field.key, {
      ...existing,
      ...field,
      possibleValues: mergePossibleValues(existing?.possibleValues, field.possibleValues),
    });
  }

  return [...fields.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergePossibleValues(...lists) {
  const values = new Map();

  for (const list of lists) {
    for (const option of list || []) {
      if (option?.value) {
        values.set(String(option.value), {
          value: String(option.value),
          label: String(option.label || option.value),
        });
      }
    }
  }

  return [...values.values()];
}

function inferCustomFields(issues) {
  const fields = new Map();

  for (const issue of issues) {
    for (const field of issue.custom_fields || []) {
      const key = `cf_${field.id}`;
      const value = normalizeIssueCustomFieldValue(field.value);

      if (!fields.has(key)) {
        fields.set(key, {
          id: String(field.id),
          key,
          name: field.name || key,
          format: "string",
          isFilter: true,
          multiple: Array.isArray(field.value),
          possibleValues: new Map(),
        });
      }

      if (value) {
        fields.get(key).possibleValues.set(value, { value, label: value });
      }
    }
  }

  return [...fields.values()].map((field) => ({
    ...field,
    possibleValues: [...field.possibleValues.values()].slice(0, 250),
  }));
}

function normalizeIssueCustomFieldValue(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return value ? String(value) : "";
}

async function fetchUsers({ redmine, config, projectId, warnings }) {
  const users = await safeCollection(
    () => redmine.fetchPaginated("/users.json", { status: 1 }, "users", config.redmine.pageLimit),
    null,
    warnings,
    "Users",
  );

  if (users.length || !projectId) {
    return users;
  }

  const memberships = await safeCollection(
    () => redmine.fetchPaginated(`/projects/${encodeURIComponent(projectId)}/memberships.json`, {}, "memberships", config.redmine.pageLimit),
    null,
    warnings,
    "Project memberships",
  );

  return uniqueUsersFromMemberships(memberships);
}

async function fetchVersions({ redmine, config, projectId, warnings }) {
  if (!projectId) {
    return [];
  }

  return safeCollection(
    () => redmine.fetchPaginated(`/projects/${encodeURIComponent(projectId)}/versions.json`, {}, "versions", config.redmine.pageLimit),
    null,
    warnings,
    "Versions",
  );
}

async function fetchAgileSprints({ redmine, projectId, warnings }) {
  if (!projectId) {
    return [];
  }

  const response = await safeCollection(
    () => redmine.get(`/projects/${encodeURIComponent(projectId)}/agile_sprints.json`),
    null,
    warnings,
    "Agile sprints",
  );

  return response.sprints || [];
}

function uniqueUsersFromMemberships(memberships) {
  const users = new Map();

  for (const membership of memberships) {
    if (membership.user?.id) {
      users.set(String(membership.user.id), {
        id: membership.user.id,
        name: membership.user.name,
      });
    }
  }

  return [...users.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function safeCollection(load, key, warnings, label) {
  try {
    const response = await load();
    return key ? response[key] || [] : response || [];
  } catch (error) {
    warnings.push(`${label}: ${error.message}`);
    return [];
  }
}

function toOption(item) {
  return {
    id: String(item.id),
    name: item.name || item.login || String(item.id),
  };
}

function toUserOption(user) {
  const name = [user.firstname, user.lastname].filter(Boolean).join(" ") || user.name || user.login || String(user.id);
  return {
    id: String(user.id),
    name,
  };
}

function toCustomField(field) {
  return {
    id: String(field.id),
    key: `cf_${field.id}`,
    name: field.name,
    format: field.field_format,
    isFilter: Boolean(field.is_filter),
    multiple: Boolean(field.multiple),
    possibleValues: normalizePossibleValues(field.possible_values),
  };
}

function normalizePossibleValues(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((item) => {
      if (typeof item === "string") {
        return { value: item, label: item };
      }
      const value = item.value ?? item.name ?? "";
      return { value: String(value), label: String(item.label || item.name || value) };
    })
    .filter((item) => item.value);
}

function toVersionOption(version) {
  return {
    id: String(version.id),
    name: version.name,
    status: version.status || "",
    dueDate: version.due_date || null,
    createdOn: version.created_on || null,
    updatedOn: version.updated_on || null,
    project: version.project?.name || "",
  };
}

function toSprintOption(sprint) {
  return {
    id: String(sprint.id),
    name: sprint.name,
    status: sprint.status || "",
    startDate: sprint.start_date || null,
    endDate: sprint.end_date || null,
    description: sprint.description || "",
  };
}

module.exports = { buildMetadata };
