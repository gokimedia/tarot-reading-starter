import { db } from '@/lib/db';
import { workerEnvironment } from '@/lib/worker-env';
import readingsWorker from '@/lib/legacy-worker.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const scheduledTasks: Promise<unknown>[] = [];
  const context = {
    waitUntil(task: Promise<unknown>) {
      scheduledTasks.push(task);
    },
  };

  await readingsWorker.scheduled({ scheduledTime: Date.now() }, workerEnvironment(), context);
  const results = await Promise.allSettled(scheduledTasks);
  const cleanup = await db()`select deckaura.cleanup_expired_state(5000) as result`;
  const failed = results.filter((result) => result.status === 'rejected');

  return Response.json({
    ok: failed.length === 0,
    tasks: results.length,
    failed: failed.length,
    cleanup: cleanup[0]?.result || {},
  }, { status: failed.length ? 500 : 200 });
}
