import { onRequestPost } from './survey.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const aliases = {'/survey':'/review/','/survey/':'/review/','/survey/index.html':'/review/','/G015262/survey':'/G015262/review/','/G015262/survey/':'/G015262/review/','/G015262/survey/index.html':'/G015262/review/'};
    if (aliases[path]) return Response.redirect(new URL(aliases[path] + url.search, url.origin), 301);
    if (path === '/api/survey') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
      return onRequestPost({ request, env });
    }
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
