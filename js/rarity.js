// Tirage pondéré : le cœur du jeu. Aucune dépendance au navigateur, donc testable avec Node.
const RARITIES = [
  { id: "figurant",  name: "Commune",              weight: 55,  color: "#8a8f98" },
  { id: "second",    name: "Peu commune",          weight: 25,  color: "#4caf6a" },
  { id: "principal", name: "Rare",                 weight: 12,  color: "#3f8ef0" },
  { id: "culte",     name: "Épique",               weight: 5,   color: "#9b5de5" },
  { id: "iconique",  name: "Légendaire",           weight: 2.5, color: "#f2b632" },
  { id: "cliffhanger", name: "Cliffhanger",       weight: 0.5, color: "#ff4d8d" },
];

// rng est injectable (Math.random par défaut) pour pouvoir tester de façon déterministe.
function drawRarity(rng = Math.random) {
  const total = RARITIES.reduce((sum, r) => sum + r.weight, 0);
  let roll = rng() * total;
  for (const r of RARITIES) {
    roll -= r.weight;
    if (roll < 0) return r;
  }
  return RARITIES[0];
}

function drawBooster(characters, size = 5, rng = Math.random) {
  return Array.from({ length: size }, () => {
    const rarity = drawRarity(rng);
    const pool = characters.filter((c) => c.rarity === rarity.id);
    const source = pool.length ? pool : characters;
    return source[Math.floor(rng() * source.length)];
  });
}

if (typeof module !== "undefined") module.exports = { RARITIES, drawRarity, drawBooster };
