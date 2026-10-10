// Contextual controls for the shared website. Authorization comes from the
// verified admin session; data attributes alone never enable editing.
function visualEditorSelection(element) {
  if (!(element instanceof Element)) return null;
  const target = element.closest("[data-edit-target]");
  if (!target) return null;
  const inherited = (key) => {
    let node = target;
    while (node) {
      if (node.dataset?.[key] !== undefined) return node.dataset[key];
      node = node.parentElement?.closest("[data-edit-target]");
    }
    return "";
  };
  let mediaPath = null;
  try {
    const raw = inherited("editMediaPath");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(part => typeof part === "string" || Number.isInteger(part))) mediaPath = parsed;
    }
  } catch (_) { /* A malformed annotation must not break public navigation. */ }
  return {
    target: target.dataset.editTarget,
    id: inherited("editId") || undefined,
    side: inherited("editSide") || undefined,
    field: inherited("editField") || undefined,
    label: target.dataset.editLabel || "Website content",
    ...(mediaPath ? { mediaPath } : {}),
  };
}

function visualEditorVisibleRect(element) {
  if (!element?.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"], .page:not(.visible)')) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const ownStyle = window.getComputedStyle(element);
  if (ownStyle.visibility === "hidden" || ownStyle.display === "none") return null;
  let left = Math.max(4, rect.left), top = Math.max(4, rect.top);
  let right = Math.min(window.innerWidth - 4, rect.right), bottom = Math.min(window.innerHeight - 4, rect.bottom);
  for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.visibility === "hidden" || style.display === "none") return null;
    if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
      const clip = ancestor.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    }
  }
  return right - left >= 2 && bottom - top >= 2 ? { left, top, width: right - left, height: bottom - top, bottom, right } : null;
}

function PortfolioVisualEditor({ enabled = false, canEdit = false, onSelect }) {
  const [entries, setEntries] = React.useState([]);
  const [active, setActive] = React.useState(null);
  const [rect, setRect] = React.useState(null);
  const elementRef = React.useRef(null);
  const layerRef = React.useRef(null);
  const enabledRef = React.useRef(false);
  const allowed = enabled === true && canEdit === true;
  enabledRef.current = allowed;

  React.useEffect(() => {
    if (!allowed) {
      elementRef.current = null;
      setActive(null);
      setRect(null);
      setEntries([]);
      return undefined;
    }
    let frame = 0;
    let refreshCatalog = false;
    let disposed = false;
    const update = () => {
      frame = 0;
      if (disposed) return;
      if (refreshCatalog) {
        refreshCatalog = false;
        const dialogs = Array.from(document.querySelectorAll('.case-sheet.open, .project-lightbox')).filter(visualEditorVisibleRect);
        const scope = dialogs[dialogs.length - 1] || document;
        const candidates = Array.from(scope.querySelectorAll("[data-edit-target]"));
        if (scope instanceof Element && scope.matches("[data-edit-target]")) candidates.unshift(scope);
        const nextEntries = candidates.filter(node => !node.closest(".visual-editor-layer") && visualEditorVisibleRect(node)).map((element, index) => ({
          element,
          key: String(index),
          selection: visualEditorSelection(element),
        }));
        setEntries(previous => previous.length === nextEntries.length && previous.every((entry, index) => entry.element === nextEntries[index].element && entry.selection.label === nextEntries[index].selection.label) ? previous : nextEntries);
        if (!elementRef.current || !nextEntries.some(entry => entry.element === elementRef.current)) {
          elementRef.current = nextEntries[0]?.element || null;
        }
      }
      const nextRect = visualEditorVisibleRect(elementRef.current);
      setRect(nextRect);
      setActive(nextRect ? visualEditorSelection(elementRef.current) : null);
    };
    const schedule = (catalog = false) => {
      refreshCatalog = refreshCatalog || catalog;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const point = event => {
      if (!(event.target instanceof Element) || event.target.closest('.visual-editor-layer, .admin-overlay, .admin-workspace-toolbar, [data-editor-chrome]')) return;
      const candidate = event.target.closest("[data-edit-target]");
      if (candidate && visualEditorVisibleRect(candidate)) elementRef.current = candidate;
      schedule();
    };
    const layout = () => schedule(true);
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest(".visual-editor-layer"))) schedule(true);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ["hidden", "inert", "class", "data-edit-label", "data-edit-id", "data-edit-media-path"] });
    document.addEventListener("pointermove", point, { passive: true });
    document.addEventListener("pointerdown", point, { passive: true });
    document.addEventListener("focusin", point);
    document.addEventListener("scroll", layout, { capture: true, passive: true });
    window.addEventListener("resize", layout, { passive: true });
    schedule(true);
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointermove", point);
      document.removeEventListener("pointerdown", point);
      document.removeEventListener("focusin", point);
      document.removeEventListener("scroll", layout, true);
      window.removeEventListener("resize", layout);
    };
  }, [allowed]);

  const choose = event => {
    const entry = entries.find(item => item.key === event.target.value);
    if (!entry) return;
    elementRef.current = entry.element;
    setActive(entry.selection);
    setRect(visualEditorVisibleRect(entry.element));
  };
  const edit = (event, action = "edit") => {
    event.preventDefault();
    event.stopPropagation();
    if (!enabledRef.current || !active) return;
    onSelect?.({ ...active, action });
  };

  if (!allowed) return null;
  const activeKey = entries.find(entry => entry.element === elementRef.current)?.key || "";
  const actionTop = rect ? Math.min(Math.max(rect.top + 5, 82), window.innerHeight - 154) : 82;
  const actionLeft = rect ? Math.max(8, Math.min(rect.left + 5, window.innerWidth - (active?.mediaPath ? 254 : 132))) : 8;
  return ReactDOM.createPortal(
    <div className="visual-editor-layer" ref={layerRef} data-editor-chrome onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <div className="visual-editor-picker" aria-label="Select visible website content">
        <label htmlFor="visual-editor-target">Edit on this page</label>
        <div className="visual-editor-picker-row">
          <select id="visual-editor-target" value={activeKey} onChange={choose} aria-describedby="visual-editor-hint">
            {!entries.length && <option value="">Scroll to editable content</option>}
            {entries.map(entry => <option key={entry.key} value={entry.key}>{entry.selection.label}</option>)}
          </select>
          <button type="button" onClick={edit} disabled={!active} aria-label={active ? `Edit ${active.label}` : "Edit selected content"}>Edit</button>
        </div>
        <span id="visual-editor-hint">Select content here, or point to it on the page.</span>
      </div>
      {rect && active && <>
        <div className="visual-editor-outline" aria-hidden="true" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
        <div className="visual-editor-actions" style={{ left: actionLeft, top: actionTop }} role="group" aria-label={`${active.label} controls`}>
          <button type="button" className="visual-editor-edit" onClick={edit} title={`Edit ${active.label}`} aria-label={`Edit ${active.label}`}><span aria-hidden="true">✎</span> Edit <span className="visual-editor-action-label">{active.label}</span></button>
          {active.mediaPath && <button type="button" className="visual-editor-replace" onClick={event => edit(event, "media")} aria-label={`Replace image for ${active.label}`}>Replace image</button>}
        </div>
      </>}
    </div>, document.body
  );
}

window.PortfolioVisualEditor = PortfolioVisualEditor;
