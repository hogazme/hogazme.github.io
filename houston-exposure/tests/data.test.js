const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../js/data.js');
const BIN = path.join(__dirname, '..', 'data', 'components.bin');

function load() {
  const b = fs.readFileSync(BIN);
  return D.decodeComponents(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

test('constants match the panel', () => {
  assert.strictEqual(D.N_CBG, 2891);
  assert.strictEqual(D.N_MONTH, 72);
  assert.strictEqual(D.PLANE, 208152);
});

test('decodeComponents returns five planes of 208152', () => {
  const c = load();
  assert.strictEqual(c.c1.length, 208152);
  assert.strictEqual(c.c2.length, 208152);
  assert.strictEqual(c.rg.length, 208152);
  assert.strictEqual(c.rgkm.length, 208152);
  assert.strictEqual(c.c3.length, 208152);
});

test('decodeComponents rejects a wrong-sized buffer', () => {
  assert.throws(() => D.decodeComponents(new ArrayBuffer(10)), /1040760/);
});

test('golden values for CBG index 0', () => {
  const c = load();
  assert.strictEqual(D.valueAt(c.c1, 0, 0), 141);
  assert.strictEqual(D.valueAt(c.c2, 0, 0), 245);
  assert.strictEqual(D.valueAt(c.c3, 0, 0), 85);
  assert.strictEqual(D.valueAt(c.c1, 71, 0), 98);
  assert.strictEqual(D.valueAt(c.c3, 71, 0), 95);
});

test('monthSlice is 2891 long and agrees with valueAt', () => {
  const c = load();
  const s = D.monthSlice(c.c1, 71);
  assert.strictEqual(s.length, 2891);
  assert.strictEqual(s[0], 98);
  for (const i of [0, 1, 1000, 2890]) {
    assert.strictEqual(s[i], D.valueAt(c.c1, 71, i));
  }
});

test('rankInMonth is 1-based and consistent with the slice', () => {
  const c = load();
  const s = D.monthSlice(c.c1, 0);
  const r = D.rankInMonth(c.c1, 0, 0);
  const below = Array.from(s).filter((v) => v < s[0]).length;
  assert.strictEqual(r, below + 1);
  assert.ok(r >= 1 && r <= 2891);
});

test('reach planes: percentile spans 0-255 and km values are plausible', () => {
  const c = load();
  let lo = 255, hi = 0, kmSum = 0;
  for (let i = 0; i < c.rg.length; i++) {
    if (c.rg[i] < lo) lo = c.rg[i];
    if (c.rg[i] > hi) hi = c.rg[i];
    kmSum += c.rgkm[i] / 2;
  }
  assert.strictEqual(lo, 0);
  assert.strictEqual(hi, 255);
  const meanKm = kmSum / c.rg.length;
  assert.ok(meanKm > 8 && meanKm < 25, `mean radius ${meanKm} km is implausible`);
  // The percentile plane must order the same way as the km plane.
  assert.ok(c.rgkm[0] !== undefined);
  const a = 0, b = 100000;
  if (c.rgkm[a] !== c.rgkm[b]) {
    assert.strictEqual(c.rg[a] < c.rg[b], c.rgkm[a] < c.rgkm[b]);
  }
});
