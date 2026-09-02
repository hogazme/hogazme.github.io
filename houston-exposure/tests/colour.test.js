const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/colour.js');

test('palette and ramp are the validated values', () => {
  assert.deepStrictEqual(C.PALETTE, [
    '#243044', '#825b4a', '#e8833a',
    '#42689a', '#9a9196', '#f1b785',
    '#60a5fa', '#acc9e5', '#f5e9c8'
  ]);
  assert.deepStrictEqual(C.REACH_RAMP, [
    '#2a78d6', '#3c6aa4', '#455b76', '#4a4a48',
    '#784b46', '#a34842', '#d03b3b'
  ]);
  assert.strictEqual(C.CELL_LABELS.length, 9);
});

test('classOf cuts at 85 and 170', () => {
  assert.strictEqual(C.classOf(0), 0);
  assert.strictEqual(C.classOf(84), 0);
  assert.strictEqual(C.classOf(85), 1);
  assert.strictEqual(C.classOf(169), 1);
  assert.strictEqual(C.classOf(170), 2);
  assert.strictEqual(C.classOf(255), 2);
});

test('cellIndex is row-major low->high PC1', () => {
  assert.strictEqual(C.cellIndex(0, 0), 0);       // low  PC1, low  PC3
  assert.strictEqual(C.cellIndex(0, 255), 2);     // low  PC1, high PC3
  assert.strictEqual(C.cellIndex(255, 0), 6);     // high PC1, low  PC3
  assert.strictEqual(C.cellIndex(255, 255), 8);   // high PC1, high PC3
  assert.strictEqual(C.cellIndex(141, 85), 4);    // golden CBG 0, 2019-01
});

test('relativise recentres on 128 and clamps', () => {
  assert.strictEqual(C.relativise(141, 134.471117), 135);
  assert.strictEqual(C.relativise(85, 129.179869), 84);
  assert.strictEqual(C.relativise(0, 200), 0);
  assert.strictEqual(C.relativise(255, 10), 255);
});

test('relative mode moves the golden CBG out of the centre cell', () => {
  const c1 = Uint8Array.from([141]);
  const c3 = Uint8Array.from([85]);
  assert.strictEqual(C.bivariateCells(c1, c3, null)[0], 4);
  const means = { c1: 134.471117, c3: 129.179869 };
  assert.strictEqual(C.bivariateCells(c1, c3, means)[0], 3);
});

test('reachSteps buckets into 7 and centres the neutral step', () => {
  const c2 = Uint8Array.from([0, 128, 255]);
  const s = C.reachSteps(c2, null);
  assert.strictEqual(s[0], 0);
  assert.strictEqual(s[1], 3);
  assert.strictEqual(s[2], 6);
});

test('matchExpression groups labels, one branch per colour', () => {
  const classes = Uint8Array.from([0, 2, 0, 1]);
  const e = C.matchExpression(classes, ['#aaaaaa', '#bbbbbb', '#cccccc']);
  assert.strictEqual(e[0], 'match');
  assert.deepStrictEqual(e[1], ['get', 'idx']);
  assert.deepStrictEqual(e[2], [0, 2]);
  assert.strictEqual(e[3], '#aaaaaa');
  assert.deepStrictEqual(e[4], [3]);
  assert.strictEqual(e[5], '#bbbbbb');
  assert.deepStrictEqual(e[6], [1]);
  assert.strictEqual(e[7], '#cccccc');
  assert.strictEqual(e.length, 9);            // + fallback
});

test('matchExpression omits colours no feature uses', () => {
  const e = C.matchExpression(Uint8Array.from([1, 1]), ['#aaaaaa', '#bbbbbb']);
  assert.strictEqual(e.length, 5);            // match, get, [0,1], colour, fallback
  assert.deepStrictEqual(e[2], [0, 1]);
  assert.strictEqual(e[3], '#bbbbbb');
});

test('a full 2891-feature expression stays small', () => {
  const classes = new Uint8Array(2891);
  for (let i = 0; i < classes.length; i++) classes[i] = i % 9;
  const e = C.matchExpression(classes, C.PALETTE);
  assert.strictEqual(e.length, 2 + 9 * 2 + 1);   // 9 branches, not 2891
});
