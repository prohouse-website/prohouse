// Approved property FAQs. Reservation-specific facts stay in the live Hostex workflow.
async function prepare(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS guest_faq (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL COLLATE NOCASE UNIQUE, answer TEXT NOT NULL)').run();
}
export async function listFaqs(db) {
  await prepare(db);
  return (await db.prepare('SELECT id,question,answer FROM guest_faq ORDER BY id').all()).results;
}
export async function manageFaq(request,env) {
  const db=env.LONGSTAY_DB;
  const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if(request.method==='GET') return response({entries:await listFaqs(db)});
  if(request.method!=='POST') return response({error:'Use the teaching form.'},405);
  const body=await request.json();
  await prepare(db);
  if(body.id!=null && (!Number.isSafeInteger(body.id)||body.id<=0)) return response({error:'Invalid answer ID.'},400);
  if(body.remove && body.id) {
    await db.prepare('DELETE FROM guest_faq WHERE id=?').bind(body.id).run();
  } else {
    const q=body.question?.trim(), a=body.answer?.trim();
    if(typeof q!=='string'||typeof a!=='string'||!q||!a||q.length>250||a.length>1000) return response({error:'Enter a question (250 characters maximum) and answer (1,000 maximum).'},400);
    if(body.id){
      const changed=await db.prepare('UPDATE OR IGNORE guest_faq SET question=?,answer=? WHERE id=? AND question=? AND answer=?').bind(q,a,body.id,body.previousQuestion||'',body.previousAnswer||'').run();
      if(!changed.meta.changes) return response({error:'This entry changed or the question already exists. Reopen the saved answer.'},409);
    } else {
      const changed=await db.prepare('INSERT OR IGNORE INTO guest_faq(question,answer) SELECT ?,? WHERE (SELECT COUNT(*) FROM guest_faq)<100').bind(q,a).run();
      if(!changed.meta.changes) return response({error:'This question already exists or the 100-answer limit has been reached. Edit an existing answer.'},409);
    }
  }
  return response({entries:await listFaqs(db)});
}
