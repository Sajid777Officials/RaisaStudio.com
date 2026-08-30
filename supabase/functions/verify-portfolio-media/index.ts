import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  ImageMagick,
  MagickFormat,
  initializeImageMagick,
} from "npm:@imagemagick/magick-wasm@0.0.41";

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 6000;
const MAX_FRAME_PIXELS = 12_000_000;
const MAX_FRAMES = 120;
const MAX_TOTAL_PIXELS = 24_000_000;
const VERIFICATION_VERSION = 1;
const REQUEST_LIMIT = 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const magickReady = Deno.readFile(new URL("./magick.wasm", import.meta.url))
  .then((wasmBytes) => initializeImageMagick(wasmBytes));

class PublicError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Probe = { mimeType: string; width: number; height: number; declaredFrames: number };
type Decoded = { width: number; height: number; frameCount: number; totalPixels: number };

function configuredOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("PORTFOLIO_ALLOWED_ORIGINS") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => {
        try {
          const url = new URL(value);
          const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
          return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" && loopback));
        } catch {
          return false;
        }
      }),
  );
}

function responseHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(origin: string, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function readU24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function probePng(bytes: Uint8Array): Probe | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (ascii(bytes, 12, 4) !== "IHDR" || readU32BE(bytes, 8) !== 13) throw new PublicError(422, "Malformed PNG image.");
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  let declaredFrames = 1;
  let offset = 8;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32BE(bytes, offset);
    if (length > bytes.length - offset - 12) throw new PublicError(422, "Truncated PNG image.");
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL") {
      if (length !== 8) throw new PublicError(422, "Malformed animated PNG image.");
      declaredFrames = readU32BE(bytes, offset + 8);
    }
    offset += length + 12;
    if (type === "IEND") { sawEnd = true; break; }
  }
  if (!sawEnd || offset !== bytes.length) throw new PublicError(422, "PNG contains trailing or incomplete data.");
  return { mimeType: "image/png", width, height, declaredFrames };
}

function probeGif(bytes: Uint8Array): Probe | null {
  if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return null;
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  let offset = 13;
  const packed = bytes[10];
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;
  let sawTrailer = false;
  const skipBlocks = () => {
    while (offset < bytes.length) {
      const size = bytes[offset++];
      if (size === 0) return;
      if (size > bytes.length - offset) throw new PublicError(422, "Truncated GIF image.");
      offset += size;
    }
    throw new PublicError(422, "Truncated GIF image.");
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) { sawTrailer = true; break; }
    if (marker === 0x21) {
      if (offset >= bytes.length) throw new PublicError(422, "Truncated GIF image.");
      offset += 1;
      skipBlocks();
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) throw new PublicError(422, "Malformed GIF image.");
    frames += 1;
    const descriptorPacked = bytes[offset + 8];
    offset += 9;
    if (descriptorPacked & 0x80) offset += 3 * (1 << ((descriptorPacked & 0x07) + 1));
    if (offset >= bytes.length) throw new PublicError(422, "Truncated GIF image.");
    offset += 1;
    skipBlocks();
  }
  if (!sawTrailer || offset !== bytes.length || frames < 1) throw new PublicError(422, "GIF contains trailing or incomplete data.");
  return { mimeType: "image/gif", width, height, declaredFrames: frames };
}

function probeJpeg(bytes: Uint8Array): Probe | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawEnd = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new PublicError(422, "Malformed JPEG image.");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9) { sawEnd = true; break; }
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) throw new PublicError(422, "Truncated JPEG scan header.");
      const scanHeaderLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (scanHeaderLength < 2 || scanHeaderLength > bytes.length - offset) {
        throw new PublicError(422, "Malformed JPEG scan header.");
      }
      offset += scanHeaderLength;
      // Scan entropy-coded data while honoring byte stuffing and restart markers.
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const next = bytes[offset + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        if (next === 0xd9) { offset += 2; sawEnd = true; break; }
        break;
      }
      if (sawEnd) break;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new PublicError(422, "Truncated JPEG image.");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || length > bytes.length - offset) throw new PublicError(422, "Truncated JPEG image.");
    if (sof.has(marker)) {
      if (length < 7) throw new PublicError(422, "Malformed JPEG dimensions.");
      height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      width = (bytes[offset + 5] << 8) | bytes[offset + 6];
    }
    offset += length;
  }
  if (!sawEnd || offset !== bytes.length || width < 1 || height < 1) throw new PublicError(422, "JPEG contains trailing or incomplete data.");
  return { mimeType: "image/jpeg", width, height, declaredFrames: 1 };
}

function probeWebp(bytes: Uint8Array): Probe | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  const riffSize = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
  if (riffSize + 8 !== bytes.length) throw new PublicError(422, "WebP container length is invalid.");
  let offset = 12;
  let width = 0;
  let height = 0;
  let frames = 0;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = (bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24)) >>> 0;
    const data = offset + 8;
    if (size > bytes.length - data) throw new PublicError(422, "Truncated WebP image.");
    if (type === "VP8X" && size >= 10) {
      width = readU24LE(bytes, data + 4) + 1;
      height = readU24LE(bytes, data + 7) + 1;
    } else if (type === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      width = (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff;
      height = (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff;
    } else if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const bits = (bytes[data + 1] | (bytes[data + 2] << 8) | (bytes[data + 3] << 16) | (bytes[data + 4] << 24)) >>> 0;
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === "ANMF") {
      frames += 1;
    }
    offset = data + size + (size & 1);
  }
  if (offset !== bytes.length || width < 1 || height < 1) throw new PublicError(422, "Malformed WebP image.");
  return { mimeType: "image/webp", width, height, declaredFrames: Math.max(frames, 1) };
}

function enforceBounds(width: number, height: number, frames: number): void {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new PublicError(422, "Image dimensions are invalid.");
  }
  if (width > MAX_EDGE || height > MAX_EDGE || pixels > MAX_FRAME_PIXELS) {
    throw new PublicError(422, "Image exceeds the 6,000-pixel edge or 12-megapixel frame limit.");
  }
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > MAX_FRAMES || pixels * frames > MAX_TOTAL_PIXELS) {
    throw new PublicError(422, "Animation exceeds the frame or total-pixel limit.");
  }
}

function probe(bytes: Uint8Array): Probe {
  const result = probePng(bytes) || probeGif(bytes) || probeJpeg(bytes) || probeWebp(bytes);
  if (!result) throw new PublicError(415, "Only genuine PNG, JPEG, WebP, and GIF images are accepted.");
  enforceBounds(result.width, result.height, result.declaredFrames);
  return result;
}

async function fullyDecode(bytes: Uint8Array, preflight: Probe): Promise<Decoded> {
  await magickReady;
  let width = 0;
  let height = 0;
  let frameCount = 0;
  let totalPixels = 0;
  try {
    ImageMagick.readCollection(bytes, (images) => {
      images.forEach((image) => {
        const frameWidth = image.width;
        const frameHeight = image.height;
        enforceBounds(frameWidth, frameHeight, 1);
        frameCount += 1;
        totalPixels += frameWidth * frameHeight;
        if (frameCount > MAX_FRAMES || totalPixels > MAX_TOTAL_PIXELS) {
          throw new PublicError(422, "Animation exceeds the frame or total-pixel limit.");
        }
        if (frameCount === 1) { width = frameWidth; height = frameHeight; }
        // Encoding every decoded frame to raw RGBA forces a complete pixel read;
        // header-only parsing is never considered trusted verification.
        image.write(MagickFormat.Rgba, (pixels) => {
          if (pixels.length !== frameWidth * frameHeight * 4) {
            throw new PublicError(422, "Image pixels could not be decoded completely.");
          }
        });
      });
    });
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(422, "Image decoding failed.");
  }
  if (frameCount < 1 || width !== preflight.width || height !== preflight.height) {
    throw new PublicError(422, "Decoded image dimensions do not match its container.");
  }
  enforceBounds(width, height, frameCount);
  if (preflight.declaredFrames !== frameCount) {
    throw new PublicError(422, "Animation frame metadata is inconsistent.");
  }
  return { width, height, frameCount, totalPixels };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("Origin") || "";
  const origins = configuredOrigins();
  if (!origin || !origins.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin is not allowed.", request_id: requestId }), {
      status: 403,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "Vary": "Origin" },
    });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (request.method !== "POST") return json(origin, 405, { error: "Method not allowed.", request_id: requestId });

  try {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > REQUEST_LIMIT) throw new PublicError(413, "Request body is too large.");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > REQUEST_LIMIT) throw new PublicError(413, "Request body is too large.");
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { throw new PublicError(400, "Request body must be valid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
      throw new PublicError(400, "Request body must be an object.");
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== "assetId") throw new PublicError(400, "Only assetId is accepted.");
    const assetId = String((body as { assetId?: unknown }).assetId || "");
    if (!UUID_RE.test(assetId)) throw new PublicError(400, "assetId must be a UUID.");

    const authHeader = request.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authHeader)) throw new PublicError(401, "Authentication is required.");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error("Required Supabase secrets are unavailable");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) throw new PublicError(401, "Authentication is invalid or expired.");
    const { data: profile, error: profileError } = await userClient
      .from("admin_users")
      .select("role,is_active")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (profileError || !profile || !["owner", "publisher", "editor"].includes(profile.role)) {
      throw new PublicError(403, "Active editor access is required.");
    }

    const service = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: asset, error: assetError } = await service
      .from("portfolio_media_assets")
      .select("id,owner_id,status,mime_type,byte_size,staging_bucket,staging_path,legacy_upload_id")
      .eq("id", assetId)
      .maybeSingle();
    if (assetError || !asset) throw new PublicError(404, "Media asset was not found.");
    if (asset.legacy_upload_id || asset.staging_bucket !== "portfolio-media-drafts" || !asset.staging_path) {
      throw new PublicError(422, "Media asset has no canonical reserved object.");
    }
    if (!["reserved", "staged", "promoting", "published"].includes(asset.status)) {
      throw new PublicError(409, "Media asset is not in a verifiable state.");
    }
    if (asset.owner_id !== userData.user.id && !["owner", "publisher"].includes(profile.role)) {
      throw new PublicError(403, "Editors may verify only their own uploads.");
    }

    // The bucket/path always comes from the protected database row; no client
    // storage locator is accepted or interpolated.
    const { data: blob, error: downloadError } = await service.storage
      .from(asset.staging_bucket)
      .download(asset.staging_path);
    if (downloadError || !blob) throw new PublicError(422, "Reserved media bytes are unavailable.");
    if (blob.size < 1 || blob.size > MAX_BYTES || blob.size !== Number(asset.byte_size)) {
      throw new PublicError(422, "Media byte size does not match its reservation.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength !== blob.size) throw new PublicError(422, "Media bytes were truncated.");
    const preflight = probe(bytes);
    if (preflight.mimeType !== asset.mime_type) throw new PublicError(422, "Media type does not match its reservation.");
    const [decoded, checksum] = await Promise.all([fullyDecode(bytes, preflight), sha256(bytes)]);

    const { data: recorded, error: recordError } = await service.rpc("record_portfolio_media_verification", {
      p_asset_id: assetId,
      p_actor_id: userData.user.id,
      p_sha256: checksum,
      p_mime_type: preflight.mimeType,
      p_byte_size: bytes.byteLength,
      p_width: decoded.width,
      p_height: decoded.height,
      p_frame_count: decoded.frameCount,
      p_total_pixels: decoded.totalPixels,
      p_verification_version: VERIFICATION_VERSION,
    });
    if (recordError || !recorded) throw new Error(`Verification marker failed: ${recordError?.code || "unknown"}`);
    return json(origin, 200, recorded);
  } catch (error) {
    if (error instanceof PublicError) return json(origin, error.status, { error: error.message, request_id: requestId });
    console.error(JSON.stringify({ event: "portfolio_media_verification_failed", request_id: requestId, error: error instanceof Error ? error.message : "unknown" }));
    return json(origin, 500, { error: "Media verification failed.", request_id: requestId });
  }
});
