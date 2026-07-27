import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const MEDIA_ROOT = path.resolve(
  process.env.ARCHIVER_MEDIA_ROOT ||
    path.join(process.cwd(), "..", "data", "media")
);

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathParts } = await params;
  let relativePath = decodeURIComponent(path.join(...pathParts));

  // The DB stores paths like "data/media/2025/..." — strip the prefix
  if (relativePath.startsWith("data/media/")) {
    relativePath = relativePath.slice("data/media/".length);
  }

  const filePath = path.join(MEDIA_ROOT, relativePath);

  // Security: ensure the resolved path is within MEDIA_ROOT
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(MEDIA_ROOT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stat = fs.statSync(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_MAP[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(resolved);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
