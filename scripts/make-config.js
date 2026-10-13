// Génère js/config.js (URL + clé publique) pour le navigateur. La clé "anon/publishable" est publique par conception.
// Lancer avec : node --env-file=.env scripts/make-config.js
const fs = require("fs");
const path = require("path");

const url = process.env.SUPABASE_URL?.trim().match(/^https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
const key = process.env.SUPABASE_ANON_KEY?.trim();
if (!url || !key) throw new Error("SUPABASE_URL ou SUPABASE_ANON_KEY manquant dans .env");

const content = `// Généré par scripts/make-config.js. Ne contient que des valeurs publiques.\nconst SUPABASE_URL = ${JSON.stringify(url)};\nconst SUPABASE_ANON_KEY = ${JSON.stringify(key)};\n`;
fs.writeFileSync(path.join(__dirname, "..", "js", "config.js"), content);
console.log("js/config.js écrit");
