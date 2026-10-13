// @ts-nocheck
// Envoie les cartes de js/data.js dans la table "cards" de Supabase.
// Lancer avec : node --env-file=.env scripts/seed-cards.js
// Utilise la clé secrète : uniquement en local, jamais dans le site.
const fs = require("fs");
const path = require("path");

const base = process.env.SUPABASE_URL?.trim().match(
  /^https:\/\/[a-z0-9]+\.supabase\.co/,
)?.[0];
const secret = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.Secret_key ||
  ""
).trim();
if (!base || !secret)
  throw new Error("SUPABASE_URL ou clé secrète manquante dans .env");

const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "data.js"),
  "utf8",
);
const characters = new Function(`${source}; return CHARACTERS;`)();

const rows = characters.map((c) => ({
  id: c.id,
  name: c.name,
  actor: c.actor,
  show: c.show,
  rarity: c.rarity,
  charisme: c.charisme,
  repliques: c.repliques,
  saisons: c.saisons,
  image: c.image,
  hue: c.hue,
  themes: c.themes,
}));

(async () => {
  // Par paquets de 300 pour rester sous les limites de taille de requête.
  for (let i = 0; i < rows.length; i += 300) {
    const res = await fetch(`${base}/rest/v1/cards`, {
      method: "POST",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows.slice(i, i + 300)),
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} : ${await res.text()}`);
  }
  console.log(`${rows.length} cartes envoyées dans Supabase`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
