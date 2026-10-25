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
