const q=(env,sql,...args)=>env.CLEANER_DB.prepare(sql).bind(...args);
const reply=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
export async function evidenceList(env,id){return (await q(env,'SELECT id,service_date,caption,size,uploaded FROM vendor_service_photos WHERE agreement_id=? ORDER BY service_date DESC,uploaded DESC LIMIT 200',id).all()).results;}
export async function serviceEvidence(req,env,a,user,isAdmin,action){
 const match=action.match(/^evidence\/file\/([a-f0-9-]{36})$/);
 if(match&&req.method==='GET'){
  const f=await q(env,'SELECT bytes,mime FROM vendor_service_photos WHERE agreement_id=? AND id=?',a.id,match[1]).first();if(!f)return reply({error:'Photo not found.'},404);
  return new Response(new Uint8Array(f.bytes),{headers:{'Content-Type':f.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="after-cleaning-photo"','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(action!=='evidence/upload'||req.method!=='POST')return reply({error:'Method not allowed.'},405);
 if(isAdmin||a.status!=='Completed')return reply({error:'Only the invited vendor may upload service photos after the agreement is completed.'},403);
 if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Invalid origin.'},403);
 const url=new URL(req.url),date=url.searchParams.get('date')||'',caption=url.searchParams.get('caption')||'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||!caption.trim()||caption.length>300)return reply({error:'Enter a valid service date and room / area description (up to 300 characters).'},400);
 const reader=req.body?.getReader();if(!reader)return reply({error:'Choose a photo.'},400);
 const chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>1048576){await reader.cancel();return reply({error:'Each photo must be no more than 1 MB. Send larger photos through WhatsApp.'},413);}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const png=[137,80,78,71,13,10,26,10];const mime=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':png.every((b,i)=>bytes[i]===b)?'image/png':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
 if(size<32||!mime)return reply({error:'Use a JPEG, PNG or WebP image.'},415);
 const id=crypto.randomUUID();const result=await q(env,"INSERT INTO vendor_service_photos(id,agreement_id,service_date,caption,mime,bytes,size,uploaded,owner) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM vendor_service_photos WHERE agreement_id=? AND service_date=?)<20 AND EXISTS(SELECT 1 FROM cleaner_agreements WHERE id=? AND status='Completed')",id,a.id,date,caption.trim(),mime,bytes.buffer,size,new Date().toISOString(),user.email,a.id,date,a.id).run();
 if(!result.meta.changes)return reply({error:'Up to 20 photos per service date may be stored. Send further evidence through WhatsApp.'},409);
 return reply({ok:true,id},201);
}
