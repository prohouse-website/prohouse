import {checkGuestInbox} from './guest-automation.js';
import { guestMessages } from './guest-messages.js';
import { onRequestPost } from './survey.js';
import { rentalV2 } from './rental-v2.js';
import rentalPage from '../public/operations/rental/index.html';
import { generateMutualLeaseDraft } from './longstay-lease.js';
import { prepareLease,leaseTemplateStatus,packetForAdmin,tenantPacket,leaseDocument,sendLease,tenantSign,tenantReportPayment,verifyLeasePayment,verifyPostSigningFunds,requestProviderOtp,signProvider,checkLeaseDeadlines } from './longstay-signing.js';
import { getLongStayReview, decideLongStayReview } from './longstay-review.js';
import { submitLongStayFirst, submitLongStaySecond, getLongStayInvitation, cleanupLongStayInvitations } from './longstay-workflow.js';
import { startSignatureHandoff, signatureHandoffStatus, saveMobileSignature, cleanupSignatureSessions } from './longstay-signature-handoff.js';
import { identityConfig,startTenantIdentity,tenantIdentityStatus,checkTenantIdentityReviews } from './longstay-identity.js';
import { cleanerPortal } from './cleaner-portal.js';
import { vendorAPI } from './vendor-proxy.js';
import { utilityPDF } from './utilities-pdf.js';
import { extractUtilityInvoice } from './utility-extraction.js';
import { usageEvent, sendShareBillDailySummary, logShareBillEvent } from './sharebill-analytics.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    // Serve the current Rental Portal from the same commit as its API.
    // Avoid stale static assets overriding admin sign-in and edit controls.
    if(path==='/operations/rental')return Response.redirect(url.origin+'/operations/rental/',308);
    if(path==='/operations/rental/'||path==='/operations/rental/index.html')
      return new Response(rentalPage,{headers:{
        'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'
      }});
    const canonicalAliases = {"/operations/livewithus": "/operations/livewithus/", "/operations/livewithus/index.html": "/operations/livewithus/", "/operations/livewithus/second": "/operations/livewithus/second/", "/operations/livewithus/second/index.html": "/operations/livewithus/second/", "/operations/livewithus/review": "/operations/livewithus/review/", "/operations/livewithus/review/index.html": "/operations/livewithus/review/", "/longstay/form/livewithus/second": "/longstay/form/livewithus/second/", "/longstay/form/livewithus/second/index.html": "/longstay/form/livewithus/second/", "/longstay/form/livewithus": "/longstay/form/livewithus/", "/longstay/form/livewithus/index.html": "/longstay/form/livewithus/", "/index.html": "/", "/stays": "/stays/", "/stays.html": "/stays/", "/stays/index.html": "/stays/", "/location": "/location/", "/location.html": "/location/", "/location/index.html": "/location/", "/properties": "/properties/", "/properties.html": "/properties/", "/properties/index.html": "/properties/", "/book": "/book/", "/book.html": "/book/", "/book/index.html": "/book/", "/owners": "/owners/", "/owners.html": "/owners/", "/owners/index.html": "/owners/", "/contact": "/contact/", "/contact.html": "/contact/", "/contact/index.html": "/contact/", "/why-prohouse": "/why-prohouse/", "/why-prohouse.html": "/why-prohouse/", "/why-prohouse/index.html": "/why-prohouse/", "/terms": "/terms/", "/terms.html": "/terms/", "/terms/index.html": "/terms/", "/privacy": "/privacy/", "/privacy.html": "/privacy/", "/privacy/index.html": "/privacy/", "/complaints": "/complaints/", "/complaints.html": "/complaints/", "/complaints/index.html": "/complaints/", "/sydney-airport-accommodation": "/sydney-airport-accommodation/", "/sydney-airport-accommodation.html": "/sydney-airport-accommodation/", "/sydney-airport-accommodation/index.html": "/sydney-airport-accommodation/", "/stays/room-1": "/stays/room-1/", "/stays/room-1.html": "/stays/room-1/", "/stays/room-1/index.html": "/stays/room-1/", "/stays/room-2": "/stays/room-2/", "/stays/room-2.html": "/stays/room-2/", "/stays/room-2/index.html": "/stays/room-2/", "/stays/room-3": "/stays/room-3/", "/stays/room-3.html": "/stays/room-3/", "/stays/room-3/index.html": "/stays/room-3/", "/terms-and-conditions/": "/terms/", "/terms-and-conditions": "/terms/", "/terms-and-conditions/index.html": "/terms/", "/privacy-policy/": "/privacy/", "/privacy-policy": "/privacy/", "/privacy-policy/index.html": "/privacy/", "/complaint-policy/": "/complaints/", "/complaint-policy": "/complaints/", "/complaint-policy/index.html": "/complaints/"};
    if ((url.hostname === 'prohouse.com.au' || url.hostname === 'www.prohouse.com.au') && (url.protocol !== 'https:' || url.hostname !== 'www.prohouse.com.au')) {
      url.protocol = 'https:'; url.hostname = 'www.prohouse.com.au';
      url.pathname = canonicalAliases[path] || path;
      return Response.redirect(url, 301);
    }
    if (path === '/operations/livewithus/' || path === '/operations/livewithus' || path === '/operations/livewithus/index.html') return Response.redirect(new URL('/operations/rental/' + url.search, url.origin), 302);
    if (path === '/operations/rental' || path === '/operations/rental/index.html' || path === '/operations/rental-v2' || path === '/operations/rental-v2/' || path === '/operations/rental-v2/index.html') return Response.redirect(new URL('/operations/rental/' + url.search, url.origin), 302);
    if (path.startsWith('/longstay/form/livewithus')) {
      const next=new URL(request.url);
      next.pathname=path.replace(/^\/longstay\/form\/livewithus/,'/operations/livewithus');
      return Response.redirect(next,301);
    }
    if (canonicalAliases[path]) return Response.redirect(new URL(canonicalAliases[path] + url.search, url.origin), 301);
    const aliases = {'/survey':'/review/','/survey/':'/review/','/survey/index.html':'/review/','/G015262/survey':'/G015262/review/','/G015262/survey/':'/G015262/review/','/G015262/survey/index.html':'/G015262/review/'};
    if (aliases[path]) return Response.redirect(new URL(aliases[path] + url.search, url.origin), 301);
    if (path === '/bill-calculator' || path === '/bill-calculator/' || path === '/bill-calculator/index.html') return Response.redirect(new URL('/operations/sharebill/' + url.search, url.origin), 301);
    if (path === '/operations' || path === '/operations/index.html') return Response.redirect(new URL('/operations/' + url.search, url.origin), 301);
    if (path === '/operations/sharebill' || path === '/operations/sharebill/index.html') return Response.redirect(new URL('/operations/sharebill/' + url.search, url.origin), 301);
    if (path === '/api/sharebill/usage') return usageEvent(request, env);
    if (path === '/api/utilities/pdf') {
      const response=await utilityPDF(request, env);
      if (response.ok && request.method==='POST') ctx?.waitUntil?.(logShareBillEvent(env,'pdf_download').catch(()=>{}));
      return response;
    }
    if (path === '/api/utilities/extract') {
      const response=await extractUtilityInvoice(request, env);
      if (response.ok && request.method==='POST') ctx?.waitUntil?.(logShareBillEvent(env,'scan').catch(()=>{}));
      return response;
    }
    if (path === '/api/longstay/application') return submitLongStayFirst(request, env);
    if (path === '/api/longstay/invitation') return getLongStayInvitation(request, env);
    if (path === '/api/longstay/coapplicant') return submitLongStaySecond(request, env);
    if (path === '/api/longstay/identity/config') return identityConfig(request,env);
    if (path === '/api/longstay/identity/start') return startTenantIdentity(request,env);
    if (path === '/api/longstay/identity/status') return tenantIdentityStatus(request,env);
    if (path === '/api/longstay/signature-session') return request.method==='POST'
      ? startSignatureHandoff(request,env) : signatureHandoffStatus(request,env);
    if (path === '/api/longstay/signature-save') return saveMobileSignature(request,env);
    if (path === '/api/longstay/lease-draft') return generateMutualLeaseDraft(request, env);
    if (path === '/api/longstay/lease-prepare') return prepareLease(request,env);
    if (path === '/api/longstay/lease-status') return packetForAdmin(request,env);
    if (path === '/api/longstay/lease-template-status') return leaseTemplateStatus(request,env);
    if (path === '/api/longstay/tenant') return tenantPacket(request,env);
    if (path === '/api/longstay/lease-pdf') return leaseDocument(request,env);
    if (path === '/api/longstay/lease-send') return sendLease(request,env);
    if (path === '/api/longstay/tenant-sign') return tenantSign(request,env);
    if (path === '/api/longstay/tenant-payment') return tenantReportPayment(request,env);
    if (path === '/api/longstay/payment-verify') return verifyLeasePayment(request,env);
    if (path === '/api/longstay/postsign-verify') return verifyPostSigningFunds(request,env);
    if (path === '/api/longstay/provider-otp') return requestProviderOtp(request,env);
    if (path === '/api/longstay/provider-sign') return signProvider(request,env);
    if (path === '/api/longstay/review') return request.method==='GET'
      ? getLongStayReview(request,env) : decideLongStayReview(request,env);
    if (path === '/api/survey') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
      return onRequestPost({ request, env });
    }
    if (path === '/cleaners' || path.startsWith('/cleaners/') || path === '/vendors') {
      const target = new URL(request.url);
      target.pathname = path.replace(/^\/cleaners(?=\/|$)/, '/vendors');
      if (target.pathname === '/vendors') target.pathname = '/vendors/';
      return Response.redirect(target, 301);
    }
    if (path.startsWith('/api/cleaners/') || path.startsWith('/api/vendors/')) {
      const upstream = env.VENDOR_PORTAL_ORIGIN;
      if (upstream && new URL(upstream).origin !== url.origin) return vendorAPI(request, upstream);
      return cleanerPortal(request, env);
    }
    if (path.startsWith('/vendors/')) {
      const assetURL=new URL(request.url);assetURL.pathname=path.replace(/^\/vendors\//,'/cleaners/');
      const asset = await env.ASSETS.fetch(new Request(assetURL,request));
      const response = new Response(asset.body, asset);
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return response;
    }
    if (path.startsWith('/api/guest-messages/')) {
      return guestMessages(request, env, async () => {
        const me = new Request(new URL('/api/rental-v2/owner/me', url), {headers:request.headers});
        return (await rentalV2(me, env)).ok;
      });
    }
    if (path.startsWith('/api/rental-v2/')) return rentalV2(request,env);
    if (path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    if (_event.cron === "*/5 * * * *") {
      ctx.waitUntil(checkGuestInbox(env));
      return;
    }
    ctx.waitUntil(checkLeaseDeadlines(env).catch(e=>console.error('Lease expiry check failed',e?.message)));
    ctx.waitUntil(checkTenantIdentityReviews(env).catch(e=>console.warn('Didit review alerts sweep failed',e?.message)));
    ctx.waitUntil(cleanupLongStayInvitations(env));
    ctx.waitUntil(cleanupSignatureSessions(env).catch(e=>console.warn('Signature session cleanup failed',e?.message)));
    if(_event.cron==='0 * * * *')return;
    ctx.waitUntil(sendShareBillDailySummary(env).then(out=>{
      if(!out.sent && out.reason!=='Already emailed')
        console.warn('Share Bill daily email was not sent:',out.reason);
    }).catch(()=>console.warn('Share Bill daily email encountered an error')));
  }
};
