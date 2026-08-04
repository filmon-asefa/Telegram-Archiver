import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);

const MEDIA_ROOT = path.resolve(
  process.env.ARCHIVER_MEDIA_ROOT ||
    path.join(process.cwd(), "..", "data", "media")
);

// Cached transcodes for audio Safari can't play natively (Opus-in-Ogg voice).
const AUDIO_CACHE_DIR = path.join(path.dirname(MEDIA_ROOT), "media_cache");
const TRANSCODABLE_AUDIO = new Set([".ogg", ".oga", ".opus"]);

function cacheKeyFor(file: string): string {
  return createHash("sha1").update(file).digest("hex");
}

async function transcodeAudio(file: string): Promise<string | null> {
  const cachePath = path.join(AUDIO_CACHE_DIR, `${cacheKeyFor(file)}.m4a`);
  if (fs.existsSync(cachePath)) return cachePath;

  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
  const tmp = `${cachePath}.${process.pid}.tmp`;
  try {
    await execFileAsync("afconvert", ["-f", "m4af", "-d", "aac", file, tmp], {
      timeout: 60000,
    });
    fs.renameSync(tmp, cachePath);
    return cachePath;
  } catch {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".tgs": "application/x-tgsticker",
};

function resolveFile(pathParts: string[]): string | null {
  const joined = decodeURIComponent(path.join(...pathParts));

  // Try relative to MEDIA_ROOT (future: DB stores rel paths like "2025/July/...")
  const viaRoot = path.resolve(MEDIA_ROOT, joined);
  if (fs.existsSync(viaRoot) && fs.statSync(viaRoot).isFile()) return viaRoot;

  // Try with data/media/ prefix stripped (old relative format)
  if (joined.startsWith("data/media/")) {
    const stripped = joined.slice("data/media/".length);
    const viaStrip = path.resolve(MEDIA_ROOT, stripped);
    if (fs.existsSync(viaStrip) && fs.statSync(viaStrip).isFile()) return viaStrip;
  }

  // Try as absolute path (current DB stores absolute paths like /Users/.../data/media/...)
  const asAbsolute = path.resolve("/", joined);
  if (fs.existsSync(asAbsolute) && fs.statSync(asAbsolute).isFile()) return asAbsolute;

  // Try as-is (for paths like data/media/... relative to cwd)
  const asCwd = path.resolve(joined);
  if (fs.existsSync(asCwd) && fs.statSync(asCwd).isFile()) return asCwd;

  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathParts } = await params;
  const resolved = resolveFile(pathParts);

  if (!resolved) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Security: only allow files under MEDIA_ROOT or absolute paths within the project
  const projectRoot = path.resolve(process.cwd(), "..");
  if (!resolved.startsWith(MEDIA_ROOT) && !resolved.startsWith(projectRoot)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Voice messages are Opus-in-Ogg, which Safari cannot decode. Transcode to
  // AAC (.m4a) on demand and serve that instead (cached for repeat requests).
  let servePath = resolved;
  const ext = path.extname(resolved).toLowerCase();
  if (TRANSCODABLE_AUDIO.has(ext)) {
    const transcoded = await transcodeAudio(resolved);
    if (transcoded) {
      servePath = transcoded;
    }
  }

  const stat = fs.statSync(servePath);
  const finalExt = path.extname(servePath).toLowerCase();
  const contentType =
    (TRANSCODABLE_AUDIO.has(ext) && servePath !== resolved
      ? "audio/mp4"
      : MIME_MAP[finalExt]) || "application/octet-stream";
  const fileSize = stat.size;

  // Support Range requests for media playback (audio/video seeking)
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (start >= fileSize) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${fileSize}` },
      });
    }
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(servePath, { start, end });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);
    return new NextResponse(body, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Type": contentType,
        "Content-Length": String(chunkSize),
        "Cache-Control": "public, max-age=86400, immutable",
        "Accept-Ranges": "bytes",
      },
    });
  }

  const buffer = fs.readFileSync(servePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(fileSize),
      "Cache-Control": "public, max-age=86400, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
