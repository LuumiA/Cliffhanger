// Lancer avec : node test/rarity.test.js
const { RARITIES, drawRarity } = require("../js/rarity.js");

const N = 200000;
const counts = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
for (let i = 0; i < N; i++) counts[drawRarity().id]++;

const total = RARITIES.reduce((s, r) => s + r.weight, 0);
let ok = true;
for (const r of RARITIES) {
  const expected = (r.weight / total) * 100;
  const actual = (counts[r.id] / N) * 100;
  const pass = Math.abs(actual - expected) < Math.max(0.3, expected * 0.1);
  if (!pass) ok = false;
  console.log(`${pass ? "OK  " : "FAIL"} ${r.name.padEnd(22)} attendu ${expected.toFixed(2)}%  obtenu ${actual.toFixed(2)}%`);
}
process.exit(ok ? 0 : 1);
