// Static admin panel for editing portfolio content in-browser.
const ADMIN_SESSION_KEY = "vox-portfolio-admin-session";
const ADMIN_TAB_KEY = "vox-portfolio-admin-tab";
const ADMIN_UPLOADS_KEY = "vox-portfolio-uploads";

const ADMIN_THUMBS = {
  graphic: ["Packaging", "Poster", "Brand", "Social"],
  webdev: ["Dashboard", "WebApp", "Code"],
};

// ─── Image upload helpers ─────────────────────────────────────────────────────
function adminReadFile(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 3 * 1024 * 1024) { reject(new Error("File exceeds 3 MB")); return; }
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function adminFormatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function adminLoadUploads() {
  try { return JSON.parse(localStorage.getItem(ADMIN_UPLOADS_KEY) || "[]"); } catch(e) { return []; }
}

function adminSaveUploads(uploads) {
  try { localStorage.setItem(ADMIN_UPLOADS_KEY, JSON.stringify(uploads)); } catch(e) {}
}

// ─── Supabase Storage upload helper ──────────────────────────────────────────
async function adminUploadFileToStorage(file) {
  const sb = window.PortfolioSupabase;
  if (!sb) throw new Error("Supabase is not configured");

  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const storagePath = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { data: storageData, error: uploadError } = await sb.storage
    .from("portfolio-uploads")
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = sb.storage
    .from("portfolio-uploads")
    .getPublicUrl(storageData.path);

  const { data: record, error: dbError } = await sb
    .from("portfolio_uploads")
    .insert({
      name: file.name,
      mime_type: file.type,
      size: file.size,
      public_url: publicUrl,
      storage_path: storageData.path,
    })
    .select()
    .single();

  if (dbError) {
    await sb.storage.from("portfolio-uploads").remove([storageData.path]).catch(() => {});
    throw dbError;
  }
  return record;
}

// ─── AdminImageUpload control ─────────────────────────────────────────────────
function AdminImageUpload({ label = "Thumbnail image", value, onChange }) {
  const [drag, setDrag] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [showPicker, setShowPicker] = React.useState(false);
  const inputRef = React.useRef();

  const handle = async (file) => {
    if (!file || !file.type.startsWith("image/")) { alert("Please select an image file."); return; }
    if (file.size > 3 * 1024 * 1024) { alert("File exceeds 3 MB"); return; }
    setLoading(true);
    try {
      const sb = window.PortfolioSupabase;
      if (sb) {
        const record = await adminUploadFileToStorage(file);
        onChange(record.public_url);
      } else {
        const data = await adminReadFile(file);
        const uploads = adminLoadUploads();
        const entry = { id: "up_" + Date.now(), name: file.name, size: file.size, mimeType: file.type, data, uploadedAt: new Date().toISOString() };
        adminSaveUploads([entry, ...uploads]);
        onChange(data);
      }
    } catch(err) { alert(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="admin-field admin-image-field">
      <span>{label}</span>
      {value ? (
        <div className="admin-image-preview-wrap">
          <img src={value} alt="preview" className="admin-image-preview" />
          <div className="admin-image-actions">
            <button type="button" className="admin-mini-button" onClick={() => inputRef.current.click()}>Replace</button>
            <button type="button" className="admin-mini-button" onClick={() => setShowPicker(!showPicker)}>
              {showPicker ? "Hide library" : "Pick from library"}
            </button>
            <button type="button" className="admin-mini-button danger" onClick={() => onChange("")}>Remove</button>
            <input ref={inputRef} type="file" accept="image/*" style={{display:"none"}} onChange={(e) => handle(e.target.files[0])} />
          </div>
        </div>
      ) : (
        <div
          className={`admin-upload-zone${drag ? " drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
        >
          <input type="file" accept="image/*" onChange={(e) => handle(e.target.files[0])} />
          <div className="admin-upload-icon">🖼</div>
          <div className="admin-upload-hint">
            {loading ? "Processing…" : "Drop image or click · PNG, JPG, WebP, SVG · max 3 MB"}
          </div>
          <button type="button" className="admin-mini-button" onClick={() => setShowPicker(!showPicker)} style={{marginTop:8}}>
            {showPicker ? "Hide library" : "Pick from library"}
          </button>
        </div>
      )}

      {showPicker && (
        <AdminImagePicker current={value} onPick={(v) => { onChange(v); setShowPicker(false); }} />
      )}
    </div>
  );
}

// ─── Library picker (inline) ──────────────────────────────────────────────────
function AdminImagePicker({ current, onPick }) {
  const [uploads, setUploads] = React.useState(null);

  React.useEffect(() => {
    const sb = window.PortfolioSupabase;
    if (sb) {
      sb.from("portfolio_uploads")
        .select("id, name, public_url")
        .order("created_at", { ascending: false })
        .then(({ data }) => setUploads(data || []));
    } else {
      setUploads(adminLoadUploads().map(u => ({ id: u.id, name: u.name, public_url: u.data })));
    }
  }, []);

  if (!uploads) {
    return <p style={{fontSize:11, color:"rgba(255,255,255,.4)", marginTop:8, fontFamily:"monospace"}}>Loading…</p>;
  }
  if (!uploads.length) {
    return <p style={{fontSize:11, color:"rgba(255,255,255,.4)", marginTop:8, fontFamily:"monospace"}}>No uploads yet — upload an image above first.</p>;
  }
  return (
    <div className="admin-image-picker">
      {uploads.map((u) => (
        <button
          key={u.id} type="button"
          className={"admin-pick-thumb" + (u.public_url === current ? " active" : "")}
          onClick={() => onPick(u.public_url)}
          title={u.name}
        >
          <img src={u.public_url} alt={u.name} />
        </button>
      ))}
    </div>
  );
}

// ─── Uploads gallery page (full tab) ─────────────────────────────────────────
function AdminUploadsPage({ setStatus }) {
  const [uploads, setUploads] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [drag, setDrag] = React.useState(false);
  const sb = window.PortfolioSupabase;

  const fetchUploads = async () => {
    setLoading(true);
    try {
      if (sb) {
        const { data } = await sb
          .from("portfolio_uploads")
          .select("*")
          .order("created_at", { ascending: false });
        setUploads(data || []);
      } else {
        setUploads(adminLoadUploads().map(u => ({
          id: u.id, name: u.name, size: u.size,
          mime_type: u.mimeType, public_url: u.data,
          created_at: u.uploadedAt, storage_path: null,
        })));
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchUploads(); }, []);

  const addFiles = async (files) => {
    const added = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) { setStatus(`${f.name} is not an image`, true); continue; }
      if (f.size > 3 * 1024 * 1024) { setStatus(`${f.name} exceeds 3 MB`, true); continue; }
      try {
        if (sb) {
          const record = await adminUploadFileToStorage(f);
          added.push(record);
        } else {
          const data = await adminReadFile(f);
          const entry = { id: "up_" + Date.now() + Math.random().toString(36).slice(2), name: f.name, size: f.size, mimeType: f.type, data, uploadedAt: new Date().toISOString() };
          const existing = adminLoadUploads();
          adminSaveUploads([entry, ...existing]);
          added.push({ id: entry.id, name: entry.name, size: entry.size, mime_type: entry.mimeType, public_url: entry.data, created_at: entry.uploadedAt, storage_path: null });
        }
      } catch(err) { setStatus(err.message, true); }
    }
    if (added.length) {
      setUploads(prev => [...added, ...prev]);
      setStatus(`${added.length} file${added.length > 1 ? "s" : ""} uploaded.`);
    }
  };

  const del = async (u) => {
    if (!window.confirm("Delete this upload?")) return;
    try {
      if (sb) {
        if (u.storage_path) await sb.storage.from("portfolio-uploads").remove([u.storage_path]);
        await sb.from("portfolio_uploads").delete().eq("id", u.id);
      } else {
        adminSaveUploads(adminLoadUploads().filter(x => x.id !== u.id));
      }
      setUploads(prev => prev.filter(x => x.id !== u.id));
      setStatus("Upload deleted.");
    } catch(err) { setStatus("Delete failed: " + err.message, true); }
  };

  const storageLabel = sb ? "Supabase Storage" : "browser storage";

  return (
    <div className="admin-stack">
      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Uploads Library</h3>
            <span>Images in {storageLabel} · {loading ? "…" : `${uploads.length} file${uploads.length !== 1 ? "s" : ""}`}</span>
          </div>
        </div>

        <div
          className={`admin-upload-zone admin-upload-zone-lg${drag ? " drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        >
          <input type="file" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} />
          <div className="admin-upload-icon">📁</div>
          <div className="admin-upload-hint">Drop images here or click to browse · PNG, JPG, WebP, SVG, GIF · Max 3 MB each · Multiple files OK</div>
        </div>

        {loading ? (
          <div className="admin-empty"><p>Loading uploads…</p></div>
        ) : uploads.length === 0 ? (
          <div className="admin-empty"><p>No uploads yet. Drag images above to get started.</p></div>
        ) : (
          <div className="admin-uploads-grid">
            {uploads.map((u) => (
              <div key={u.id} className="admin-upload-card">
                <img src={u.public_url} alt={u.name} className="admin-upload-img" />
                <div className="admin-upload-meta">
                  <div className="admin-upload-name" title={u.name}>{u.name}</div>
                  <div className="admin-upload-size">{adminFormatBytes(u.size || 0)} · {(u.mime_type || "").split("/")[1]?.toUpperCase()}</div>
                  <div className="admin-upload-size">{u.created_at ? new Date(u.created_at).toLocaleDateString() : ""}</div>
                </div>
                <div className="admin-upload-card-actions">
                  <button type="button" className="admin-mini-button" onClick={() => {
                    navigator.clipboard.writeText(u.public_url)
                      .then(() => setStatus("Image URL copied."))
                      .catch(() => setStatus("Copy failed.", true));
                  }}>Copy URL</button>
                  <button type="button" className="admin-mini-button danger" onClick={() => del(u)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="admin-note">
          {sb
            ? "Images are stored in Supabase Storage and accessible via public URL from any device."
            : "localStorage limit is ~5 MB. Connect Supabase for persistent, cross-device image hosting."}
        </p>
      </section>
    </div>
  );
}

function adminHash(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return String(hash >>> 0);
}

function adminNormalizePasscode(value) {
  return String(value ?? "").trim();
}

function adminIsNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    error?.name === "TypeError" ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("load failed")
  );
}

function adminDisableSupabase() {
  window.PortfolioSupabase = null;
}

function adminClone(value) {
  return window.PortfolioContent.clone(value);
}

function adminNormalize(value) {
  return window.PortfolioContent.normalize
    ? window.PortfolioContent.normalize(value)
    : adminClone(value);
}

function adminSlugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function adminCategoryOptions(services = []) {
  return services.map((service, index) => {
    const label = service.name || service.title || `Category ${index + 1}`;
    const slug = adminSlugify(service.slug || service.id || label) || `category-${index + 1}`;
    return { value: slug, label };
  });
}

function adminValidateContent(content) {
  const errors = [];
  ["graphic", "webdev"].forEach((side) => {
    const seenSlugs = new Set();
    (content.works?.[side] || []).forEach((work, index) => {
      const label = `${side} project ${index + 1}`;
      if (!String(work.title || "").trim()) errors.push(`${label}: title is required.`);
      if (!String(work.slug || "").trim()) errors.push(`${work.title || label}: slug is required.`);
      if (!String(work.category_id || work.cat || "").trim()) errors.push(`${work.title || label}: category is required.`);
      if (!String(work.cover_image_url || work.image || work.thumb || "").trim()) errors.push(`${work.title || label}: cover image or generated thumbnail is required.`);
      if (work.slug) {
        if (seenSlugs.has(work.slug)) errors.push(`${work.title || label}: slug must be unique within ${side}.`);
        seenSlugs.add(work.slug);
      }
      (work.gallery_images || []).forEach((image, imageIndex) => {
        if (!String(image.image_url || "").trim()) errors.push(`${work.title || label}: gallery image ${imageIndex + 1} needs an image.`);
      });
    });
  });
  return errors[0] || "";
}

function moveArrayItem(items, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function AdminText({ label, value, onChange, textarea = false, type = "text", placeholder = "" }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {textarea ? (
        <>
          <textarea value={value || ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
          <span className="admin-char-count">{(value || "").length} chars</span>
        </>
      ) : (
        <input type={type} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function AdminSelect({ label, value, options, onChange }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <select className="admin-select" value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
    </label>
  );
}

function AdminNumber({ label, value, min = 0, max = 12, onChange }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ""}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function AdminPasswordField({ label, value, onChange }) {
  const [show, setShow] = React.useState(false);
  return (
    <label className="admin-field">
      <span>{label}</span>
      <div className="admin-password-wrap">
        <input
          type={show ? "text" : "password"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="current-password"
        />
        <button type="button" className="admin-password-toggle" onClick={() => setShow(s => !s)} tabIndex={-1}>
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

function AdminPaletteSelect({ label, value, onChange, side = "graphic" }) {
  const shared = window.PortfolioShared || {};
  const palettes = side === "webdev"
    ? (shared.WEBDEV_PALETTES || [])
    : (shared.GRAPHIC_PALETTES || []);
  if (!palettes.length) {
    return <AdminNumber label={label} value={value} min={0} max={5} onChange={onChange} />;
  }
  return (
    <div className="admin-field">
      <span>{label}</span>
      <div className="admin-palette-row">
        {palettes.map((palette, i) => (
          <button
            key={i}
            type="button"
            title={`Palette ${i}`}
            className={"admin-palette-btn" + (Number(value) === i ? " active" : "")}
            onClick={() => onChange(i)}
          >
            {palette.slice(0, 3).map((color, ci) => (
              <span key={ci} style={{ background: color }}></span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminRowActions({ index, length, onMove, onRemove }) {
  return (
    <div className="admin-row-actions">
      <button type="button" className="admin-mini-button" disabled={index === 0} onClick={() => onMove(index, -1)}>Up</button>
      <button type="button" className="admin-mini-button" disabled={index === length - 1} onClick={() => onMove(index, 1)}>Down</button>
      <button type="button" className="admin-mini-button danger" onClick={() => onRemove(index)}>Remove</button>
    </div>
  );
}

function AdminGalleryEditor({ images = [], projectId, onChange }) {
  const normalized = Array.isArray(images) ? images : [];
  const updateImage = (index, key, value) => {
    const next = normalized.map((image, imageIndex) => ({
      ...image,
      sort_order: image.sort_order || imageIndex + 1,
    }));
    next[index] = { ...next[index], [key]: value, updated_at: new Date().toISOString() };
    onChange(next);
  };
  const addImage = () => {
    const nextIndex = normalized.length + 1;
    onChange([
      ...normalized,
      {
        id: `${projectId || "project"}-gallery-${Date.now()}`,
        project_id: projectId || "",
        image_url: "",
        caption: "",
        alt_text: "",
        sort_order: nextIndex,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  };
  const removeImage = (index) => {
    if (!window.confirm("Remove this gallery image from the draft?")) return;
    onChange(normalized.filter((_, imageIndex) => imageIndex !== index).map((image, imageIndex) => ({ ...image, sort_order: imageIndex + 1 })));
  };
  const moveImage = (index, direction) => {
    onChange(moveArrayItem(normalized, index, direction).map((image, imageIndex) => ({ ...image, sort_order: imageIndex + 1 })));
  };

  return (
    <div className="admin-gallery-editor">
      <div className="admin-subsection-head">
        <h4>Project gallery</h4>
        <button type="button" className="admin-mini-button" onClick={addImage}>Add gallery image</button>
      </div>
      {normalized.length === 0 ? (
        <div className="admin-gallery-empty">No gallery images yet. Add images here to show them inside the case study.</div>
      ) : (
        <div className="admin-gallery-list">
          {normalized.map((image, index) => (
            <div className="admin-gallery-card" key={image.id || index}>
              <AdminImageUpload label={`Gallery image ${index + 1}`} value={image.image_url || ""} onChange={(value) => updateImage(index, "image_url", value)} />
              <div className="admin-grid two">
                <AdminText label="Caption" value={image.caption || ""} onChange={(value) => updateImage(index, "caption", value)} />
                <AdminText label="Alt text" value={image.alt_text || ""} onChange={(value) => updateImage(index, "alt_text", value)} />
              </div>
              <AdminRowActions index={index} length={normalized.length} onMove={moveImage} onRemove={removeImage} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminStatEditor({ title, stats = [], onChange }) {
  const updateStat = (index, key, value) => {
    const next = [...stats];
    next[index] = { ...next[index], [key]: value };
    onChange(next);
  };
  const addStat = () => onChange([...stats, { value: "0", suffix: "", label: "Metric" }]);
  const removeStat = (index) => onChange(stats.filter((_, itemIndex) => itemIndex !== index));
  const moveStat = (index, direction) => onChange(moveArrayItem(stats, index, direction));

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <h4>{title}</h4>
        <button type="button" className="admin-mini-button" onClick={addStat}>Add metric</button>
      </div>
      <div className="admin-mini-grid">
        {stats.map((stat, index) => (
          <div className="admin-mini-card" key={`${stat.label}-${index}`}>
            <AdminText label="Value" value={stat.value} onChange={(value) => updateStat(index, "value", value)} />
            <AdminText label="Suffix" value={stat.suffix} onChange={(value) => updateStat(index, "suffix", value)} />
            <AdminText label="Label" value={stat.label} onChange={(value) => updateStat(index, "label", value)} />
            <AdminRowActions index={index} length={stats.length} onMove={moveStat} onRemove={removeStat} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminKeyValueEditor({ title, rows = [], onChange, keyLabel = "Label", valueLabel = "Value" }) {
  const updateRow = (index, part, value) => {
    const next = rows.map((row) => [...row]);
    next[index][part] = value;
    onChange(next);
  };
  const addRow = () => onChange([...rows, ["Label", "Value"]]);
  const removeRow = (index) => onChange(rows.filter((_, itemIndex) => itemIndex !== index));
  const moveRow = (index, direction) => onChange(moveArrayItem(rows, index, direction));

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <h4>{title}</h4>
        <button type="button" className="admin-mini-button" onClick={addRow}>Add row</button>
      </div>
      <div className="admin-list">
        {rows.map((row, index) => (
          <div className="admin-row-card kv" key={`${row[0]}-${index}`}>
            <AdminText label={keyLabel} value={row[0]} onChange={(value) => updateRow(index, 0, value)} />
            <AdminText label={valueLabel} value={row[1]} onChange={(value) => updateRow(index, 1, value)} />
            <AdminRowActions index={index} length={rows.length} onMove={moveRow} onRemove={removeRow} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminResultEditor({ results = [], onChange }) {
  const updateResult = (index, part, value) => {
    const next = results.map((result) => [...result]);
    next[index][part] = value;
    onChange(next);
  };
  const addResult = () => onChange([...results, ["0", "", "Result"]]);
  const removeResult = (index) => onChange(results.filter((_, itemIndex) => itemIndex !== index));
  const moveResult = (index, direction) => onChange(moveArrayItem(results, index, direction));

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <h4>Results</h4>
        <button type="button" className="admin-mini-button" onClick={addResult}>Add result</button>
      </div>
      <div className="admin-mini-grid">
        {results.map((result, index) => (
          <div className="admin-mini-card" key={`${result[2]}-${index}`}>
            <AdminText label="Number" value={result[0]} onChange={(value) => updateResult(index, 0, value)} />
            <AdminText label="Suffix" value={result[1]} onChange={(value) => updateResult(index, 1, value)} />
            <AdminText label="Label" value={result[2]} onChange={(value) => updateResult(index, 2, value)} />
            <AdminRowActions index={index} length={results.length} onMove={moveResult} onRemove={removeResult} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminTechStackEditor({ stack = [], onChange }) {
  const updateItem = (index, value) => {
    const next = [...stack];
    next[index] = value;
    onChange(next);
  };
  const addItem = () => onChange([...stack, "New tool"]);
  const removeItem = (index) => onChange(stack.filter((_, itemIndex) => itemIndex !== index));
  const moveItem = (index, direction) => onChange(moveArrayItem(stack, index, direction));

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <h4>Tech stack rail</h4>
        <button type="button" className="admin-mini-button" onClick={addItem}>Add tool</button>
      </div>
      <div className="admin-list">
        {stack.map((tool, index) => (
          <div className="admin-row-card stack" key={`${tool}-${index}`}>
            <AdminText label="Tool" value={tool} onChange={(value) => updateItem(index, value)} />
            <AdminRowActions index={index} length={stack.length} onMove={moveItem} onRemove={removeItem} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminStudioEditor({
  side,
  draft,
  updateStudio,
  updateStudioStats,
  updateService,
  addService,
  removeService,
  moveService,
  updateWork,
  addWork,
  removeWork,
  moveWork,
}) {
  const studio = draft.studios[side];
  const services = draft.services[side] || [];
  const works = draft.works[side] || [];
  const label = side === "graphic" ? "Graphic Studio" : "Web Studio";
  const thumbOptions = ADMIN_THUMBS[side];
  const categoryOptions = adminCategoryOptions(services);

  return (
    <div className="admin-stack">
      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>{label}</h3>
            <span>Hero, page copy, stats, and CTA text</span>
          </div>
        </div>
        <div className="admin-grid two">
          <AdminText label="Hero eyebrow" value={studio.heroEyebrow} onChange={(value) => updateStudio(side, "heroEyebrow", value)} />
          <AdminText label="Hero CTA" value={studio.heroCta} onChange={(value) => updateStudio(side, "heroCta", value)} />
          <AdminText label="Hero top line" value={studio.heroTitleTop} onChange={(value) => updateStudio(side, "heroTitleTop", value)} />
          <AdminText label="Hero italic line" value={studio.heroTitleEm} onChange={(value) => updateStudio(side, "heroTitleEm", value)} />
          <AdminText label="Hero suffix" value={studio.heroTitleSuffix} onChange={(value) => updateStudio(side, "heroTitleSuffix", value)} />
          <AdminText label="Page eyebrow" value={studio.pageEyebrow} onChange={(value) => updateStudio(side, "pageEyebrow", value)} />
        </div>
        <AdminText label="Hero description" value={studio.heroSub} textarea onChange={(value) => updateStudio(side, "heroSub", value)} />
        <AdminStatEditor title="Hero stats" stats={studio.heroStats || []} onChange={(stats) => updateStudioStats(side, "heroStats", stats)} />
        <div className="admin-grid two">
          <AdminText label="Page title prefix" value={studio.pageTitlePre} onChange={(value) => updateStudio(side, "pageTitlePre", value)} />
          <AdminText label="Page title italic word" value={studio.pageTitleEm} onChange={(value) => updateStudio(side, "pageTitleEm", value)} />
          <AdminText label="Page title suffix" value={studio.pageTitlePost} onChange={(value) => updateStudio(side, "pageTitlePost", value)} />
          <AdminText label="Page title second line" value={studio.pageTitleSecond} onChange={(value) => updateStudio(side, "pageTitleSecond", value)} />
        </div>
        <AdminText label="Page intro" value={studio.pageLede} textarea onChange={(value) => updateStudio(side, "pageLede", value)} />
        <AdminStatEditor title="Page stats" stats={studio.pageStats || []} onChange={(stats) => updateStudioStats(side, "pageStats", stats)} />
        <div className="admin-grid two">
          <AdminText label="Portfolio title" value={studio.portfolioTitle} onChange={(value) => updateStudio(side, "portfolioTitle", value)} />
          <AdminText label="Portfolio meta" value={studio.portfolioMeta} onChange={(value) => updateStudio(side, "portfolioMeta", value)} />
          <AdminText label="Services meta" value={studio.servicesMeta} onChange={(value) => updateStudio(side, "servicesMeta", value)} />
          <AdminText label="CTA button" value={studio.ctaButton} onChange={(value) => updateStudio(side, "ctaButton", value)} />
          <AdminText label="CTA title prefix" value={studio.ctaTitlePre} onChange={(value) => updateStudio(side, "ctaTitlePre", value)} />
          <AdminText label="CTA italic word" value={studio.ctaTitleEm} onChange={(value) => updateStudio(side, "ctaTitleEm", value)} />
          <AdminText label="CTA second line" value={studio.ctaTitleSecond} onChange={(value) => updateStudio(side, "ctaTitleSecond", value)} />
        </div>
        <AdminText label="CTA text" value={studio.ctaText} textarea onChange={(value) => updateStudio(side, "ctaText", value)} />
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Services</h3>
            <span>{services.length} service cards</span>
          </div>
          <button type="button" className="admin-secondary" onClick={() => addService(side)}>Add service</button>
        </div>
        <div className="admin-list">
          {services.map((service, index) => (
            <div className="admin-row-card service" key={`${service.num}-${service.title}-${index}`}>
              <AdminText label="Number" value={service.num} onChange={(value) => updateService(side, index, "num", value)} />
              <AdminText label="Title" value={service.title} onChange={(value) => updateService(side, index, "title", value)} />
              <AdminText label="Description" value={service.desc} onChange={(value) => updateService(side, index, "desc", value)} />
              <AdminNumber label="Icon index" value={service.icon ?? index} max={9} onChange={(value) => updateService(side, index, "icon", value)} />
              <AdminRowActions index={index} length={services.length} onMove={(itemIndex, direction) => moveService(side, itemIndex, direction)} onRemove={(itemIndex) => removeService(side, itemIndex)} />
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Portfolio Work</h3>
            <span>{works.length} case cards</span>
          </div>
          <button type="button" className="admin-secondary" onClick={() => addWork(side)}>Add work</button>
        </div>
        <div className="admin-list">
          {works.map((work, index) => (
            <div className="admin-row-card work" key={`${work.id}-${index}`}>
              <AdminText label="Case ID" value={work.id} onChange={(value) => updateWork(side, index, "id", value)} />
              <AdminText label="Title" value={work.title} onChange={(value) => updateWork(side, index, "title", value)} />
              <AdminText label="Slug" value={work.slug || ""} onChange={(value) => updateWork(side, index, "slug", adminSlugify(value))} />
              <AdminText label="Category" value={work.cat} onChange={(value) => updateWork(side, index, "cat", value)} />
              <AdminSelect
                label="Service category"
                value={work.category_id || adminSlugify(work.cat)}
                options={categoryOptions.length ? categoryOptions : [{ value: adminSlugify(work.cat || "selected-work"), label: work.cat || "Selected work" }]}
                onChange={(value) => updateWork(side, index, "category_id", value)}
              />
              <AdminText label="Year" value={work.year} onChange={(value) => updateWork(side, index, "year", value)} />
              <AdminText label="Client name" value={work.client_name || ""} onChange={(value) => updateWork(side, index, "client_name", value)} />
              {side === "webdev" && (
                <AdminText label="Stack" value={work.stack} onChange={(value) => updateWork(side, index, "stack", value)} />
              )}
              <AdminText label="Short description" value={work.short_description || ""} textarea onChange={(value) => updateWork(side, index, "short_description", value)} />
              <AdminText label="Full description" value={work.full_description || ""} textarea onChange={(value) => updateWork(side, index, "full_description", value)} />
              <AdminSelect label="Published" value={work.is_published === false ? "no" : "yes"} options={[
                { value: "yes", label: "Published" },
                { value: "no", label: "Unpublished" },
              ]} onChange={(value) => updateWork(side, index, "is_published", value === "yes")} />
              <AdminSelect label="Featured" value={work.is_featured ? "yes" : "no"} options={[
                { value: "no", label: "Not featured" },
                { value: "yes", label: "Featured" },
              ]} onChange={(value) => updateWork(side, index, "is_featured", value === "yes")} />
              <AdminNumber label="Sort order" value={work.sort_order ?? index + 1} min={1} max={999} onChange={(value) => updateWork(side, index, "sort_order", value)} />
              <AdminSelect label="Thumbnail" value={work.thumb} options={thumbOptions} onChange={(value) => updateWork(side, index, "thumb", value)} />
              <AdminPaletteSelect label="Palette" value={work.pal ?? 0} side={side} onChange={(value) => updateWork(side, index, "pal", value)} />
              <AdminSelect label="Card size / aspect ratio" value={String(work.span ?? 4)} options={[
                { value: "4",  label: "4-col — portrait (3:4)" },
                { value: "6",  label: "6-col — landscape (4:3)" },
                { value: "8",  label: "8-col — wide (16:9)" },
                { value: "12", label: "12-col — full-width (21:9)" },
              ]} onChange={(value) => updateWork(side, index, "span", Number(value))} />
              <AdminText label="Thumb number" value={work.num} onChange={(value) => updateWork(side, index, "num", value)} />
              <AdminText label="Cover alt text" value={work.cover_alt || ""} onChange={(value) => updateWork(side, index, "cover_alt", value)} />
              <AdminImageUpload label="Cover image for Selected Work grid" value={work.cover_image_url || work.image || ""} onChange={(value) => {
                updateWork(side, index, "cover_image_url", value);
                updateWork(side, index, "image", value);
              }} />
              <AdminGalleryEditor
                images={work.gallery_images || []}
                projectId={work.id}
                onChange={(images) => updateWork(side, index, "gallery_images", images)}
              />
              <AdminRowActions index={index} length={works.length} onMove={(itemIndex, direction) => moveWork(side, itemIndex, direction)} onRemove={(itemIndex) => removeWork(side, itemIndex)} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminCasesEditor({ draft, updateCase, updateCaseResult, updateCaseInfo, addCase, removeCase }) {
  const caseIds = Object.keys(draft.cases || {});
  const [caseId, setCaseId] = React.useState(caseIds[0] || "");

  React.useEffect(() => {
    if (!caseId && caseIds.length) setCaseId(caseIds[0]);
    if (caseId && !draft.cases?.[caseId]) setCaseId(caseIds[0] || "");
  }, [caseId, caseIds.join("|"), draft.cases]);

  const data = draft.cases?.[caseId];

  if (!caseIds.length) {
    return (
      <section className="admin-section">
        <div className="admin-empty">
          <h3>Case Studies</h3>
          <p>No case studies exist yet.</p>
          <button type="button" className="admin-primary" onClick={() => setCaseId(addCase())}>Create first case</button>
        </div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <div className="admin-stack">
      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Case Studies</h3>
            <span>Work card IDs open matching case IDs</span>
          </div>
          <div className="admin-heading-actions">
            <button type="button" className="admin-secondary" onClick={() => setCaseId(addCase())}>Add case</button>
            <button type="button" className="admin-danger" onClick={() => removeCase(caseId)}>Remove case</button>
          </div>
        </div>

        <AdminSelect
          label="Editing case"
          value={caseId}
          onChange={setCaseId}
          options={caseIds.map((id) => ({ value: id, label: `${id} - ${draft.cases[id].title || "Untitled"}` }))}
        />

        <div className="admin-grid two">
          <AdminText label="Title" value={data.title} onChange={(value) => updateCase(caseId, "title", value)} />
          <AdminText label="Eyebrow" value={data.eyebrow} onChange={(value) => updateCase(caseId, "eyebrow", value)} />
          <AdminSelect label="Side" value={data.side || "graphic"} options={[
            { value: "graphic", label: "Graphic" },
            { value: "webdev", label: "Software Dev" },
          ]} onChange={(value) => updateCase(caseId, "side", value)} />
          <AdminSelect label="Thumbnail" value={data.thumb || (data.side === "webdev" ? "WebApp" : "Brand")} options={ADMIN_THUMBS[data.side || "graphic"]} onChange={(value) => updateCase(caseId, "thumb", value)} />
          <AdminPaletteSelect label="Palette" value={data.pal ?? 0} side={data.side || "graphic"} onChange={(value) => updateCase(caseId, "pal", value)} />
          <AdminText label="Thumb number" value={data.num} onChange={(value) => updateCase(caseId, "num", value)} />
        </div>

        <AdminImageUpload label="Case hero image (overrides generated thumbnail)" value={data.image || ""} onChange={(value) => updateCase(caseId, "image", value)} />
        <AdminText label="Challenge" value={data.challenge} textarea onChange={(value) => updateCase(caseId, "challenge", value)} />
        <AdminText label="Pull quote" value={data.pull} textarea onChange={(value) => updateCase(caseId, "pull", value)} />
        <AdminText label="Process" value={data.process} textarea onChange={(value) => updateCase(caseId, "process", value)} />
        <AdminText label="Tools and stack" value={data.tools} textarea onChange={(value) => updateCase(caseId, "tools", value)} />
      </section>

      <section className="admin-section">
        <AdminKeyValueEditor
          title="Sidebar facts"
          rows={data.side_info || []}
          keyLabel="Fact"
          valueLabel="Detail"
          onChange={(rows) => updateCaseInfo(caseId, rows)}
        />
        <AdminResultEditor
          results={data.results || []}
          onChange={(results) => updateCaseResult(caseId, results)}
        />
      </section>
    </div>
  );
}

function AdminDataEditor({ draft, setDraft, save, reset, setStatus }) {
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "vox-portfolio-content.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Exported content JSON.");
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
      setStatus("Copied content JSON to clipboard.");
    } catch (error) {
      setStatus("Clipboard copy was blocked by the browser.", true);
    }
  };

  const importJson = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object") throw new Error("Expected an object.");
        setDraft(adminNormalize(parsed));
        setStatus("Imported JSON. Review it, then save changes.");
      } catch (error) {
        setStatus("The selected file is not valid portfolio JSON.", true);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const updateStack = (stack) => {
    setDraft((current) => {
      const next = adminClone(current);
      next.techStack = stack;
      return next;
    });
  };

  return (
    <div className="admin-stack">
      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Data Tools</h3>
            <span>Move content between browsers, builds, or hosts</span>
          </div>
        </div>
        <div className="admin-data-actions">
          <button type="button" className="admin-secondary" onClick={exportJson}>Export JSON</button>
          <button type="button" className="admin-secondary" onClick={copyJson}>Copy JSON</button>
          <label className="admin-file">
            Import JSON
            <input type="file" accept="application/json" onChange={importJson} />
          </label>
          <button type="button" className="admin-primary" onClick={save}>Save now</button>
          <button type="button" className="admin-danger" onClick={reset}>Reset defaults</button>
        </div>
        <p className="admin-note">
          {window.PortfolioSupabase
            ? "Changes are saved to Supabase and visible on every device. Export JSON as an offline backup."
            : "Static hosting cannot write content back to the server. Saved changes persist in this browser; export JSON when you want to carry edits into another environment."}
        </p>
      </section>

      <section className="admin-section">
        <AdminTechStackEditor stack={draft.techStack || []} onChange={updateStack} />
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Current JSON</h3>
            <span>Read-only preview of the saved content shape</span>
          </div>
        </div>
        <textarea className="admin-json" readOnly value={JSON.stringify(draft, null, 2)} />
      </section>
    </div>
  );
}

function AdminPanel({ enabled = true, open, content, onSave, onClose }) {
  const config = window.PortfolioConfig || {};
  const passcode = adminNormalizePasscode(config.adminPasscode || window.PORTFOLIO_ADMIN_PASSCODE || "");
  const sessionValue = passcode ? `pass:${adminHash(passcode)}` : "";
  const [unlocked, setUnlocked] = React.useState(false);
  const [authChecking, setAuthChecking] = React.useState(true);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [loginError, setLoginError] = React.useState("");
  const [authFallback, setAuthFallback] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState(() => localStorage.getItem(ADMIN_TAB_KEY) || "site");
  const [draft, setDraft] = React.useState(() => adminClone(content));
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatusState] = React.useState("");
  const [statusIsError, setStatusIsError] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState(null);
  const statusTimerRef = React.useRef(null);

  const setStatus = (message, isError = false) => {
    setStatusState(message);
    setStatusIsError(isError);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (message) {
      statusTimerRef.current = setTimeout(() => setStatusState(""), 3500);
    }
  };

  React.useEffect(() => {
    if (!dirty) setDraft(adminClone(content));
  }, [content, dirty]);

  // Auth: check Supabase session or fall back to localStorage passcode session
  React.useEffect(() => {
    const sb = authFallback ? null : window.PortfolioSupabase;
    if (sb) {
      sb.auth.getSession()
        .then(({ data: { session } }) => {
          setUnlocked(!!session);
          setAuthChecking(false);
        })
        .catch((error) => {
          if (adminIsNetworkError(error)) {
            adminDisableSupabase();
            setAuthFallback(true);
          }
          setUnlocked(localStorage.getItem(ADMIN_SESSION_KEY) === sessionValue);
          setAuthChecking(false);
        });
      const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
        setUnlocked(!!session);
      });
      return () => subscription.unsubscribe();
    } else {
      setUnlocked(localStorage.getItem(ADMIN_SESSION_KEY) === sessionValue);
      setAuthChecking(false);
    }
  }, [authFallback, sessionValue]);

  React.useEffect(() => {
    localStorage.setItem(ADMIN_TAB_KEY, activeTab);
  }, [activeTab]);

  const mutate = (producer) => {
    setDraft((current) => {
      const next = adminClone(current);
      producer(next);
      return next;
    });
    setDirty(true);
    setStatus("");
  };

  const updateSite = (key, value) => mutate((next) => { next.site[key] = value; });
  const updateStudio = (side, key, value) => mutate((next) => { next.studios[side][key] = value; });
  const updateStudioStats = (side, key, value) => mutate((next) => { next.studios[side][key] = value; });
  const updateService = (side, index, key, value) => mutate((next) => { next.services[side][index][key] = value; });
  const updateWork = (side, index, key, value) => mutate((next) => { next.works[side][index][key] = value; });
  const updateCase = (caseId, key, value) => mutate((next) => { next.cases[caseId][key] = value; });
  const updateCaseInfo = (caseId, rows) => mutate((next) => { next.cases[caseId].side_info = rows; });
  const updateCaseResult = (caseId, results) => mutate((next) => { next.cases[caseId].results = results; });

  const addService = (side) => mutate((next) => {
    const count = next.services[side].length + 1;
    next.services[side].push({ num: String(count).padStart(2, "0"), title: "New service", desc: "Short service description.", icon: Math.min(count - 1, 9) });
  });
  const removeService = (side, index) => mutate((next) => {
    next.services[side] = next.services[side].filter((_, itemIndex) => itemIndex !== index);
  });
  const moveService = (side, index, direction) => mutate((next) => {
    next.services[side] = moveArrayItem(next.services[side], index, direction);
  });

  const addWork = (side) => mutate((next) => {
    const prefix = side === "graphic" ? "g" : "w";
    const count = next.works[side].length + 1;
    const title = "New Project";
    const categoryLabel = side === "graphic" ? "Brand Identity" : "Website";
    next.works[side].push({
      id: `${prefix}${count}`,
      title,
      slug: adminSlugify(`${title} ${count}`),
      category_id: adminSlugify(categoryLabel),
      cat: categoryLabel,
      year: String(new Date().getFullYear()),
      stack: side === "webdev" ? "React - CSS - Node" : undefined,
      client_name: "",
      cover_image_url: "",
      short_description: "",
      full_description: "",
      gallery_images: [],
      is_featured: false,
      is_published: true,
      sort_order: count,
      thumb: side === "graphic" ? "Brand" : "WebApp",
      pal: 0,
      span: 4,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });
  const removeWork = (side, index) => {
    if (!window.confirm("Delete this project from the draft?")) return;
    mutate((next) => {
      next.works[side] = next.works[side].filter((_, itemIndex) => itemIndex !== index);
    });
  };
  const moveWork = (side, index, direction) => mutate((next) => {
    next.works[side] = moveArrayItem(next.works[side], index, direction);
  });

  const addCase = () => {
    let index = Object.keys(draft.cases || {}).length + 1;
    let createdId = "";
    do {
      createdId = `case-${index}`;
      index += 1;
    } while (draft.cases?.[createdId]);

    mutate((next) => {
      next.cases[createdId] = {
        side: "graphic",
        title: "New Case Study",
        eyebrow: "Case - Project",
        pal: 0,
        thumb: "Brand",
        side_info: [["Client", "Client name"], ["Year", String(new Date().getFullYear())], ["Role", "Designer"]],
        challenge: "Describe the business problem.",
        pull: "Add a short pull quote.",
        process: "Describe the process.",
        tools: "Tools, stack, and deliverables.",
        results: [["0", "", "Result"]],
      };
    });
    return createdId;
  };

  const removeCase = (caseId) => {
    if (!window.confirm(`Remove ${caseId}? This only affects the saved draft.`)) return;
    mutate((next) => {
      delete next.cases[caseId];
    });
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const normalized = adminNormalize(draft);
      const validationError = adminValidateContent(normalized);
      if (validationError) {
        setDraft(adminClone(normalized));
        setDirty(true);
        setStatus(validationError, true);
        return;
      }
      await window.PortfolioContent.save(normalized);
      onSave(adminClone(normalized));
      setDraft(adminClone(normalized));
      setDirty(false);
      setLastSavedAt(new Date());
      setStatus(window.PortfolioSupabase ? "Saved to Supabase." : "Content saved in this browser.");
    } catch (err) {
      setStatus("Save failed — " + (err.message || "unknown error") + ". Draft kept.", true);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm("Reset all portfolio content to the source defaults?")) return;
    try {
      const fresh = await window.PortfolioContent.reset();
      setDraft(adminClone(fresh));
      onSave(adminClone(fresh));
      setDirty(false);
      setStatus("Content reset to source defaults.");
    } catch (err) {
      setStatus("Reset failed: " + (err.message || "unknown error"), true);
    }
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Close the admin panel with unsaved changes?")) return;
    onClose();
  };

  React.useEffect(() => {
    if (!open || !unlocked) return undefined;
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, unlocked, dirty, draft]);

  const login = async (event) => {
    event.preventDefault();
    const sb = authFallback ? null : window.PortfolioSupabase;
    const submittedPasscode = adminNormalizePasscode(password);
    if (sb) {
      if (passcode && submittedPasscode === passcode) {
        adminDisableSupabase();
        setAuthFallback(true);
        localStorage.setItem(ADMIN_SESSION_KEY, sessionValue);
        setUnlocked(true);
        setLoginError("");
        setEmail("");
        setPassword("");
        return;
      }
      setLoginLoading(true);
      setLoginError("");
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange listener will set unlocked = true
      } catch (err) {
        if (adminIsNetworkError(err)) {
          adminDisableSupabase();
          setAuthFallback(true);
          if (!passcode) {
            setLoginError("Supabase is unreachable and admin passcode is not configured.");
          } else if (submittedPasscode === passcode) {
            localStorage.setItem(ADMIN_SESSION_KEY, sessionValue);
            setUnlocked(true);
            setLoginError("");
            setPassword("");
          } else {
            setPassword("");
            setLoginError("Supabase is unreachable. Enter the site passcode to continue in browser-only mode.");
          }
        } else {
          setLoginError(err.message || "Login failed.");
        }
      } finally {
        setLoginLoading(false);
      }
    } else {
      if (!passcode) { setLoginError("Admin passcode is not configured."); return; }
      if (submittedPasscode === passcode) {
        localStorage.setItem(ADMIN_SESSION_KEY, sessionValue);
        setUnlocked(true);
        setLoginError("");
        setPassword("");
      } else {
        setLoginError("Wrong passcode. Use the value set in Portfolio.html -> PortfolioConfig.adminPasscode.");
      }
    }
  };

  const logout = async () => {
    const sb = authFallback ? null : window.PortfolioSupabase;
    if (sb) {
      await sb.auth.signOut().catch(() => {});
      // onAuthStateChange listener will set unlocked = false
    } else {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      setUnlocked(false);
    }
    setStatus("Admin locked.");
  };

  if (!open || !enabled) return null;

  if (authChecking) {
    return (
      <div className="admin-overlay">
        <div className="admin-login">
          <button type="button" className="admin-close" onClick={requestClose}>Close</button>
          <p style={{color:"rgba(255,255,255,.45)", fontFamily:"monospace", fontSize:13, textAlign:"center", marginTop:16}}>Checking session…</p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    const useSupabase = !!window.PortfolioSupabase && !authFallback;
    return (
      <div className="admin-overlay">
        <form className="admin-login" onSubmit={login}>
          <button type="button" className="admin-close" onClick={requestClose}>Close</button>
          <h2>Admin Panel</h2>
          <p>{useSupabase ? "Sign in with your Supabase admin account." : "Enter the site passcode to edit portfolio content."}</p>
          {useSupabase && (
            <AdminText label="Email" type="email" value={email} onChange={setEmail} placeholder="admin@example.com" />
          )}
          <AdminPasswordField label={useSupabase ? "Password" : "Passcode"} value={password} onChange={setPassword} />
          {loginError && <div className="admin-error">{loginError}</div>}
          <button className="admin-primary" type="submit" disabled={loginLoading}>
            {loginLoading ? "Signing in…" : "Unlock"}
          </button>
          {useSupabase && passcode && (
            <button
              type="button"
              className="admin-secondary"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => {
                adminDisableSupabase();
                setAuthFallback(true);
                setEmail("");
                setPassword("");
                setLoginError("Enter the site passcode to continue in browser-only mode.");
              }}
            >
              Use passcode instead
            </button>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="admin-overlay">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div>
            <div className="admin-kicker">Portfolio CMS</div>
            <h2>
              Admin Panel
              {dirty && <span className="admin-dirty-dot" title="Unsaved changes"></span>}
            </h2>
          </div>
          <nav className="admin-tabs">
            {[
              ["site",    "⊙", "Site"],
              ["graphic", "◈", "Graphic"],
              ["webdev",  "‹›", "Software Dev"],
              ["cases",   "▤", "Cases"],
              ["uploads", "⊞", "Uploads"],
              ["data",    "≡", "Data"],
            ].map(([key, icon, label]) => (
              <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>
                <span className="admin-tab-icon">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="admin-sidebar-actions">
            <button type="button" className="admin-secondary" onClick={logout}>Lock</button>
            <button type="button" className="admin-secondary" onClick={requestClose}>Close</button>
          </div>
        </aside>

        <main className="admin-main">
          <div className="admin-toolbar">
            <div>
              <strong>{saving ? "Saving…" : dirty ? "Unsaved changes" : "Content saved"}</strong>
              <span>
                {lastSavedAt
                  ? `Last saved at ${lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : window.PortfolioSupabase
                    ? "Changes are saved to Supabase."
                    : "Static edits stored in this browser."}
              </span>
            </div>
            <div className="admin-toolbar-actions">
              <button type="button" className="admin-secondary" disabled={saving} onClick={() => {
                setDraft(adminClone(content));
                setDirty(false);
                setStatus("Draft changes discarded.");
              }}>Discard draft</button>
              <button type="button" className="admin-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          {activeTab === "site" && (
            <section className="admin-section">
              <div className="admin-section-head">
                <div>
                  <h3>Site Settings</h3>
                  <span>Brand, SEO, and contact</span>
                </div>
              </div>
              <div className="admin-grid two">
                <AdminText label="Brand name" value={draft.site.brandName} onChange={(value) => updateSite("brandName", value)} />
                <AdminText label="Logo mark" value={draft.site.logoMark} onChange={(value) => updateSite("logoMark", value)} />
                <AdminText label="Trademark text" value={draft.site.trademark} onChange={(value) => updateSite("trademark", value)} />
                <AdminText label="Contact email" type="email" value={draft.site.contactEmail} onChange={(value) => updateSite("contactEmail", value)} />
              </div>
              <AdminText label="Meta title" value={draft.site.metaTitle} onChange={(value) => updateSite("metaTitle", value)} />
              <AdminText label="Meta description" value={draft.site.metaDescription} textarea onChange={(value) => updateSite("metaDescription", value)} />
              <div className="admin-subsection-head" style={{ marginTop: 22 }}>
                <h4>Social links</h4>
              </div>
              <div className="admin-grid two">
                <AdminText label="GitHub" value={draft.site.github} placeholder="https://github.com/…" onChange={(value) => updateSite("github", value)} />
                <AdminText label="LinkedIn" value={draft.site.linkedin} placeholder="https://linkedin.com/in/…" onChange={(value) => updateSite("linkedin", value)} />
                <AdminText label="Twitter / X" value={draft.site.twitter} placeholder="https://x.com/…" onChange={(value) => updateSite("twitter", value)} />
                <AdminText label="Behance" value={draft.site.behance} placeholder="https://behance.net/…" onChange={(value) => updateSite("behance", value)} />
              </div>
            </section>
          )}

          {activeTab === "graphic" && (
            <AdminStudioEditor
              side="graphic"
              draft={draft}
              updateStudio={updateStudio}
              updateStudioStats={updateStudioStats}
              updateService={updateService}
              addService={addService}
              removeService={removeService}
              moveService={moveService}
              updateWork={updateWork}
              addWork={addWork}
              removeWork={removeWork}
              moveWork={moveWork}
            />
          )}

          {activeTab === "webdev" && (
            <AdminStudioEditor
              side="webdev"
              draft={draft}
              updateStudio={updateStudio}
              updateStudioStats={updateStudioStats}
              updateService={updateService}
              addService={addService}
              removeService={removeService}
              moveService={moveService}
              updateWork={updateWork}
              addWork={addWork}
              removeWork={removeWork}
              moveWork={moveWork}
            />
          )}

          {activeTab === "cases" && (
            <AdminCasesEditor
              draft={draft}
              updateCase={updateCase}
              updateCaseInfo={updateCaseInfo}
              updateCaseResult={updateCaseResult}
              addCase={addCase}
              removeCase={removeCase}
            />
          )}

          {activeTab === "uploads" && (
            <AdminUploadsPage setStatus={setStatus} />
          )}

          {activeTab === "data" && (
            <AdminDataEditor
              draft={draft}
              setDraft={(next) => {
                setDraft(next);
                setDirty(true);
              }}
              save={save}
              reset={reset}
              setStatus={setStatus}
            />
          )}
        </main>
      </div>
      {status && (
        <div className={"admin-toast" + (statusIsError ? " error" : "")}>
          <span>{status}</span>
          <button className="admin-toast-close" onClick={() => setStatusState("")}>×</button>
        </div>
      )}
    </div>
  );
}

window.PortfolioAdminPanel = AdminPanel;
