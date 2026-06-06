import { useCallback } from 'react';
import {
  generate as backendGenerate,
  type GenerateRequest,
  type GenerateResult,
  type GenerateError,
} from '../api/franklin';
import { IS_BROWSER_PAY } from './mode';
import { useX402Payment, parseX402FromResponse, type X402Response } from './x402';

// Browser-pay generation: mirrors the backend generate() but signs x402 with the
// VISITOR's wallet (web build). In local mode (desktop) it just delegates to the
// backend, which signs with the local wallet — so the same call site works in
// both builds. Requests go through the server's transparent /api/gw proxy.

const GW = '/api/gw';
const IMG_SIZE: Record<string, string> = {
  '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792', '4:3': '1024x768', '3:4': '768x1024',
};

type Pay = (r: X402Response) => Promise<{ payload: string | null; error: string | null }>;

function pickUrl(j: unknown): string | undefined {
  const o = j as { data?: { url?: string }[]; url?: string } | null;
  return o?.data?.[0]?.url || o?.url;
}

async function errText(res: Response): Promise<string> {
  try {
    const j = await res.clone().json();
    return (j as { error?: string }).error || `gateway ${res.status}`;
  } catch {
    return `gateway ${res.status}`;
  }
}

function buildRequest(req: GenerateRequest): { endpoint: string; body: string } {
  if (req.kind === 'image') {
    const edit = !!req.imageUrl;
    const images = req.imageUrl2 ? [req.imageUrl, req.imageUrl2] : req.imageUrl;
    const size = (req.aspectRatio && IMG_SIZE[req.aspectRatio]) || '1024x1024';
    const body = edit
      ? { model: req.model, prompt: req.prompt, image: images, size, n: 1 }
      : { model: req.model, prompt: req.prompt, size, n: 1, ...(req.quality ? { quality: req.quality } : {}) };
    return { endpoint: edit ? `${GW}/v1/images/image2image` : `${GW}/v1/images/generations`, body: JSON.stringify(body) };
  }
  if (req.kind === 'video') {
    const body = {
      model: req.model,
      prompt: req.prompt,
      ...(req.imageUrl ? { image_url: req.imageUrl } : {}),
      ...(req.imageUrl2 ? { last_frame_url: req.imageUrl2 } : {}),
      ...(req.referenceImageUrls?.length ? { reference_image_urls: req.referenceImageUrls } : {}),
      ...(req.durationS ? { duration_seconds: req.durationS } : {}),
      ...(req.aspectRatio ? { aspect_ratio: req.aspectRatio } : {}),
      ...(req.resolution ? { resolution: req.resolution } : {}),
      ...(typeof req.generateAudio === 'boolean' ? { generate_audio: req.generateAudio } : {}),
    };
    return { endpoint: `${GW}/v1/videos/generations`, body: JSON.stringify(body) };
  }
  // music
  const body = { model: req.model, prompt: req.prompt, ...(req.durationS ? { duration_seconds: req.durationS } : {}) };
  return { endpoint: `${GW}/v1/audio/generations`, body: JSON.stringify(body) };
}

// Async media (202 + poll_url). First poll is 402 → sign once, reuse for the rest.
async function pollJob(submitRes: Response, signal: AbortSignal | undefined, pay: Pay, kind: GenerateRequest['kind']): Promise<string | undefined> {
  const submit = await submitRes.json();
  const pollPath: string | undefined = submit.poll_url;
  if (!pollPath) return pickUrl(submit);
  const proxied = pollPath.startsWith('/api/gw') ? pollPath : `${GW}${pollPath.replace(/^.*\/api/, '')}`;
  let sig: string | null = null;
  const start = Date.now();
  const maxMs = kind === 'image' ? 180_000 : 300_000;
  while (Date.now() - start < maxMs) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const headers: Record<string, string> = {};
    if (sig) headers['X-Payment'] = sig;
    const r = await fetch(proxied, { headers, signal });
    if (r.status === 402 && !sig) {
      const reqs = parseX402FromResponse(r);
      if (!reqs) throw new Error('Poll missing payment requirements.');
      const { payload, error } = await pay(reqs);
      if (!payload) throw new Error(error || 'Wallet signature failed.');
      sig = payload;
      continue;
    }
    if (!r.ok) throw new Error(await errText(r));
    const j = await r.json();
    if (j.status === 'completed' || j.status === 'settled' || j.data) return pickUrl(j);
    await new Promise((res) => setTimeout(res, 4000));
  }
  throw new Error('Generation is taking too long — try again.');
}

export function useGenerate() {
  const { makePayment } = useX402Payment();

  return useCallback(
    async (req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult | GenerateError> => {
      // Desktop / local build: backend signs with the local wallet (unchanged).
      if (!IS_BROWSER_PAY) return backendGenerate(req, signal);

      // Web build: the visitor's wallet pays. 402 → sign → retry → (poll).
      try {
        const { endpoint, body } = buildRequest(req);
        const post = (extra?: Record<string, string>) =>
          fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(extra || {}) }, body, signal });

        let res = await post();
        if (res.status === 402) {
          const reqs = parseX402FromResponse(res);
          if (!reqs) return { ok: false, error: 'Could not read payment requirements.' };
          const { payload, error } = await makePayment(reqs);
          if (!payload) return { ok: false, error: error || 'Wallet signature failed.' };
          res = await post({ 'X-Payment': payload });
        }

        let url: string | undefined;
        if (res.status === 202) {
          url = await pollJob(res, signal, makePayment, req.kind);
        } else {
          if (!res.ok) return { ok: false, error: await errText(res) };
          url = pickUrl(await res.json());
        }
        if (!url) return { ok: false, error: 'No media came back from the model.' };
        return { ok: true, resultUrl: url };
      } catch (err) {
        if ((err as Error).name === 'AbortError') return { ok: false, error: 'cancelled' };
        return { ok: false, error: (err as Error).message || 'generation failed' };
      }
    },
    [makePayment],
  );
}
