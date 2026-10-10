// Shared, pure helpers for contextual editing. Paths address collection IDs,
// never visual positions, so reordering cannot redirect an image replacement.
function workspaceMediaLocation(document, path) {
  if (!Array.isArray(path) || path.length < 2 || path.some((key) => ["__proto__", "prototype", "constructor"].includes(String(key)))) return null;
  let record = document;
  for (const key of path.slice(0, -1)) {
    if (!record || typeof record !== "object") return null;
    record = Array.isArray(record)
      ? (typeof key === "number" ? record[key] : record.find((item) => item && (item.id === key || item.slug === key)))
      : Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
  }
  const key = path[path.length - 1];
  if (!record || typeof record !== "object" || !["image_url", "cover_image_url", "icon_url", "image", "ogImage"].includes(key)) return null;
  return { record, key, value: record[key] };
}

window.PortfolioWorkspaceUtils = { mediaLocation: workspaceMediaLocation };
