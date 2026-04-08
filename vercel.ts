import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'next build',
  headers: [
    routes.cacheControl('/api/card/(.*)', {
      public: true,
      maxAge: '1 hour',
      sMaxAge: '1 day',
    }),
  ],
  crons: [
    // Refresh daily card cache at midnight UTC
    { path: '/api/cron/refresh-daily', schedule: '0 0 * * *' },
  ],
};

export default config;
