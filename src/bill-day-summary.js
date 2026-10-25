/**
 * Count UNIQUE inclusive calendar days covered by one or more utility bills.
 * Overlapping billing windows count only once in an overall total.
 * Tenant counts include only days where that tenant lived during a billed window.
 * Pure module shared by PDF generation and tests; no client data is persisted.
 */
import { parseDay } from '../public/assets/bill-math.js';

function mergedInclusiveDays(windows) {
  const sorted=windows.map(w=>({start:parseDay(w.start),end:parseDay(w.end)}))
    .filter(w=>w.end>=w.start).sort((a,b)=>a.start-b.start||a.end-b.end);
  let total=0,currentStart=null,currentEnd=null;
  for(const w of sorted){
    if(currentStart===null){currentStart=w.start;currentEnd=w.end;}
    else if(w.start<=currentEnd+1){currentEnd=Math.max(currentEnd,w.end);}
    else {total+=currentEnd-currentStart+1;currentStart=w.start;currentEnd=w.end;}
  }
  if(currentStart!==null)total+=currentEnd-currentStart+1;
  return total;
}
export function summariseBilledDays(report){
  const bills=report.bills||[];
  const billedDays=mergedInclusiveDays(bills);
  const tenantDays=new Map();
  for(const tenant of report.tenants||[]){
    const stayStart=parseDay(tenant.start),stayEnd=parseDay(tenant.end);
    const overlap=[];
    for(const bill of bills){
      const first=Math.max(stayStart,parseDay(bill.start));
      const last=Math.min(stayEnd,parseDay(bill.end));
      if(first<=last)overlap.push({start:new Date(first*86400000).toISOString().slice(0,10),
        end:new Date(last*86400000).toISOString().slice(0,10)});
    }
    tenantDays.set(tenant.id,mergedInclusiveDays(overlap));
  }
  const vacant=[];
  for(const bill of bills){
    for(const segment of bill.spans||[]){
      if(segment.occupants?.length===1 && segment.occupants[0]==='Vacant / property')
        vacant.push({start:segment.start,end:segment.end});
    }
  }
  return {billedDays,tenantDays,vacantDays:mergedInclusiveDays(vacant)};
}
