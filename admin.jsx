// VOX Studio — Admin Panel
const { useState, useEffect, useRef, useCallback } = React;

// ─── Storage ─────────────────────────────────────────────────────────────────
const KEYS = { graphic: 'vox_graphic_works', webdev: 'vox_webdev_works', uploads: 'vox_uploads' };
const ADMIN_PW = 'voxstudio';

const db = {
  get: (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch(e) { return fb; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) { alert('Storage full — delete some uploads first.'); } },
};

const DEFAULT_GRAPHIC = [
  { id:'g1', title:'Sorrel & Stone',    cat:'Packaging · Botanical Tea', year:'2025', thumb:'Packaging', pal:0, span:6 },
  { id:'g2', title:'Northwind Festival',cat:'Poster Series',             year:'2025', thumb:'Poster',    pal:1, span:3, num:'26' },
  { id:'g3', title:'Atlas Roastery',    cat:'Brand Identity',            year:'2024', thumb:'Brand',     pal:2, span:3 },
  { id:'g4', title:'Marlow & Co.',      cat:'Stationery System',         year:'2024', thumb:'Brand',     pal:3, span:4 },
  { id:'g5', title:'Hoshi Skincare',    cat:'Social Media Suite',        year:'2024', thumb:'Social',    pal:4, span:4 },
  { id:'g6', title:'Ember Films',       cat:'Title Sequence',            year:'2024', thumb:'Poster',    pal:5, span:4, num:'07' },
];
const DEFAULT_WEBDEV = [
  { id:'w1', title:'Halo Bank',        cat:'Web App · Fintech',  year:'2025', stack:'Next.js · TS · Postgres', thumb:'Dashboard', pal:0, span:6 },
  { id:'w2', title:'Pinecrest Realty', cat:'Marketing Site',     year:'2025', stack:'Next.js · Sanity',         thumb:'WebApp',    pal:1, span:3 },
  { id:'w3', title:'Loom & Field',     cat:'E-commerce',         year:'2024', stack:'Shopify Hydrogen',         thumb:'WebApp',    pal:2, span:3 },
  { id:'w4', title:'Open Atlas API',   cat:'Developer Tool',     year:'2024', stack:'Node · GraphQL',           thumb:'Code',      pal:3, span:4 },
  { id:'w5', title:'Northwind Studio', cat:'Portfolio',          year:'2024', stack:'Astro · MDX',              thumb:'WebApp',    pal:4, span:4 },
  { id:'w6', title:'Ledger.io',        cat:'SaaS Dashboard',     year:'2024', stack:'React · Tailwind',         thumb:'Dashboard', pal:5, span:4 },
];

// ─── Icons (tiny inline SVG) ─────────────────────────────────────────────────
function Ico({ n, s = 15 }) {
  const paths = {
    home:    <path strokeWidth="1.6" d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z M7 18v-7h6v7"/>,
    grid:    <path strokeWidth="1.6" d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z"/>,
    img:     <><rect x="2" y="2" width="16" height="16" rx="2" strokeWidth="1.6"/><circle cx="7.5" cy="7.5" r="1.5" strokeWidth="1.6"/><path strokeWidth="1.6" d="M2 13l4-4 3 3 3-3 6 6"/></>,
    plus:    <path strokeWidth="2" d="M10 4v12M4 10h12"/>,
    edit:    <path strokeWidth="1.6" d="M14.8 3.2a2 2 0 012.8 2.8L6.4 17.2 2 18l.8-4.4L14.8 3.2z"/>,
    trash:   <path strokeWidth="1.6" d="M3 6h14M8 6V4h4v2M5 6l1 12h8l1-12"/>,
    upload:  <path strokeWidth="1.6" d="M4 14v3a1 1 0 001 1h10a1 1 0 001-1v-3M10 3v10M6 7l4-4 4 4"/>,
    back:    <path strokeWidth="1.6" d="M15 10H5M9 6l-4 4 4 4"/>,
    logout:  <path strokeWidth="1.6" d="M14 7l5 3-5 3M9 10h10M9 3H4a1 1 0 00-1 1v12a1 1 0 001 1h5"/>,
    eye:     <><path strokeWidth="1.6" d="M1 10s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7z"/><circle cx="10" cy="10" r="3" strokeWidth="1.6"/></>,
    code:    <path strokeWidth="1.6" d="M6 8l-4 4 4 4M14 8l4 4-4 4M11 4l-2 12"/>,
    check:   <path strokeWidth="2" d="M4 10l4 4 8-8"/>,
    copy:    <path strokeWidth="1.6" d="M7 4H4a1 1 0 00-1 1v12a1 1 0 001 1h9a1 1 0 001-1v-3M11 3h6v6h-6z"/>,
  };
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
      {paths[n]}
    </svg>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);
  const Toasts = () => (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <Ico n={t.type === 'success' ? 'check' : 'trash'} s={14} />
          {t.msg}
        </div>
      ))}
    </div>
  );
  return { push, Toasts };
}

// ─── Image upload helper ──────────────────────────────────────────────────────
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 3 * 1024 * 1024) { reject(new Error('File exceeds 3 MB limit')); return; }
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

// ─── Upload Zone component ────────────────────────────────────────────────────
function UploadZone({ value, onChange, label = 'Upload image', hint = 'PNG, JPG, WebP, SVG — max 3 MB' }) {
  const [drag, setDrag] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef();

  const handle = async (file) => {
    if (!file || !file.type.startsWith('image/')) { alert('Please select an image file.'); return; }
    setLoading(true);
    try { onChange(await readFileAsBase64(file)); }
    catch(e) { alert(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      {value ? (
        <div>
          <img src={value} alt="preview" className="upload-preview" />
          <div className="upload-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => inputRef.current.click()}>
              <Ico n="upload" s={13} /> Replace
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onChange('')}>
              <Ico n="trash" s={13} /> Remove
            </button>
            <input ref={inputRef} type="file" accept="image/*" style={{display:'none'}} onChange={e => handle(e.target.files[0])} />
          </div>
        </div>
      ) : (
        <div
          className={`upload-zone ${drag ? 'drag-over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files[0]); }}
        >
          <input type="file" accept="image/*" onChange={e => handle(e.target.files[0])} />
          <div className="upload-icon">🖼</div>
          <div className="upload-title">{loading ? 'Processing…' : label}</div>
          <div className="upload-hint">{hint}</div>
        </div>
      )}
    </div>
  );
}

// ─── Results builder ──────────────────────────────────────────────────────────
function ResultsBuilder({ value, onChange }) {
  const rows = value && value.length ? value : [['', '', '']];
  const set = (i, j, v) => {
    const next = rows.map(r => [...r]);
    next[i][j] = v;
    onChange(next);
  };
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="results-row">
          <div className="form-group">
            {i === 0 && <label className="form-label">Value</label>}
            <input className="form-input" placeholder="+42" value={r[0] || ''} onChange={e => set(i, 0, e.target.value)} />
          </div>
          <div className="form-group">
            {i === 0 && <label className="form-label">Suffix</label>}
            <input className="form-input" placeholder="%" value={r[1] || ''} onChange={e => set(i, 1, e.target.value)} />
          </div>
          <div className="form-group">
            {i === 0 && <label className="form-label">Label</label>}
            <input className="form-input" placeholder="Shelf recall" value={r[2] || ''} onChange={e => set(i, 2, e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            {rows.length > 1 && (
              <button type="button" className="btn btn-danger btn-sm btn-icon"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Ico n="trash" s={12} />
              </button>
            )}
          </div>
        </div>
      ))}
      {rows.length < 4 && (
        <button type="button" className="btn btn-ghost btn-sm add-row-btn"
          onClick={() => onChange([...rows, ['', '', '']])}>
          <Ico n="plus" s={12} /> Add result
        </button>
      )}
    </div>
  );
}

// ─── Side-info builder ────────────────────────────────────────────────────────
function SideInfoBuilder({ value, onChange }) {
  const rows = value && value.length ? value : [['', '']];
  const set = (i, j, v) => {
    const next = rows.map(r => [...r]);
    next[i][j] = v;
    onChange(next);
  };
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="sideinfo-row">
          <div className="form-group">
            {i === 0 && <label className="form-label">Label</label>}
            <input className="form-input" placeholder="Client" value={r[0] || ''} onChange={e => set(i, 0, e.target.value)} />
          </div>
          <div className="form-group">
            {i === 0 && <label className="form-label">Value</label>}
            <input className="form-input" placeholder="Studio Name" value={r[1] || ''} onChange={e => set(i, 1, e.target.value)} />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            {rows.length > 1 && (
              <button type="button" className="btn btn-danger btn-sm btn-icon"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Ico n="trash" s={12} />
              </button>
            )}
          </div>
        </div>
      ))}
      {rows.length < 8 && (
        <button type="button" className="btn btn-ghost btn-sm add-row-btn"
          onClick={() => onChange([...rows, ['', '']])}>
          <Ico n="plus" s={12} /> Add row
        </button>
      )}
    </div>
  );
}

// ─── Work Form ────────────────────────────────────────────────────────────────
const BLANK_WORK = {
  title: '', cat: '', year: new Date().getFullYear().toString(),
  thumb: 'Brand', pal: 0, span: 4, image: '', stack: '',
  eyebrow: '', challenge: '', pull: '', process: '', tools: '',
  results: [['', '', '']], side_info: [['Client', ''], ['Year', '']],
};

function WorkForm({ side, initial, onSave, onCancel, toast }) {
  const [tab, setTab] = useState('info');
  const [form, setForm] = useState(() => ({ ...BLANK_WORK, ...initial }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const thumbOptions = side === 'graphic'
    ? ['Packaging', 'Poster', 'Brand', 'Social']
    : ['WebApp', 'Code', 'Dashboard'];

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.push('Title is required', 'error'); return; }
    onSave(form);
  };

  return (
    <form className="form-wrap" onSubmit={submit}>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <Ico n="back" s={13} /> Back
        </button>
        <h2 style={{ fontFamily:'var(--font-ui)', fontWeight:700, fontSize:17, letterSpacing:'-.02em' }}>
          {initial ? 'Edit work' : `Add ${side === 'graphic' ? 'graphic' : 'web dev'} work`}
        </h2>
      </div>

      <div className="tabs">
        <button type="button" className={`tab-btn ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Work Info</button>
        <button type="button" className={`tab-btn ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')}>Image Upload</button>
        <button type="button" className={`tab-btn ${tab === 'case' ? 'active' : ''}`} onClick={() => setTab('case')}>Case Study</button>
      </div>

      {/* ── Info tab ── */}
      {tab === 'info' && (
        <div className="form-card">
          <div className="form-card-title">Work details</div>
          <div className="form-grid">
            <div className="form-group form-full">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Project name" />
            </div>
            <div className="form-group">
              <label className="form-label">Category / Subtitle</label>
              <input className="form-input" value={form.cat} onChange={e => set('cat', e.target.value)} placeholder="Brand Identity · Coffee" />
            </div>
            <div className="form-group">
              <label className="form-label">Year</label>
              <input className="form-input" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2025" />
            </div>
            {side === 'webdev' && (
              <div className="form-group form-full">
                <label className="form-label">Stack</label>
                <input className="form-input" value={form.stack || ''} onChange={e => set('stack', e.target.value)} placeholder="Next.js · TypeScript · Postgres" />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Grid span</label>
              <select className="form-select" value={form.span} onChange={e => set('span', +e.target.value)}>
                <option value={3}>3 cols (narrow)</option>
                <option value={4}>4 cols (medium)</option>
                <option value={6}>6 cols (wide)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Palette</label>
              <select className="form-select" value={form.pal} onChange={e => set('pal', +e.target.value)}>
                {[0,1,2,3,4,5].map(i => <option key={i} value={i}>Palette {i+1}</option>)}
              </select>
            </div>
            <div className="form-group form-full">
              <label className="form-label">Fallback thumbnail type</label>
              <p className="form-hint" style={{marginBottom:8}}>Used when no image is uploaded</p>
              <div className="chip-row">
                {thumbOptions.map(t => (
                  <div key={t} className={`chip ${form.thumb === t ? 'active' : ''}`} onClick={() => set('thumb', t)}>{t}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Upload tab ── */}
      {tab === 'upload' && (
        <div className="form-card">
          <div className="form-card-title">Thumbnail image</div>
          <p className="form-hint" style={{marginBottom:18}}>
            Upload a real image to replace the procedural placeholder. Stored in localStorage as base64 (max 3 MB).
          </p>
          <UploadZone value={form.image} onChange={v => set('image', v)} />

          <div className="divider" />

          <div className="form-card-title" style={{marginBottom:10}}>Or pick from uploads library</div>
          <UploadsPickerInline current={form.image} onPick={v => set('image', v)} />
        </div>
      )}

      {/* ── Case study tab ── */}
      {tab === 'case' && (
        <div>
          <div className="form-card">
            <div className="form-card-title">Case study overview</div>
            <div className="form-grid">
              <div className="form-group form-full">
                <label className="form-label">Eyebrow label</label>
                <input className="form-input" value={form.eyebrow || ''} onChange={e => set('eyebrow', e.target.value)} placeholder="Case · Brand identity" />
              </div>
              <div className="form-group form-full">
                <label className="form-label">Challenge</label>
                <textarea className="form-textarea" value={form.challenge || ''} onChange={e => set('challenge', e.target.value)} placeholder="Describe the client problem..." style={{minHeight:100}} />
              </div>
              <div className="form-group form-full">
                <label className="form-label">Pull quote</label>
                <input className="form-input" value={form.pull || ''} onChange={e => set('pull', e.target.value)} placeholder="One punchy sentence..." />
              </div>
              <div className="form-group form-full">
                <label className="form-label">Process</label>
                <textarea className="form-textarea" value={form.process || ''} onChange={e => set('process', e.target.value)} placeholder="How you solved it..." />
              </div>
              <div className="form-group form-full">
                <label className="form-label">Tools &amp; stack</label>
                <input className="form-input" value={form.tools || ''} onChange={e => set('tools', e.target.value)} placeholder="Figma · Illustrator · InDesign" />
              </div>
            </div>
          </div>

          <div className="form-card">
            <div className="form-card-title">Results (up to 4)</div>
            <ResultsBuilder value={form.results} onChange={v => set('results', v)} />
          </div>

          <div className="form-card">
            <div className="form-card-title">Side info (metadata table)</div>
            <SideInfoBuilder value={form.side_info} onChange={v => set('side_info', v)} />
          </div>
        </div>
      )}

      <div style={{ display:'flex', gap:12, marginTop:8 }}>
        <button type="submit" className="btn btn-primary">
          <Ico n="check" s={14} /> {initial ? 'Save changes' : 'Add to portfolio'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// Inline uploads picker (shown inside the form)
function UploadsPickerInline({ current, onPick }) {
  const uploads = db.get(KEYS.uploads, []);
  if (!uploads.length) return <p className="form-hint">No uploads yet — use the Uploads page to add files first.</p>;
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))', gap:8 }}>
      {uploads.map(u => (
        <div key={u.id} onClick={() => onPick(u.data)}
          style={{ cursor:'pointer', borderRadius:6, overflow:'hidden', border: u.data === current ? '2px solid #E63946' : '2px solid transparent', transition:'border 140ms' }}>
          <img src={u.data} alt={u.name} style={{ width:'100%', aspectRatio:'4/3', objectFit:'cover', display:'block' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Works list page ──────────────────────────────────────────────────────────
function WorksPage({ side, toast }) {
  const [works, setWorks] = useState(() => db.get(side === 'graphic' ? KEYS.graphic : KEYS.webdev, side === 'graphic' ? DEFAULT_GRAPHIC : DEFAULT_WEBDEV));
  const [editing, setEditing] = useState(null); // null | {} | {existing work}
  const key = side === 'graphic' ? KEYS.graphic : KEYS.webdev;

  const save = (works) => { setWorks(works); db.set(key, works); };

  const handleSave = (form) => {
    if (editing && editing.id) {
      save(works.map(w => w.id === editing.id ? { ...w, ...form, id: w.id, side } : w));
      toast.push('Work updated');
    } else {
      const id = (side === 'graphic' ? 'g' : 'w') + Date.now();
      save([...works, { ...form, id, side }]);
      toast.push('Work added to portfolio');
    }
    setEditing(null);
  };

  const del = (id) => {
    if (!confirm('Delete this work?')) return;
    save(works.filter(w => w.id !== id));
    toast.push('Work removed');
  };

  const reset = () => {
    if (!confirm('Reset to default works? This will remove all custom entries.')) return;
    const def = side === 'graphic' ? DEFAULT_GRAPHIC : DEFAULT_WEBDEV;
    save(def);
    toast.push('Reset to defaults');
  };

  if (editing !== null) {
    return <WorkForm side={side} initial={editing.id ? editing : null} onSave={handleSave} onCancel={() => setEditing(null)} toast={toast} />;
  }

  return (
    <div>
      <div className="sec-head">
        <h2 className="sec-title">{side === 'graphic' ? 'Graphic Design' : 'Web Development'} works</h2>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={reset}>Reset defaults</button>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
            <Ico n="plus" s={13} /> Add work
          </button>
        </div>
      </div>

      {works.length === 0 ? (
        <div className="empty-state">
          <p>No works yet.</p>
          <button className="btn btn-primary" style={{marginTop:16}} onClick={() => setEditing({})}>
            <Ico n="plus" s={13} /> Add first work
          </button>
        </div>
      ) : (
        <table className="works-table">
          <thead>
            <tr>
              <th style={{width:60}}>Image</th>
              <th>Title</th>
              <th>Year</th>
              <th>Span</th>
              <th>Thumb</th>
              <th style={{width:120}}></th>
            </tr>
          </thead>
          <tbody>
            {works.map(w => (
              <tr key={w.id}>
                <td>
                  <div className="wt-thumb">
                    {w.image
                      ? <img src={w.image} alt={w.title} />
                      : <div className="wt-thumb-proc" style={{ background: '#1e1e1e', display:'flex', alignItems:'center', justifyContent:'center', color:'#444', fontSize:10, fontFamily:'var(--font-mono)' }}>{w.thumb}</div>
                    }
                  </div>
                </td>
                <td>
                  <div className="wt-title">{w.title}</div>
                  <div className="wt-cat">{w.cat}</div>
                  {w.stack && <div className="wt-cat" style={{marginTop:2}}>{w.stack}</div>}
                </td>
                <td><span className="wt-year">{w.year}</span></td>
                <td><span className="wt-span">{w.span} col</span></td>
                <td>
                  <span className={`badge ${w.image ? 'badge-green' : 'badge-blue'}`}>
                    {w.image ? 'photo' : w.thumb}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(w)} title="Edit">
                      <Ico n="edit" s={13} />
                    </button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => del(w.id)} title="Delete">
                      <Ico n="trash" s={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Uploads page ─────────────────────────────────────────────────────────────
function UploadsPage({ toast }) {
  const [uploads, setUploads] = useState(() => db.get(KEYS.uploads, []));
  const [drag, setDrag] = useState(false);

  const saveUploads = (u) => { setUploads(u); db.set(KEYS.uploads, u); };

  const addFiles = async (files) => {
    const results = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) { toast.push(`${f.name} is not an image`, 'error'); continue; }
      try {
        const data = await readFileAsBase64(f);
        results.push({ id: 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2), name: f.name, size: f.size, mimeType: f.type, data, uploadedAt: new Date().toISOString() });
      } catch(e) { toast.push(e.message, 'error'); }
    }
    if (results.length) {
      saveUploads([...results, ...uploads]);
      toast.push(`${results.length} file${results.length > 1 ? 's' : ''} uploaded`);
    }
  };

  const del = (id) => {
    if (!confirm('Delete this upload?')) return;
    saveUploads(uploads.filter(u => u.id !== id));
    toast.push('Upload deleted');
  };

  const copy = (data) => {
    navigator.clipboard?.writeText(data).then(() => toast.push('Data URL copied')).catch(() => toast.push('Copy failed', 'error'));
  };

  return (
    <div>
      <div className="sec-head">
        <h2 className="sec-title">Uploads library</h2>
        <span className="topbar-sub">{uploads.length} file{uploads.length !== 1 ? 's' : ''}</span>
      </div>

      <div
        className={`upload-zone ${drag ? 'drag-over' : ''}`}
        style={{ marginBottom:28 }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
      >
        <input type="file" accept="image/*" multiple onChange={e => addFiles(e.target.files)} />
        <div className="upload-icon">📁</div>
        <div className="upload-title">Drop images here or click to browse</div>
        <div className="upload-hint">PNG, JPG, WebP, SVG, GIF · Max 3 MB each · Multiple files supported</div>
      </div>

      <div className="uploads-grid">
        {uploads.length === 0
          ? <div className="upload-empty">No uploads yet. Drag images above to get started.</div>
          : uploads.map(u => (
            <div key={u.id} className="upload-card">
              <img src={u.data} alt={u.name} className="upload-card-img" />
              <div className="upload-card-body">
                <div className="upload-card-name" title={u.name}>{u.name}</div>
                <div className="upload-card-meta">{formatBytes(u.size)} · {u.mimeType.split('/')[1]?.toUpperCase()}</div>
                <div className="upload-card-meta">{new Date(u.uploadedAt).toLocaleDateString()}</div>
              </div>
              <div className="upload-card-actions">
                <button className="upload-card-btn" onClick={() => copy(u.data)} title="Copy data URL">
                  <Ico n="copy" s={12} />
                </button>
                <button className="upload-card-btn" onClick={() => del(u.id)} title="Delete">
                  <Ico n="trash" s={12} />
                </button>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ setPage }) {
  const graphic = db.get(KEYS.graphic, DEFAULT_GRAPHIC);
  const webdev  = db.get(KEYS.webdev,  DEFAULT_WEBDEV);
  const uploads = db.get(KEYS.uploads, []);
  const withImg = [...graphic, ...webdev].filter(w => w.image).length;
  const totalStorage = (() => { try { let b = 0; for (const k in localStorage) b += (localStorage.getItem(k) || '').length * 2; return b; } catch(e) { return 0; } })();

  return (
    <div>
      <div className="dash-grid">
        <div className="dash-card" style={{cursor:'pointer'}} onClick={() => setPage('graphic')}>
          <div className="dash-card-label">Graphic works</div>
          <div className="dash-card-num red">{graphic.length}</div>
        </div>
        <div className="dash-card" style={{cursor:'pointer'}} onClick={() => setPage('webdev')}>
          <div className="dash-card-label">Web dev works</div>
          <div className="dash-card-num amber">{webdev.length}</div>
        </div>
        <div className="dash-card" style={{cursor:'pointer'}} onClick={() => setPage('uploads')}>
          <div className="dash-card-label">Uploads</div>
          <div className="dash-card-num green">{uploads.length}</div>
        </div>
        <div className="dash-card">
          <div className="dash-card-label">Real images</div>
          <div className="dash-card-num">{withImg}</div>
        </div>
      </div>

      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'22px 24px', marginBottom:20 }}>
        <div style={{ fontFamily:'var(--font-ui)', fontWeight:700, fontSize:14, marginBottom:14 }}>Storage usage</div>
        <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--text-mid)' }}>
          localStorage: ~{formatBytes(totalStorage)} used
          <span style={{ color:'var(--text-dim)', marginLeft:10 }}>/ ~5 MB browser limit</span>
        </div>
        <div style={{ marginTop:10, height:6, background:'var(--surface2)', borderRadius:999, overflow:'hidden' }}>
          <div style={{ height:'100%', borderRadius:999, background: totalStorage / (5*1024*1024) > .8 ? 'var(--red)' : 'var(--green)', width: Math.min(100, (totalStorage / (5*1024*1024) * 100)) + '%', transition:'width .3s' }} />
        </div>
      </div>

      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'22px 24px' }}>
        <div style={{ fontFamily:'var(--font-ui)', fontWeight:700, fontSize:14, marginBottom:14 }}>Quick start</div>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { label:'Add a graphic design work', page:'graphic', icon:'grid' },
            { label:'Add a web dev work',         page:'webdev',  icon:'code' },
            { label:'Upload project images',      page:'uploads', icon:'upload' },
          ].map(item => (
            <button key={item.page} className="btn btn-ghost" style={{ justifyContent:'flex-start' }} onClick={() => setPage(item.page)}>
              <Ico n={item.icon} s={14} /> {item.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop:20, padding:'18px 22px', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
        <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-dim)', lineHeight:1.7 }}>
          <strong style={{ color:'var(--text-mid)' }}>How it works:</strong><br/>
          Changes here are saved to <code>localStorage</code> and automatically reflected on your portfolio page.{' '}
          Open <a href="Portfolio.html" target="_blank" style={{ color:'var(--red)', textDecoration:'none' }}>Portfolio.html</a> in the same browser to see live updates.
        </div>
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ onAuth }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (pw === ADMIN_PW) { sessionStorage.setItem('vox_admin', '1'); onAuth(); }
    else { setErr('Incorrect password'); }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <div className="mark">V</div>
          <div>
            <span>VOX Studio</span>
            <small>Admin Panel</small>
          </div>
        </div>
        <div className="login-title">Sign in</div>
        <div className="login-sub">Enter the admin password to continue</div>
        <label className="field-label">Password</label>
        <input className="field-input" type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(''); }} placeholder="••••••••" autoFocus />
        {err && <div className="login-err">{err}</div>}
        <button type="submit" className="login-btn">Continue →</button>
        <div style={{ marginTop:16, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-dim)', textAlign:'center' }}>
          Default: <code>voxstudio</code>
        </div>
      </form>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function AdminApp() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('vox_admin') === '1');
  const [page, setPage] = useState('dashboard');
  const toast = useToast();

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  const logout = () => { sessionStorage.removeItem('vox_admin'); setAuthed(false); };

  const navItems = [
    { id:'dashboard', label:'Dashboard',      icon:'home' },
    { id:'graphic',   label:'Graphic Works',  icon:'grid',   count: db.get(KEYS.graphic, DEFAULT_GRAPHIC).length },
    { id:'webdev',    label:'Web Dev Works',  icon:'code',   count: db.get(KEYS.webdev, DEFAULT_WEBDEV).length },
    { id:'uploads',   label:'Uploads',        icon:'upload', count: db.get(KEYS.uploads, []).length },
  ];

  const pageTitles = { dashboard:'Dashboard', graphic:'Graphic Works', webdev:'Web Dev Works', uploads:'Uploads' };

  const pageContent = () => {
    switch(page) {
      case 'dashboard': return <Dashboard setPage={setPage} />;
      case 'graphic':   return <WorksPage side="graphic" toast={toast} />;
      case 'webdev':    return <WorksPage side="webdev"  toast={toast} />;
      case 'uploads':   return <UploadsPage toast={toast} />;
      default: return null;
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="mark">V</div>
          <div>
            <div className="name">VOX Studio</div>
            <div className="sub">Admin Panel</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section-label">Menu</div>
          {navItems.map(item => (
            <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
              <Ico n={item.icon} s={15} />
              <span>{item.label}</span>
              {item.count !== undefined && <span className="nav-count">{item.count}</span>}
            </button>
          ))}
          <div className="nav-section-label" style={{marginTop:8}}>Links</div>
          <a href="Portfolio.html" target="_blank" style={{textDecoration:'none'}}>
            <button className="nav-item">
              <Ico n="eye" s={15} />
              <span>View portfolio</span>
            </button>
          </a>
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={logout}>
            <Ico n="logout" s={15} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="topbar-title">{pageTitles[page]}</div>
          <a href="Portfolio.html" target="_blank" style={{textDecoration:'none'}}>
            <button className="btn btn-ghost btn-sm"><Ico n="eye" s={13} /> Preview portfolio</button>
          </a>
        </div>
        <div className="page-body">
          {pageContent()}
        </div>
      </main>

      <toast.Toasts />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('admin-root'));
root.render(<AdminApp />);
