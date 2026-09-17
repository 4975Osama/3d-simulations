/**
 * POST /api/youtube/upload
 *
 * Accepts a multipart/form-data request containing a video file and
 * streams it directly to YouTube via the resumable upload API.
 *
 * The video binary is NEVER stored on disk — it is piped through the
 * server as a Node.js Readable stream. Only metadata (title, description,
 * YouTube video ID, category, etc.) is returned and stored.
 *
 * Protected by middleware — only admins can upload.
 *
 * ── Serverless limits ──────────────────────────────────────────────────
 * Large video uploads (>50 MB) can exceed serverless function timeouts.
 * For production with large files, deploy on a long-lived Node.js host
 * (VPS, Docker, Railway, Fly.io) instead.
 * ───────────────────────────────────────────────────────────────────────
 *
 * Expected form fields:
 *   - video:       File (video/*)
 *   - category:    string (simex | calendars | general)
 *   - title:       string (max 100 chars)
 *   - description: string (max 5000 bytes, optional)
 */

import { NextRequest, NextResponse } from 'next/server';
import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { isAdmin } from '@/lib/admin-auth';
import { hasRefreshToken } from '@/lib/google-auth';
import { CATEGORIES, uploadVideo, YouTubeApiError } from '@/lib/youtube';

// Disable Next.js body parsing — we handle it with busboy
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Max file size: 4 GB
const MAX_FILE_SIZE = 4 * 1024 ** 3;

export async function POST(request: NextRequest) {
  // Auth check (double-check in case middleware is bypassed)
  if (!isAdmin(request)) {
    return NextResponse.json(
      { error: 'Log in as admin to upload videos.' },
      { status: 401 }
    );
  }

  // YouTube config check
  if (!hasRefreshToken()) {
    return NextResponse.json(
      { error: "YouTube isn't connected — add your Google credentials to .env.local." },
      { status: 503 }
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Expected multipart/form-data.' },
      { status: 400 }
    );
  }

  // Parse the multipart body with busboy (streaming, no temp files)
  try {
    const { fields, fileStream, fileMeta } = await parseMultipart(request, contentType);

    // Validate fields
    const category = String(fields.category ?? '');
    const title = String(fields.title ?? '').trim();
    const description = String(fields.description ?? '').trim();

    if (!Object.hasOwn(CATEGORIES, category)) {
      return NextResponse.json({ error: 'Unknown video category.' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: 'Give the video a title.' }, { status: 400 });
    }
    if (title.length > 100) {
      return NextResponse.json({ error: 'Title must be 100 characters or fewer.' }, { status: 400 });
    }
    if (/[<>]/.test(title) || /[<>]/.test(description)) {
      return NextResponse.json(
        { error: "Title and description can't contain < or > characters." },
        { status: 400 }
      );
    }
    if (Buffer.byteLength(description) > 5000) {
      return NextResponse.json({ error: 'Description is too long (5000 bytes max).' }, { status: 400 });
    }

    if (!fileStream || !fileMeta) {
      return NextResponse.json({ error: 'Choose a video file to upload.' }, { status: 400 });
    }
    if (!fileMeta.mimeType.startsWith('video/')) {
      return NextResponse.json({ error: 'Only video files can be uploaded.' }, { status: 400 });
    }

    // Stream directly to YouTube — no file on disk
    const video = await uploadVideo({
      stream: fileStream,
      mimeType: fileMeta.mimeType,
      size: fileMeta.size,
      category,
      title,
      description,
    });

    return NextResponse.json({ video }, { status: 201 });
  } catch (err) {
    if (err instanceof YouTubeApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: `Upload failed: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}

// ── Multipart parser ────────────────────────────────────────────────────────

interface ParsedMultipart {
  fields: Record<string, string>;
  fileStream: Readable | null;
  fileMeta: { filename: string; mimeType: string; size: number } | null;
}

function parseMultipart(
  request: NextRequest,
  contentType: string
): Promise<ParsedMultipart> {
  return new Promise(async (resolve, reject) => {
    const fields: Record<string, string> = {};
    let fileStream: Readable | null = null;
    let fileMeta: { filename: string; mimeType: string; size: number } | null = null;

    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_FILE_SIZE) {
      return reject(new Error('Video is larger than the 4 GB limit.'));
    }

    const bb = Busboy({
      headers: { 'content-type': contentType },
      limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 5 },
    });

    bb.on('field', (name: string, val: string) => {
      fields[name] = val;
    });

    bb.on('file', (name: string, stream: Readable, info: { filename: string; encoding: string; mimeType: string }) => {
      fileMeta = {
        filename: info.filename,
        mimeType: info.mimeType,
        size: contentLength,
      };
      fileStream = stream;
    });

    bb.on('close', () => {
      resolve({ fields, fileStream, fileMeta });
    });

    bb.on('error', (err: Error) => {
      reject(err);
    });

    // Pipe the request body into busboy
    const body = request.body;
    if (!body) {
      return reject(new Error('No request body.'));
    }

    const reader = body.getReader();
    const nodeStream = new Readable({
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null);
          } else {
            this.push(Buffer.from(value));
          }
        } catch (err) {
          this.destroy(err as Error);
        }
      },
    });

    nodeStream.pipe(bb);
  });
}
