import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";
import { ImageMagick, MagickFormat, initializeImageMagick } from "@imagemagick/magick-wasm";

const source = await readFile(new URL("../supabase/functions/verify-portfolio-media/index.ts", import.meta.url), "utf8");
const wasmBytes = await readFile(new URL("../supabase/functions/verify-portfolio-media/magick.wasm", import.meta.url));
const functions = source.slice(source.indexOf("const MAX_BYTES"), source.indexOf("Deno.serve"))
  .replace(/const magickReady = [\s\S]*?;\n/, "const magickReady = initializeImageMagick(wasmBytes);\n");
const context = vm.createContext({ ImageMagick, MagickFormat, initializeImageMagick, wasmBytes, TextDecoder, TextEncoder, Uint8Array });
vm.runInContext((await transform(`${functions}\nglobalThis.verifier = { probe, fullyDecode, ${source.includes("async function readRequestBody") ? "readRequestBody" : ""} };`, { loader: "ts" })).code, context);
const { probe, fullyDecode } = context.verifier;
const gif = () => Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));

test("GIF frame rectangles are bounded before full decode", () => {
  const bytes = gif();
  const frame = bytes.indexOf(0x2c) + 1;
  bytes[frame + 4] = 0xff; bytes[frame + 5] = 0xff;
  assert.throws(() => probe(bytes), /frame|dimensions|canvas/i);
});

test("optimized GIF frames retain their logical canvas and fully decode", async () => {
  const bytes = gif();
  bytes[6] = 2; bytes[8] = 2;
  const result = await fullyDecode(bytes, probe(bytes));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { width: 2, height: 2, frameCount: 1, totalPixels: 4 });
});

test("valid PNG, JPEG, and WebP bytes fully decode with consistent dimensions", async () => {
  await fullyDecode(gif(), probe(gif()));
  for (const format of [MagickFormat.Png, MagickFormat.Jpeg, MagickFormat.WebP]) {
    let bytes;
    ImageMagick.read(gif(), (image) => image.write(format, (encoded) => { bytes = Uint8Array.from(encoded); }));
    const decoded = await fullyDecode(bytes, probe(bytes));
    assert.equal(decoded.width, 1);
    assert.equal(decoded.height, 1);
    assert.equal(decoded.frameCount, 1);
  }
});

test("animated PNG and WebP rectangles cannot hide oversized frames", () => {
  const chunk = (type, data) => {
    const value = Buffer.alloc(data.length + 12);
    value.writeUInt32BE(data.length); value.write(type, 4); data.copy(value, 8);
    return value;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4);
  const frame = Buffer.alloc(26); frame.writeUInt32BE(10000, 4); frame.writeUInt32BE(1, 8);
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("fcTL", frame), chunk("IEND", Buffer.alloc(0))]);
  assert.throws(() => probe(png), /frame|dimensions|canvas/i);
  const webp = Buffer.alloc(54);
  webp.write("RIFF"); webp.writeUInt32LE(webp.length - 8, 4); webp.write("WEBP", 8);
  webp.write("VP8X", 12); webp.writeUInt32LE(10, 16);
  webp.write("ANMF", 30); webp.writeUInt32LE(16, 34); webp.writeUIntLE(9999, 44, 3);
  assert.throws(() => probe(webp), /frame|dimensions|canvas/i);
});

test("request limit is enforced while reading chunked data", async () => {
  assert.equal(typeof context.verifier.readRequestBody, "function");
  let cancelled = false;
  const request = new Request("https://example.test", { method: "POST", duplex: "half", body: new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(800)); },
    cancel() { cancelled = true; },
  }) });
  await assert.rejects(context.verifier.readRequestBody(request), /too large/i);
  assert.equal(cancelled, true);
  assert.equal(await context.verifier.readRequestBody(new Request("https://example.test", { method: "POST", body: '{"assetId":"example"}' })), '{"assetId":"example"}');
});
