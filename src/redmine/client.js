function createRedmineClient({ url: baseUrl, apiKey }) {
  async function get(endpoint, params = {}) {
    const requestUrl = new URL(`${baseUrl}${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        requestUrl.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(requestUrl, {
      headers: {
        "Accept": "application/json",
        "X-Redmine-API-Key": apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redmine ${response.status}: ${text.slice(0, 220) || response.statusText}`);
    }

    return response.json();
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

  return { fetchPaginated, get };
}

module.exports = { createRedmineClient };
