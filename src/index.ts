import { createRouter } from './router';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const router = createRouter();
    return router.fetch(request, env);
  },
};

export type { Env };
