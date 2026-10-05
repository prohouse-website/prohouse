import { onRequestPost } from './survey.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/survey') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
      return onRequestPost({ request, env });
    }
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
