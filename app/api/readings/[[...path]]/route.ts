import { workerEnvironment } from '@/lib/worker-env';
import readingsWorker from '@/lib/legacy-worker.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function handle(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  if (path[0] === 'internal') return new Response('Not found', { status: 404 });
  const incoming = new URL(request.url);
  const target = new URL(`/${path.map(encodeURIComponent).join('/')}`, incoming.origin);
  target.search = incoming.search;
  const forwarded = new Request(target, request);
  return readingsWorker.fetch(forwarded, workerEnvironment());
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
