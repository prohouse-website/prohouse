/* Shared, deterministic allocation for browser preview and server-side PDF.
   Dates are inclusive calendar days in UTC; every bill day is apportioned equally
   among occupants present, or to a clearly labeled Vacant / property account. */
const ONE_DAY = 86400000;
const VACANT_ID = '__vacant__';
export { VACANT_ID };

export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter a valid date (YYYY-MM-DD).');
  const ms = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error('Enter a valid calendar date.');
  return Math.round(ms / ONE_DAY);
}
export function dateFromDay(day) {
  return new Date(day * ONE_DAY).toISOString().slice(0, 10);
}
export function fmtDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function money(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}
const labelType = { water: 'Water', gas: 'Gas', electricity: 'Electricity', other: 'Other utility' };
export function calculateUtilitySplit(source) {
  if (!source || !Array.isArray(source.tenants) || !Array.isArray(source.bills)) throw new Error('Missing tenant or bill details.');
  if (!source.tenants.length || source.tenants.length > 80) throw new Error('Add between 1 and 80 tenants.');
  if (source.bills.length > 30) throw new Error('Maximum 30 bills per report.');
  const usedIds = new Set();
  const tenants = source.tenants.map((entry, index) => {
    const id = String(entry.id || ('tenant-' + index));
    const name = String(entry.name || '').trim().slice(0, 90);
    if (!name) throw new Error('Enter a name for every tenant.');
    if (usedIds.has(id) || id === VACANT_ID) throw new Error('Tenant identifiers must be unique.');
    usedIds.add(id);
    const startDay = parseDay(entry.start);
    const endDay = parseDay(entry.end);
    if (endDay < startDay) throw new Error(name + ': the end date precedes the start date.');
    return { id, name, start: entry.start, end: entry.end, startDay, endDay };
  });
  const bills = source.bills.filter(entry => String(entry.amount || '').trim() !== '' && Number(entry.amount) !== 0).map((entry, index) => {
    const type = String(entry.type || 'other').toLowerCase();
    const name = labelType[type] || 'Other utility';
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10000000 || !/^\d+(?:\.\d{1,2})?$/.test(String(entry.amount).trim())) {
      throw new Error('Enter a non-negative bill amount with up to two decimal places.');
    }
    const startDay = parseDay(entry.start);
    const endDay = parseDay(entry.end);
    const days = endDay - startDay + 1;
    if (days < 1 || days > 730) throw new Error(name + ': billing periods must be between 1 and 730 days.');
    return { id: String(entry.id || ('bill-' + index)), type, name, start: entry.start, end: entry.end,
      startDay, endDay, days, amountCents: Math.round(amount * 100) };
  });
  const totalById = new Map(tenants.map(t => [t.id, { id: t.id, name: t.name, amountCents: 0, bills: [] }]));
  const reports = [];
  let totalCents = 0;
  for (const bill of bills) {
    const weights = new Map();
    const presence = new Map();
    const spans = [];
    for (let day = bill.startDay; day <= bill.endDay; day++) {
      const here = tenants.filter(t => t.startDay <= day && day <= t.endDay);
      const participants = here.length ? here.map(t => t.id) : [VACANT_ID];
      const key = participants.join('|');
      const last = spans[spans.length - 1];
      if (last && last.key === key) { last.end = dateFromDay(day); last.days++; }
      else spans.push({ key, start: dateFromDay(day), end: dateFromDay(day), days: 1,
        occupants: here.length ? here.map(t => t.name) : ['Vacant / property'] });
      const part = 1 / participants.length;
      for (const id of participants) {
        weights.set(id, (weights.get(id) || 0) + part);
        presence.set(id, (presence.get(id) || 0) + 1);
      }
    }
    const all = [...tenants.map(t => t.id), VACANT_ID].filter(id => weights.has(id));
    const provisional = all.map((id, order) => {
      const equivalentDays = weights.get(id);
      const raw = bill.amountCents * equivalentDays / bill.days;
      const whole = Math.floor(raw + 1e-8);
      return { id, order, equivalentDays, presentDays: presence.get(id), amountCents: whole, fraction: raw - whole };
    });
    let leftover = bill.amountCents - provisional.reduce((sum, p) => sum + p.amountCents, 0);
    if (leftover < 0 || leftover > provisional.length) throw new Error('Unable to reconcile the bill to cents.');
    const remainderOrder = [...provisional].sort((a, b) => b.fraction - a.fraction || a.order - b.order);
    for (let i = 0; i < leftover; i++) remainderOrder[i].amountCents++;
    const rows = provisional.map(row => ({
      id: row.id, name: row.id === VACANT_ID ? 'Vacant / property' : tenants.find(t => t.id === row.id).name,
      presentDays: row.presentDays, equivalentDays: row.equivalentDays, amountCents: row.amountCents
    }));
    for (const row of rows) {
      if (!totalById.has(row.id)) totalById.set(row.id, { id: row.id, name: row.name, amountCents: 0, bills: [] });
      const aggregate = totalById.get(row.id);
      aggregate.amountCents += row.amountCents;
      aggregate.bills.push({ billId: bill.id, name: bill.name, amountCents: row.amountCents,
        presentDays: row.presentDays, equivalentDays: row.equivalentDays, days: bill.days,
        start: bill.start, end: bill.end });
    }
    totalCents += bill.amountCents;
    reports.push({ id: bill.id, name: bill.name, type: bill.type, start: bill.start, end: bill.end,
      days: bill.days, amountCents: bill.amountCents, rows, spans });
  }
  return { tenants: tenants.map(({ id, name, start, end }) => ({ id, name, start, end })),
    bills: reports, summary: [...totalById.values()].filter(x => x.id !== VACANT_ID || x.amountCents > 0),
    totalCents, billCount: reports.length, tenantCount: tenants.length };
}
