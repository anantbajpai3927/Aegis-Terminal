import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { stripHtmlToText, validateExternalUrl } from '@/lib/pipeline-rules';
import type { GroundingResource, ResourceKind } from '@/lib/types';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB safe limit
const MAX_URL_BYTES = 2 * 1024 * 1024; // 2 MB HTML fetch cap

function inferKindFromMime(mimeType: string, fileName: string): ResourceKind {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mimeType.includes('wordprocessingml') ||
    mimeType === 'application/msword' ||
    lower.endsWith('.docx') ||
    lower.endsWith('.doc')
  ) {
    return 'doc';
  }
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'text';
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = (await req.json()) as { url?: string };
      const rawUrl = body.url ?? '';
      const validation = validateExternalUrl(rawUrl);

      if (!validation.valid || !validation.normalizedUrl) {
        return NextResponse.json(
          { error: validation.reason || 'Invalid URL' },
          { status: 400 },
        );
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      let extractedText = '';
      let pageTitle = validation.normalizedUrl;

      try {
        const res = await fetch(validation.normalizedUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'AegisTerminal-GroundingFetcher/1.0',
            Accept: 'text/html, text/plain, application/json;q=0.9',
          },
          redirect: 'follow',
        });

        // Re-validate final redirect destination to prevent SSRF via redirect
        const finalCheck = validateExternalUrl(res.url || validation.normalizedUrl);
        if (!finalCheck.valid) {
          return NextResponse.json(
            { error: 'Redirect target blocked by network safety policy.' },
            { status: 400 },
          );
        }

        if (!res.ok) {
          extractedText = `URL added (${res.status} ${res.statusText} on direct fetch; Gemini urlContext will attempt retrieval).`;
        } else {
          const buf = await res.arrayBuffer();
          const sliced = buf.byteLength > MAX_URL_BYTES ? buf.slice(0, MAX_URL_BYTES) : buf;
          const rawText = new TextDecoder().decode(sliced);
          const titleMatch = rawText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (titleMatch?.[1]) {
            pageTitle = titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 120);
          }
          const mime = res.headers.get('content-type') || 'text/html';
          extractedText = mime.includes('html')
            ? stripHtmlToText(rawText).slice(0, 25000)
            : rawText.slice(0, 25000);
        }
      } catch {
        extractedText = `URL registered for live urlContext retrieval (direct fetch timed out or blocked).`;
      } finally {
        clearTimeout(timeoutId);
      }

      const resource: GroundingResource = {
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: 'url',
        name: pageTitle,
        url: validation.normalizedUrl,
        mimeType: 'text/html',
        extractedText,
        byteSize: Buffer.byteLength(extractedText, 'utf8'),
        addedAt: Date.now(),
        enabled: true,
      };

      return NextResponse.json({ resource });
    }

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: 'File exceeds 8 MB maximum grounding size.' },
          { status: 400 },
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = file.type || 'application/octet-stream';
      const kind = inferKindFromMime(mimeType, file.name);

      let extractedText: string | undefined;
      let base64Data: string | undefined;

      if (kind === 'doc') {
        try {
          const result = await mammoth.extractRawText({ buffer });
          extractedText = result.value.trim().slice(0, 35000);
        } catch {
          extractedText = buffer.toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').slice(0, 25000);
        }
      } else if (kind === 'text') {
        extractedText = buffer.toString('utf8').slice(0, 35000);
      } else if (kind === 'pdf' || kind === 'image' || kind === 'video') {
        base64Data = buffer.toString('base64');
        extractedText = `Attached ${kind.toUpperCase()} document "${file.name}" (${Math.round(file.size / 1024)} KB) provided inline for multimodal verification.`;
      }

      const resource: GroundingResource = {
        id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        name: file.name,
        mimeType: kind === 'pdf' ? 'application/pdf' : mimeType,
        extractedText,
        base64Data,
        byteSize: file.size,
        addedAt: Date.now(),
        enabled: true,
      };

      return NextResponse.json({ resource });
    }

    return NextResponse.json(
      { error: 'Unsupported Content-Type. Use application/json or multipart/form-data.' },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to ingest grounding resource.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
