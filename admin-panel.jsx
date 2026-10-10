// Static admin panel for editing portfolio content in-browser.
const ADMIN_TAB_KEY = "raisa-portfolio-admin-tab-v2";

const ADMIN_THUMBS = {
  graphic: ["Packaging", "Poster", "Brand", "Social"],
  webdev: ["Dashboard", "WebApp", "Code"],
};

// ─── Image upload helpers ─────────────────────────────────────────────────────
function adminFormatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

const ADMIN_MEDIA_MAX_BYTES = 3 * 1024 * 1024;
const ADMIN_MEDIA_MAX_EDGE = 6000;
const ADMIN_MEDIA_MAX_PIXELS = 12 * 1000 * 1000;
const ADMIN_MEDIA_MAX_FRAMES = 120;
const ADMIN_MEDIA_MAX_TOTAL_PIXELS = 24 * 1000 * 1000;
const ADMIN_MEDIA_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const ADMIN_MEDIA_LIMITS_LABEL = "PNG, JPG, WebP, GIF · up to 3 MiB each · 6,000 px per edge · 12 megapixels. Animations: up to 120 frames and 24 megapixels total.";
const ADMIN_MEDIA_TOKEN_PATTERN = /^media:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const ADMIN_MEDIA_PERMISSIONS = React.createContext({
  canUpload: false,
  canEditMetadata: false,
  canDelete: false,
});

function adminMediaIdFromToken(value) {
  return String(value || "").trim().match(ADMIN_MEDIA_TOKEN_PATTERN)?.[1] || "";
}

function adminMediaToken(mediaId) {
  const normalized = String(mediaId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(normalized)) throw new Error("The media service returned an invalid asset id.");
  return `media://${normalized}`;
}

function adminSafeFileName(value) {
  const normalized = String(value || "image")
    .replace(/[\u0000-\u001f\u007f/\\]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return normalized || "image";
}

function adminImageSignatureMatches(bytes, mimeType) {
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/gif") {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

// Preserve animations when preparing uploads; only static images are cropped.
function adminImageHasAnimation(bytes, mimeType) {
  if (mimeType === "image/gif") return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = mimeType === "image/png" ? 8 : 12;
  while (offset + 8 <= bytes.length) {
    const png = mimeType === "image/png";
    const typeOffset = png ? offset + 4 : offset;
    const chunkType = String.fromCharCode(...bytes.slice(typeOffset, typeOffset + 4));
    if ((png && chunkType === "acTL") || (!png && chunkType === "ANIM")) return true;
    const length = view.getUint32(png ? offset : offset + 4, !png);
    offset += png ? 12 + length : 8 + length + (length % 2);
  }
  return false;
}

function adminFilterMedia(records, query = "", status = "all", type = "all") {
  const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return records.filter((record) => {
    const isPublished = record.status === "published" || record.status === "legacy";
    if (status === "published" && !isPublished) return false;
    if (status === "draft" && isPublished) return false;
    if (type !== "all" && record.mime_type !== type) return false;
    const searchable = [record.name, record.alt_text, record.mime_type, record.reference_token]
      .join(" ").toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

async function adminDecodeImageDimensions(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return dimensions;
    } catch (_) {
      // Fall through for browsers whose bitmap decoder does not support GIF.
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      };
      cleanup();
      resolve(dimensions);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("The selected file could not be decoded as an image."));
    };
    image.src = url;
  });
}

async function adminInspectImageFile(file) {
  if (!(file instanceof Blob) || !file.size) throw new Error("Choose a non-empty image file.");
  if (!ADMIN_MEDIA_TYPES[file.type]) throw new Error("Use PNG, JPG, WebP, or GIF images only.");
  if (file.size > ADMIN_MEDIA_MAX_BYTES) throw new Error("The image exceeds the 3 MiB upload limit.");

  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (!adminImageSignatureMatches(bytes, file.type)) {
    throw new Error("The file contents do not match the selected image type.");
  }

  const { width, height } = await adminDecodeImageDimensions(file);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The image has invalid dimensions.");
  }
  if (width > ADMIN_MEDIA_MAX_EDGE || height > ADMIN_MEDIA_MAX_EDGE || width * height > ADMIN_MEDIA_MAX_PIXELS) {
    throw new Error("The image dimensions are too large. Use at most 6,000 px per edge and 12 megapixels.");
  }

  const animated = file.type === "image/gif" || ((file.type === "image/png" || file.type === "image/webp")
    && adminImageHasAnimation(new Uint8Array(await file.arrayBuffer()), file.type));
  return { width, height, mimeType: file.type, size: file.size, animated };
}

async function adminCropImageFile(file, targetAspect, focusX, focusY) {
  if (!targetAspect || targetAspect === "original" || file.type === "image/gif") return file;
  if ((file.type === "image/png" || file.type === "image/webp")
    && adminImageHasAnimation(new Uint8Array(await file.arrayBuffer()), file.type)) return file;
  const aspect = Number(targetAspect);
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error("Choose a valid crop aspect ratio.");

  const bitmap = typeof createImageBitmap === "function"
    ? await createImageBitmap(file)
    : await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("The browser could not decode this image."));
        };
        image.src = url;
      });
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceWidth / sourceHeight > aspect) {
    cropWidth = sourceHeight * aspect;
  } else {
    cropHeight = sourceWidth / aspect;
  }

  const sourceX = Math.max(0, (sourceWidth - cropWidth) * Math.min(1, Math.max(0, focusX)));
  const sourceY = Math.max(0, (sourceHeight - cropHeight) * Math.min(1, Math.max(0, focusY)));
  const maxDimension = 2400;
  const scale = Math.min(1, maxDimension / Math.max(cropWidth, cropHeight));
  const outputWidth = Math.max(1, Math.round(cropWidth * scale));
  const outputHeight = Math.max(1, Math.round(cropHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d", { alpha: file.type === "image/png" });
  if (!context) {
    bitmap.close?.();
    throw new Error("The browser could not prepare the crop. Try uploading the original image.");
  }
  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );
  bitmap.close?.();

  const outputType = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (nextBlob) => nextBlob ? resolve(nextBlob) : reject(new Error("The browser could not crop this image.")),
      outputType,
      outputType === "image/png" ? undefined : 0.9
    );
  });
  const extension = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${baseName}-cropped.${extension}`, { type: outputType });
}

function AdminCropDialog({ file, inspection, initialAltText = "", onCancel, onUpload }) {
  const animated = file.type === "image/gif" || inspection?.animated;
  const [aspect, setAspect] = React.useState("original");
  const [focusX, setFocusX] = React.useState(0.5);
  const [focusY, setFocusY] = React.useState(0.5);
  const [altText, setAltText] = React.useState(initialAltText);
  const [processing, setProcessing] = React.useState(false);
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [error, setError] = React.useState("");
  const [progress, setProgress] = React.useState({ value: 0, label: "" });
  const dialogRef = React.useRef(null);
  const altRef = React.useRef(null);
  const titleId = React.useId();
  const actionRef = React.useRef({ processing, onCancel });
  actionRef.current = { processing, onCancel };

  React.useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  React.useEffect(() => {
    const previousFocus = document.activeElement;
    altRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !actionRef.current.processing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        actionRef.current.onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      ) || []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus?.();
    };
  }, []);

  const upload = async () => {
    if (actionRef.current.processing) return;
    const normalizedAltText = altText.trim();
    if (!normalizedAltText) {
      setError("Alternative text is required before this image can be uploaded.");
      altRef.current?.focus();
      return;
    }
    setProcessing(true);
    setError("");
    setProgress({ value: 10, label: "Preparing image" });
    try {
      const output = await adminCropImageFile(file, aspect, focusX, focusY);
      await onUpload(output, { altText: normalizedAltText }, (value, label) => {
        setProgress({ value, label });
      });
      setProgress({ value: 100, label: "Upload complete" });
    } catch (uploadError) {
      setError(uploadError.message || "The image could not be uploaded.");
      setProgress({ value: 0, label: "" });
    } finally {
      setProcessing(false);
    }
  };

  const aspectCss = aspect === "original" ? "auto" : String(aspect).includes(".")
    ? String(aspect)
    : aspect === "1" ? "1 / 1" : aspect === String(4 / 3) ? "4 / 3" : "16 / 9";

  return ReactDOM.createPortal(
    <div className="admin-crop-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className="admin-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={processing}
      >
        <div className="admin-section-head">
          <div>
            <h3 id={titleId}>Prepare image</h3>
            <span>
              {file.name} · {adminFormatBytes(file.size)}
              {inspection ? ` · ${inspection.width} × ${inspection.height}px` : ""}
            </span>
          </div>
          <button type="button" className="admin-secondary" onClick={onCancel} disabled={processing}>Close</button>
        </div>
        <div
          className={"admin-crop-preview" + (aspect === "original" ? " original" : "")}
          style={{ aspectRatio: aspectCss }}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Crop preview"
              style={{ objectPosition: `${focusX * 100}% ${focusY * 100}%` }}
            />
          )}
        </div>
        <div className="admin-crop-options">
          <span>Aspect ratio</span>
          {[
            ["original", "Original"],
            ["1", "Square"],
            [String(4 / 3), "4:3"],
            [String(16 / 9), "16:9"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={aspect === value ? "active" : ""}
              disabled={processing || (animated && value !== "original")}
              aria-pressed={aspect === value}
              onClick={() => setAspect(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {animated && <p className="admin-note">Animated images keep their original frames. Cropping is available for static PNG, JPG, and WebP images.</p>}
        {aspect !== "original" && (
          <div className="admin-grid two">
            <label className="admin-field">
              <span>Horizontal focus</span>
              <input type="range" min="0" max="1" step="0.01" disabled={processing} value={focusX} onChange={(event) => setFocusX(Number(event.target.value))} />
            </label>
            <label className="admin-field">
              <span>Vertical focus</span>
              <input type="range" min="0" max="1" step="0.01" disabled={processing} value={focusY} onChange={(event) => setFocusY(Number(event.target.value))} />
            </label>
          </div>
        )}
        <label className="admin-field">
          <span>Alternative text <strong aria-hidden="true">*</strong></span>
          <textarea
            ref={altRef}
            value={altText}
            maxLength={500}
            required
            disabled={processing}
            placeholder="Describe the important visual content for people who cannot see the image."
            onChange={(event) => {
              setAltText(event.target.value);
              if (error) setError("");
            }}
          />
          <span className="admin-char-count">{altText.length}/500 chars</span>
        </label>
        {error && <div className="admin-inline-error" role="alert">{error}</div>}
        {processing && (
          <div className="admin-upload-progress" role="status" aria-live="polite">
            <progress max="100" value={progress.value}>{progress.value}%</progress>
            <span>{progress.label || "Uploading image"} · {progress.value}%</span>
          </div>
        )}
        <div className="admin-toolbar-actions">
          <button type="button" className="admin-secondary" onClick={onCancel} disabled={processing}>Cancel</button>
          <button type="button" className="admin-primary" onClick={upload} disabled={processing}>
            {processing ? "Processing…" : aspect === "original" ? "Upload original" : "Crop and upload"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Secure media lifecycle client ───────────────────────────────────────────
const ADMIN_MEDIA_DRAFT_BUCKET = "portfolio-media-drafts";
const ADMIN_MEDIA_PUBLIC_BUCKET = "portfolio-media-public";
const adminMediaRecordCache = new Map();
let adminMediaCatalogPromise = null;

function adminRequireMediaBackend() {
  const sb = window.PortfolioSupabase;
  if (!sb) throw new Error("The secure media backend is unavailable.");
  return sb;
}

function adminAssertMediaPath(bucket, path, { requireUuid = true, allowLegacy = false } = {}) {
  const normalizedBucket = String(bucket || "");
  const normalizedPath = String(path || "");
  const allowedBuckets = [
    ADMIN_MEDIA_DRAFT_BUCKET,
    ADMIN_MEDIA_PUBLIC_BUCKET,
    ...(allowLegacy ? ["portfolio-uploads"] : []),
  ];
  if (
    !allowedBuckets.includes(normalizedBucket) ||
    !normalizedPath ||
    normalizedPath.startsWith("/") ||
    normalizedPath.includes("..") ||
    normalizedPath.includes("\\") ||
    (requireUuid && !/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(normalizedPath))
  ) {
    throw new Error("The media service returned an unsafe storage path.");
  }
  return { bucket: normalizedBucket, path: normalizedPath };
}

function adminNormalizeMediaRecord(value) {
  if (!value || typeof value !== "object") throw new Error("The media service returned an invalid asset.");
  const id = String(value.asset_id || value.id || "").trim();
  const referenceToken = String(value.reference_token || value.referenceToken || `media://${id}`);
  if (adminMediaIdFromToken(referenceToken) !== id) {
    throw new Error("The media service returned an invalid reference token.");
  }

  const record = {
    ...value,
    id,
    asset_id: id,
    reference_token: referenceToken,
    name: adminSafeFileName(value.name),
    mime_type: String(value.mime_type || ""),
    size: Number(value.size || 0),
    width: Number(value.width || 0),
    height: Number(value.height || 0),
    alt_text: String(value.alt_text || ""),
    status: String(value.status || "staged"),
    draft_reference_count: Number(value.draft_reference_count || 0),
    published_reference_count: Number(value.published_reference_count || 0),
    is_referenced: value.is_referenced === true,
    can_delete: value.can_delete === true,
    preview_url: String(value.preview_url || ""),
    preview_expires_at: Number(value.preview_expires_at || 0),
  };
  adminMediaRecordCache.set(referenceToken, record);
  return record;
}

function adminAssertVerifiedMediaResponse(value, reservation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The trusted media verifier returned an invalid response.");
  }
  const assetId = String(value.asset_id || "").trim();
  const width = Number(value.width || 0);
  const height = Number(value.height || 0);
  const byteSize = Number(value.byte_size || 0);
  const frameCount = Number(value.frame_count || 0);
  const totalPixels = Number(value.total_pixels || 0);
  const checksum = String(value.checksum_sha256 || "").trim().toLowerCase();
  const verificationVersion = Number(value.verification_version || 0);
  if (
    assetId !== reservation.asset_id ||
    value.status !== "staged" ||
    !ADMIN_MEDIA_TYPES[String(value.mime_type || "")] ||
    !Number.isInteger(width) || width < 1 || width > ADMIN_MEDIA_MAX_EDGE ||
    !Number.isInteger(height) || height < 1 || height > ADMIN_MEDIA_MAX_EDGE ||
    width * height > ADMIN_MEDIA_MAX_PIXELS ||
    !Number.isInteger(byteSize) || byteSize < 1 || byteSize > ADMIN_MEDIA_MAX_BYTES ||
    !Number.isInteger(frameCount) || frameCount < 1 || frameCount > ADMIN_MEDIA_MAX_FRAMES ||
    !Number.isInteger(totalPixels) || totalPixels < width * height || totalPixels > ADMIN_MEDIA_MAX_TOTAL_PIXELS ||
    !/^[0-9a-f]{64}$/.test(checksum) ||
    !value.verified_at ||
    verificationVersion !== 1
  ) {
    throw new Error("The trusted media verifier did not confirm a safe staged image.");
  }
  return {
    ...value,
    asset_id: assetId,
    id: assetId,
    width,
    height,
    size: byteSize,
    byte_size: byteSize,
    frame_count: frameCount,
    total_pixels: totalPixels,
    checksum_sha256: checksum,
    verification_version: verificationVersion,
  };
}

async function adminAttachMediaPreview(record) {
  const normalized = adminNormalizeMediaRecord(record);
  if (/^https:\/\//i.test(normalized.public_url || "")) {
    normalized.preview_url = normalized.public_url;
    normalized.preview_expires_at = Number.MAX_SAFE_INTEGER;
    adminMediaRecordCache.set(normalized.reference_token, normalized);
    return normalized;
  }
  if (normalized.preview_url && normalized.preview_expires_at > Date.now() + 30000) return normalized;

  const bucket = normalized.storage_bucket || normalized.draft_bucket || ADMIN_MEDIA_DRAFT_BUCKET;
  const path = normalized.storage_path || normalized.draft_path;
  const safe = adminAssertMediaPath(bucket, path);
  if (safe.bucket !== ADMIN_MEDIA_DRAFT_BUCKET) {
    throw new Error("Only private draft assets may use signed admin previews.");
  }
  const sb = adminRequireMediaBackend();
  const { data, error } = await sb.storage.from("portfolio-media-drafts").createSignedUrl(safe.path, 600);
  if (error) throw error;
  const signedUrl = String(data?.signedUrl || data?.signedURL || "");
  if (!signedUrl) throw new Error("A private preview URL could not be created.");
  normalized.preview_url = signedUrl;
  normalized.preview_expires_at = Date.now() + 9 * 60 * 1000;
  adminMediaRecordCache.set(normalized.reference_token, normalized);
  return normalized;
}

async function adminFetchMediaPage(offset = 0, limit = 50) {
  const sb = adminRequireMediaBackend();
  const { data, error } = await sb.rpc("list_portfolio_media", {
    p_offset: Math.max(0, Number(offset) || 0),
    p_limit: Math.min(100, Math.max(1, Number(limit) || 50)),
  });
  if (error) throw error;
  const items = await Promise.all((data?.items || []).map(async (record) => {
    try {
      return await adminAttachMediaPreview(record);
    } catch (error) {
      // A failed or interrupted upload must not make the entire library unusable.
      return { ...adminNormalizeMediaRecord(record), preview_url: "", preview_error: error.message || "Preview unavailable" };
    }
  }));
  return { items, count: Number(data?.count || items.length) };
}

async function adminLoadMediaCatalog(force = false) {
  if (!force && adminMediaCatalogPromise) {
    const cached = await adminMediaCatalogPromise;
    return Promise.all(cached.map(adminAttachMediaPreview));
  }
  adminMediaCatalogPromise = (async () => {
    const first = await adminFetchMediaPage(0, 50);
    const items = [...first.items];
    while (items.length < first.count && items.length < 500) {
      const page = await adminFetchMediaPage(items.length, Math.min(50, first.count - items.length));
      if (!page.items.length) break;
      items.push(...page.items);
    }
    return items;
  })();
  try {
    return await adminMediaCatalogPromise;
  } catch (error) {
    adminMediaCatalogPromise = null;
    throw error;
  }
}

function adminResetMediaCatalog() {
  adminMediaCatalogPromise = null;
  window.dispatchEvent(new CustomEvent("portfolio-media-changed"));
}

async function adminResolveMediaValue(value) {
  const token = String(value || "").trim();
  if (!adminMediaIdFromToken(token)) return token;
  const cached = adminMediaRecordCache.get(token);
  if (cached) return (await adminAttachMediaPreview(cached)).preview_url;
  const records = await adminLoadMediaCatalog();
  const record = records.find((item) => item.reference_token === token);
  if (!record) throw new Error("This media asset is unavailable or you no longer have access.");
  return record.preview_url;
}

async function adminHydrateMediaPreviewContent(content) {
  const records = await adminLoadMediaCatalog();
  const previewByToken = new Map(records.map((record) => [record.reference_token, record.preview_url]));
  const unresolved = new Set();

  const replace = (value) => {
    if (typeof value === "string") {
      const token = value.trim();
      if (!adminMediaIdFromToken(token)) return value;
      const previewUrl = previewByToken.get(token);
      if (!previewUrl) {
        unresolved.add(token);
        return "";
      }
      return previewUrl;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") {
      return Object.entries(value).reduce((result, [key, item]) => {
        result[key] = replace(item);
        return result;
      }, {});
    }
    return value;
  };

  const hydrated = replace(content);
  if (unresolved.size) {
    throw new Error(`${unresolved.size} referenced media asset${unresolved.size === 1 ? " is" : "s are"} unavailable for preview.`);
  }
  return hydrated;
}

function adminCollectMediaReferences(value, references = new Set()) {
  if (typeof value === "string") {
    const mediaId = adminMediaIdFromToken(value);
    if (mediaId) references.add(adminMediaToken(mediaId));
    return references;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => adminCollectMediaReferences(item, references));
    return references;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => adminCollectMediaReferences(item, references));
  }
  return references;
}

async function adminGetMediaUsage(record) {
  const sb = adminRequireMediaBackend();
  const { data, error } = await sb.rpc("get_portfolio_media_usage", {
    p_asset_id: record.asset_id,
  });
  if (error) throw error;
  return {
    draft: Array.isArray(data?.draft) ? data.draft : [],
    published: Array.isArray(data?.published) ? data.published : [],
    draftCount: Number(data?.draft_count || 0),
    publishedCount: Number(data?.published_count || 0),
  };
}

async function adminRequestMediaDeletion(record, { bestEffort = false } = {}) {
  const sb = adminRequireMediaBackend();
  const assetId = String(record?.asset_id || record?.id || "");
  try {
    const { data, error } = await sb.rpc("request_portfolio_media_deletion", {
      p_asset_id: assetId,
    });
    if (error) throw error;
    for (const object of data?.objects || []) {
      const safe = adminAssertMediaPath(object.bucket, object.path, {
        requireUuid: false,
        allowLegacy: true,
      });
      const { error: removeError } = await sb.storage.from(safe.bucket).remove([safe.path]);
      if (removeError) throw removeError;
    }
    const { error: finalizeError } = await sb.rpc("finalize_portfolio_media_deletion", {
      p_asset_id: assetId,
    });
    if (finalizeError) throw finalizeError;
    adminMediaRecordCache.delete(record.reference_token || adminMediaToken(assetId));
    adminResetMediaCatalog();
  } catch (error) {
    if (!bestEffort) throw error;
  }
}

async function adminUploadFileToStorage(file, {
  altText,
  replacesToken = "",
  onProgress,
} = {}) {
  const sb = adminRequireMediaBackend();
  const normalizedAltText = String(altText || "").trim();
  if (!normalizedAltText) throw new Error("Alternative text is required.");
  if (normalizedAltText.length > 500) throw new Error("Alternative text must be 500 characters or fewer.");

  onProgress?.(15, "Validating image");
  const inspection = await adminInspectImageFile(file);
  const oldAssetId = adminMediaIdFromToken(replacesToken);
  const rpcName = oldAssetId
    ? "create_portfolio_media_replacement"
    : "create_portfolio_media_upload";
  const rpcArgs = {
    ...(oldAssetId ? { p_asset_id: oldAssetId } : {}),
    p_name: adminSafeFileName(file.name),
    p_mime_type: inspection.mimeType,
    p_size: inspection.size,
    p_alt_text: normalizedAltText,
  };

  onProgress?.(30, oldAssetId ? "Reserving secure replacement" : "Reserving private upload");
  const { data: reservationData, error: reservationError } = await sb.rpc(rpcName, rpcArgs);
  if (reservationError) throw reservationError;
  const reservation = adminNormalizeMediaRecord(reservationData);
  const safe = adminAssertMediaPath(
    reservation.storage_bucket || ADMIN_MEDIA_DRAFT_BUCKET,
    reservation.storage_path
  );
  if (safe.bucket !== ADMIN_MEDIA_DRAFT_BUCKET) {
    throw new Error("Draft media must be staged in the private media bucket.");
  }

  onProgress?.(50, "Uploading to private storage");
  const { error: uploadError } = await sb.storage
    .from("portfolio-media-drafts")
    .upload(safe.path, file, {
      contentType: inspection.mimeType,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadError) {
    await adminRequestMediaDeletion(reservation, { bestEffort: true });
    throw uploadError;
  }

  onProgress?.(80, "Verifying upload on the server");
  let verifiedData;
  try {
    if (typeof sb.functions?.invoke !== "function") {
      throw new Error("The trusted media verifier is unavailable.");
    }
    const { data, error: verifierError } = await sb.functions.invoke("verify-portfolio-media", {
      body: { assetId: reservation.asset_id },
    });
    if (verifierError) throw verifierError;
    verifiedData = adminAssertVerifiedMediaResponse(data, reservation);
  } catch (verifierError) {
    await adminRequestMediaDeletion(reservation, { bestEffort: true });
    throw verifierError;
  }

  onProgress?.(95, "Creating private preview");
  const finalized = await adminAttachMediaPreview({ ...reservation, ...verifiedData });
  adminResetMediaCatalog();
  return finalized;
}

async function adminUpdateMediaAltText(record, altText) {
  const normalized = String(altText || "").trim();
  if (!normalized) throw new Error("Alternative text is required.");
  if (normalized.length > 500) throw new Error("Alternative text must be 500 characters or fewer.");
  const sb = adminRequireMediaBackend();
  const { data, error } = await sb.rpc("update_portfolio_media_alt_text", {
    p_asset_id: record.asset_id,
    p_alt_text: normalized,
  });
  if (error) throw error;
  const updated = await adminAttachMediaPreview({ ...record, ...data });
  adminResetMediaCatalog();
  return updated;
}

// ─── AdminImageUpload control ─────────────────────────────────────────────────
function AdminImageUpload({
  label = "Thumbnail image",
  value,
  altText = "",
  onAltTextChange,
  onChange,
  disabled = false,
}) {
  const permissions = React.useContext(ADMIN_MEDIA_PERMISSIONS);
  const [drag, setDrag] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [showPicker, setShowPicker] = React.useState(false);
  const [pendingFile, setPendingFile] = React.useState(null);
  const [previewUrl, setPreviewUrl] = React.useState("");
  const [fieldError, setFieldError] = React.useState("");
  const inputRef = React.useRef();
  const fieldRef = React.useRef(null);
  const canChange = permissions.canUpload && !disabled;
  const busy = loading || validating;
  const permitsChange = () => canChange && !fieldRef.current?.closest("fieldset[disabled]");

  React.useEffect(() => {
    let active = true;
    const resolvePreview = async () => {
      if (!value) {
        setPreviewUrl("");
        setFieldError("");
        return;
      }
      try {
        const resolved = await adminResolveMediaValue(value);
        if (active) {
          setPreviewUrl(resolved);
          setFieldError("");
        }
      } catch (error) {
        if (active) {
          setPreviewUrl("");
          setFieldError(error.message || "The image preview is unavailable.");
        }
      }
    };
    resolvePreview();
    const onMediaChanged = () => resolvePreview();
    window.addEventListener("portfolio-media-changed", onMediaChanged);
    return () => {
      active = false;
      window.removeEventListener("portfolio-media-changed", onMediaChanged);
    };
  }, [value]);

  const queue = async (file) => {
    if (!file || busy || pendingFile) return;
    if (!permitsChange()) {
      setFieldError("Your role cannot upload or replace media.");
      return;
    }
    setValidating(true);
    setFieldError("");
    try {
      const inspection = await adminInspectImageFile(file);
      setPendingFile({ file, inspection });
    } catch (error) {
      setFieldError(error.message || "The selected image is invalid.");
    } finally {
      setValidating(false);
    }
  };

  const handle = async (file, metadata, onProgress) => {
    if (!permitsChange()) throw new Error("Editing is currently disabled for this image.");
    setLoading(true);
    setFieldError("");
    try {
      const record = await adminUploadFileToStorage(file, {
        altText: metadata.altText,
        replacesToken: value,
        onProgress,
      });
      onChange(record.reference_token);
      onAltTextChange?.(record.alt_text);
      return true;
    } catch (error) {
      setFieldError(error.message || "The image could not be uploaded.");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={fieldRef} className="admin-field admin-image-field" aria-busy={busy}>
      <span>{label}</span>
      <span className="admin-upload-security-note">Draft uploads stay private until a Publisher or Owner publishes them.</span>
      <span className="admin-resource-limits">{ADMIN_MEDIA_LIMITS_LABEL}</span>
      {value ? (
        <div className={`admin-image-preview-wrap${drag ? " admin-resource-drop-active" : ""}`}
          onDragOver={(event) => { event.preventDefault(); if (permitsChange() && !busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => { event.preventDefault(); setDrag(false); queue(event.dataTransfer.files?.[0]); }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={altText || "Selected media preview"} className="admin-image-preview" />
          ) : (
            <div className="admin-image-preview-placeholder" role="status">Private preview unavailable</div>
          )}
          {canChange && (
            <div className="admin-image-actions">
              <button type="button" className="admin-mini-button" disabled={loading || validating} onClick={() => inputRef.current?.click()}>Replace</button>
              <button type="button" className="admin-mini-button" disabled={loading || validating} onClick={() => setShowPicker(!showPicker)}>
                {showPicker ? "Hide library" : "Pick from library"}
              </button>
              <button type="button" className="admin-mini-button danger" disabled={loading || validating} onClick={() => {
                if (!permitsChange()) return;
                if (window.confirm("Remove this image from the draft field? The media asset will remain in the library.")) {
                  onChange("");
                }
              }}>Remove reference</button>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="admin-visually-hidden"
                aria-label={`Replace ${label}`}
                disabled={busy || !canChange}
                onChange={(event) => {
                  queue(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      ) : canChange ? (
        <div
          className={`admin-upload-zone${drag ? " drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (permitsChange() && !busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); queue(e.dataTransfer.files[0]); }}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label={`Upload ${label}`}
            disabled={loading || validating}
            onChange={(event) => {
              queue(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="admin-upload-icon">🖼</div>
          <div className="admin-upload-hint">
            {validating ? "Validating image…" : loading ? "Uploading securely…" : "Drop image or click · PNG, JPG, WebP, GIF · max 3 MiB"}
          </div>
          <button type="button" className="admin-mini-button" disabled={busy} aria-expanded={showPicker} onClick={() => setShowPicker(!showPicker)} style={{marginTop:8}}>
            {showPicker ? "Hide library" : "Pick from library"}
          </button>
        </div>
      ) : (
        <div className="admin-image-preview-placeholder">No image selected. Your role is read-only.</div>
      )}

      {showPicker && (
        <AdminImagePicker current={value} disabled={!canChange || busy} onPick={(record) => {
          if (!permitsChange()) return;
          onChange(record.reference_token);
          onAltTextChange?.(record.alt_text);
          setShowPicker(false);
        }} />
      )}
      {pendingFile && (
        <AdminCropDialog
          file={pendingFile.file}
          inspection={pendingFile.inspection}
          initialAltText={altText || adminMediaRecordCache.get(value)?.alt_text || ""}
          onCancel={() => setPendingFile(null)}
          onUpload={async (file, metadata, onProgress) => {
            const uploaded = await handle(file, metadata, onProgress);
            if (uploaded) setPendingFile(null);
          }}
        />
      )}
      {fieldError && <div className="admin-inline-error" role="alert">{fieldError}</div>}
    </div>
  );
}

// ─── Library picker (inline) ──────────────────────────────────────────────────
function AdminImagePicker({ current, onPick, disabled = false }) {
  const [uploads, setUploads] = React.useState(null);
  const [loadError, setLoadError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [status, setFilterStatus] = React.useState("all");
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    adminLoadMediaCatalog(reload > 0)
      .then((records) => {
        if (!active) return;
        setUploads(records);
        setLoadError("");
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error.message || "The media library could not be loaded.");
        setUploads([]);
      });
    return () => { active = false; };
  }, [reload]);

  if (!uploads) {
    return <div className="admin-media-state" role="status">Loading private media library…</div>;
  }
  if (loadError) {
    return <div className="admin-inline-error" role="alert">{loadError}<button type="button" className="admin-mini-button" onClick={() => { setUploads(null); setLoadError(""); setReload((value) => value + 1); }}>Retry library</button></div>;
  }
  if (!uploads.length) {
    return <div className="admin-media-state">No media assets yet. Upload an image above first.</div>;
  }
  const available = uploads.filter((record) => record.preview_url && ["staged", "promoting", "published", "legacy"].includes(record.status));
  const filtered = adminFilterMedia(available, query, status);
  return (
    <div className="admin-resource-picker">
      <div className="admin-resource-search">
        <label className="admin-field"><span>Search resources</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Image name or alternative text" /></label>
        <label className="admin-field"><span>Visibility</span><select value={status} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">All resources</option><option value="draft">Draft</option><option value="published">Published</option></select></label>
      </div>
      <p className="admin-resource-count" role="status">{filtered.length} of {available.length} resources. Select an image to reuse it here.</p>
      <div className="admin-image-picker" aria-label="Media library">
      {filtered.map((u) => (
        <button
          key={u.asset_id}
          type="button"
          className={"admin-pick-thumb" + (u.reference_token === current ? " active" : "")}
          onClick={() => onPick(u)}
          title={`${u.name}: ${u.alt_text}`}
          aria-label={`Use ${u.name}. ${u.alt_text}`}
          aria-pressed={u.reference_token === current}
          disabled={disabled}
        >
          <img src={u.preview_url} alt="" loading="lazy" decoding="async" />
          <span className="admin-resource-filename">{u.name}</span>
          <span>{u.status === "published" ? "Published" : "Draft"}</span>
        </button>
      ))}
      </div>
      {!filtered.length && <div className="admin-media-state">No resources match this search. Try another name or visibility filter.</div>}
    </div>
  );
}

// ─── Uploads gallery page (full tab) ─────────────────────────────────────────
function AdminMediaCard({ record, canManage, referencedByWorkingCopy = false, onUpdated, onDelete, setStatus }) {
  const [altText, setAltText] = React.useState(record.alt_text || "");
  const [savingAlt, setSavingAlt] = React.useState(false);
  const [usage, setUsage] = React.useState(null);
  const [usageLoading, setUsageLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => setAltText(record.alt_text || ""), [record.alt_text]);
  const changed = altText.trim() !== String(record.alt_text || "").trim();
  const referenced = referencedByWorkingCopy || record.is_referenced
    || record.draft_reference_count > 0
    || record.published_reference_count > 0;
  const canResumeDeletion = record.status === "deleting";

  const saveAlt = async () => {
    if (!canManage || savingAlt) return;
    setSavingAlt(true);
    try {
      const updated = await adminUpdateMediaAltText(record, altText);
      onUpdated(updated);
      setStatus("Alternative text updated.");
    } catch (error) {
      setStatus("Alternative text could not be saved: " + (error.message || "unknown error"), true);
    } finally {
      setSavingAlt(false);
    }
  };

  const toggleUsage = async () => {
    if (usage) {
      setUsage(null);
      return;
    }
    setUsageLoading(true);
    try {
      setUsage(await adminGetMediaUsage(record));
    } catch (error) {
      setStatus("Media usage could not be loaded: " + (error.message || "unknown error"), true);
    } finally {
      setUsageLoading(false);
    }
  };

  return (
    <article className={`admin-upload-card${expanded ? " admin-resource-expanded" : ""}`}>
      {record.preview_url ? <button type="button" className="admin-resource-preview-toggle" aria-expanded={expanded} aria-label={`${expanded ? "Reduce" : "Enlarge"} preview of ${record.name}`} onClick={() => setExpanded((value) => !value)}>
        <img src={record.preview_url} alt={record.alt_text} className="admin-upload-img" loading="lazy" decoding="async" />
        <span>{expanded ? "Reduce preview" : "Enlarge preview"}</span>
      </button> : <div className="admin-media-state">Preview unavailable. Refresh to try again.</div>}
      <div className="admin-upload-meta">
        <div className="admin-upload-card-heading">
          <div className="admin-upload-name" title={record.name}>{record.name}</div>
          <span className={`admin-media-status ${record.status}`}>{record.status}</span>
        </div>
        <div className="admin-upload-size">
          {adminFormatBytes(record.size || 0)} · {(record.mime_type || "").split("/")[1]?.toUpperCase()}
          {record.width && record.height ? ` · ${record.width} × ${record.height}px` : ""}
        </div>
        <div className="admin-media-usage">
          Draft references: {record.draft_reference_count} · Published references: {record.published_reference_count}
        </div>
        {referencedByWorkingCopy && (
          <div className="admin-inline-warning" role="status">
            Referenced by the unsaved browser working copy. Remove that reference before deleting this asset.
          </div>
        )}
        {usage && (
          <div className="admin-media-usage-paths">
            {[...usage.draft.map((item) => `Draft: ${item.json_path}`), ...usage.published.map((item) => `Published: ${item.json_path}`)]
              .map((label) => <span key={label}>{label}</span>)}
            {!usage.draftCount && !usage.publishedCount && <span>No current content references.</span>}
          </div>
        )}
        <label className="admin-field admin-media-alt-field">
          <span>Alternative text</span>
          <textarea
            value={altText}
            maxLength={500}
            required
            disabled={!canManage || savingAlt}
            onChange={(event) => setAltText(event.target.value)}
          />
          <span className="admin-char-count">{altText.length}/500 chars</span>
        </label>
      </div>
      <div className="admin-upload-card-actions">
        <button type="button" className="admin-mini-button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(record.reference_token);
            setStatus("Media reference copied.");
          } catch (_) { setStatus("Copy failed. Select this image from an image field's resource library to reuse it.", true); }
        }}>Copy reference</button>
        <button type="button" className="admin-mini-button" disabled={usageLoading} onClick={toggleUsage}>
          {usageLoading ? "Loading usage…" : usage ? "Hide usage" : "Show usage"}
        </button>
        {canManage && (
          <button
            type="button"
            className="admin-mini-button"
            disabled={!changed || !altText.trim() || savingAlt}
            onClick={saveAlt}
          >
            {savingAlt ? "Saving…" : "Save alt text"}
          </button>
        )}
        {canManage && (
          <button
            type="button"
            className="admin-mini-button danger"
            disabled={referenced || (record.can_delete === false && !canResumeDeletion)}
            title={referenced ? "Remove this asset from the browser working copy, saved draft, and published content before deleting it." : ""}
            onClick={() => onDelete(record)}
          >
            {canResumeDeletion ? "Resume deletion" : "Delete"}
          </button>
        )}
      </div>
    </article>
  );
}

function AdminUploadsPage({ setStatus, canManage, workingReferences = new Set() }) {
  const [uploads, setUploads] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [drag, setDrag] = React.useState(false);
  const [validating, setValidating] = React.useState(false);
  const [pendingFiles, setPendingFiles] = React.useState([]);
  const [deletingId, setDeletingId] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState("all");
  const [filterType, setFilterType] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [queueError, setQueueError] = React.useState("");
  const filtered = React.useMemo(() => adminFilterMedia(uploads, query, filterStatus, filterType), [uploads, query, filterStatus, filterType]);
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleUploads = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  React.useEffect(() => setPage(1), [query, filterStatus, filterType]);

  const fetchUploads = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const records = await adminLoadMediaCatalog(true);
      setUploads(records);
    } catch (error) {
      const message = error.message || "unknown error";
      setLoadError(message);
      setStatus("Media could not be loaded: " + message, true);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { fetchUploads(); }, []);

  const queueFiles = async (files) => {
    if (validating || pendingFiles.length) return;
    if (!canManage) {
      setStatus("Your role has read-only media access.", true);
      return;
    }
    setValidating(true);
    setQueueError("");
    const accepted = [];
    const rejected = [];
    for (const file of Array.from(files || [])) {
      try {
        accepted.push({ file, inspection: await adminInspectImageFile(file) });
      } catch (error) {
        rejected.push(`${file?.name || "File"}: ${error.message}`);
      }
    }
    setPendingFiles((current) => [...current, ...accepted]);
    if (rejected.length) { setQueueError(rejected.join(" ")); setStatus(rejected.join(" "), true); }
    else if (accepted.length > 1) setStatus(`${accepted.length} images validated. Add required alt text to each image.`);
    setValidating(false);
  };

  const removePendingFile = () => setPendingFiles((current) => current.slice(1));

  const del = async (record) => {
    if (!canManage) {
      setStatus("Your role cannot delete media.", true);
      return;
    }
    if (workingReferences.has(record.reference_token)) {
      setStatus("This asset is referenced by the unsaved browser working copy. Remove that reference before deleting.", true);
      return;
    }
    if (record.is_referenced || record.draft_reference_count || record.published_reference_count) {
      setStatus("This asset is referenced. Remove it from the saved draft and published content before deleting.", true);
      return;
    }
    const confirmation = record.status === "deleting"
      ? `Resume deletion of ${record.name}?`
      : `Permanently delete ${record.name}? This removes its private and published objects and cannot be undone.`;
    if (!window.confirm(confirmation)) return;
    setDeletingId(record.asset_id);
    try {
      await adminRequestMediaDeletion(record);
      setUploads((current) => current.filter((item) => item.asset_id !== record.asset_id));
      setStatus("Media asset deleted.");
    } catch (error) {
      setStatus("Delete failed: " + (error.message || "unknown error"), true);
      await fetchUploads();
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="admin-stack" aria-busy={loading || validating || Boolean(deletingId)}>
      <section className="admin-section" id="admin-section-uploads">
        <div className="admin-section-head">
          <div>
            <h3>Media Library</h3>
            <span>Private drafts and immutable published assets · {loading ? "…" : `${uploads.length} asset${uploads.length !== 1 ? "s" : ""}`}</span>
          </div>
          {!loading && <button type="button" className="admin-secondary" onClick={fetchUploads}>Refresh</button>}
        </div>

        {canManage ? (
          <div
            className={`admin-upload-zone admin-upload-zone-lg${drag ? " drag" : ""}`}
            onDragOver={(event) => { event.preventDefault(); if (!validating && !pendingFiles.length) setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDrag(false);
              queueFiles(event.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              disabled={validating || pendingFiles.length > 0}
              aria-label="Upload images to the private media library"
              onChange={(event) => {
                queueFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <div className="admin-upload-icon">▧</div>
            <div className="admin-upload-hint">
              {validating
                ? "Inspecting file signatures and dimensions…"
                : "Drop images here or click to browse · PNG, JPG, WebP, GIF · max 3 MiB each"}
            </div>
          </div>
        ) : (
          <div className="admin-media-state">Your role can inspect media but cannot upload, edit, or delete it.</div>
        )}
        <p className="admin-resource-limits">{ADMIN_MEDIA_LIMITS_LABEL} Select a resource from an image editor to reuse it on the website.</p>
        {pendingFiles.length > 0 && <p className="admin-resource-count" role="status">{pendingFiles.length} image{pendingFiles.length === 1 ? "" : "s"} remaining to prepare and upload.</p>}
        {queueError && <div className="admin-inline-error" role="alert">{queueError}</div>}
        <div className="admin-resource-search">
          <label className="admin-field"><span>Search resources</span><input type="search" value={query} placeholder="Search name or alternative text" onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="admin-field"><span>Visibility</span><select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}><option value="all">All resources</option><option value="draft">Draft</option><option value="published">Published</option></select></label>
          <label className="admin-field"><span>Image format</span><select value={filterType} onChange={(event) => setFilterType(event.target.value)}><option value="all">All formats</option>{Object.entries(ADMIN_MEDIA_TYPES).map(([type, extension]) => <option key={type} value={type}>{extension.toUpperCase()}</option>)}</select></label>
        </div>

        {loadError && (
          <div className="admin-inline-error" role="alert">
            Media library failed to load. {loadError}
            <button type="button" className="admin-mini-button" onClick={fetchUploads}>Try again</button>
          </div>
        )}
        {loading ? (
          <div className="admin-empty" role="status"><p>Loading secure media…</p></div>
        ) : !loadError && uploads.length === 0 ? (
          <div className="admin-empty"><p>No media assets yet. Upload an image above to get started.</p></div>
        ) : filtered.length === 0 ? (
          <div className="admin-media-state" role="status">No resources match your search. Try a different name or filter.</div>
        ) : (
          <div className="admin-uploads-grid">
            {visibleUploads.map((record) => (
              <AdminMediaCard
                key={record.asset_id}
                record={record}
                canManage={canManage && !deletingId}
                referencedByWorkingCopy={workingReferences.has(record.reference_token)}
                setStatus={setStatus}
                onUpdated={(updated) => setUploads((current) => current.map(
                  (item) => item.asset_id === updated.asset_id ? updated : item
                ))}
                onDelete={del}
              />
            ))}
          </div>
        )}
        {!loading && filtered.length > 0 && <div className="admin-resource-pagination">
          <span role="status">{filtered.length} matching resources · Page {Math.min(page, pageCount)} of {pageCount}</span>
          <button type="button" className="admin-mini-button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous resources</button>
          <button type="button" className="admin-mini-button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next resources</button>
        </div>}
        <p className="admin-note">
          Draft bytes stay in authenticated private storage. Publishing promotes referenced assets to immutable public paths; signed preview URLs are temporary and are never saved into content.
        </p>
      </section>

      {pendingFiles[0] && (
        <AdminCropDialog
          key={`${pendingFiles[0].file.name}-${pendingFiles[0].file.lastModified}-${pendingFiles.length}`}
          file={pendingFiles[0].file}
          inspection={pendingFiles[0].inspection}
          onCancel={removePendingFile}
          onUpload={async (file, metadata, onProgress) => {
            if (!canManage) throw new Error("Your role has read-only media access.");
            const record = await adminUploadFileToStorage(file, {
              altText: metadata.altText,
              onProgress,
            });
            setUploads((current) => [record, ...current.filter((item) => item.asset_id !== record.asset_id)]);
            setStatus(`${record.name} uploaded privately.`);
            removePendingFile();
          }}
        />
      )}
    </div>
  );
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

function adminCategoryAliasSet(services = []) {
  const aliases = new Set();
  services.forEach((service) => {
    const id = String(service?.id || "").trim();
    const slug = String(service?.slug || "").trim();
    if (id) aliases.add(id);
    if (slug) aliases.add(slug);
  });
  return aliases;
}


function adminTagsToText(tags) {
  return Array.isArray(tags) ? tags.join(", ") : String(tags || "");
}

function adminTextToTags(value) {
  return String(value || "").split(",").map(tag => tag.trim()).filter(Boolean);
}

let adminIdSequence = 0;

function adminCreateSafeId(prefix, existingIds = []) {
  const existing = new Set(existingIds.filter(Boolean));
  let candidate = "";
  do {
    adminIdSequence += 1;
    const token = window.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${adminIdSequence.toString(36)}`;
    candidate = `${prefix}-${token}`;
  } while (existing.has(candidate));
  return candidate;
}

function adminCreateUniqueSlug(value, items = []) {
  const existing = new Set(items.map((item) => String(item?.slug || "")).filter(Boolean));
  const base = adminSlugify(value) || "untitled";
  let candidate = `${base}-copy`;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-copy-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function adminDefaultCategory(services = [], index = 0) {
  const options = adminCategoryOptions(services);
  return options[index % Math.max(options.length, 1)]?.value || "selected-work";
}

function adminIsSafeHttpsUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return true;
  if (/[\u0000-\u001f\u007f\\\s]/.test(normalized) || /%0d|%0a|%5c/i.test(normalized)) {
    return false;
  }
  if (!/^https:\/\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?::[1-9][0-9]{0,4})?(?:\/[^\s\\]*)?$/.test(normalized)) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    const labels = parsed.hostname.split(".");
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && labels.length > 1
      && labels.every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
      && /^[A-Za-z]/.test(labels[labels.length - 1]);
  } catch (_) {
    return false;
  }
}

function adminIsSafeNavigationUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || adminIsSafeHttpsUrl(normalized)) return true;
  if (/[\u0000-\u001f\u007f\\\s]/.test(normalized) || /%0d|%0a|%5c/i.test(normalized)) {
    return false;
  }
  return /^#[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/.test(normalized)
    || /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/.test(normalized);
}

function adminIsSafeMediaValue(value) {
  const normalized = String(value || "").trim();
  return !normalized || Boolean(adminMediaIdFromToken(normalized)) || adminIsSafeHttpsUrl(normalized);
}

function adminValidateContent(content) {
  const errors = [];
  const contactEmail = String(content.site?.contact?.email || content.site?.contactEmail || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    errors.push("Site settings: enter a valid contact email.");
  }
  if (!String(content.site?.seo?.title || content.site?.metaTitle || "").trim()) {
    errors.push("Site settings: meta title is required.");
  }
  (content.site?.navigation || []).forEach((item, index) => {
    if (!String(item.label || "").trim()) errors.push(`Navigation link ${index + 1}: label is required.`);
    const navigationUrl = String(item.url || "").trim();
    if (
      item.target === "external" &&
      (!navigationUrl || !adminIsSafeHttpsUrl(navigationUrl))
    ) {
      errors.push(`${item.label || `Navigation link ${index + 1}`}: use a valid HTTPS URL.`);
    } else if (navigationUrl && !adminIsSafeNavigationUrl(navigationUrl)) {
      errors.push(`${item.label || `Navigation link ${index + 1}`}: use a safe relative path, fragment, or HTTPS URL.`);
    }
  });
  (content.site?.socialLinks || []).forEach((item, index) => {
    const socialUrl = String(item.url || "").trim();
    if ((item.is_visible !== false && !socialUrl) || (socialUrl && !adminIsSafeHttpsUrl(socialUrl))) {
      errors.push(`${item.label || `Social link ${index + 1}`}: use a valid HTTPS URL.`);
    }
  });
  if (!adminIsSafeHttpsUrl(content.site?.seo?.canonicalUrl)) {
    errors.push("SEO: canonical URL must use HTTPS.");
  }
  if (!adminIsSafeMediaValue(content.site?.seo?.ogImage)) {
    errors.push("SEO: sharing image must use a secure media reference or valid HTTPS URL.");
  }
  Object.entries(content.site?.seo?.pages || {}).forEach(([page, seo]) => {
    if (!adminIsSafeHttpsUrl(seo?.canonicalUrl)) errors.push(`${page} SEO: canonical URL must use HTTPS.`);
    if (!adminIsSafeMediaValue(seo?.ogImage)) errors.push(`${page} SEO: sharing image must use a secure media reference or valid HTTPS URL.`);
  });

  const workReferences = new Map();
  ["graphic", "webdev"].forEach((side) => {
    const validCategories = adminCategoryAliasSet(content.services?.[side] || []);
    const seenServiceIds = new Set();
    const seenServiceSlugs = new Set();
    (content.services?.[side] || []).forEach((service, index) => {
      if (!String(service.title || service.name || "").trim()) {
        errors.push(`${side} service ${index + 1}: title is required.`);
      }
      const serviceId = String(service.id || "").trim();
      const serviceSlug = String(service.slug || "").trim().toLowerCase();
      if (!serviceId) errors.push(`${side} service ${index + 1}: ID is required.`);
      if (!serviceSlug) errors.push(`${side} service ${index + 1}: slug is required.`);
      if (serviceId && seenServiceIds.has(serviceId)) errors.push(`${side} service ${index + 1}: ID must be unique.`);
      if (serviceSlug && seenServiceSlugs.has(serviceSlug)) errors.push(`${side} service ${index + 1}: slug must be unique.`);
      if (serviceId) seenServiceIds.add(serviceId);
      if (serviceSlug) seenServiceSlugs.add(serviceSlug);
      if (!adminIsSafeMediaValue(service.icon_url)) errors.push(`${side} service ${index + 1}: icon must use a secure media reference or valid HTTPS URL.`);
    });
    const seenProjectSlugs = new Set();
    (content.projects?.[side] || []).forEach((project, index) => {
      const label = `${side} service project ${index + 1}`;
      if (!String(project.title || "").trim()) errors.push(`${label}: title is required.`);
      const projectSlug = String(project.slug || "").trim().toLowerCase();
      if (!projectSlug) errors.push(`${project.title || label}: slug is required.`);
      if (projectSlug && seenProjectSlugs.has(projectSlug)) errors.push(`${project.title || label}: slug must be unique within ${side}.`);
      if (projectSlug) seenProjectSlugs.add(projectSlug);
      if (!String(project.category_id || "").trim()) errors.push(`${project.title || label}: service category is required.`);
      if (project.category_id && validCategories.size && !validCategories.has(project.category_id)) errors.push(`${project.title || label}: service category does not match an active service.`);
      const projectImage = String(project.image_url || project.image || "").trim();
      if (!adminIsSafeMediaValue(projectImage)) errors.push(`${project.title || label}: cover image must use a secure media reference or valid HTTPS URL.`);
      if (
        projectImage &&
        !String(project.cover_alt || "").trim()
      ) errors.push(`${project.title || label}: cover image alternative text is required.`);
      (project.gallery_images || []).forEach((image, imageIndex) => {
        if (!String(image.image_url || "").trim()) errors.push(`${project.title || label}: gallery image ${imageIndex + 1} needs an image.`);
        if (!adminIsSafeMediaValue(image.image_url)) errors.push(`${project.title || label}: gallery image ${imageIndex + 1} must use a secure media reference or valid HTTPS URL.`);
        if (String(image.image_url || "").trim() && !String(image.alt_text || "").trim()) {
          errors.push(`${project.title || label}: gallery image ${imageIndex + 1} needs alternative text.`);
        }
      });
    });

    const seenSlugs = new Set();
    const seenIds = new Set();
    (content.works?.[side] || []).forEach((work, index) => {
      const label = `${side} selected work ${index + 1}`;
      const workId = String(work.id || "").trim();
      if (!String(work.title || "").trim()) errors.push(`${label}: title is required.`);
      if (!workId) errors.push(`${work.title || label}: ID is required.`);
      if (workId && seenIds.has(workId)) errors.push(`${work.title || label}: ID must be unique within ${side}.`);
      if (workId) seenIds.add(workId);
      if (!String(work.slug || "").trim()) errors.push(`${work.title || label}: slug is required.`);
      if (!String(work.category_id || work.cat || "").trim()) errors.push(`${work.title || label}: category is required.`);
      if (work.category_id && validCategories.size && !validCategories.has(work.category_id)) errors.push(`${work.title || label}: service category does not match an active service.`);
      if (!String(work.cover_image_url || work.image || work.thumb || "").trim()) errors.push(`${work.title || label}: cover image or generated thumbnail is required.`);
      if (
        String(work.cover_image_url || work.image || "").trim() &&
        !String(work.cover_alt || "").trim()
      ) errors.push(`${work.title || label}: cover image alternative text is required.`);
      const workSlug = String(work.slug || "").trim().toLowerCase();
      if (workSlug) {
        if (seenSlugs.has(workSlug)) errors.push(`${work.title || label}: slug must be unique within ${side}.`);
        seenSlugs.add(workSlug);
      }
      const workImage = String(work.cover_image_url || work.image || "").trim();
      if (!adminIsSafeMediaValue(workImage)) errors.push(`${work.title || label}: cover image must use a secure media reference or valid HTTPS URL.`);
      [work.id, work.slug].filter(Boolean).forEach((reference) => {
        const matches = workReferences.get(reference) || [];
        matches.push({ id: work.id, side });
        workReferences.set(reference, matches);
      });
      (work.gallery_images || []).forEach((image, imageIndex) => {
        if (!String(image.image_url || "").trim()) errors.push(`${work.title || label}: gallery image ${imageIndex + 1} needs an image.`);
        if (!adminIsSafeMediaValue(image.image_url)) errors.push(`${work.title || label}: gallery image ${imageIndex + 1} must use a secure media reference or valid HTTPS URL.`);
        if (String(image.image_url || "").trim() && !String(image.alt_text || "").trim()) {
          errors.push(`${work.title || label}: gallery image ${imageIndex + 1} needs alternative text.`);
        }
      });
    });
  });
  const linkedCaseProjects = new Set();
  Object.entries(content.cases || {}).forEach(([caseId, caseData]) => {
    if (!String(caseData.title || "").trim()) errors.push(`${caseId}: case title is required.`);
    if (!String(caseData.project_id || "").trim()) errors.push(`${caseData.title || caseId}: link a canonical portfolio work.`);
    const projectId = String(caseData.project_id || "").trim();
    const matches = projectId ? (workReferences.get(projectId) || []) : [];
    if (projectId && matches.length !== 1) {
      errors.push(`${caseData.title || caseId}: canonical portfolio work must resolve exactly once.`);
    } else if (matches[0] && projectId !== matches[0].id) {
      errors.push(`${caseData.title || caseId}: link the canonical portfolio work ID, not its route slug.`);
    } else if (matches[0] && caseData.side && matches[0].side !== caseData.side) {
      errors.push(`${caseData.title || caseId}: case side must match its canonical portfolio work.`);
    }
    if (projectId && linkedCaseProjects.has(projectId)) {
      errors.push(`${caseData.title || caseId}: canonical portfolio work is already linked to another case.`);
    }
    if (projectId) linkedCaseProjects.add(projectId);
    if (!adminIsSafeHttpsUrl(caseData.seo?.canonicalUrl)) errors.push(`${caseData.title || caseId}: canonical URL must use HTTPS.`);
    if (!adminIsSafeMediaValue(caseData.seo?.ogImage)) errors.push(`${caseData.title || caseId}: sharing image must use a secure media reference or valid HTTPS URL.`);
    if (!adminIsSafeMediaValue(caseData.image || caseData.cover_image_url)) errors.push(`${caseData.title || caseId}: hero image must use a secure media reference or valid HTTPS URL.`);
    if (
      String(caseData.image || caseData.cover_image_url || "").trim() &&
      !String(caseData.cover_alt || "").trim()
    ) errors.push(`${caseData.title || caseId}: case hero alternative text is required.`);
  });
  return errors[0] || Object.values(adminCollectFieldErrors(content))[0] || "";
}

function adminCollectFieldErrors(content) {
  const errors = {};
  const add = (path, message) => {
    if (!errors[path]) errors[path] = message;
  };
  const contactEmail = String(content.site?.contact?.email || content.site?.contactEmail || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    add("site.contact.email", "Enter a valid contact email.");
  }
  if (!String(content.site?.seo?.title || content.site?.metaTitle || "").trim()) {
    add("site.seo.title", "Meta title is required.");
  }
  (content.site?.navigation || []).forEach((item, index) => {
    if (!String(item.label || "").trim()) {
      add(`site.navigation.${index}.label`, "Navigation label is required.");
    }
    const navigationUrl = String(item.url || "").trim();
    if (item.target === "external" && (!navigationUrl || !adminIsSafeHttpsUrl(navigationUrl))) {
      add(`site.navigation.${index}.url`, "Use a valid HTTPS URL for an external link.");
    } else if (navigationUrl && !adminIsSafeNavigationUrl(navigationUrl)) {
      add(`site.navigation.${index}.url`, "Use a safe relative path, fragment, or HTTPS URL.");
    }
  });
  (content.site?.socialLinks || []).forEach((item, index) => {
    if (!String(item.label || "").trim()) {
      add(`site.socialLinks.${index}.label`, "Social link label is required.");
    }
    const socialUrl = String(item.url || "").trim();
    if ((item.is_visible !== false && !socialUrl) || (socialUrl && !adminIsSafeHttpsUrl(socialUrl))) {
      add(`site.socialLinks.${index}.url`, "Use a valid HTTPS URL.");
    }
  });
  if (!adminIsSafeHttpsUrl(content.site?.seo?.canonicalUrl)) {
    add("site.seo.canonicalUrl", "Canonical URL must use HTTPS.");
  }
  if (!adminIsSafeMediaValue(content.site?.seo?.ogImage)) {
    add("site.seo.ogImage", "Use a secure media reference or HTTPS URL.");
  }
  Object.entries(content.site?.seo?.pages || {}).forEach(([page, seo]) => {
    if (!adminIsSafeHttpsUrl(seo?.canonicalUrl)) {
      add(`site.seo.pages.${page}.canonicalUrl`, "Canonical URL must use HTTPS.");
    }
    if (!adminIsSafeMediaValue(seo?.ogImage)) {
      add(`site.seo.pages.${page}.ogImage`, "Use a secure media reference or HTTPS URL.");
    }
  });
  ["graphic", "webdev"].forEach((side) => {
    const validCategories = adminCategoryAliasSet(content.services?.[side] || []);
    const serviceIds = new Map();
    const serviceSlugs = new Map();
    (content.services?.[side] || []).forEach((service, index) => {
      if (!String(service.title || service.name || "").trim()) {
        add(`services.${side}.${index}.title`, "Service title is required.");
      }
      const id = String(service.id || "").trim();
      const slug = String(service.slug || "").trim().toLowerCase();
      if (!id) add(`services.${side}.${index}.id`, "Service ID is required.");
      if (!slug) add(`services.${side}.${index}.slug`, "Service slug is required.");
      if (id) {
        const prior = serviceIds.get(id);
        if (prior != null) {
          add(`services.${side}.${prior}.id`, "Service ID must be unique.");
          add(`services.${side}.${index}.id`, "Service ID must be unique.");
        }
        serviceIds.set(id, index);
      }
      if (slug) {
        const prior = serviceSlugs.get(slug);
        if (prior != null) {
          add(`services.${side}.${prior}.slug`, "Service slug must be unique.");
          add(`services.${side}.${index}.slug`, "Service slug must be unique.");
        }
        serviceSlugs.set(slug, index);
      }
      if (!adminIsSafeMediaValue(service.icon_url)) {
        add(`services.${side}.${index}.icon_url`, "Use a secure media reference or HTTPS URL.");
      }
    });
    const projectSlugs = new Map();
    (content.projects?.[side] || []).forEach((project, index) => {
      if (!String(project.title || "").trim()) {
        add(`projects.${side}.${index}.title`, "Project title is required.");
      }
      if (!String(project.slug || "").trim()) {
        add(`projects.${side}.${index}.slug`, "Project slug is required.");
      }
      const slug = String(project.slug || "").trim().toLowerCase();
      if (slug) {
        const prior = projectSlugs.get(slug);
        if (prior != null) {
          add(`projects.${side}.${prior}.slug`, "Project slug must be unique.");
          add(`projects.${side}.${index}.slug`, "Project slug must be unique.");
        }
        projectSlugs.set(slug, index);
      }
      if (!String(project.category_id || "").trim()) {
        add(`projects.${side}.${index}.category_id`, "Choose a service category.");
      } else if (validCategories.size && !validCategories.has(project.category_id)) {
        add(`projects.${side}.${index}.category_id`, "Choose an active service category.");
      }
      const cover = String(project.image_url || project.image || "").trim();
      if (!adminIsSafeMediaValue(cover)) {
        add(`projects.${side}.${index}.image_url`, "Use a secure media reference or HTTPS URL.");
      }
      if (cover && !String(project.cover_alt || "").trim()) {
        add(`projects.${side}.${index}.cover_alt`, "Cover image alternative text is required.");
      }
      (project.gallery_images || []).forEach((image, imageIndex) => {
        const imageUrl = String(image?.image_url || "").trim();
        if (!imageUrl || !adminIsSafeMediaValue(imageUrl)) {
          add(`projects.${side}.${index}.gallery_images.${imageIndex}.image_url`, "Choose a secure gallery image.");
        }
        if (imageUrl && !String(image?.alt_text || "").trim()) {
          add(`projects.${side}.${index}.gallery_images.${imageIndex}.alt_text`, "Gallery image alternative text is required.");
        }
      });
    });
    const workIds = new Map();
    const workSlugs = new Map();
    (content.works?.[side] || []).forEach((work, index) => {
      const id = String(work.id || "").trim();
      if (!id) add(`works.${side}.${index}.id`, "Work ID is required.");
      if (id) {
        const prior = workIds.get(id);
        if (prior != null) {
          add(`works.${side}.${prior}.id`, "Work ID must be unique.");
          add(`works.${side}.${index}.id`, "Work ID must be unique.");
        }
        workIds.set(id, index);
      }
      if (!String(work.title || "").trim()) {
        add(`works.${side}.${index}.title`, "Work title is required.");
      }
      if (!String(work.slug || "").trim()) {
        add(`works.${side}.${index}.slug`, "Work slug is required.");
      }
      const slug = String(work.slug || "").trim().toLowerCase();
      if (slug) {
        const prior = workSlugs.get(slug);
        if (prior != null) {
          add(`works.${side}.${prior}.slug`, "Work slug must be unique.");
          add(`works.${side}.${index}.slug`, "Work slug must be unique.");
        }
        workSlugs.set(slug, index);
      }
      if (!String(work.category_id || work.cat || "").trim()) {
        add(`works.${side}.${index}.category_id`, "Choose a service category.");
      } else if (validCategories.size && !validCategories.has(work.category_id)) {
        add(`works.${side}.${index}.category_id`, "Choose an active service category.");
      }
      const cover = String(work.cover_image_url || work.image || "").trim();
      if (!adminIsSafeMediaValue(cover)) {
        add(`works.${side}.${index}.cover_image_url`, "Use a secure media reference or HTTPS URL.");
      }
      if (cover && !String(work.cover_alt || "").trim()) {
        add(`works.${side}.${index}.cover_alt`, "Cover image alternative text is required.");
      }
      (work.gallery_images || []).forEach((image, imageIndex) => {
        const imageUrl = String(image?.image_url || "").trim();
        if (!imageUrl || !adminIsSafeMediaValue(imageUrl)) {
          add(`works.${side}.${index}.gallery_images.${imageIndex}.image_url`, "Choose a secure gallery image.");
        }
        if (imageUrl && !String(image?.alt_text || "").trim()) {
          add(`works.${side}.${index}.gallery_images.${imageIndex}.alt_text`, "Gallery image alternative text is required.");
        }
      });
    });
  });
  const workReferences = new Map();
  ["graphic", "webdev"].forEach((side) => {
    (content.works?.[side] || []).forEach((work) => {
      [work.id, work.slug].filter(Boolean).forEach((reference) => {
        const matches = workReferences.get(reference) || [];
        matches.push({ id: work.id, side });
        workReferences.set(reference, matches);
      });
    });
  });
  const linkedCaseProjects = new Set();
  Object.entries(content.cases || {}).forEach(([caseId, caseData]) => {
    if (!String(caseData.title || "").trim()) {
      add(`cases.${caseId}.title`, "Case title is required.");
    }
    if (!String(caseData.project_id || "").trim()) {
      add(`cases.${caseId}.project_id`, "Link this case to its canonical portfolio work.");
    }
    const projectId = String(caseData.project_id || "").trim();
    const matches = projectId ? (workReferences.get(projectId) || []) : [];
    if (projectId && matches.length !== 1) {
      add(`cases.${caseId}.project_id`, "Choose a portfolio work that resolves exactly once.");
    } else if (matches[0] && projectId !== matches[0].id) {
      add(`cases.${caseId}.project_id`, "Choose the canonical portfolio work ID, not its route slug.");
    } else if (matches[0] && caseData.side && matches[0].side !== caseData.side) {
      add(`cases.${caseId}.project_id`, "Case side must match the selected portfolio work.");
    }
    if (projectId && linkedCaseProjects.has(projectId)) {
      add(`cases.${caseId}.project_id`, "This portfolio work is already linked to another case.");
    }
    if (projectId) linkedCaseProjects.add(projectId);
    if (!adminIsSafeHttpsUrl(caseData.seo?.canonicalUrl)) {
      add(`cases.${caseId}.seo.canonicalUrl`, "Canonical URL must use HTTPS.");
    }
    if (!adminIsSafeMediaValue(caseData.seo?.ogImage)) {
      add(`cases.${caseId}.seo.ogImage`, "Use a secure media reference or HTTPS URL.");
    }
    const hero = String(caseData.image || caseData.cover_image_url || "").trim();
    if (!adminIsSafeMediaValue(hero)) {
      add(`cases.${caseId}.image`, "Use a secure media reference or HTTPS URL.");
    }
    if (hero && !String(caseData.cover_alt || "").trim()) {
      add(`cases.${caseId}.cover_alt`, "Case hero alternative text is required.");
    }
  });
  return errors;
}

function moveArrayItem(items, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function AdminText({
  label,
  value,
  onChange,
  textarea = false,
  type = "text",
  placeholder = "",
  error = "",
  required = false,
  inputRef,
}) {
  const inputId = React.useId();
  const errorId = `${inputId}-error`;
  return (
    <label className={"admin-field" + (error ? " invalid" : "")} htmlFor={inputId}>
      <span>{label}</span>
      {textarea ? (
        <>
          <textarea
            ref={inputRef}
            id={inputId}
            value={value || ""}
            placeholder={placeholder}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          <span className="admin-char-count">{(value || "").length} chars</span>
        </>
      ) : (
        <input
          ref={inputRef}
          id={inputId}
          type={type}
          value={value ?? ""}
          placeholder={placeholder}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error && <span className="admin-field-error" id={errorId} role="alert">{error}</span>}
    </label>
  );
}

function AdminSelect({ label, value, options, onChange, error = "", required = false }) {
  const inputId = React.useId();
  const errorId = `${inputId}-error`;
  return (
    <label className={"admin-field" + (error ? " invalid" : "")} htmlFor={inputId}>
      <span>{label}</span>
      <select
        id={inputId}
        className="admin-select"
        value={value ?? ""}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          const disabled = typeof option === "string" ? false : option.disabled === true;
          return <option key={value} value={value} disabled={disabled}>{label}</option>;
        })}
      </select>
      {error && <span className="admin-field-error" id={errorId} role="alert">{error}</span>}
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
        <button
          type="button"
          className="admin-password-toggle"
          aria-pressed={show}
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow(s => !s)}
        >
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
            aria-label={`Palette ${i + 1}`}
            aria-pressed={Number(value) === i}
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

function AdminRowActions({
  index,
  length,
  onMove,
  onRemove,
  onDuplicate,
  upLabel = "Up",
  downLabel = "Down",
}) {
  return (
    <div className="admin-row-actions">
      <button type="button" className="admin-mini-button" disabled={index === 0} onClick={() => onMove(index, -1)}>{upLabel}</button>
      <button type="button" className="admin-mini-button" disabled={index === length - 1} onClick={() => onMove(index, 1)}>{downLabel}</button>
      {onDuplicate && <button type="button" className="admin-mini-button" onClick={() => onDuplicate(index)}>Duplicate</button>}
      <button type="button" className="admin-mini-button danger" onClick={() => onRemove(index)}>Remove</button>
    </div>
  );
}

function AdminGalleryEditor({ images = [], projectId, coverImage = "", coverAlt = "", onChange }) {
  const normalized = Array.isArray(images) ? images : [];
  const validImageCount = normalized.filter((image) => String(image.image_url || "").trim()).length;
  const totalImageCount = validImageCount + (coverImage ? 1 : 0);
  const updateImage = (index, key, value) => {
    const next = normalized.map((image, imageIndex) => ({
      ...image,
      sort_order: image.sort_order ?? imageIndex + 1,
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
        <div>
          <h4>Image viewer &amp; thumbnail order</h4>
          <p className="admin-gallery-help">The cover opens first. Additional images follow in the order shown below.</p>
        </div>
        <div className="admin-gallery-heading-actions">
          <span className="admin-gallery-count">{totalImageCount} {totalImageCount === 1 ? "image" : "images"}</span>
          <button type="button" className="admin-mini-button" onClick={addImage}>Add image</button>
        </div>
      </div>

      {coverImage && (
        <div className="admin-gallery-cover-card">
          <span className="admin-gallery-position">01</span>
          <img src={coverImage} alt={coverAlt || "Cover preview"} />
          <div>
            <strong>Cover image</strong>
            <span>Always appears first in the fullscreen viewer and thumbnail rail.</span>
          </div>
        </div>
      )}

      {normalized.length === 0 ? (
        <div className="admin-gallery-empty">
          No additional images yet. Add images to create the thumbnail rail below the main preview.
        </div>
      ) : (
        <div className="admin-gallery-list">
          {normalized.map((image, index) => {
            const viewerPosition = index + (coverImage ? 2 : 1);
            return (
            <div className="admin-gallery-card" key={image.id || index}>
              <div className="admin-gallery-card-head">
                <span className="admin-gallery-position">{String(viewerPosition).padStart(2, "0")}</span>
                <strong>Viewer image {String(viewerPosition).padStart(2, "0")}</strong>
              </div>
              <AdminImageUpload
                label="Image file"
                value={image.image_url || ""}
                altText={image.alt_text || ""}
                onAltTextChange={(value) => updateImage(index, "alt_text", value)}
                onChange={(value) => updateImage(index, "image_url", value)}
              />
              <div className="admin-grid two">
                <AdminText label="Caption" placeholder="Optional text shown below the image" value={image.caption || ""} onChange={(value) => updateImage(index, "caption", value)} />
                <AdminText label="Alt text" placeholder="Describe the image for accessibility" value={image.alt_text || ""} onChange={(value) => updateImage(index, "alt_text", value)} />
              </div>
              <AdminRowActions index={index} length={normalized.length} onMove={moveImage} onRemove={removeImage} upLabel="Earlier" downLabel="Later" />
            </div>
          )})}
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
  const removeStat = (index) => {
    if (!window.confirm(`Remove this ${title.toLowerCase()} metric from the draft?`)) return;
    onChange(stats.filter((_, itemIndex) => itemIndex !== index));
  };
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
  const removeRow = (index) => {
    if (!window.confirm(`Remove this ${title.toLowerCase()} row from the draft?`)) return;
    onChange(rows.filter((_, itemIndex) => itemIndex !== index));
  };
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
  const removeResult = (index) => {
    if (!window.confirm("Remove this result from the draft?")) return;
    onChange(results.filter((_, itemIndex) => itemIndex !== index));
  };
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
  const removeItem = (index) => {
    if (!window.confirm("Remove this tool from the draft collection?")) return;
    onChange(stack.filter((_, itemIndex) => itemIndex !== index));
  };
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

function AdminPillarEditor({ pillars = [], onChange }) {
  const normalized = Array.isArray(pillars) ? pillars : [];
  const updateItem = (index, value) => {
    const next = [...normalized];
    next[index] = value;
    onChange(next);
  };
  const addItem = () => onChange([...normalized, "New pillar"]);
  const removeItem = (index) => {
    if (!window.confirm("Remove this about pillar from the draft?")) return;
    onChange(normalized.filter((_, itemIndex) => itemIndex !== index));
  };
  const moveItem = (index, direction) => onChange(moveArrayItem(normalized, index, direction));

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <h4>About pillars</h4>
        <button type="button" className="admin-mini-button" onClick={addItem}>Add pillar</button>
      </div>
      <div className="admin-list">
        {normalized.map((pillar, index) => (
          <div className="admin-row-card stack" key={`${pillar}-${index}`}>
            <AdminText label="Pillar" value={pillar} onChange={(value) => updateItem(index, value)} />
            <AdminRowActions index={index} length={normalized.length} onMove={moveItem} onRemove={removeItem} />
          </div>
        ))}
      </div>
    </div>
  );
}

const ADMIN_SEO_PAGES = [
  ["home", "Home"],
  ["graphic", "Graphic"],
  ["webdev", "Software Dev"],
  ["about", "About"],
];

function AdminSeoFields({ title, seo = {}, onChange, errorPrefix = "", errors = {} }) {
  const errorFor = (key) => {
    const known = errors[errorPrefix ? `${errorPrefix}.${key}` : key];
    if (known) return known;
    if (key === "canonicalUrl" && !adminIsSafeHttpsUrl(seo.canonicalUrl)) {
      return "Canonical URL must use HTTPS.";
    }
    if (key === "ogImage" && !adminIsSafeMediaValue(seo.ogImage)) {
      return "Use a secure media reference or HTTPS URL.";
    }
    return "";
  };
  return (
    <div className="admin-subsection admin-seo-editor">
      <div className="admin-subsection-head">
        <div>
          <h4>{title}</h4>
          <p>Structured search and social-sharing metadata</p>
        </div>
      </div>
      <AdminText
        label="SEO title"
        value={seo.title || ""}
        error={errorFor("title")}
        onChange={(value) => onChange("title", value)}
      />
      <AdminText
        label="SEO description"
        value={seo.description || ""}
        textarea
        onChange={(value) => onChange("description", value)}
      />
      <AdminText
        label="Keywords, comma separated"
        value={adminTagsToText(seo.keywords)}
        onChange={(value) => onChange("keywords", adminTextToTags(value))}
      />
      <div className="admin-grid two">
        <AdminText
          label="Canonical URL"
          value={seo.canonicalUrl || ""}
          placeholder="https://..."
          error={errorFor("canonicalUrl")}
          onChange={(value) => onChange("canonicalUrl", value)}
        />
        <AdminSelect
          label="Search indexing"
          value={seo.noIndex ? "no" : "yes"}
          options={[{ value: "yes", label: "Allow indexing" }, { value: "no", label: "No index" }]}
          onChange={(value) => onChange("noIndex", value === "no")}
        />
      </div>
      <AdminImageUpload
        label="Social sharing image"
        value={seo.ogImage || ""}
        onChange={(value) => onChange("ogImage", value)}
      />
      {errorFor("ogImage") && <div className="admin-inline-error" role="alert">{errorFor("ogImage")}</div>}
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
  duplicateService,
  updateCategoryProject,
  addCategoryProject,
  removeCategoryProject,
  moveCategoryProject,
  duplicateCategoryProject,
  updateWork,
  addWork,
  removeWork,
  moveWork,
  duplicateWork,
  fieldErrors = {},
  firstErrorPath = "",
}) {
  const studio = draft.studios[side];
  const services = draft.services[side] || [];
  const categoryProjects = draft.projects?.[side] || [];
  const works = draft.works[side] || [];
  const label = side === "graphic" ? "Graphic Studio" : "Web Studio";
  const thumbOptions = ADMIN_THUMBS[side];
  const categoryOptions = adminCategoryOptions(services);
  const aboutPillars = Array.isArray(studio.aboutPillars) ? studio.aboutPillars : [];
  const [categorySearch, setCategorySearch] = React.useState("");
  const [categoryStatus, setCategoryStatus] = React.useState("all");
  const [categorySort, setCategorySort] = React.useState("manual");
  const [categoryPage, setCategoryPage] = React.useState(1);
  const [workSearch, setWorkSearch] = React.useState("");
  const [workStatus, setWorkStatus] = React.useState("all");
  const [workSort, setWorkSort] = React.useState("manual");
  const [workPage, setWorkPage] = React.useState(1);
  const pageSize = 6;

  const filterItems = (items, query, status, sort) => items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const haystack = [
        item.id,
        item.title,
        item.slug,
        item.category_id,
        item.cat,
        item.client_name,
        item.short_description,
      ].join(" ").toLowerCase();
      const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
      const matchesStatus = status === "all" ||
        (status === "published" && item.is_published !== false) ||
        (status === "unpublished" && item.is_published === false);
      return matchesQuery && matchesStatus;
    })
    .sort((a, b) => {
      if (sort === "title") return String(a.item.title || "").localeCompare(String(b.item.title || ""));
      if (sort === "newest") {
        return String(b.item.updated_at || b.item.created_at || "").localeCompare(String(a.item.updated_at || a.item.created_at || ""));
      }
      return Number(a.item.sort_order ?? a.index + 1) - Number(b.item.sort_order ?? b.index + 1);
    });

  const filteredCategoryProjects = filterItems(categoryProjects, categorySearch, categoryStatus, categorySort);
  const filteredWorks = filterItems(works, workSearch, workStatus, workSort);
  const categoryPages = Math.max(1, Math.ceil(filteredCategoryProjects.length / pageSize));
  const workPages = Math.max(1, Math.ceil(filteredWorks.length / pageSize));
  const visibleCategoryProjects = filteredCategoryProjects.slice((Math.min(categoryPage, categoryPages) - 1) * pageSize, Math.min(categoryPage, categoryPages) * pageSize);
  const visibleWorks = filteredWorks.slice((Math.min(workPage, workPages) - 1) * pageSize, Math.min(workPage, workPages) * pageSize);

  React.useEffect(() => { setCategoryPage(1); }, [categorySearch, categoryStatus, categorySort]);
  React.useEffect(() => { setWorkPage(1); }, [workSearch, workStatus, workSort]);
  React.useEffect(() => {
    const categoryMatch = firstErrorPath.match(new RegExp(`^projects\\.${side}\\.(\\d+)\\.`));
    if (categoryMatch) {
      setCategorySearch("");
      setCategoryStatus("all");
      setCategorySort("manual");
      setCategoryPage(Math.floor(Number(categoryMatch[1]) / pageSize) + 1);
    }
    const workMatch = firstErrorPath.match(new RegExp(`^works\\.${side}\\.(\\d+)\\.`));
    if (workMatch) {
      setWorkSearch("");
      setWorkStatus("all");
      setWorkSort("manual");
      setWorkPage(Math.floor(Number(workMatch[1]) / pageSize) + 1);
    }
  }, [firstErrorPath, side]);

  return (
    <div className="admin-stack">
      <section className="admin-section" id={`admin-section-${side}-hero`}>
        <div className="admin-section-head">
          <div>
            <h3>{label}</h3>
            <span>Hero, page copy, stats, and about text</span>
          </div>
        </div>
        <div className="admin-grid two">
          <AdminText label="Hero eyebrow" value={studio.heroEyebrow} onChange={(value) => updateStudio(side, "heroEyebrow", value)} />
          <AdminText label="Hero CTA" value={studio.heroCta} onChange={(value) => updateStudio(side, "heroCta", value)} />
          <AdminText label="Hero hover label" value={studio.heroHoverLabel || ""} placeholder={side === "graphic" ? "Explore Graphic Design" : "Explore Software Development"} onChange={(value) => updateStudio(side, "heroHoverLabel", value)} />
          <AdminText label="Hero top line" value={studio.heroTitleTop} onChange={(value) => updateStudio(side, "heroTitleTop", value)} />
          <AdminText label="Hero italic line" value={studio.heroTitleEm} onChange={(value) => updateStudio(side, "heroTitleEm", value)} />
          <AdminText label="Hero suffix" value={studio.heroTitleSuffix} onChange={(value) => updateStudio(side, "heroTitleSuffix", value)} />
          <AdminText label="Page eyebrow" value={studio.pageEyebrow} onChange={(value) => updateStudio(side, "pageEyebrow", value)} />
          <AdminText label="Back button" value={studio.backLabel || ""} onChange={(value) => updateStudio(side, "backLabel", value)} />
          <AdminText label="Breadcrumb" value={studio.crumbLabel || ""} onChange={(value) => updateStudio(side, "crumbLabel", value)} />
          <AdminText label="All services CTA" value={studio.allServicesLabel || ""} onChange={(value) => updateStudio(side, "allServicesLabel", value)} />
          <AdminText label="Service breadcrumb" value={studio.categoryCrumbLabel || ""} onChange={(value) => updateStudio(side, "categoryCrumbLabel", value)} />
          {side === "webdev" && <AdminText label="Technology rail label" value={studio.stackLabel || ""} onChange={(value) => updateStudio(side, "stackLabel", value)} />}
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
          <AdminText label="Services heading" value={studio.servicesTitle || ""} onChange={(value) => updateStudio(side, "servicesTitle", value)} />
          <AdminText label="Services heading suffix" value={studio.servicesSubtitle || ""} onChange={(value) => updateStudio(side, "servicesSubtitle", value)} />
          <AdminText label="Portfolio title" value={studio.portfolioTitle} onChange={(value) => updateStudio(side, "portfolioTitle", value)} />
          <AdminText label="Portfolio meta" value={studio.portfolioMeta} onChange={(value) => updateStudio(side, "portfolioMeta", value)} />
          <AdminText label="Services meta" value={studio.servicesMeta} onChange={(value) => updateStudio(side, "servicesMeta", value)} />
          <AdminText label="Work card CTA" value={studio.workCtaLabel || ""} onChange={(value) => updateStudio(side, "workCtaLabel", value)} />
          <AdminText label="Project details CTA" value={studio.projectCtaLabel || ""} onChange={(value) => updateStudio(side, "projectCtaLabel", value)} />
          <AdminText label="Load more CTA" value={studio.loadMoreLabel || ""} onChange={(value) => updateStudio(side, "loadMoreLabel", value)} />
          <AdminText label="About eyebrow" value={studio.aboutEyebrow} onChange={(value) => updateStudio(side, "aboutEyebrow", value)} />
        </div>
        <div className="admin-grid three">
          <AdminSelect label="Services section" value={studio.showServices === false ? "hidden" : "visible"} options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }]} onChange={(value) => updateStudio(side, "showServices", value === "visible")} />
          <AdminSelect label="Portfolio section" value={studio.showPortfolio === false ? "hidden" : "visible"} options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }]} onChange={(value) => updateStudio(side, "showPortfolio", value === "visible")} />
          <AdminSelect label="About section" value={studio.showAbout === false ? "hidden" : "visible"} options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }]} onChange={(value) => updateStudio(side, "showAbout", value === "visible")} />
          {side === "webdev" && <AdminSelect label="Technology rail" value={studio.showTechStack === false ? "hidden" : "visible"} options={[{ value: "visible", label: "Visible" }, { value: "hidden", label: "Hidden" }]} onChange={(value) => updateStudio(side, "showTechStack", value === "visible")} />}
        </div>
        <AdminText label="About title" value={studio.aboutTitle} textarea onChange={(value) => updateStudio(side, "aboutTitle", value)} />
        <AdminText label="About lead" value={studio.aboutLead} textarea onChange={(value) => updateStudio(side, "aboutLead", value)} />
        <AdminText label="About body" value={studio.aboutBody} textarea onChange={(value) => updateStudio(side, "aboutBody", value)} />
        <AdminPillarEditor pillars={aboutPillars} onChange={(pillars) => updateStudio(side, "aboutPillars", pillars)} />
      </section>

      <section className="admin-section" id={`admin-section-${side}-services`}>
        <div className="admin-section-head">
          <div>
            <h3>Services</h3>
            <span>{services.length} service cards</span>
          </div>
          <button type="button" className="admin-secondary" onClick={() => addService(side)}>Add service</button>
        </div>
        <div className="admin-list">
          {services.map((service, index) => (
            <div className="admin-row-card service" key={`service-editor-${index}`}>
              <AdminText label="Service ID" value={service.id || ""} required error={fieldErrors[`services.${side}.${index}.id`]} onChange={(value) => updateService(side, index, "id", value.trim())} />
              <AdminText label="Slug" value={service.slug || ""} required error={fieldErrors[`services.${side}.${index}.slug`]} onChange={(value) => updateService(side, index, "slug", adminSlugify(value))} />
              <AdminText label="Number" value={service.num} onChange={(value) => updateService(side, index, "num", value)} />
              <AdminText label="Title" value={service.title} required error={fieldErrors[`services.${side}.${index}.title`] || (!String(service.title || "").trim() ? "Service title is required." : "")} onChange={(value) => updateService(side, index, "title", value)} />
              <AdminText label="Description" value={service.short_description || service.desc || ""} onChange={(value) => updateService(side, index, "short_description", value)} />
              <AdminText label="Custom icon URL or media reference" value={service.icon_url || ""} error={fieldErrors[`services.${side}.${index}.icon_url`]} onChange={(value) => updateService(side, index, "icon_url", value)} />
              <AdminNumber label="Icon index" value={service.icon ?? index} max={9} onChange={(value) => updateService(side, index, "icon", value)} />
              <AdminSelect label="Public status" value={service.is_active === false ? "hidden" : "visible"} options={[
                { value: "visible", label: "Published" },
                { value: "hidden", label: "Unpublished" },
              ]} onChange={(value) => updateService(side, index, "is_active", value === "visible")} />
              <AdminRowActions
                index={index}
                length={services.length}
                onMove={(itemIndex, direction) => moveService(side, itemIndex, direction)}
                onDuplicate={(itemIndex) => duplicateService(side, itemIndex)}
                onRemove={(itemIndex) => removeService(side, itemIndex)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section" id={`admin-section-${side}-projects`}>
        <div className="admin-section-head">
          <div>
            <h3>Service Category Projects</h3>
            <span>{categoryProjects.length} projects shown after clicking service cards</span>
          </div>
          <button type="button" className="admin-secondary" onClick={() => addCategoryProject(side)}>Add category project</button>
        </div>
        <div className="admin-list-controls">
          <input
            className="admin-search-input"
            type="search"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            aria-label="Search service category projects"
            placeholder="Search category projects…"
          />
          <select className="admin-select" aria-label="Filter service category projects by status" value={categoryStatus} onChange={(event) => setCategoryStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
          </select>
          <select className="admin-select" aria-label="Sort service category projects" value={categorySort} onChange={(event) => setCategorySort(event.target.value)}>
            <option value="manual">Manual order</option>
            <option value="title">Title A-Z</option>
            <option value="newest">Recently updated</option>
          </select>
          <span>{filteredCategoryProjects.length} result{filteredCategoryProjects.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="admin-list">
          {visibleCategoryProjects.map(({ item: project, index }) => (
            <div className="admin-row-card work" key={`category-project-editor-${index}`}>
              <AdminText label="Project ID" value={project.id || ""} onChange={(value) => updateCategoryProject(side, index, "id", value)} />
              <AdminText
                label="Title"
                value={project.title || ""}
                required
                error={fieldErrors[`projects.${side}.${index}.title`] || (!String(project.title || "").trim() ? "Project title is required." : "")}
                onChange={(value) => updateCategoryProject(side, index, "title", value)}
              />
              <AdminText
                label="Slug"
                value={project.slug || ""}
                required
                error={fieldErrors[`projects.${side}.${index}.slug`] || (!String(project.slug || "").trim() ? "Project slug is required." : "")}
                onChange={(value) => updateCategoryProject(side, index, "slug", adminSlugify(value))}
              />
              <AdminSelect
                label="Service category"
                value={project.category_id || adminDefaultCategory(services, index)}
                options={categoryOptions.length ? categoryOptions : [{ value: project.category_id || "selected-work", label: project.category_id || "Selected work" }]}
                required
                error={fieldErrors[`projects.${side}.${index}.category_id`]}
                onChange={(value) => updateCategoryProject(side, index, "category_id", value)}
              />
              <AdminText label="Project date / year" value={project.project_date || ""} onChange={(value) => updateCategoryProject(side, index, "project_date", value)} />
              <AdminText label="Client name" value={project.client_name || ""} onChange={(value) => updateCategoryProject(side, index, "client_name", value)} />
              {side === "webdev" && (
                <AdminText label="Stack" value={project.stack || ""} onChange={(value) => updateCategoryProject(side, index, "stack", value)} />
              )}
              <AdminText label="Short description" value={project.short_description || ""} textarea onChange={(value) => updateCategoryProject(side, index, "short_description", value)} />
              <AdminText label="Full description" value={project.full_description || ""} textarea onChange={(value) => updateCategoryProject(side, index, "full_description", value)} />
              <AdminText label="Tags, comma separated" value={adminTagsToText(project.tags)} onChange={(value) => updateCategoryProject(side, index, "tags", adminTextToTags(value))} />
              <AdminSelect label="Published" value={project.is_published === false ? "no" : "yes"} options={[
                { value: "yes", label: "Published" },
                { value: "no", label: "Unpublished" },
              ]} onChange={(value) => updateCategoryProject(side, index, "is_published", value === "yes")} />
              <AdminSelect label="Featured" value={project.is_featured ? "yes" : "no"} options={[
                { value: "no", label: "Not featured" },
                { value: "yes", label: "Featured" },
              ]} onChange={(value) => updateCategoryProject(side, index, "is_featured", value === "yes")} />
              <AdminNumber label="Sort order" value={project.sort_order ?? index + 1} min={1} max={999} onChange={(value) => updateCategoryProject(side, index, "sort_order", value)} />
              <AdminSelect label="Thumbnail" value={project.thumb || (side === "webdev" ? "WebApp" : "Brand")} options={thumbOptions} onChange={(value) => updateCategoryProject(side, index, "thumb", value)} />
              <AdminPaletteSelect label="Palette" value={project.pal ?? 0} side={side} onChange={(value) => updateCategoryProject(side, index, "pal", value)} />
              <AdminText label="Cover alt text" value={project.cover_alt || ""} placeholder={project.title || "Describe the cover image"} error={fieldErrors[`projects.${side}.${index}.cover_alt`]} onChange={(value) => updateCategoryProject(side, index, "cover_alt", value)} />
              <AdminImageUpload
                label="Cover image (opens first in gallery)"
                value={project.image_url || project.image || ""}
                altText={project.cover_alt || ""}
                onAltTextChange={(value) => updateCategoryProject(side, index, "cover_alt", value)}
                onChange={(value) => {
                  updateCategoryProject(side, index, "image_url", value);
                  updateCategoryProject(side, index, "image", value);
                }}
              />
              {fieldErrors[`projects.${side}.${index}.image_url`] && <div className="admin-inline-error" role="alert">Cover image: {fieldErrors[`projects.${side}.${index}.image_url`]}</div>}
              <AdminGalleryEditor
                images={project.gallery_images || []}
                projectId={project.id || project.slug}
                coverImage={project.image_url || project.image || ""}
                coverAlt={project.cover_alt || project.title || ""}
                onChange={(images) => updateCategoryProject(side, index, "gallery_images", images)}
              />
              {Object.entries(fieldErrors).find(([path]) => path.startsWith(`projects.${side}.${index}.gallery_images.`))?.[1] && (
                <div className="admin-inline-error" role="alert">Gallery: {Object.entries(fieldErrors).find(([path]) => path.startsWith(`projects.${side}.${index}.gallery_images.`))?.[1]}</div>
              )}
              <AdminRowActions
                index={index}
                length={categoryProjects.length}
                onMove={(itemIndex, direction) => moveCategoryProject(side, itemIndex, direction)}
                onDuplicate={(itemIndex) => duplicateCategoryProject(side, itemIndex)}
                onRemove={(itemIndex) => removeCategoryProject(side, itemIndex)}
              />
            </div>
          ))}
        </div>
        {categoryPages > 1 && (
          <div className="admin-pagination">
            <button type="button" className="admin-secondary" disabled={categoryPage <= 1} onClick={() => setCategoryPage((page) => Math.max(1, page - 1))}>Previous</button>
            <span>Page {Math.min(categoryPage, categoryPages)} of {categoryPages}</span>
            <button type="button" className="admin-secondary" disabled={categoryPage >= categoryPages} onClick={() => setCategoryPage((page) => Math.min(categoryPages, page + 1))}>Next</button>
          </div>
        )}
      </section>

      <section className="admin-section" id={`admin-section-${side}-work`}>
        <div className="admin-section-head">
          <div>
            <h3>Portfolio Work</h3>
            <span>{works.length} case cards</span>
          </div>
          <button type="button" className="admin-secondary" onClick={() => addWork(side)}>Add work</button>
        </div>
        <div className="admin-list-controls">
          <input
            className="admin-search-input"
            type="search"
            value={workSearch}
            onChange={(event) => setWorkSearch(event.target.value)}
            aria-label="Search portfolio work"
            placeholder="Search portfolio work…"
          />
          <select className="admin-select" aria-label="Filter portfolio work by status" value={workStatus} onChange={(event) => setWorkStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="published">Published</option>
            <option value="unpublished">Unpublished</option>
          </select>
          <select className="admin-select" aria-label="Sort portfolio work" value={workSort} onChange={(event) => setWorkSort(event.target.value)}>
            <option value="manual">Manual order</option>
            <option value="title">Title A-Z</option>
            <option value="newest">Recently updated</option>
          </select>
          <span>{filteredWorks.length} result{filteredWorks.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="admin-list">
          {visibleWorks.map(({ item: work, index }) => (
            <div className="admin-row-card work" key={`work-editor-${index}`}>
              <AdminText label="Work ID" value={work.id} required error={fieldErrors[`works.${side}.${index}.id`]} onChange={(value) => updateWork(side, index, "id", value.trim())} />
              <AdminText
                label="Title"
                value={work.title}
                required
                error={fieldErrors[`works.${side}.${index}.title`] || (!String(work.title || "").trim() ? "Work title is required." : "")}
                onChange={(value) => updateWork(side, index, "title", value)}
              />
              <AdminText
                label="Slug"
                value={work.slug || ""}
                required
                error={fieldErrors[`works.${side}.${index}.slug`] || (!String(work.slug || "").trim() ? "Work slug is required." : "")}
                onChange={(value) => updateWork(side, index, "slug", adminSlugify(value))}
              />
              <AdminText label="Category" value={work.cat} onChange={(value) => updateWork(side, index, "cat", value)} />
              <AdminSelect
                label="Service category"
                value={work.category_id || adminSlugify(work.cat)}
                options={categoryOptions.length ? categoryOptions : [{ value: adminSlugify(work.cat || "selected-work"), label: work.cat || "Selected work" }]}
                required
                error={fieldErrors[`works.${side}.${index}.category_id`]}
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
              <AdminText label="Cover alt text" value={work.cover_alt || ""} error={fieldErrors[`works.${side}.${index}.cover_alt`]} onChange={(value) => updateWork(side, index, "cover_alt", value)} />
              <AdminImageUpload
                label="Cover image (grid card + first gallery image)"
                value={work.cover_image_url || work.image || ""}
                altText={work.cover_alt || ""}
                onAltTextChange={(value) => updateWork(side, index, "cover_alt", value)}
                onChange={(value) => {
                  updateWork(side, index, "cover_image_url", value);
                  updateWork(side, index, "image", value);
                }}
              />
              {fieldErrors[`works.${side}.${index}.cover_image_url`] && <div className="admin-inline-error" role="alert">Cover image: {fieldErrors[`works.${side}.${index}.cover_image_url`]}</div>}
              <AdminGalleryEditor
                images={work.gallery_images || []}
                projectId={work.id}
                coverImage={work.cover_image_url || work.image || ""}
                coverAlt={work.cover_alt || work.title || ""}
                onChange={(images) => updateWork(side, index, "gallery_images", images)}
              />
              {Object.entries(fieldErrors).find(([path]) => path.startsWith(`works.${side}.${index}.gallery_images.`))?.[1] && (
                <div className="admin-inline-error" role="alert">Gallery: {Object.entries(fieldErrors).find(([path]) => path.startsWith(`works.${side}.${index}.gallery_images.`))?.[1]}</div>
              )}
              <AdminRowActions
                index={index}
                length={works.length}
                onMove={(itemIndex, direction) => moveWork(side, itemIndex, direction)}
                onDuplicate={(itemIndex) => duplicateWork(side, itemIndex)}
                onRemove={(itemIndex) => removeWork(side, itemIndex)}
              />
            </div>
          ))}
        </div>
        {workPages > 1 && (
          <div className="admin-pagination">
            <button type="button" className="admin-secondary" disabled={workPage <= 1} onClick={() => setWorkPage((page) => Math.max(1, page - 1))}>Previous</button>
            <span>Page {Math.min(workPage, workPages)} of {workPages}</span>
            <button type="button" className="admin-secondary" disabled={workPage >= workPages} onClick={() => setWorkPage((page) => Math.min(workPages, page + 1))}>Next</button>
          </div>
        )}
      </section>
    </div>
  );
}

function AdminCasesEditor({
  draft,
  updateCase,
  updateCaseSeo,
  linkCaseProject,
  updateCaseResult,
  updateCaseInfo,
  addCase,
  duplicateCase,
  removeCase,
  fieldErrors = {},
  firstErrorPath = "",
  onCaseSelect,
}) {
  const caseIds = Object.keys(draft.cases || {});
  const workOptions = ["graphic", "webdev"].flatMap((side) => (
    (draft.works?.[side] || []).map((work) => ({
      value: work.id,
      label: `${side === "graphic" ? "Graphic" : "Software Dev"} - ${work.title || "Untitled"} (${work.id})`,
      side,
    }))
  )).filter((option) => option.value);
  const [caseId, setCaseId] = React.useState(caseIds[0] || "");
  const [search, setSearch] = React.useState("");
  const [sideFilter, setSideFilter] = React.useState("all");
  const [linkFilter, setLinkFilter] = React.useState("all");
  const [sort, setSort] = React.useState("manual");
  const [page, setPage] = React.useState(1);
  const pageSize = 6;

  const filteredCases = caseIds
    .map((id, index) => ({ id, index, data: draft.cases[id] }))
    .filter(({ id, data }) => {
      const linked = Boolean(String(data.project_id || "").trim());
      const haystack = [id, data.title, data.eyebrow, data.project_id, data.side].join(" ").toLowerCase();
      const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase());
      const matchesSide = sideFilter === "all" || data.side === sideFilter;
      const matchesLink = linkFilter === "all"
        || (linkFilter === "linked" && linked)
        || (linkFilter === "unlinked" && !linked);
      return matchesSearch && matchesSide && matchesLink;
    })
    .sort((a, b) => {
      if (sort === "title") return String(a.data.title || "").localeCompare(String(b.data.title || ""));
      if (sort === "newest") {
        return String(b.data.updated_at || b.data.created_at || "").localeCompare(String(a.data.updated_at || a.data.created_at || ""));
      }
      return a.index - b.index;
    });
  const pages = Math.max(1, Math.ceil(filteredCases.length / pageSize));
  const visibleCases = filteredCases.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);

  React.useEffect(() => { setPage(1); }, [search, sideFilter, linkFilter, sort]);
  React.useEffect(() => {
    if (!caseId && caseIds.length) setCaseId(caseIds[0]);
    if (caseId && !draft.cases?.[caseId]) setCaseId(caseIds[0] || "");
  }, [caseId, caseIds.join("|"), draft.cases]);
  React.useEffect(() => {
    if (visibleCases.length && !visibleCases.some((entry) => entry.id === caseId)) {
      setCaseId(visibleCases[0].id);
    }
  }, [visibleCases.map((entry) => entry.id).join("|")]);
  React.useEffect(() => {
    const match = firstErrorPath.match(/^cases\.([^.]+)\./);
    if (match && draft.cases?.[match[1]]) {
      setSearch("");
      setSideFilter("all");
      setLinkFilter("all");
      setSort("manual");
      setPage(Math.floor(Math.max(0, caseIds.indexOf(match[1])) / pageSize) + 1);
      setCaseId(match[1]);
    }
  }, [firstErrorPath, caseIds.join("|")]);

  const data = draft.cases?.[caseId];
  const linkedByOtherCase = new Set(
    Object.entries(draft.cases || {})
      .filter(([id]) => id !== caseId)
      .map(([, caseData]) => String(caseData?.project_id || "").trim())
      .filter(Boolean)
  );
  const selectableWorkOptions = workOptions.map((option) => ({
    ...option,
    disabled: linkedByOtherCase.has(option.value),
    label: linkedByOtherCase.has(option.value) ? `${option.label} - already linked` : option.label,
  }));
  React.useEffect(() => {
    if (caseId && data) onCaseSelect?.(caseId, data);
  }, [caseId, data?.side, data?.project_id]);
  const controls = (
    <>
      <div className="admin-list-controls admin-list-controls-wide" aria-label="Case study list controls">
        <input
          className="admin-search-input"
          type="search"
          value={search}
          aria-label="Search case studies"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search cases..."
        />
        <select className="admin-select" aria-label="Filter cases by studio" value={sideFilter} onChange={(event) => setSideFilter(event.target.value)}>
          <option value="all">All studios</option>
          <option value="graphic">Graphic</option>
          <option value="webdev">Software Dev</option>
        </select>
        <select className="admin-select" aria-label="Filter cases by project link" value={linkFilter} onChange={(event) => setLinkFilter(event.target.value)}>
          <option value="all">All links</option>
          <option value="linked">Linked</option>
          <option value="unlinked">Needs project link</option>
        </select>
        <select className="admin-select" aria-label="Sort case studies" value={sort} onChange={(event) => setSort(event.target.value)}>
          <option value="manual">Manual order</option>
          <option value="title">Title A-Z</option>
          <option value="newest">Recently updated</option>
        </select>
        <span>{filteredCases.length} result{filteredCases.length !== 1 ? "s" : ""}</span>
      </div>
      {pages > 1 && (
        <div className="admin-pagination">
          <button type="button" className="admin-secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span>Page {Math.min(page, pages)} of {pages}</span>
          <button type="button" className="admin-secondary" disabled={page >= pages} onClick={() => setPage((current) => Math.min(pages, current + 1))}>Next</button>
        </div>
      )}
    </>
  );

  if (!caseIds.length) {
    return (
      <section className="admin-section" id="admin-section-cases">
        <div className="admin-empty">
          <h3>Case Studies</h3>
          <p>No case studies exist yet.</p>
          <button type="button" className="admin-primary" onClick={() => setCaseId(addCase())}>Create first case</button>
        </div>
      </section>
    );
  }

  if (!filteredCases.length) {
    return (
      <section className="admin-section" id="admin-section-cases">
        <div className="admin-section-head">
          <div><h3>Case Studies</h3><span>No cases match these controls</span></div>
          <button type="button" className="admin-secondary" onClick={() => setCaseId(addCase())}>Add case</button>
        </div>
        {controls}
        <div className="admin-empty"><p>Change the search or filters to continue editing.</p></div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <div className="admin-stack" id="admin-section-cases">
      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Case Studies</h3>
            <span>Every case links to one canonical Portfolio Work record</span>
          </div>
          <div className="admin-heading-actions">
            <button type="button" className="admin-secondary" onClick={() => setCaseId(addCase())}>Add case</button>
            <button type="button" className="admin-secondary" onClick={() => setCaseId(duplicateCase(caseId))}>Duplicate case</button>
            <button type="button" className="admin-danger" onClick={() => removeCase(caseId)}>Remove case</button>
          </div>
        </div>

        {controls}
        <AdminSelect
          label="Editing case"
          value={caseId}
          onChange={setCaseId}
          options={visibleCases.map(({ id, data: caseData }) => ({ value: id, label: `${id} - ${caseData.title || "Untitled"}` }))}
        />

        <div className="admin-grid two">
          <AdminSelect
            label="Canonical portfolio work"
            value={data.project_id || ""}
            required
            error={fieldErrors[`cases.${caseId}.project_id`] || (!String(data.project_id || "").trim() ? "Link this case to its canonical portfolio work." : "")}
            options={[{ value: "", label: "Select a portfolio work..." }, ...selectableWorkOptions]}
            onChange={(value) => linkCaseProject(caseId, value, workOptions.find((option) => option.value === value)?.side)}
          />
          <AdminText
            label="Title"
            value={data.title}
            required
            error={fieldErrors[`cases.${caseId}.title`] || (!String(data.title || "").trim() ? "Case title is required." : "")}
            onChange={(value) => updateCase(caseId, "title", value)}
          />
          <AdminText label="Eyebrow" value={data.eyebrow} onChange={(value) => updateCase(caseId, "eyebrow", value)} />
          <AdminSelect label="Side" value={data.side || "graphic"} options={[
            { value: "graphic", label: "Graphic" },
            { value: "webdev", label: "Software Dev" },
          ]} onChange={(value) => updateCase(caseId, "side", value)} />
          <AdminSelect
            label="Publication status"
            value={data.is_published === false ? "draft" : "published"}
            options={[
              { value: "published", label: "Published" },
              { value: "draft", label: "Unpublished" },
            ]}
            onChange={(value) => {
              const nextPublished = value === "published";
              if (!nextPublished && data.is_published !== false && !window.confirm("Unpublish this case study? Its linked portfolio work can remain published, but this case route will no longer open publicly.")) return;
              updateCase(caseId, "is_published", nextPublished);
            }}
          />
          <AdminSelect label="Thumbnail" value={data.thumb || (data.side === "webdev" ? "WebApp" : "Brand")} options={ADMIN_THUMBS[data.side || "graphic"]} onChange={(value) => updateCase(caseId, "thumb", value)} />
          <AdminPaletteSelect label="Palette" value={data.pal ?? 0} side={data.side || "graphic"} onChange={(value) => updateCase(caseId, "pal", value)} />
          <AdminText label="Thumb number" value={data.num} onChange={(value) => updateCase(caseId, "num", value)} />
        </div>

        <AdminText label="Case hero alt text" value={data.cover_alt || ""} placeholder={data.title || "Describe the case hero image"} error={fieldErrors[`cases.${caseId}.cover_alt`]} onChange={(value) => updateCase(caseId, "cover_alt", value)} />
        <AdminImageUpload
          label="Case hero image (opens first in gallery)"
          value={data.image || ""}
          altText={data.cover_alt || ""}
          onAltTextChange={(value) => updateCase(caseId, "cover_alt", value)}
          onChange={(value) => updateCase(caseId, "image", value)}
        />
        {fieldErrors[`cases.${caseId}.image`] && <div className="admin-inline-error" role="alert">Case hero: {fieldErrors[`cases.${caseId}.image`]}</div>}
        <p className="admin-note admin-gallery-case-note">
          Additional case images and thumbnail order come from the linked Portfolio Work record. The canonical project link is independent from this case ID.
        </p>
        <AdminText label="Challenge" value={data.challenge} textarea onChange={(value) => updateCase(caseId, "challenge", value)} />
        <AdminText label="Pull quote" value={data.pull} textarea onChange={(value) => updateCase(caseId, "pull", value)} />
        <AdminText label="Process" value={data.process} textarea onChange={(value) => updateCase(caseId, "process", value)} />
        <AdminText label="Tools and stack" value={data.tools} textarea onChange={(value) => updateCase(caseId, "tools", value)} />
      </section>

      <section className="admin-section" id="admin-section-cases-seo">
        <AdminSeoFields
          title="Case SEO"
          seo={data.seo || {}}
          errors={fieldErrors}
          errorPrefix={`cases.${caseId}.seo`}
          onChange={(key, value) => updateCaseSeo(caseId, key, value)}
        />
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

function AdminDataEditor({ draft, setDraft, save, reset, setStatus, canEdit }) {
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "raisa-portfolio-content.json";
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
    if (!canEdit) {
      event.target.value = "";
      setStatus("Your viewer role is read-only and cannot import content.", true);
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object.");
        const validationError = adminValidateContent(parsed);
        if (validationError) throw new Error(validationError);
        const normalized = adminNormalize(parsed);
        if (adminValidateContent(normalized)) throw new Error("The normalized document is invalid.");
        setDraft(normalized);
        setStatus("Imported JSON. Review it, then save changes.");
      } catch (error) {
        setStatus(`The selected file is not valid portfolio JSON: ${error.message || "validation failed"}`, true);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const updateStack = (stack) => {
    if (!canEdit) {
      setStatus("Your viewer role is read-only.", true);
      return;
    }
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
          <label className={"admin-file" + (!canEdit ? " disabled" : "")}>
            Import JSON
            <input type="file" accept="application/json" onChange={importJson} disabled={!canEdit} />
          </label>
          <button type="button" className="admin-primary" onClick={save} disabled={!canEdit}>Save now</button>
          <button type="button" className="admin-danger" onClick={reset} disabled={!canEdit}>Reset defaults</button>
        </div>
        <p className="admin-note">
          Save creates a protected server draft; publishing is a separate owner/publisher action. Export JSON as an offline backup.
        </p>
      </section>

      <section className="admin-section">
        <fieldset className="admin-editor-fieldset" disabled={!canEdit}>
          <AdminTechStackEditor stack={draft.techStack || []} onChange={updateStack} />
        </fieldset>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Current JSON</h3>
            <span>Read-only preview of the saved content shape</span>
          </div>
        </div>
        <textarea className="admin-json" aria-label="Current portfolio JSON" readOnly value={JSON.stringify(draft, null, 2)} />
      </section>
    </div>
  );
}

function AdminHistoryPage({ draftRevision, canRestore, onRestored, setStatus }) {
  const pageSize = 10;
  const [activity, setActivity] = React.useState([]);
  const [activityCount, setActivityCount] = React.useState(0);
  const [activityPage, setActivityPage] = React.useState(1);
  const [activityLoading, setActivityLoading] = React.useState(true);
  const [activityError, setActivityError] = React.useState("");
  const [revisions, setRevisions] = React.useState([]);
  const [revisionCount, setRevisionCount] = React.useState(0);
  const [revisionPage, setRevisionPage] = React.useState(1);
  const [revisionLoading, setRevisionLoading] = React.useState(true);
  const [revisionError, setRevisionError] = React.useState("");
  const [restoring, setRestoring] = React.useState("");

  const loadRevisions = React.useCallback(async () => {
    setRevisionLoading(true);
    setRevisionError("");
    try {
      const result = await window.PortfolioContent.loadRevisions({ offset: (revisionPage - 1) * pageSize, limit: pageSize });
      setRevisions(result.items || []);
      setRevisionCount(Number(result.count || 0));
    } catch (error) {
      setRevisions([]);
      setRevisionError(error.message || "Revision history is unavailable.");
    } finally {
      setRevisionLoading(false);
    }
  }, [revisionPage]);

  const loadActivity = React.useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const result = await window.PortfolioContent.loadActivity({ offset: (activityPage - 1) * pageSize, limit: pageSize });
      setActivity(result.items || []);
      setActivityCount(Number(result.count || 0));
    } catch (error) {
      setActivity([]);
      setActivityError(error.message || "Activity history is unavailable.");
    } finally {
      setActivityLoading(false);
    }
  }, [activityPage]);

  const load = React.useCallback(async () => {
    await Promise.all([loadRevisions(), loadActivity()]);
  }, [loadRevisions, loadActivity]);

  React.useEffect(() => { loadRevisions(); }, [loadRevisions]);
  React.useEffect(() => { loadActivity(); }, [loadActivity]);

  const restore = async (revision) => {
    if (!canRestore) {
      setStatus("Only an owner or publisher can restore revisions.", true);
      return;
    }
    if (!window.confirm(`Restore ${revision.kind} revision ${revision.revision} into the working draft?`)) return;
    setRestoring(revision.id);
    try {
      const result = await window.PortfolioContent.restoreRevision(revision.id, draftRevision);
      onRestored(result);
      setStatus(`Revision ${revision.revision} restored into the draft. Review it before publishing.`);
      await load();
    } catch (error) {
      setStatus("Restore failed: " + (error.message || "unknown error"), true);
    } finally {
      setRestoring("");
    }
  };

  const formatDate = (value) => value
    ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Unknown time";
  const formatAction = (value) => String(value || "activity")
    .replace(/[._-]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  const activityPages = Math.max(1, Math.ceil(activityCount / pageSize));
  const revisionPages = Math.max(1, Math.ceil(revisionCount / pageSize));

  return (
    <div className="admin-stack">
      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Revision History</h3>
            <span>Server snapshots created by draft saves and publishes</span>
          </div>
          <button type="button" className="admin-secondary" onClick={loadRevisions} disabled={revisionLoading}>
            {revisionLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {revisionLoading ? (
          <div className="admin-media-state" role="status">Loading revision history...</div>
        ) : revisionError ? (
          <div className="admin-inline-error" role="alert">{revisionError}</div>
        ) : revisions.length === 0 ? (
          <div className="admin-empty"><p>No revisions have been created yet.</p></div>
        ) : (
          <div className="admin-list">
            {revisions.map((revision) => (
              <div className="admin-row-card kv" key={revision.id}>
                <div>
                  <strong>{revision.kind === "published" ? "Published" : "Draft"} revision {revision.revision}</strong>
                  <div className="admin-note">Actor: {revision.created_by || "System"}</div>
                  <time className="admin-note" dateTime={revision.created_at}>{formatDate(revision.created_at)}</time>
                </div>
                {canRestore && (
                  <button
                    type="button"
                    className="admin-secondary"
                    disabled={restoring === revision.id}
                    onClick={() => restore(revision)}
                  >
                    {restoring === revision.id ? "Restoring…" : "Restore to draft"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {revisionPages > 1 && (
          <div className="admin-pagination" aria-label="Revision history pages">
            <button type="button" className="admin-secondary" disabled={revisionPage <= 1 || revisionLoading} onClick={() => setRevisionPage((page) => Math.max(1, page - 1))}>Previous</button>
            <span>Page {revisionPage} of {revisionPages} · {revisionCount} revisions</span>
            <button type="button" className="admin-secondary" disabled={revisionPage >= revisionPages || revisionLoading} onClick={() => setRevisionPage((page) => Math.min(revisionPages, page + 1))}>Next</button>
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Activity Log</h3>
            <span>Protected actions with actor, target, and time</span>
          </div>
          <button type="button" className="admin-secondary" onClick={loadActivity} disabled={activityLoading}>{activityLoading ? "Loading…" : "Refresh"}</button>
        </div>
        {activityLoading ? (
          <div className="admin-media-state" role="status">Loading activity history...</div>
        ) : activityError ? (
          <div className="admin-inline-error" role="alert">{activityError}</div>
        ) : activity.length === 0 ? (
          <div className="admin-empty"><p>No activity has been recorded yet.</p></div>
        ) : (
          <div className="admin-activity-list admin-activity-list-detailed">
            {activity.map((entry) => (
              <article className="admin-activity-item admin-activity-item-detailed" key={entry.id}>
                <div>
                  <strong>{formatAction(entry.action)}</strong>
                  <span>Actor: {entry.actor_email || entry.actor_id || "System"}</span>
                  <span>Target: {[entry.resource_type, entry.resource_id].filter(Boolean).join(" · ") || "Portfolio"}</span>
                </div>
                <time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time>
              </article>
            ))}
          </div>
        )}
        {activityPages > 1 && (
          <div className="admin-pagination" aria-label="Activity history pages">
            <button type="button" className="admin-secondary" disabled={activityPage <= 1 || activityLoading} onClick={() => setActivityPage((page) => Math.max(1, page - 1))}>Previous</button>
            <span>Page {activityPage} of {activityPages} · {activityCount} actions</span>
            <button type="button" className="admin-secondary" disabled={activityPage >= activityPages || activityLoading} onClick={() => setActivityPage((page) => Math.min(activityPages, page + 1))}>Next</button>
          </div>
        )}
      </section>
    </div>
  );
}

function AdminNavigationEditor({ items, onChange, errors = {} }) {
  const update = (index, key, value) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  };
  const move = (index, direction) => {
    onChange(moveArrayItem(items, index, direction).map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })));
  };

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <div>
          <h4>Navigation</h4>
          <p>Label, destination, visibility, and order</p>
        </div>
        <button type="button" className="admin-mini-button" onClick={() => onChange([
          ...items,
          {
            id: `nav-${Date.now()}`,
            label: "New link",
            target: "external",
            url: "",
            is_visible: true,
            order: items.length + 1,
          },
        ])}>Add link</button>
      </div>
      <div className="admin-list">
        {items.map((item, index) => (
          <div className="admin-row-card service" key={item.id || index}>
            <AdminText label="Label" value={item.label} error={errors[`site.navigation.${index}.label`]} onChange={(value) => update(index, "label", value)} />
            <AdminSelect
              label="Destination"
              value={item.target || "external"}
              options={[
                { value: "home", label: "Home" },
                { value: "graphic", label: "Graphic" },
                { value: "webdev", label: "Software Dev" },
                { value: "about", label: "About" },
                { value: "contact", label: "Contact" },
                { value: "external", label: "External URL" },
              ]}
              onChange={(value) => update(index, "target", value)}
            />
            <AdminText label="URL (external only)" value={item.url} error={errors[`site.navigation.${index}.url`]} onChange={(value) => update(index, "url", value)} />
            <AdminSelect
              label="Visible"
              value={item.is_visible === false ? "no" : "yes"}
              options={[{ value: "yes", label: "Visible" }, { value: "no", label: "Hidden" }]}
              onChange={(value) => update(index, "is_visible", value === "yes")}
            />
            <div className="admin-row-actions">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1}>↓</button>
              <button type="button" className="danger" onClick={() => {
                if (!window.confirm(`Delete the ${item.label || "navigation"} link from the draft?`)) return;
                onChange(items.filter((_, itemIndex) => itemIndex !== index));
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminSocialLinksEditor({ items, onChange, errors = {} }) {
  const update = (index, key, value) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
  };
  const move = (index, direction) => {
    onChange(moveArrayItem(items, index, direction).map((item, itemIndex) => ({ ...item, order: itemIndex + 1 })));
  };

  return (
    <div className="admin-subsection">
      <div className="admin-subsection-head">
        <div>
          <h4>Social links</h4>
          <p>Public profiles shown by the portfolio</p>
        </div>
        <button type="button" className="admin-mini-button" onClick={() => onChange([
          ...items,
          {
            id: `social-${Date.now()}`,
            label: "New profile",
            url: "",
            is_visible: true,
            order: items.length + 1,
          },
        ])}>Add profile</button>
      </div>
      <div className="admin-list">
        {items.map((item, index) => (
          <div className="admin-row-card service" key={item.id || index}>
            <AdminText label="Label" value={item.label} error={errors[`site.socialLinks.${index}.label`]} onChange={(value) => update(index, "label", value)} />
            <AdminText label="URL" value={item.url} placeholder="https://…" error={errors[`site.socialLinks.${index}.url`]} onChange={(value) => update(index, "url", value)} />
            <AdminSelect
              label="Visible"
              value={item.is_visible === false ? "no" : "yes"}
              options={[{ value: "yes", label: "Visible" }, { value: "no", label: "Hidden" }]}
              onChange={(value) => update(index, "is_visible", value === "yes")}
            />
            <div className="admin-row-actions">
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0}>↑</button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1}>↓</button>
              <button type="button" className="danger" onClick={() => {
                if (!window.confirm(`Delete the ${item.label || "social"} link from the draft?`)) return;
                onChange(items.filter((_, itemIndex) => itemIndex !== index));
              }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const ADMIN_STAFF_ROLES = ["owner", "publisher", "editor", "viewer"];

function AdminStaffPage({ currentUserId, onCurrentUserChanged, setStatus }) {
  const [staff, setStaff] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("editor");
  const [adding, setAdding] = React.useState(false);
  const [savingId, setSavingId] = React.useState("");

  const loadStaff = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await window.PortfolioContent.listAdminUsers();
      setStaff(result);
    } catch (error) {
      setLoadError(error.message || "Staff access is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadStaff(); }, [loadStaff]);

  const addStaff = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setStatus("Enter the email address of an existing Supabase Auth user.", true);
      return;
    }
    if (!window.confirm(`Assign the ${role} role to ${normalizedEmail}? This reactivates an existing staff row for that Auth user.`)) return;
    setAdding(true);
    try {
      const record = await window.PortfolioContent.addAdminUser(normalizedEmail, role);
      setStaff((current) => [record, ...current.filter((item) => item.user_id !== record.user_id)]);
      setEmail("");
      setStatus(`Staff access assigned to ${record.email}.`);
      if (record.user_id === currentUserId) await onCurrentUserChanged?.(record);
    } catch (error) {
      setStatus("Staff access could not be assigned: " + (error.message || "unknown error"), true);
    } finally {
      setAdding(false);
    }
  };

  const updateLocal = (userId, key, value) => {
    setStaff((current) => current.map((item) => item.user_id === userId ? { ...item, [key]: value } : item));
  };

  const saveStaff = async (record) => {
    const action = record.is_active ? `save ${record.role} access for ${record.email}` : `deactivate ${record.email}`;
    const selfWarning = record.user_id === currentUserId
      ? " This changes your current account and may immediately remove access to this screen."
      : "";
    if (!window.confirm(`Confirm: ${action}?${selfWarning}`)) return;
    setSavingId(record.user_id);
    try {
      const updated = await window.PortfolioContent.updateAdminUser(record.user_id, record.role, record.is_active);
      setStaff((current) => current.map((item) => item.user_id === updated.user_id ? updated : item));
      setStatus(updated.is_active ? `Access updated for ${updated.email}.` : `${updated.email} deactivated.`);
      if (updated.user_id === currentUserId) await onCurrentUserChanged?.(updated);
    } catch (error) {
      setStatus("Staff access could not be updated: " + (error.message || "unknown error"), true);
      await loadStaff();
    } finally {
      setSavingId("");
    }
  };

  return (
    <div className="admin-stack">
      <section className="admin-section" id="admin-section-staff-add">
        <div className="admin-section-head">
          <div>
            <h3>Staff</h3>
            <span>Owner-only role assignment for existing Supabase Auth users</span>
          </div>
          <button type="button" className="admin-secondary" disabled={loading} onClick={loadStaff}>Refresh</button>
        </div>
        <div className="admin-inline-warning" role="note">
          This screen never creates an Auth account or sets a password. Create or invite the person in Supabase Authentication first.
        </div>
        <form className="admin-staff-add" onSubmit={addStaff}>
          <AdminText label="Existing Auth user email" type="email" value={email} placeholder="person@example.com" required onChange={setEmail} />
          <AdminSelect label="Role" value={role} options={ADMIN_STAFF_ROLES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={setRole} />
          <button type="submit" className="admin-primary" disabled={adding}>{adding ? "Assigning access..." : "Assign role"}</button>
        </form>
      </section>

      <section className="admin-section" id="admin-section-staff-list" aria-busy={loading}>
        <div className="admin-section-head">
          <div><h3>Current staff</h3><span>{staff.length} account{staff.length !== 1 ? "s" : ""}</span></div>
        </div>
        {loading ? (
          <div className="admin-empty" role="status"><p>Loading staff...</p></div>
        ) : loadError ? (
          <div className="admin-inline-error" role="alert">{loadError} <button type="button" className="admin-mini-button" onClick={loadStaff}>Try again</button></div>
        ) : staff.length ? (
          <div className="admin-staff-list">
            {staff.map((record) => (
              <article className="admin-staff-card" key={record.user_id}>
                <div className="admin-staff-identity">
                  <strong>{record.email}</strong>
                  <span>{record.user_id === currentUserId ? "Your account" : record.user_id}</span>
                </div>
                <AdminSelect
                  label="Role"
                  value={record.role}
                  options={ADMIN_STAFF_ROLES.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))}
                  onChange={(value) => updateLocal(record.user_id, "role", value)}
                />
                <label className="admin-staff-active">
                  <input type="checkbox" checked={record.is_active === true} onChange={(event) => updateLocal(record.user_id, "is_active", event.target.checked)} />
                  <span>Active access</span>
                </label>
                <button type="button" className="admin-secondary" disabled={savingId === record.user_id} onClick={() => saveStaff(record)}>
                  {savingId === record.user_id ? "Saving..." : "Save access"}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty"><p>No staff rows were returned. Keep this Owner session open and verify the migration before continuing.</p></div>
        )}
        <p className="admin-note">The database prevents the last active Owner from being demoted or deactivated.</p>
      </section>
    </div>
  );
}

function AdminDashboard({
  draft,
  published,
  profile,
  draftRevision,
  publishedRevision,
  publishedAt,
  publicEnabled,
  onNavigate,
}) {
  const [activity, setActivity] = React.useState([]);
  const [activityError, setActivityError] = React.useState("");
  const [activityLoading, setActivityLoading] = React.useState(true);
  const countSnapshot = (snapshot = {}) => ({
    services: (snapshot.services?.graphic?.length || 0) + (snapshot.services?.webdev?.length || 0),
    categoryProjects: (snapshot.projects?.graphic?.length || 0) + (snapshot.projects?.webdev?.length || 0),
    work: (snapshot.works?.graphic?.length || 0) + (snapshot.works?.webdev?.length || 0),
    cases: Object.keys(snapshot.cases || {}).length,
  });
  const draftCounts = countSnapshot(draft);
  const publishedCounts = countSnapshot(published);
  const stats = [
    ["Services", draftCounts.services, publishedCounts.services],
    ["Category projects", draftCounts.categoryProjects, publishedCounts.categoryProjects],
    ["Portfolio work", draftCounts.work, publishedCounts.work],
    ["Case studies", draftCounts.cases, publishedCounts.cases],
  ];
  const formatActivityAction = (value) => String(value || "activity")
    .replace(/[._-]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

  React.useEffect(() => {
    let active = true;
    setActivityLoading(true);
    window.PortfolioContent.loadActivity({ limit: 5 })
      .then((result) => {
        if (!active) return;
        setActivity(Array.isArray(result) ? result : result.items || []);
        setActivityError("");
      })
      .catch((error) => {
        if (!active) return;
        setActivityError(error.message || "Recent activity is unavailable.");
      })
      .finally(() => {
        if (active) setActivityLoading(false);
      });
    return () => { active = false; };
  }, [draftRevision, publishedRevision, publicEnabled]);

  return (
    <div className="admin-stack">
      <section className="admin-section" id="admin-section-dashboard">
        <div className="admin-section-head">
          <div>
            <h3>Dashboard</h3>
            <span>Draft and published snapshot counts</span>
          </div>
          <span className="admin-note">Signed in as {profile.role}</span>
        </div>
        <div className="admin-dashboard-grid">
          {stats.map(([label, draftValue, publishedValue]) => (
            <div className="admin-dashboard-stat" key={label}>
              <strong>{draftValue}</strong>
              <span>{label}</span>
              <small>Published snapshot: {publishedValue}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-head">
          <div>
            <h3>Publishing status</h3>
            <span className={"admin-public-status " + (publicEnabled ? "enabled" : "disabled")}>
              {publicEnabled ? "Public site enabled" : "Public site unpublished"}
            </span>
            <span>Draft r{draftRevision} · Published r{publishedRevision}</span>
          </div>
        </div>
        <p className="admin-note">
          {publishedAt
            ? `Last published ${publishedAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.`
            : "This project has not published its first database snapshot yet."}
        </p>
        <div className="admin-data-actions">
          <button type="button" className="admin-secondary" onClick={() => onNavigate("site")}>Edit site settings</button>
          <button type="button" className="admin-secondary" onClick={() => onNavigate("graphic")}>Manage graphic work</button>
          <button type="button" className="admin-secondary" onClick={() => onNavigate("webdev")}>Manage web work</button>
          <button type="button" className="admin-secondary" onClick={() => onNavigate("uploads")}>Open uploads</button>
          <button type="button" className="admin-secondary" onClick={() => onNavigate("history")}>View history</button>
          {profile.role === "owner" && <button type="button" className="admin-secondary" onClick={() => onNavigate("staff")}>Manage staff</button>}
        </div>
      </section>

      <section className="admin-section" id="admin-section-dashboard-activity">
        <div className="admin-section-head">
          <div>
            <h3>Recent activity</h3>
            <span>Latest protected admin actions</span>
          </div>
        </div>
        {activityLoading ? (
          <div className="admin-media-state" role="status">Loading recent activity...</div>
        ) : activityError ? (
          <div className="admin-inline-error" role="alert">{activityError}</div>
        ) : activity.length ? (
          <div className="admin-activity-list">
            {activity.map((entry) => (
              <div className="admin-activity-item" key={entry.id}>
                <div>
                  <strong>{formatActivityAction(entry.action)}</strong>
                  <span>{entry.actor_email || entry.actor_id || "System"}</span>
                </div>
                <time dateTime={entry.created_at}>
                  {entry.created_at ? new Date(entry.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Unknown time"}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty admin-empty-compact"><p>No activity has been recorded yet.</p></div>
        )}
      </section>
    </div>
  );
}

function AdminPanel({ enabled = true, open, content, onSave, onPreview, onWorkspaceDraft, onAccessRevoked, onClose }) {
  const sb = window.PortfolioSupabase;
  const [profile, setProfile] = React.useState(null);
  const [authChecking, setAuthChecking] = React.useState(true);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [loginError, setLoginError] = React.useState("");
  const [activeTab, setActiveTab] = React.useState(() => {
    const stored = localStorage.getItem(ADMIN_TAB_KEY);
    return ["dashboard", "site", "graphic", "webdev", "cases", "uploads", "history", "staff", "data"].includes(stored)
      ? stored
      : "dashboard";
  });
  const [draft, setDraft] = React.useState(() => adminClone(content));
  const [savedDraft, setSavedDraft] = React.useState(() => adminClone(content));
  const [publishedContent, setPublishedContent] = React.useState(() => adminClone(content));
  const [draftRevision, setDraftRevision] = React.useState(0);
  const [publishedRevision, setPublishedRevision] = React.useState(0);
  const [publishedAt, setPublishedAt] = React.useState(null);
  const [publicEnabled, setPublicEnabled] = React.useState(content?.publicEnabled !== false);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [unpublishing, setUnpublishing] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState({});
  const [jumpTarget, setJumpTarget] = React.useState("dashboard");
  const [previewTarget, setPreviewTarget] = React.useState({ view: null, caseId: null, section: null });
  const [livePreviewEnabled, setLivePreviewEnabled] = React.useState(false);
  const [livePreviewBusy, setLivePreviewBusy] = React.useState(false);
  const [livePreviewError, setLivePreviewError] = React.useState("");
  const [status, setStatusState] = React.useState("");
  const [statusIsError, setStatusIsError] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editorPreview, setEditorPreview] = React.useState(false);
  const [selection, setSelection] = React.useState(null);
  const mutationVersionRef = React.useRef(0);
  const leavingRef = React.useRef(false);
  const workspaceRequestRef = React.useRef(0);
  const workspaceWasOpenRef = React.useRef(false);
  const [lastSavedAt, setLastSavedAt] = React.useState(null);
  const statusTimerRef = React.useRef(null);
  const authRequestRef = React.useRef(0);
  const authorizedUserIdRef = React.useRef(null);
  const loginInFlightRef = React.useRef(false);
  const accessCheckInFlightRef = React.useRef(false);
  const lastAccessCheckRef = React.useRef(0);
  const dialogRef = React.useRef(null);
  const loginEmailRef = React.useRef(null);
  const returnFocusRef = React.useRef(null);
  const livePreviewTimerRef = React.useRef(null);
  const livePreviewRequestRef = React.useRef(0);
  const livePreviewActiveRef = React.useRef(false);

  const unlocked = Boolean(profile);
  const canEdit = ["owner", "publisher", "editor"].includes(profile?.role);
  const canPublish = ["owner", "publisher"].includes(profile?.role);
  const canManageStaff = profile?.role === "owner";
  const jumpTargets = [
    { value: "dashboard", label: "Dashboard overview", tab: "dashboard", sectionId: "admin-section-dashboard", preview: { view: null, caseId: null, section: null } },
    { value: "site", label: "Site - brand and contact", tab: "site", sectionId: "admin-section-site", preview: { view: null, caseId: null, section: null } },
    { value: "site-seo-pages", label: "Site - page SEO", tab: "site", sectionId: "admin-section-site-seo-pages", preview: { view: null, caseId: null, section: null } },
    { value: "graphic-hero", label: "Graphic - hero and about", tab: "graphic", sectionId: "admin-section-graphic-hero", preview: { view: "graphic", caseId: null, section: null } },
    { value: "graphic-about", label: "Graphic - public about", tab: "graphic", sectionId: "admin-section-graphic-hero", preview: { view: "graphic", caseId: null, section: "about" } },
    { value: "graphic-services", label: "Graphic - services", tab: "graphic", sectionId: "admin-section-graphic-services", preview: { view: "graphic", caseId: null, section: null } },
    { value: "graphic-projects", label: "Graphic - category projects", tab: "graphic", sectionId: "admin-section-graphic-projects", preview: { view: "graphic", caseId: null, section: null } },
    { value: "graphic-work", label: "Graphic - portfolio work", tab: "graphic", sectionId: "admin-section-graphic-work", preview: { view: "graphic", caseId: null, section: null } },
    { value: "webdev-hero", label: "Software Dev - hero and about", tab: "webdev", sectionId: "admin-section-webdev-hero", preview: { view: "webdev", caseId: null, section: null } },
    { value: "webdev-about", label: "Software Dev - public about", tab: "webdev", sectionId: "admin-section-webdev-hero", preview: { view: "webdev", caseId: null, section: "about" } },
    { value: "webdev-services", label: "Software Dev - services", tab: "webdev", sectionId: "admin-section-webdev-services", preview: { view: "webdev", caseId: null, section: null } },
    { value: "webdev-projects", label: "Software Dev - category projects", tab: "webdev", sectionId: "admin-section-webdev-projects", preview: { view: "webdev", caseId: null, section: null } },
    { value: "webdev-work", label: "Software Dev - portfolio work", tab: "webdev", sectionId: "admin-section-webdev-work", preview: { view: "webdev", caseId: null, section: null } },
    { value: "cases", label: "Cases - content", tab: "cases", sectionId: "admin-section-cases", preview: previewTarget },
    { value: "cases-seo", label: "Cases - SEO", tab: "cases", sectionId: "admin-section-cases-seo", preview: previewTarget },
    { value: "uploads", label: "Media library", tab: "uploads", sectionId: "admin-section-uploads", preview: previewTarget },
    { value: "history", label: "Revision history", tab: "history", sectionId: "admin-section-history", preview: previewTarget },
    ...(canManageStaff ? [{ value: "staff", label: "Staff access", tab: "staff", sectionId: "admin-section-staff-add", preview: previewTarget }] : []),
    { value: "data", label: "Raw data", tab: "data", sectionId: "admin-section-data", preview: previewTarget },
  ];

  const setStatus = (message, isError = false) => {
    setStatusState(message);
    setStatusIsError(isError);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    if (message && !isError) {
      statusTimerRef.current = setTimeout(() => setStatusState(""), 3500);
    }
  };

  const navigateAdmin = (value) => {
    const target = jumpTargets.find((item) => item.value === value);
    if (!target) return;
    setJumpTarget(value);
    setActiveTab(target.tab);
    setDrawerOpen(true);
    if (!["uploads", "history", "staff", "data"].includes(target.tab)) {
      setPreviewTarget(target.preview);
    }
    window.setTimeout(() => {
      document.getElementById(target.sectionId)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const activateTab = (tab) => {
    setSelection(null);
    const preferred = jumpTargets.find((item) => item.tab === tab);
    if (preferred) navigateAdmin(preferred.value);
  };

  const clearAccess = React.useCallback(() => {
    const publicSnapshot = adminClone(window.PortfolioContent.load());
    if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    livePreviewTimerRef.current = null;
    livePreviewRequestRef.current += 1;
    livePreviewActiveRef.current = false;
    authRequestRef.current += 1;
    authorizedUserIdRef.current = null;
    setProfile(null);
    workspaceRequestRef.current += 1;
    setDrawerOpen(false);
    setEditorPreview(false);
    setSelection(null);
    setDraft(publicSnapshot);
    setSavedDraft(adminClone(publicSnapshot));
    setPublishedContent(adminClone(publicSnapshot));
    setDirty(false);
    setDraftRevision(0);
    setPublishedRevision(0);
    setPublishedAt(null);
    setPublicEnabled(publicSnapshot?.publicEnabled !== false);
    setFieldErrors({});
    setLivePreviewEnabled(false);
    setLivePreviewBusy(false);
    setLivePreviewError("");
    onAccessRevoked?.();
  }, [onAccessRevoked]);

  const loadAuthorizedState = React.useCallback(async (session, { hydrateDraft = true } = {}) => {
    const requestId = authRequestRef.current + 1;
    authRequestRef.current = requestId;
    if (!sb || !session) {
      clearAccess();
      return false;
    }

    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError) throw userError;
    if (!userData?.user) throw new Error("Your session is no longer valid.");
    if (session.user?.id && session.user.id !== userData.user.id) {
      throw new Error("The active session changed. Please sign in again.");
    }
    if (requestId !== authRequestRef.current) return false;

    const nextProfile = await window.PortfolioContent.getAdminProfile();
    if (requestId !== authRequestRef.current) return false;
    if (!nextProfile?.isActive) {
      await sb.auth.signOut().catch(() => {});
      clearAccess();
      throw new Error("This account does not have active portfolio admin access.");
    }
    if (nextProfile.userId !== userData.user.id) {
      await sb.auth.signOut().catch(() => {});
      clearAccess();
      throw new Error("The admin role does not match the active account.");
    }

    const state = hydrateDraft
      ? await window.PortfolioContent.loadAdminState()
      : null;
    if (requestId !== authRequestRef.current) return false;

    authorizedUserIdRef.current = userData.user.id;
    setProfile({ ...nextProfile, email: userData.user.email || "" });
    setLoginError("");
    if (state) {
      const nextDraft = adminClone(state.draft);
      const nextPublished = adminClone(state.published);
      setDraft(nextDraft);
      setSavedDraft(adminClone(nextDraft));
      setPublishedContent(nextPublished);
      setDraftRevision(state.draftRevision);
      setPublishedRevision(state.publishedRevision);
      setLastSavedAt(state.updatedAt ? new Date(state.updatedAt) : null);
      setPublishedAt(state.publishedAt ? new Date(state.publishedAt) : null);
      setPublicEnabled(state.publicEnabled !== false);
      setFieldErrors({});
      setDirty(false);
    }
    return true;
  }, [sb, clearAccess]);

  // Fail closed: a valid Supabase session and an active admin_users role are
  // both required before any draft is loaded.
  React.useEffect(() => {
    let active = true;
    if (!sb) {
      clearAccess();
      setLoginError("Secure admin is unavailable because Supabase is not configured.");
      setAuthChecking(false);
      return undefined;
    }

    const verifyInitialSession = async () => {
      setAuthChecking(true);
      try {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;
        if (data?.session) await loadAuthorizedState(data.session);
      } catch (error) {
        if (active) {
          clearAccess();
          setLoginError(error.message || "Session verification failed.");
        }
      } finally {
        if (active) setAuthChecking(false);
      }
    };

    verifyInitialSession();
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT" || !session) {
        clearAccess();
        return;
      }
      if (["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
        if (event === "SIGNED_IN" && loginInFlightRef.current) return;
        const hydrateDraft = authorizedUserIdRef.current !== session.user?.id;
        window.setTimeout(() => {
          if (!active) return;
          loadAuthorizedState(session, { hydrateDraft }).catch((error) => {
            clearAccess();
            setLoginError(error.message || "Admin access verification failed.");
          });
        }, 0);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [sb, clearAccess, loadAuthorizedState]);

  React.useEffect(() => {
    if (!sb || !unlocked) return undefined;
    let active = true;
    const recheckAccess = async () => {
      if (!active || accessCheckInFlightRef.current) return;
      const now = Date.now();
      if (now - lastAccessCheckRef.current < 2000) return;
      lastAccessCheckRef.current = now;
      accessCheckInFlightRef.current = true;
      try {
        const { data, error } = await sb.auth.getSession();
        if (error) throw error;
        if (!data?.session) throw new Error("Your admin session has expired.");
        await loadAuthorizedState(data.session, { hydrateDraft: false });
      } catch (error) {
        if (active) {
          clearAccess();
          setLoginError(error.message || "Admin access could not be reverified.");
        }
      } finally {
        accessCheckInFlightRef.current = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") recheckAccess();
    };
    window.addEventListener("focus", recheckAccess);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("focus", recheckAccess);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sb, unlocked, loadAuthorizedState, clearAccess]);

  React.useEffect(() => {
    localStorage.setItem(ADMIN_TAB_KEY, activeTab);
  }, [activeTab]);

  React.useEffect(() => {
    if (unlocked && activeTab === "staff" && !canManageStaff) {
      setActiveTab("dashboard");
      setJumpTarget("dashboard");
    }
  }, [unlocked, activeTab, canManageStaff]);

  React.useEffect(() => () => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (!open || !unlocked || !dirty) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [open, unlocked, dirty]);

  // Keep private previews in memory, and only supply them after verified Auth
  // and the active database role have authorized loadAuthorizedState.
  React.useEffect(() => {
    if (!open || !unlocked) return undefined;
    workspaceWasOpenRef.current = true;
    const requestId = ++workspaceRequestRef.current;
    setLivePreviewBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const next = adminCollectMediaReferences(draft).size
          ? await adminHydrateMediaPreviewContent(draft)
          : draft;
        if (requestId !== workspaceRequestRef.current) return;
        onWorkspaceDraft?.(adminClone(next));
        setLivePreviewError("");
      } catch (error) {
        if (requestId === workspaceRequestRef.current) setLivePreviewError(error.message || "Draft preview could not be updated.");
      } finally {
        if (requestId === workspaceRequestRef.current) setLivePreviewBusy(false);
      }
    }, 100);
    return () => { clearTimeout(timer); workspaceRequestRef.current += 1; };
  }, [open, unlocked, draft, onWorkspaceDraft]);

  React.useEffect(() => {
    if (!open && workspaceWasOpenRef.current) {
      workspaceWasOpenRef.current = false;
      setDrawerOpen(false);
      onAccessRevoked?.();
    }
    if (open) leavingRef.current = false;
  }, [open, onAccessRevoked]);

  React.useEffect(() => {
    if (!open || !unlocked) return undefined;
    const guard = (event) => {
      if (!leavingRef.current && dirty && !window.confirm("Leave the editor with unsaved changes? Save your draft first to keep it after reload.")) event.preventDefault();
    };
    window.addEventListener("portfolio-leave-editor", guard);
    return () => window.removeEventListener("portfolio-leave-editor", guard);
  }, [open, unlocked, dirty]);

  const mutate = (producer) => {
    if (!canEdit) {
      setStatus("Your viewer role is read-only.", true);
      return;
    }
    mutationVersionRef.current += 1;
    setDraft((current) => {
      const next = adminClone(current);
      producer(next);
      return next;
    });
    setDirty(true);
    setFieldErrors({});
    setStatus("");
  };

  const updateSite = (key, value) => mutate((next) => { next.site[key] = value; });
  const updateContact = (key, value) => mutate((next) => {
    next.site.contact = next.site.contact || {};
    next.site.contact[key] = value;
    if (key === "email") next.site.contactEmail = value;
  });
  const updateSeo = (key, value) => mutate((next) => {
    next.site.seo = next.site.seo || {};
    next.site.seo[key] = value;
    if (key === "title") next.site.metaTitle = value;
    if (key === "description") next.site.metaDescription = value;
  });
  const updatePageSeo = (page, key, value) => mutate((next) => {
    next.site.seo = next.site.seo || {};
    next.site.seo.pages = next.site.seo.pages || {};
    next.site.seo.pages[page] = next.site.seo.pages[page] || {};
    next.site.seo.pages[page][key] = value;
  });
  const updateFooter = (key, value) => mutate((next) => {
    next.site.footer = next.site.footer || {};
    next.site.footer[key] = value;
  });
  const updateNavigation = (items) => mutate((next) => {
    next.site.navigation = items.map((item, index) => ({ ...item, order: index + 1 }));
  });
  const updateSocialLinks = (items) => mutate((next) => {
    next.site.socialLinks = items.map((item, index) => ({ ...item, order: index + 1 }));
  });
  const updateGithubIntegration = (key, value) => mutate((next) => {
    next.integrations = next.integrations || {};
    next.integrations.github = next.integrations.github || {};
    next.integrations.github[key] = value;
  });
  const updateStudio = (side, key, value) => mutate((next) => { next.studios[side][key] = value; });
  const updateStudioStats = (side, key, value) => mutate((next) => { next.studios[side][key] = value; });
  const updateService = (side, index, key, value) => mutate((next) => {
    const service = next.services[side][index];
    const previousCategoryId = service.slug || service.id;
    service[key] = value;
    if (key === "title" || key === "name") {
      service.title = value;
      service.name = value;
    }
    if (["desc", "short_description", "shortDescription"].includes(key)) {
      service.desc = value;
      service.short_description = value;
      service.shortDescription = value;
    }
    const nextCategoryId = service.slug || service.id;
    if (previousCategoryId && nextCategoryId && previousCategoryId !== nextCategoryId) {
      next.projects[side] = (next.projects?.[side] || []).map((project) => (
        project.category_id === previousCategoryId ? { ...project, category_id: nextCategoryId } : project
      ));
      next.works[side] = (next.works?.[side] || []).map((work) => (
        work.category_id === previousCategoryId ? { ...work, category_id: nextCategoryId } : work
      ));
    }
    if (key === "title" || key === "name") {
      next.works[side] = (next.works?.[side] || []).map((work) => (
        work.category_id === nextCategoryId ? { ...work, cat: value } : work
      ));
    }
    service.updated_at = new Date().toISOString();
  });
  const updateCategoryProject = (side, index, key, value) => mutate((next) => {
    next.projects = next.projects || { graphic: [], webdev: [] };
    next.projects[side] = next.projects[side] || [];
    next.projects[side][index][key] = value;
    next.projects[side][index].updated_at = new Date().toISOString();
  });
  const updateWork = (side, index, key, value) => mutate((next) => {
    const work = next.works[side][index];
    const previousId = work.id;
    const previousSlug = work.slug;
    work[key] = value;
    work.updated_at = new Date().toISOString();
    if ((key === "id" || key === "slug") && next.cases) {
      Object.values(next.cases).forEach((caseData) => {
        if (caseData.project_id === previousId || caseData.project_id === previousSlug) {
          caseData.project_id = work.id || value;
          caseData.side = side;
          caseData.updated_at = new Date().toISOString();
        }
      });
    }
  });
  const updateCase = (caseId, key, value) => mutate((next) => {
    next.cases[caseId][key] = value;
    next.cases[caseId].updated_at = new Date().toISOString();
  });
  const updateCaseSeo = (caseId, key, value) => mutate((next) => {
    next.cases[caseId].seo = next.cases[caseId].seo || {};
    next.cases[caseId].seo[key] = value;
    next.cases[caseId].updated_at = new Date().toISOString();
  });
  const linkCaseProject = (caseId, projectId, side) => {
    const duplicate = Object.entries(draft.cases || {}).find(([otherCaseId, caseData]) => (
      otherCaseId !== caseId && projectId && caseData?.project_id === projectId
    ));
    if (duplicate) {
      setStatus(`That portfolio work is already linked to ${duplicate[1]?.title || duplicate[0]}. Choose a different work.`, true);
      return;
    }
    mutate((next) => {
    next.cases[caseId].project_id = projectId;
    if (side === "graphic" || side === "webdev") next.cases[caseId].side = side;
    next.cases[caseId].updated_at = new Date().toISOString();
    });
  };
  const updateCaseInfo = (caseId, rows) => mutate((next) => { next.cases[caseId].side_info = rows; });
  const updateCaseResult = (caseId, results) => mutate((next) => { next.cases[caseId].results = results; });

  const addService = (side) => mutate((next) => {
    const count = next.services[side].length + 1;
    const title = "New service";
    const items = next.services[side];
    next.services[side].push({
      id: adminCreateSafeId(`${side}-service`, items.map((item) => item.id)),
      slug: adminCreateUniqueSlug(title, items),
      num: String(count).padStart(2, "0"),
      title,
      name: title,
      desc: "Short service description.",
      short_description: "Short service description.",
      icon: Math.min(count - 1, 9),
      order: count,
      is_active: true,
    });
  });
  const removeService = (side, index) => {
    const service = draft.services?.[side]?.[index];
    if (!service) return;
    const identifiers = new Set([service.id, service.slug].filter(Boolean));
    const linkedCount = [
      ...(draft.projects?.[side] || []),
      ...(draft.works?.[side] || []),
    ].filter((record) => identifiers.has(record.category_id)).length;
    if (linkedCount) {
      setStatus(`This service still has ${linkedCount} linked project${linkedCount === 1 ? "" : "s"}. Reassign or delete those projects first.`, true);
      return;
    }
    if (!window.confirm(`Delete ${service.title || service.name || "this service"} from the draft?`)) return;
    mutate((next) => {
      next.services[side] = next.services[side]
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, serviceIndex) => ({ ...item, order: serviceIndex + 1 }));
    });
  };
  const moveService = (side, index, direction) => mutate((next) => {
    next.services[side] = moveArrayItem(next.services[side], index, direction)
      .map((service, serviceIndex) => ({
        ...service,
        order: serviceIndex + 1,
        updated_at: new Date().toISOString(),
      }));
  });
  const duplicateService = (side, index) => mutate((next) => {
    const items = next.services?.[side] || [];
    const source = items[index];
    if (!source) return;
    const title = `${source.title || source.name || "Service"} copy`;
    const duplicate = {
      ...source,
      id: adminCreateSafeId(`${side}-service`, items.map((item) => item.id)),
      slug: adminCreateUniqueSlug(source.slug || title, items),
      title,
      name: title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    items.splice(index + 1, 0, duplicate);
    next.services[side] = items.map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }));
  });

  const addCategoryProject = (side) => mutate((next) => {
    next.projects = next.projects || { graphic: [], webdev: [] };
    next.projects[side] = next.projects[side] || [];
    const count = next.projects[side].length + 1;
    const title = side === "graphic" ? "New Design Project" : "New Web Project";
    const categoryId = adminDefaultCategory(next.services?.[side] || [], count - 1);
    const items = next.projects[side];
    next.projects[side].push({
      id: adminCreateSafeId(`${side}-project`, items.map((item) => item.id)),
      category_id: categoryId,
      title,
      slug: adminCreateUniqueSlug(title, items),
      short_description: "Short project description.",
      full_description: "Longer project details.",
      image_url: "",
      cover_alt: "",
      gallery_images: [],
      tags: [],
      client_name: "",
      project_date: String(new Date().getFullYear()),
      stack: side === "webdev" ? "React - Supabase" : undefined,
      is_featured: false,
      is_published: true,
      sort_order: count,
      thumb: side === "webdev" ? "WebApp" : "Brand",
      pal: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });
  const removeCategoryProject = (side, index) => {
    if (!window.confirm("Delete this service category project from the draft?")) return;
    mutate((next) => {
      next.projects = next.projects || { graphic: [], webdev: [] };
      next.projects[side] = (next.projects[side] || []).filter((_, itemIndex) => itemIndex !== index);
    });
  };
  const moveCategoryProject = (side, index, direction) => mutate((next) => {
    next.projects = next.projects || { graphic: [], webdev: [] };
    next.projects[side] = moveArrayItem(next.projects[side] || [], index, direction)
      .map((project, projectIndex) => ({ ...project, sort_order: projectIndex + 1, updated_at: new Date().toISOString() }));
  });
  const duplicateCategoryProject = (side, index) => mutate((next) => {
    next.projects = next.projects || { graphic: [], webdev: [] };
    const items = next.projects[side] || [];
    const source = items[index];
    if (!source) return;
    const title = `${source.title || "Project"} copy`;
    const duplicate = {
      ...source,
      id: adminCreateSafeId(`${side}-project`, items.map((item) => item.id)),
      slug: adminCreateUniqueSlug(source.slug || title, items),
      title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    items.splice(index + 1, 0, duplicate);
    next.projects[side] = items.map((item, itemIndex) => ({ ...item, sort_order: itemIndex + 1 }));
  });

  const addWork = (side) => mutate((next) => {
    const prefix = side === "graphic" ? "g" : "w";
    const count = next.works[side].length + 1;
    const title = "New Project";
    const items = next.works[side];
    const categoryId = adminDefaultCategory(next.services?.[side] || [], count - 1);
    const categoryLabel = adminCategoryOptions(next.services?.[side] || []).find((option) => option.value === categoryId)?.label || "Selected work";
    next.works[side].push({
      id: adminCreateSafeId(prefix, items.map((item) => item.id)),
      title,
      slug: adminCreateUniqueSlug(title, items),
      category_id: categoryId,
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
    const work = draft.works?.[side]?.[index];
    if (!work) return;
    const linkedCases = Object.entries(draft.cases || {}).filter(([caseId, caseData]) => (
      caseData?.project_id === work.id ||
      caseData?.project_id === work.slug ||
      (!caseData?.project_id && (caseId === work.id || caseId === work.slug))
    ));
    if (linkedCases.length) {
      setStatus(`This project is linked to ${linkedCases.length} case stud${linkedCases.length === 1 ? "y" : "ies"}. Relink or remove ${linkedCases.length === 1 ? "it" : "them"} first.`, true);
      return;
    }
    if (!window.confirm("Delete this project from the draft?")) return;
    mutate((next) => {
      next.works[side] = next.works[side]
        .filter((_, itemIndex) => itemIndex !== index)
        .map((work, workIndex) => ({ ...work, sort_order: workIndex + 1 }));
    });
  };
  const moveWork = (side, index, direction) => mutate((next) => {
    next.works[side] = moveArrayItem(next.works[side], index, direction)
      .map((work, workIndex) => ({
        ...work,
        sort_order: workIndex + 1,
        updated_at: new Date().toISOString(),
      }));
  });
  const duplicateWork = (side, index) => mutate((next) => {
    const items = next.works?.[side] || [];
    const source = items[index];
    if (!source) return;
    const title = `${source.title || "Project"} copy`;
    const duplicate = {
      ...source,
      id: adminCreateSafeId(side === "graphic" ? "g" : "w", items.map((item) => item.id)),
      slug: adminCreateUniqueSlug(source.slug || title, items),
      title,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    items.splice(index + 1, 0, duplicate);
    next.works[side] = items.map((item, itemIndex) => ({ ...item, sort_order: itemIndex + 1 }));
  });

  const addCase = () => {
    let index = Object.keys(draft.cases || {}).length + 1;
    let createdId = "";
    do {
      createdId = `case-${index}`;
      index += 1;
    } while (draft.cases?.[createdId]);

    mutate((next) => {
      const alreadyLinked = new Set(Object.values(next.cases || {}).map((item) => item?.project_id).filter(Boolean));
      const firstLinkedWork = [...(next.works?.graphic || []), ...(next.works?.webdev || [])]
        .find((work) => work?.id && !alreadyLinked.has(work.id)) || null;
      const linkedSide = next.works?.graphic?.includes(firstLinkedWork) ? "graphic" : "webdev";
      next.cases[createdId] = {
        project_id: firstLinkedWork?.id || "",
        side: firstLinkedWork ? linkedSide : "graphic",
        title: "New Case Study",
        eyebrow: "Case - Project",
        pal: 0,
        thumb: "Brand",
        cover_alt: "",
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

  const duplicateCase = (caseId) => {
    const cases = draft.cases || {};
    const source = cases[caseId];
    if (!source) return caseId;
    const createdId = adminCreateSafeId("case", Object.keys(cases));
    mutate((next) => {
      next.cases[createdId] = {
        ...next.cases[caseId],
        title: `${next.cases[caseId].title || "Case Study"} copy`,
        project_id: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });
    setStatus("Case duplicated. Link the copy to an unused canonical portfolio work before saving.");
    return createdId;
  };

  const removeCase = (caseId) => {
    if (!window.confirm(`Remove ${caseId}? This only affects the saved draft.`)) return;
    mutate((next) => {
      delete next.cases[caseId];
    });
  };

  const revealValidationErrors = (errors) => {
    setFieldErrors(errors);
    const firstPath = Object.keys(errors)[0] || "";
    if (firstPath.startsWith("site.")) {
      setActiveTab("site");
      setJumpTarget(firstPath.includes(".pages.") ? "site-seo-pages" : "site");
    } else if (firstPath.startsWith("services.graphic.") || firstPath.startsWith("projects.graphic.") || firstPath.startsWith("works.graphic.")) {
      setActiveTab("graphic");
      setJumpTarget(firstPath.startsWith("services.") ? "graphic-services" : firstPath.startsWith("projects.") ? "graphic-projects" : "graphic-work");
    } else if (firstPath.startsWith("services.webdev.") || firstPath.startsWith("projects.webdev.") || firstPath.startsWith("works.webdev.")) {
      setActiveTab("webdev");
      setJumpTarget(firstPath.startsWith("services.") ? "webdev-services" : firstPath.startsWith("projects.") ? "webdev-projects" : "webdev-work");
    } else if (firstPath.startsWith("cases.")) {
      setActiveTab("cases");
      setJumpTarget(firstPath.includes(".seo.") ? "cases-seo" : "cases");
    }
    window.setTimeout(() => {
      const firstInvalid = dialogRef.current?.querySelector('[aria-invalid="true"]');
      firstInvalid?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      firstInvalid?.focus?.();
    }, 80);
  };

  const save = async () => {
    if (saving || !canEdit) {
      if (!canEdit) setStatus("Your viewer role cannot save drafts.", true);
      return;
    }
    setSaving(true);
    const savingVersion = mutationVersionRef.current;
    const savingUser = authorizedUserIdRef.current;
    try {
      const nextFieldErrors = adminCollectFieldErrors(draft);
      const validationError = adminValidateContent(draft);
      if (validationError) {
        setDirty(true);
        revealValidationErrors(nextFieldErrors);
        setStatus(validationError, true);
        return;
      }
      const normalized = adminNormalize(draft);
      const normalizedValidationError = adminValidateContent(normalized);
      if (normalizedValidationError) {
        revealValidationErrors(adminCollectFieldErrors(normalized));
        setStatus(normalizedValidationError, true);
        return;
      }
      const result = await window.PortfolioContent.saveDraft(normalized, draftRevision);
      if (!savingUser || savingUser !== authorizedUserIdRef.current) return;
      const nextDraft = adminClone(result.draft);
      if (savingVersion === mutationVersionRef.current) setDraft(nextDraft);
      setSavedDraft(adminClone(nextDraft));
      setDraftRevision(result.draftRevision);
      setDirty(savingVersion !== mutationVersionRef.current);
      setFieldErrors({});
      setLastSavedAt(result.updatedAt ? new Date(result.updatedAt) : new Date());
      setStatus(savingVersion === mutationVersionRef.current ? "Draft saved. Publish it when it is ready for the public site." : "Draft saved. Newer changes still need saving.");
    } catch (err) {
      const message = err.message || "unknown error";
      setStatus(
        message.toLowerCase().includes("another session")
          ? "Save stopped because another session changed the draft. Reload the server draft before editing again."
          : "Save failed — " + message + ". Your unsaved draft is still on this screen.",
        true
      );
    } finally {
      setSaving(false);
    }
  };

  const stopLivePreview = ({ restore = true } = {}) => {
    if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    livePreviewTimerRef.current = null;
    livePreviewRequestRef.current += 1;
    const shouldRestore = restore && livePreviewActiveRef.current;
    livePreviewActiveRef.current = false;
    setLivePreviewEnabled(false);
    setLivePreviewBusy(false);
    setLivePreviewError("");
    if (shouldRestore) onAccessRevoked?.();
  };

  React.useEffect(() => {
    if (!open || !unlocked || !livePreviewEnabled) return undefined;
    const requestId = livePreviewRequestRef.current + 1;
    livePreviewRequestRef.current = requestId;
    if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
    setLivePreviewBusy(true);
    setLivePreviewError("");
    livePreviewTimerRef.current = window.setTimeout(async () => {
      try {
        const normalized = adminNormalize(draft);
        const hydrated = adminCollectMediaReferences(normalized).size
          ? await adminHydrateMediaPreviewContent(normalized)
          : normalized;
        if (requestId !== livePreviewRequestRef.current) return;
        onPreview(adminClone(hydrated), { ...previewTarget, keepOpen: true });
        livePreviewActiveRef.current = true;
      } catch (error) {
        if (requestId === livePreviewRequestRef.current) {
          setLivePreviewError(error.message || "Live preview could not be updated.");
        }
      } finally {
        if (requestId === livePreviewRequestRef.current) setLivePreviewBusy(false);
      }
    }, 500);
    return () => {
      if (livePreviewTimerRef.current) clearTimeout(livePreviewTimerRef.current);
      livePreviewTimerRef.current = null;
    };
  }, [open, unlocked, livePreviewEnabled, draft, previewTarget]);

  React.useEffect(() => {
    if (!open && (livePreviewEnabled || livePreviewActiveRef.current)) {
      stopLivePreview({ restore: true });
    }
  }, [open]);

  const publish = async () => {
    if (publishing || !canPublish) {
      if (!canPublish) setStatus("Only an owner or publisher can publish.", true);
      return;
    }
    if (dirty) {
      setStatus("Save the current draft before publishing.", true);
      return;
    }
    if (!window.confirm("Publish the saved draft to the public website now?")) return;
    setPublishing(true);
    try {
      const result = await window.PortfolioContent.publishDraft(draftRevision, {
        onProgress: ({ label }) => setStatus(label || "Publishing…"),
      });
      setPublishedRevision(result.publishedRevision);
      setPublishedAt(result.publishedAt ? new Date(result.publishedAt) : new Date());
      setPublishedContent(adminClone(result.published));
      setPublicEnabled(true);
      onSave(adminClone(result.publicContent || result.published));
      setStatus("Published successfully. The public website is now up to date.");
    } catch (err) {
      setStatus("Publish failed — " + (err.message || "unknown error") + ".", true);
    } finally {
      setPublishing(false);
    }
  };

  const unpublishSite = async () => {
    if (unpublishing || !canPublish) {
      if (!canPublish) setStatus("Only an owner or publisher can unpublish the site.", true);
      return;
    }
    const draftWarning = dirty
      ? " Your unsaved browser changes will remain in this editor and are not part of this action."
      : "";
    if (!window.confirm(`Unpublish the entire public website now? Visitors will see the unavailable state; the private draft and history remain intact.${draftWarning}`)) return;
    setUnpublishing(true);
    try {
      const result = await window.PortfolioContent.unpublish(publishedRevision);
      setPublishedRevision(result.publishedRevision);
      setPublicEnabled(false);
      onSave(adminClone(result.publicContent));
      setStatus("Site unpublished. The private draft and revision history were preserved.");
    } catch (error) {
      const message = error.message || "unknown error";
      setStatus(
        message.toLowerCase().includes("another session") || message.toLowerCase().includes("revision")
          ? "Unpublish stopped because the published revision changed. Reload the server draft and try again."
          : "Unpublish failed - " + message + ".",
        true
      );
    } finally {
      setUnpublishing(false);
    }
  };

  const preview = async () => {
    setDrawerOpen(false);
    setEditorPreview(true);
  };

  const reset = () => {
    if (!canEdit) {
      setStatus("Your viewer role cannot reset the draft.", true);
      return;
    }
    if (!window.confirm("Replace the working draft with the source defaults? It will not be public until saved and published.")) return;
    setDraft(adminNormalize(window.PortfolioContent.defaults));
    setDirty(true);
    setStatus("Defaults loaded into the working draft. Review and save when ready.");
  };

  const reloadDraft = async () => {
    if (dirty && !window.confirm("Discard unsaved changes and reload the latest server draft?")) return;
    setSaving(true);
    try {
      const state = await window.PortfolioContent.loadAdminState();
      const nextDraft = adminClone(state.draft);
      setDraft(nextDraft);
      setSavedDraft(adminClone(nextDraft));
      setPublishedContent(adminClone(state.published));
      setDraftRevision(state.draftRevision);
      setPublishedRevision(state.publishedRevision);
      setLastSavedAt(state.updatedAt ? new Date(state.updatedAt) : null);
      setPublishedAt(state.publishedAt ? new Date(state.publishedAt) : null);
      setPublicEnabled(state.publicEnabled !== false);
      setFieldErrors({});
      setDirty(false);
      setStatus("Latest server draft loaded.");
    } catch (error) {
      setStatus("Reload failed — " + (error.message || "unknown error") + ".", true);
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty && !window.confirm("Close the admin panel with unsaved changes?")) return;
    leavingRef.current = true;
    if (livePreviewEnabled || livePreviewActiveRef.current) stopLivePreview({ restore: true });
    onClose();
  };

  React.useEffect(() => {
    if (!open || (unlocked && !drawerOpen)) return undefined;
    returnFocusRef.current = document.activeElement;
    return () => {
      returnFocusRef.current?.focus?.();
      returnFocusRef.current = null;
    };
  }, [open, unlocked, drawerOpen]);

  React.useEffect(() => {
    if (!open || (unlocked && !drawerOpen)) return undefined;
    const timer = window.setTimeout(() => {
      const focusTarget = (!unlocked && !authChecking ? loginEmailRef.current : null)
        || dialogRef.current?.querySelector(
          'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
      focusTarget?.focus?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, authChecking, unlocked, drawerOpen]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.defaultPrevented) return;
      if (canEdit && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
      if (event.key === "Tab" && (!unlocked || drawerOpen)) {
        const focusable = Array.from(dialogRef.current?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        ) || []).filter((element) => element.getClientRects().length > 0);
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!dialogRef.current?.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === "Escape" && !document.querySelector(".admin-crop-dialog")) {
        if (drawerOpen) { event.preventDefault(); setDrawerOpen(false); }
        else if (!unlocked) requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, unlocked, dirty, draft, draftRevision, canEdit, drawerOpen]);

  const login = async (event) => {
    event.preventDefault();
    if (!sb) {
      setLoginError("Secure admin is unavailable because Supabase is not configured.");
      return;
    }
    if (!email.trim() || !password) {
      setLoginError("Enter both email and password.");
      return;
    }
    setLoginLoading(true);
    loginInFlightRef.current = true;
    setLoginError("");
    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      await loadAuthorizedState(data.session);
      setPassword("");
    } catch (err) {
      clearAccess();
      await sb.auth.signOut().catch(() => {});
      setPassword("");
      setLoginError(err.message || "Sign-in failed.");
    } finally {
      loginInFlightRef.current = false;
      setLoginLoading(false);
    }
  };

  const logout = async () => {
    if (dirty && !window.confirm("Sign out and discard unsaved changes? Save draft first to keep your work.")) return;
    let signOutError = null;
    if (sb) {
      try {
        const result = await sb.auth.signOut();
        signOutError = result?.error || null;
        if (signOutError) {
          // Even if server-side revocation is unavailable, explicitly remove
          // this browser's session before clearing all in-memory draft state.
          const localResult = await sb.auth.signOut({ scope: "local" });
          signOutError = localResult?.error || signOutError;
        }
      } catch (error) {
        signOutError = error;
        try {
          const localResult = await sb.auth.signOut({ scope: "local" });
          signOutError = localResult?.error || signOutError;
        } catch (_) {
          // Report the original failure after the UI and preview are locked.
        }
      }
    }
    clearAccess();
    if (signOutError) {
      const message = "Signed out of this screen, but server session revocation could not be confirmed. Close this browser before leaving the device.";
      setLoginError(message);
      setStatus(message, true);
      return;
    }
    setLoginError("");
    setStatus("Admin locked.");
  };

  const selectElement = (nextSelection) => {
    if (!unlocked || !canEdit) return;
    const target = jumpTargets.find((item) => item.value === nextSelection.target);
    if (!target) return;
    setSelection(nextSelection);
    navigateAdmin(target.value);
  };
  const mediaLocation = selection?.mediaPath
    ? window.PortfolioWorkspaceUtils.mediaLocation(draft, selection.mediaPath)
    : null;
  const mediaAltKey = selection?.mediaPath?.includes("gallery_images") ? "alt" : "cover_alt";
  const updateSelectedMedia = (value, isAlt) => mutate((next) => {
    const location = window.PortfolioWorkspaceUtils.mediaLocation(next, selection.mediaPath);
    if (!location) return;
    if (isAlt) {
      // Icons and SEO images have no alt leaf in the persisted v1 contract.
      if (!["icon_url", "ogImage"].includes(location.key)) location.record[mediaAltKey] = value;
    } else {
      location.record[location.key] = value;
      if (selection.mediaPath[0] === "projects" && location.key === "image_url" && !selection.mediaPath.includes("gallery_images")) location.record.image = value;
    }
  });

  if (!open || !enabled) return null;

  if (authChecking) {
    return (
      <div className="admin-overlay">
        <div ref={dialogRef} className="admin-login" role="dialog" aria-modal="true" aria-label="Checking admin session">
          <button type="button" className="admin-close" onClick={requestClose}>Close</button>
          <p role="status" aria-live="polite" style={{color:"rgba(17,17,17,.68)", fontFamily:"monospace", fontSize:13, textAlign:"center", marginTop:16}}>Checking session…</p>
        </div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="admin-overlay">
        <form ref={dialogRef} className="admin-login" role="dialog" aria-modal="true" aria-labelledby="admin-login-title" aria-describedby={loginError ? "admin-login-error" : "admin-login-help"} onSubmit={login}>
          <button type="button" className="admin-close" onClick={requestClose}>Close</button>
          <h2 id="admin-login-title">Admin Panel</h2>
          <p id="admin-login-help">Sign in with an active Supabase portfolio admin account.</p>
          <AdminText inputRef={loginEmailRef} label="Email" type="email" value={email} onChange={setEmail} placeholder="admin@example.com" />
          <AdminPasswordField label="Password" value={password} onChange={setPassword} />
          {loginError && <div className="admin-error" id="admin-login-error" role="alert" aria-live="assertive">{loginError}</div>}
          <button className="admin-primary" type="submit" disabled={loginLoading || !sb}>
            {loginLoading ? "Signing in…" : "Sign in securely"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <ADMIN_MEDIA_PERMISSIONS.Provider value={{
      canUpload: canEdit,
      canEditMetadata: canEdit,
      canDelete: canEdit,
    }}>
    <div className="visual-admin-workspace">
      {editorPreview ? (
        <div className="visual-preview-return">
          <span>Private draft preview</span>
          <button type="button" onClick={() => setEditorPreview(false)}>Exit preview</button>
        </div>
      ) : (
        <div className="visual-admin-toolbar" aria-label="Raisa Studio editor">
          <div className="visual-admin-brand"><b>{draft.site.logoMark || "R"}</b><span>{draft.site.brandName}<small>{profile.role} ? Draft r{draftRevision}</small></span></div>
          <div className="visual-admin-mode" role="group" aria-label="View mode">
            <button type="button" aria-pressed={!editorPreview} onClick={() => { setEditorPreview(false); setDrawerOpen(false); }}>Edit mode</button>
            <button type="button" onClick={preview} disabled={livePreviewBusy}>Preview</button>
          </div>
          <button type="button" onClick={() => activateTab("uploads")}>Resources</button>
          <button type="button" onClick={() => activateTab("site")}>Settings</button>
          <button type="button" disabled={!canEdit || saving || publishing || unpublishing || !dirty} onClick={save}>{saving ? "Saving?" : "Save draft"}</button>
          <button type="button" className="visual-publish" disabled={!canPublish || saving || publishing || unpublishing || dirty} title={!canPublish ? "Owner or Publisher access required" : dirty ? "Save your draft before publishing" : "Publish the saved draft"} onClick={publish}>{publishing ? "Publishing?" : "Publish"}</button>
          <button type="button" onClick={logout} disabled={saving || publishing || unpublishing}>Sign out</button>
          <div className="visual-save-status" role="status" aria-live="polite">{statusIsError ? status : saving ? "Saving draft?" : publishing ? "Publishing?" : dirty ? "Unsaved changes" : `Draft saved ? ${publicEnabled ? "Published r" + publishedRevision : "Site unpublished"}`}{livePreviewBusy && " ? Updating view"}</div>
        </div>
      )}
      {!editorPreview && window.PortfolioVisualEditor && React.createElement(window.PortfolioVisualEditor, {
        enabled: !drawerOpen, canEdit, onSelect: selectElement,
      })}
      {livePreviewError && <div className="visual-preview-error" role="alert">Preview: {livePreviewError} Your draft is retained. <button type="button" onClick={() => setDraft(adminClone(draft))}>Retry preview</button></div>}
      {drawerOpen && !editorPreview && <div className="visual-admin-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setDrawerOpen(false); }}>
      <div ref={dialogRef} className="admin-shell visual-admin-drawer" role="dialog" aria-modal="true" aria-labelledby="admin-panel-title">
        <header className="visual-drawer-header">
          <div><span className="admin-kicker">{selection ? "Edit on your website" : "Studio settings"}</span><h2 id="admin-panel-title">{selection?.label || ({ site: "Brand & settings", uploads: "Resources", graphic: "Graphic studio", webdev: "Software studio", cases: "Case studies", history: "Revision history", staff: "Staff access", data: "Technology & data", dashboard: "Publication overview" }[activeTab])}</h2></div>
          <button type="button" className="admin-secondary" aria-label="Close editor panel" onClick={() => setDrawerOpen(false)}>Close</button>
        </header>
        <div className="visual-drawer-navigation">
          <label>Manage content<select className="admin-select" value={activeTab} onChange={(event) => activateTab(event.target.value)}>
            {[["site", "Brand, navigation, contact & SEO"], ["graphic", "Graphic studio"], ["webdev", "Software studio"], ["cases", "Case studies"], ["uploads", "Resources"], ["history", "Revision history"], ["data", "Technology & data"], ["dashboard", "Publication overview"], ...(canManageStaff ? [["staff", "Staff access"]] : [])].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <div className="visual-drawer-actions">
            <button type="button" className="admin-secondary" disabled={saving || publishing || unpublishing} onClick={reloadDraft}>Reload saved draft</button>
            <button type="button" className="admin-secondary" disabled={!canEdit || !dirty || saving || publishing} onClick={() => { if (!window.confirm("Discard unsaved changes and return to the saved draft?")) return; mutationVersionRef.current += 1; setDraft(adminClone(savedDraft)); setDirty(false); setFieldErrors({}); }}>Discard changes</button>
            <button type="button" className="admin-secondary" onClick={requestClose}>Leave editor</button>
            {activeTab === "dashboard" && canPublish && publicEnabled && <button type="button" className="admin-danger" disabled={saving || publishing || unpublishing} onClick={unpublishSite}>Unpublish site</button>}
          </div>
          {selection && <button type="button" className="admin-secondary" onClick={() => setSelection(null)}>Show all fields in this section</button>}
        </div>
        <main className="admin-main" id="admin-tabpanel">
          {selection?.action === "media" && mediaLocation ? (
            <fieldset className="admin-editor-fieldset" disabled={!canEdit}>
              <AdminImageUpload label={selection.label || "Replace image"} value={mediaLocation.value || ""} altText={mediaLocation.record[mediaAltKey] || ""} onAltTextChange={(value) => updateSelectedMedia(value, true)} onChange={(value) => updateSelectedMedia(value, false)} />
              <p className="admin-note">Upload a replacement or reuse a verified resource. Changes stay in your draft until saved and published.</p>
            </fieldset>
          ) : <>
          {!canEdit && (
            <div className="admin-error" style={{ margin: "0 0 16px" }}>
              Viewer access is read-only. You can inspect content, uploads, and history but cannot change them.
            </div>
          )}

          {activeTab === "dashboard" && (
            <AdminDashboard
              draft={draft}
              published={publishedContent}
              profile={profile}
              draftRevision={draftRevision}
              publishedRevision={publishedRevision}
              publishedAt={publishedAt}
              publicEnabled={publicEnabled}
              onNavigate={activateTab}
            />
          )}

          {activeTab === "site" && (
            <fieldset className="admin-editor-fieldset" disabled={!canEdit}>
            <section className="admin-section" id="admin-section-site">
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
              </div>

              <div className="admin-subsection">
                <div className="admin-subsection-head"><h4>Contact details</h4></div>
                <div className="admin-grid two">
                  <AdminText label="Contact email" type="email" value={draft.site.contact?.email || draft.site.contactEmail} required error={fieldErrors["site.contact.email"]} onChange={(value) => updateContact("email", value)} />
                  <AdminText label="Phone" value={draft.site.contact?.phone} onChange={(value) => updateContact("phone", value)} />
                  <AdminText label="Location / availability" value={draft.site.contact?.location} onChange={(value) => updateContact("location", value)} />
                </div>
              </div>

              <div className="admin-subsection">
                <div className="admin-subsection-head"><h4>Search and sharing</h4></div>
                <AdminText label="Meta title" value={draft.site.seo?.title || draft.site.metaTitle} required error={fieldErrors["site.seo.title"]} onChange={(value) => updateSeo("title", value)} />
                <AdminText label="Meta description" value={draft.site.seo?.description || draft.site.metaDescription} textarea onChange={(value) => updateSeo("description", value)} />
                <AdminText label="Keywords, comma separated" value={adminTagsToText(draft.site.seo?.keywords)} onChange={(value) => updateSeo("keywords", adminTextToTags(value))} />
                <div className="admin-grid two">
                  <AdminText label="Canonical URL" value={draft.site.seo?.canonicalUrl} placeholder="https://..." error={fieldErrors["site.seo.canonicalUrl"]} onChange={(value) => updateSeo("canonicalUrl", value)} />
                  <AdminSelect
                    label="Search indexing"
                    value={draft.site.seo?.noIndex ? "no" : "yes"}
                    options={[{ value: "yes", label: "Allow indexing" }, { value: "no", label: "No index" }]}
                    onChange={(value) => updateSeo("noIndex", value === "no")}
                  />
                </div>
                <AdminImageUpload label="Social sharing image" value={draft.site.seo?.ogImage || ""} onChange={(value) => updateSeo("ogImage", value)} />
                {fieldErrors["site.seo.canonicalUrl"] && <div className="admin-inline-error" role="alert">Canonical URL: {fieldErrors["site.seo.canonicalUrl"]}</div>}
                {fieldErrors["site.seo.ogImage"] && <div className="admin-inline-error" role="alert">Sharing image: {fieldErrors["site.seo.ogImage"]}</div>}
              </div>

              <div className="admin-subsection" id="admin-section-site-seo-pages">
                <div className="admin-subsection-head">
                  <div><h4>SEO by public page</h4><p>Optional values override the global metadata for each route.</p></div>
                </div>
                <div className="admin-seo-pages">
                  {ADMIN_SEO_PAGES.map(([page, label]) => (
                    <AdminSeoFields
                      key={page}
                      title={`${label} page`}
                      seo={draft.site.seo?.pages?.[page] || {}}
                      errors={fieldErrors}
                      errorPrefix={`site.seo.pages.${page}`}
                      onChange={(key, value) => updatePageSeo(page, key, value)}
                    />
                  ))}
                </div>
              </div>

              <AdminNavigationEditor items={draft.site.navigation || []} onChange={updateNavigation} errors={fieldErrors} />
              <AdminSocialLinksEditor items={draft.site.socialLinks || []} onChange={updateSocialLinks} errors={fieldErrors} />

              <div className="admin-subsection">
                <div className="admin-subsection-head"><h4>Footer</h4></div>
                <div className="admin-grid two">
                  <AdminText label="Eyebrow" value={draft.site.footer?.eyebrow} onChange={(value) => updateFooter("eyebrow", value)} />
                  <AdminText label="Contact button" value={draft.site.footer?.contactLabel} onChange={(value) => updateFooter("contactLabel", value)} />
                </div>
                <AdminText label="Tagline" value={draft.site.footer?.tagline} textarea onChange={(value) => updateFooter("tagline", value)} />
                <AdminText label="Copyright" value={draft.site.footer?.copyright} onChange={(value) => updateFooter("copyright", value)} />
              </div>

              <div className="admin-subsection">
                <div className="admin-subsection-head"><h4>GitHub integration</h4></div>
                <div className="admin-grid two">
                  <AdminSelect
                    label="Enabled"
                    value={draft.integrations?.github?.enabled === false ? "no" : "yes"}
                    options={[{ value: "yes", label: "Enabled" }, { value: "no", label: "Disabled" }]}
                    onChange={(value) => updateGithubIntegration("enabled", value === "yes")}
                  />
                  <AdminText label="Username" value={draft.integrations?.github?.username} onChange={(value) => updateGithubIntegration("username", value)} />
                  <AdminText label="Section eyebrow" value={draft.integrations?.github?.eyebrow} onChange={(value) => updateGithubIntegration("eyebrow", value)} />
                  <AdminText label="Section title" value={draft.integrations?.github?.title} onChange={(value) => updateGithubIntegration("title", value)} />
                  <AdminText label="Link label" value={draft.integrations?.github?.linkLabel} onChange={(value) => updateGithubIntegration("linkLabel", value)} />
                  <AdminText label="Project limit" type="number" value={draft.integrations?.github?.limit} onChange={(value) => updateGithubIntegration("limit", Number(value) || 12)} />
                </div>
              </div>
            </section>
            </fieldset>
          )}

          {activeTab === "graphic" && (
            <fieldset className="admin-editor-fieldset" disabled={!canEdit}>
            <AdminStudioEditor
              side="graphic"
              draft={draft}
              updateStudio={updateStudio}
              updateStudioStats={updateStudioStats}
              updateService={updateService}
              addService={addService}
              removeService={removeService}
              moveService={moveService}
              duplicateService={duplicateService}
              updateCategoryProject={updateCategoryProject}
              addCategoryProject={addCategoryProject}
              removeCategoryProject={removeCategoryProject}
              moveCategoryProject={moveCategoryProject}
              duplicateCategoryProject={duplicateCategoryProject}
              updateWork={updateWork}
              addWork={addWork}
              removeWork={removeWork}
              moveWork={moveWork}
              duplicateWork={duplicateWork}
              fieldErrors={fieldErrors}
              firstErrorPath={Object.keys(fieldErrors)[0] || ""}
            />
            </fieldset>
          )}

          {activeTab === "webdev" && (
            <fieldset className="admin-editor-fieldset" disabled={!canEdit}>
            <AdminStudioEditor
              side="webdev"
              draft={draft}
              updateStudio={updateStudio}
              updateStudioStats={updateStudioStats}
              updateService={updateService}
              addService={addService}
              removeService={removeService}
              moveService={moveService}
              duplicateService={duplicateService}
              updateCategoryProject={updateCategoryProject}
              addCategoryProject={addCategoryProject}
              removeCategoryProject={removeCategoryProject}
              moveCategoryProject={moveCategoryProject}
              duplicateCategoryProject={duplicateCategoryProject}
              updateWork={updateWork}
              addWork={addWork}
              removeWork={removeWork}
              moveWork={moveWork}
              duplicateWork={duplicateWork}
              fieldErrors={fieldErrors}
              firstErrorPath={Object.keys(fieldErrors)[0] || ""}
            />
            </fieldset>
          )}

          {activeTab === "cases" && (
            <fieldset className="admin-editor-fieldset" disabled={!canEdit}>
            <AdminCasesEditor
              draft={draft}
              updateCase={updateCase}
              updateCaseSeo={updateCaseSeo}
              linkCaseProject={linkCaseProject}
              updateCaseInfo={updateCaseInfo}
              updateCaseResult={updateCaseResult}
              addCase={addCase}
              duplicateCase={duplicateCase}
              removeCase={removeCase}
              fieldErrors={fieldErrors}
              firstErrorPath={Object.keys(fieldErrors)[0] || ""}
              onCaseSelect={(selectedCaseId, caseData) => {
                setPreviewTarget((current) => (
                  current.caseId === (caseData.project_id || selectedCaseId) && current.view === caseData.side && current.section == null
                    ? current
                    : { view: caseData.side === "webdev" ? "webdev" : "graphic", caseId: caseData.project_id || selectedCaseId, section: null }
                ));
              }}
            />
            </fieldset>
          )}

          {activeTab === "uploads" && (
            <AdminUploadsPage
              setStatus={setStatus}
              canManage={canEdit}
              workingReferences={adminCollectMediaReferences(draft)}
            />
          )}

          {activeTab === "history" && (
            <div id="admin-section-history">
              <AdminHistoryPage
                draftRevision={draftRevision}
                canRestore={canPublish}
                setStatus={setStatus}
                onRestored={(result) => {
                  const nextDraft = adminClone(result.draft);
                  setDraft(nextDraft);
                  setSavedDraft(adminClone(nextDraft));
                  setDraftRevision(result.draftRevision);
                  setLastSavedAt(result.updatedAt ? new Date(result.updatedAt) : new Date());
                  setFieldErrors({});
                  setDirty(false);
                }}
              />
            </div>
          )}

          {activeTab === "staff" && canManageStaff && (
            <AdminStaffPage
              currentUserId={profile.userId}
              setStatus={setStatus}
              onCurrentUserChanged={async (updated) => {
                if (updated?.is_active === false) {
                  await sb.auth.signOut().catch(() => {});
                  clearAccess();
                  setLoginError("Your staff access was deactivated. Sign in with an active account to continue.");
                  return;
                }
                const { data, error } = await sb.auth.getSession();
                if (error) throw error;
                if (!data?.session) throw new Error("Your admin session has expired.");
                await loadAuthorizedState(data.session, { hydrateDraft: false });
              }}
            />
          )}

          {activeTab === "data" && (
            <div id="admin-section-data">
              <AdminDataEditor
                draft={draft}
                setDraft={(next) => {
                  if (!canEdit) {
                    setStatus("Your viewer role is read-only.", true);
                    return;
                  }
                  setDraft(next);
                  setFieldErrors({});
                  setDirty(true);
                }}
                save={save}
                reset={reset}
                setStatus={setStatus}
                canEdit={canEdit}
              />
            </div>
          )}
          </>}
        </main>
      </div>
      </div>}
      {status && !editorPreview && (
        <div
          className={"admin-toast" + (statusIsError ? " error" : "")}
          role={statusIsError ? "alert" : "status"}
          aria-live={statusIsError ? "assertive" : "polite"}
        >
          <span>{status}</span>
          <button type="button" className="admin-toast-close" aria-label="Dismiss notification" onClick={() => setStatusState("")}>×</button>
        </div>
      )}
    </div>
    </ADMIN_MEDIA_PERMISSIONS.Provider>
  );
}

window.PortfolioAdminPanel = AdminPanel;
