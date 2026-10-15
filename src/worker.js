import { onRequestPost } from './survey.js';
import { cleanerPortal } from './cleaner-portal.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const canonicalAliases = {"/index.html": "/", "/stays": "/stays/", "/stays.html": "/stays/", "/stays/index.html": "/stays/", "/location": "/location/", "/location.html": "/location/", "/location/index.html": "/location/", "/properties": "/properties/", "/properties.html": "/properties/", "/properties/index.html": "/properties/", "/book": "/book/", "/book.html": "/book/", "/book/index.html": "/book/", "/owners": "/owners/", "/owners.html": "/owners/", "/owners/index.html": "/owners/", "/contact": "/contact/", "/contact.html": "/contact/", "/contact/index.html": "/contact/", "/why-prohouse": "/why-prohouse/", "/why-prohouse.html": "/why-prohouse/", "/why-prohouse/index.html": "/why-prohouse/", "/terms": "/terms/", "/terms.html": "/terms/", "/terms/index.html": "/terms/", "/privacy": "/privacy/", "/privacy.html": "/privacy/", "/privacy/index.html": "/privacy/", "/complaints": "/complaints/", "/complaints.html": "/complaints/", "/complaints/index.html": "/complaints/", "/sydney-airport-accommodation": "/sydney-airport-accommodation/", "/sydney-airport-accommodation.html": "/sydney-airport-accommodation/", "/sydney-airport-accommodation/index.html": "/sydney-airport-accommodation/", "/stays/room-1": "/stays/room-1/", "/stays/room-1.html": "/stays/room-1/", "/stays/room-1/index.html": "/stays/room-1/", "/stays/room-2": "/stays/room-2/", "/stays/room-2.html": "/stays/room-2/", "/stays/room-2/index.html": "/stays/room-2/", "/stays/room-3": "/stays/room-3/", "/stays/room-3.html": "/stays/room-3/", "/stays/room-3/index.html": "/stays/room-3/", "/terms-and-conditions/": "/terms/", "/terms-and-conditions": "/terms/", "/terms-and-conditions/index.html": "/terms/", "/privacy-policy/": "/privacy/", "/privacy-policy": "/privacy/", "/privacy-policy/index.html": "/privacy/", "/complaint-policy/": "/complaints/", "/complaint-policy": "/complaints/", "/complaint-policy/index.html": "/complaints/"};
    if ((url.hostname === 'prohouse.com.au' || url.hostname === 'www.prohouse.com.au') && (url.protocol !== 'https:' || url.hostname !== 'www.prohouse.com.au')) {
      url.protocol = 'https:'; url.hostname = 'www.prohouse.com.au';
      url.pathname = canonicalAliases[path] || path;
      return Response.redirect(url, 301);
    }
    if (canonicalAliases[path]) return Response.redirect(new URL(canonicalAliases[path] + url.search, url.origin), 301);
    const aliases = {'/survey':'/review/','/survey/':'/review/','/survey/index.html':'/review/','/G015262/survey':'/G015262/review/','/G015262/survey/':'/G015262/review/','/G015262/survey/index.html':'/G015262/review/'};
    if (aliases[path]) return Response.redirect(new URL(aliases[path] + url.search, url.origin), 301);
    if (path === '/api/survey') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
      return onRequestPost({ request, env });
    }
    if (path === '/cleaners') return Response.redirect(new URL('/cleaners/' + url.search, url.origin), 302);
    if (path.startsWith('/api/cleaners/')) return cleanerPortal(request, env);
    if (path === '/cleaners/' || path.startsWith('/cleaners/')) {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return response;
    }
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
