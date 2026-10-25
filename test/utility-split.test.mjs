import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateUtilitySplit } from '../public/assets/bill-math.js';

const tenant=(id,start,end)=>({id,name:id,start,end});
const bill=(amount,start,end,type='water')=>({type,amount,start,end});
const allocations=input=>Object.fromEntries(calculateUtilitySplit(input).summary.map(r=>[r.id,r.amountCents]));

test('36 inclusive days: late arrival on 4 November shares only 4-5 November',()=>{
  const output=calculateUtilitySplit({
    tenants:[tenant('A','2026-10-01','2026-11-05'),tenant('B','2026-11-04','2026-11-05')],
    bills:[bill('360.00','2026-10-01','2026-11-05')]
  });
  assert.equal(output.bills[0].days,36);
  assert.deepEqual(allocations({tenants:output.tenants,bills:[bill('360.00','2026-10-01','2026-11-05')]}),{A:35000,B:1000});
  assert.equal(output.bills[0].spans.length,2);
  assert.equal(output.bills[0].spans[0].days,34);
  assert.equal(output.bills[0].spans[1].days,2);
});

test('three occupants split only the days they overlap',()=>{
  const input={
    tenants:[tenant('A','2026-10-01','2026-10-03'),tenant('B','2026-10-02','2026-10-03'),tenant('C','2026-10-03','2026-10-03')],
    bills:[bill('90','2026-10-01','2026-10-03')]
  };
  assert.deepEqual(allocations(input),{A:5500,B:2500,C:1000});
});

test('unoccupied days belong to vacant/property share',()=>{
  const input={tenants:[tenant('A','2026-10-02','2026-10-02')],bills:[bill('60','2026-10-01','2026-10-03')]};
  assert.deepEqual(allocations(input),{A:2000,__vacant__:4000});
});

test('cent rounding always reconciles, including a one-cent three-way split',()=>{
  const input={tenants:['A','B','C'].map(id=>tenant(id,'2026-01-01','2026-01-01')),bills:[bill('0.01','2026-01-01','2026-01-01')]};
  assert.deepEqual(allocations(input),{A:1,B:0,C:0});
});

test('different bill date ranges allocate independently',()=>{
  const input={
    tenants:[tenant('A','2026-09-01','2026-11-30'),tenant('B','2026-11-01','2026-11-30')],
    bills:[bill('30','2026-10-01','2026-10-03'),bill('20','2026-11-01','2026-11-02','gas')]
  };
  const result=calculateUtilitySplit(input);
  assert.equal(result.bills.length,2);
  assert.deepEqual(Object.fromEntries(result.summary.map(x=>[x.id,x.amountCents])),{A:4000,B:1000});
  assert.equal(result.totalCents,5000);
});

test('reject invalid dates, backwards periods, and over-precision',()=>{
  assert.throws(()=>calculateUtilitySplit({tenants:[tenant('A','2026-02-30','2026-03-01')],bills:[bill('10','2026-03-01','2026-03-02')]}),/valid calendar date/);
  assert.throws(()=>calculateUtilitySplit({tenants:[tenant('A','2026-11-05','2026-10-01')],bills:[bill('10','2026-10-01','2026-11-05')]}),/end date/);
  assert.throws(()=>calculateUtilitySplit({tenants:[tenant('A','2026-10-01','2026-10-03')],bills:[bill('10.001','2026-10-01','2026-10-03')]}),/bill amount/);
});
