function createRedmineClient({
  url: baseUrl,
  apiKey,
  requestConcurrency = 1,
  requestDelayMs = 250,
  requestRetries = 4,
  requestRetryBaseMs = 1500,
}) {
  const schedule = createRequestQueue({
    concurrency: requestConcurrency,
    delayMs: requestDelayMs,
  });

  async function get(endpoint, params = {}) {
    const requestUrl = new URL(`${baseUrl}${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        requestUrl.searchParams.set(key, String(value));
      }
    }

    return schedule(() => requestJson(requestUrl));
  }

  async function put(endpoint, body) {
    const requestUrl = new URL(`${baseUrl}${endpoint}`);
    return schedule(() => requestJson(requestUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }));
  }

  async function requestJson(requestUrl, options = {}) {
    for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
      const response = await fetch(requestUrl, {
        ...options,
        headers: {
          "Accept": "application/json",
          "X-Redmine-API-Key": apiKey,
          ...options.headers,
        },
      });

      if (response.ok) {
        if (response.status === 204) {
          return {};
        }
        const text = await response.text();
        return text ? JSON.parse(text) : {};
      }

      const text = await response.text();
      if (response.status === 429 && attempt < requestRetries) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        await delay(Math.max(retryAfter, retryDelay(attempt, requestRetryBaseMs)));
        continue;
      }

      const attemptsText = attempt > 0 ? ` after ${attempt + 1} attempts` : "";
      throw new Error(`Redmine ${response.status}${attemptsText}: ${text.slice(0, 220) || response.statusText}`);
    }

    throw new Error("Redmine request failed.");
  }

  async function fetchPaginated(endpoint, params, collectionKey, limit = 100, maxItems = Infinity) {
    const items = [];
    let offset = 0;
    let totalCount = Infinity;

    while (offset < totalCount && items.length < maxItems) {
      const pageLimit = Math.min(limit, maxItems - items.length);
      const page = await get(endpoint, { ...params, limit: pageLimit, offset });
      const pageItems = page[collectionKey] || [];
      items.push(...pageItems);

      totalCount = Number(page.total_count || items.length);
      offset += pageItems.length;

      if (!pageItems.length) {
        break;
      }
    }

    return items;
  }

  return { fetchPaginated, get, put };
}

function createRequestQueue({ concurrency, delayMs }) {
  const queue = [];
  let active = 0;
  let nextStartAt = 0;
  let timer = null;

  function schedule(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      pump();
    });
  }

  function pump() {
    if (timer || active >= concurrency || !queue.length) {
      return;
    }

    const waitMs = Math.max(0, nextStartAt - Date.now());
    if (waitMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        pump();
      }, waitMs);
      return;
    }

    const item = queue.shift();
    active += 1;
    nextStartAt = Date.now() + delayMs;

    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        active -= 1;
        pump();
      });

    pump();
  }

  return schedule;
}

function parseRetryAfter(value) {
  if (!value) {
    return 0;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

function retryDelay(attempt, baseMs) {
  return baseMs * (2 ** attempt);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createRedmineClient };
