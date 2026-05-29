export function emptyState(text) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

export function errorState(text) {
  const node = document.createElement("div");
  node.className = "error-state";
  node.textContent = text;
  return node;
}
