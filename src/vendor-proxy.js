// Keep the existing agreement store and verification setup behind the branded URL.
export async function vendorAPI(request, upstreamOrigin) {
  const url = new URL(request.url);
  const upstream = new URL(upstreamOrigin);
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (unsafe && request.headers.get('Origin') !== url.origin) {
    return Response.json({ error: 'Invalid request origin.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  upstream.pathname = url.pathname;
  upstream.search = url.search;
  const headers = new Headers(request.headers);
  headers.delete('Host');
  headers.delete('Referer');
  headers.delete('Cloudflare-Workers-Version-Overrides');
  // Only forward the portal's session, never unrelated website cookies.
  const session = (headers.get('Cookie') || '').split(';').map(c => c.trim()).find(c => c.startsWith('ph_cleaner_session='));
  headers.delete('Cookie');
  if (session) headers.set('Cookie', session);
  if (unsafe) headers.set('Origin', upstream.origin);
  try {
    const result = await fetch(new Request(upstream, new Request(request, { headers, redirect: 'manual' })));
    const response = new Response(result.body, result);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    const location = response.headers.get('Location');
    if (location) {
      const target = new URL(location, upstream);
      if (target.origin === upstream.origin) {
        target.protocol = url.protocol;
        target.host = url.host;
        response.headers.set('Location', target.href);
      }
    }
    return response;
  } catch {
    return Response.json({ error: 'Partner portal temporarily unavailable. Please try again.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
