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

test('decodeComponents returns three planes of 208152', () => {
  const c = load();
  assert.strictEqual(c.c1.length, 208152);
  assert.strictEqual(c.c2.length, 208152);
  assert.strictEqual(c.c3.length, 208152);
});

test('decodeComponents rejects a wrong-sized buffer', () => {
  assert.throws(() => D.decodeComponents(new ArrayBuffer(10)), /624456/);
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
