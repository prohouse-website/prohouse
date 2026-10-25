// Synchronise default resident date ranges to the earliest bill start and latest end.
// A resident's manually edited boundaries remain untouched until reset.
export function billDateBounds(bills) {
  const usable=(bills||[]).filter(b => b && /^\d{4}-\d\d-\d\d$/.test(b.start||'') &&
    /^\d{4}-\d\d-\d\d$/.test(b.end||'') && b.start<=b.end);
  if(!usable.length)return null;
  return {start:usable.reduce((d,b)=> b.start<d?b.start:d,usable[0].start),
    end:usable.reduce((d,b)=> b.end>d?b.end:d,usable[0].end)};
}
export function syncTenantsToBills(tenants,bills,{force=false}={}) {
  const bounds=billDateBounds(bills);
  if(!bounds)return null;
  for(const tenant of tenants){
    if(force || !tenant.manualStart)tenant.start=bounds.start;
    if(force || !tenant.manualEnd)tenant.end=bounds.end;
    if(force){tenant.manualStart=false;tenant.manualEnd=false;}
  }
  return bounds;
}

/**
 * Billing counts inclusive calendar days, including both arrival and departure.
 * Not hotel nights, where the departure day would not ordinarily be charged.
 */
export function inclusiveStayDays(start,end) {
  const toDay=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    const ms=Date.parse(value+'T00:00:00Z');
    return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value ? Math.round(ms/86400000):null;
  };
  const first=toDay(start),last=toDay(end);
  return first===null||last===null||last<first?null:last-first+1;
}
