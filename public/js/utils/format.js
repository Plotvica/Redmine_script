export function formatNumber(value) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

export function formatDate(value) {
  if (!value) {
    return "Без дати";
  }

  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
