const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (status, message) => new Response(JSON.stringify({ message }), { status, headers });

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return reply(403, 'This request is not allowed.');
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) return reply(415, 'JSON is required.');
  if (Number(request.headers.get('Content-Length') || 0) > 8000) return reply(413, 'Feedback is too long.');

  let body;
  try { body = await request.text(); } catch { return reply(400, 'Could not read feedback.'); }
  if (body.length > 8000) return reply(413, 'Feedback is too long.');
  let data;
  try { data = JSON.parse(body); } catch { return reply(400, 'Invalid feedback.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, 'Invalid feedback.');
  // A hidden field catches basic automated submissions without sending mail.
  if (data.website) return reply(200, 'Thank you.');

  const labels = [
    ['overall', 'Overall stay'],
    ['cleanliness', 'Cleanliness'],
    ['service', 'Customer service'],
    ['comfort', 'Comfort']
  ];
  const scores = {};
  for (const [key] of labels) {
    const value = Number(data[key]);
    if (!Number.isInteger(value) || value < 1 || value > 5) return reply(400, 'All four star ratings are required.');
    scores[key] = value;
  }
  if (typeof data.comment !== 'string' || data.comment.length > 3000 ||
      typeof data.name !== 'string' || data.name.length > 100) return reply(400, 'Feedback is too long.');
  const comment = data.comment.trim() || '(No written comment)';
  const guest = data.name.trim() || '(Not provided)';

  // Configure these in the Cloudflare Pages project, never in public website files.
  if (!env.RESEND_API_KEY || !env.SURVEY_FROM_EMAIL) return reply(503, 'Survey email is not configured yet.');
  const subject = `ProHouse guest survey — ${scores.overall}/5 overall`;
  const text = [
    'New private guest feedback from prohouse.com.au/survey', '',
    ...labels.map(([key, label]) => `${label}: ${scores[key]} / 5 stars`),
    '', `Guest name: ${guest}`, '', 'Guest comments:', comment, '',
    `Received: ${new Date().toISOString()}`
  ].join('\n');
  try {
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.SURVEY_FROM_EMAIL,
        to: ['hi@prohouse.com.au'],
        subject,
        text
      })
    });
    if (!sent.ok) return reply(502, 'Email service could not accept this feedback.');
    return reply(200, 'Thank you for your feedback.');
  } catch {
    return reply(502, 'Email service is temporarily unavailable.');
  }
}

export function onRequestGet() {
  return reply(405, 'Use the guest survey page to send feedback.');
}
