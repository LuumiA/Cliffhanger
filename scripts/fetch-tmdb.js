// Récupère les séries et leurs personnages depuis TMDB et écrit js/data.js.
// Lancer avec : node --env-file=.env scripts/fetch-tmdb.js          (écrit js/data.js)
//               node --env-file=.env scripts/fetch-tmdb.js --dry    (affiche seulement, n'écrit rien)
// Puis envoyer dans la base : node --env-file=.env scripts/seed-cards.js
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TMDB_TOKEN;
if (!TOKEN) throw new Error("TMDB_TOKEN manquant dans .env");

// Pour ajouter une série : une ligne ici, puis relancer les deux scripts.
//   q      = nom à chercher sur TMDB
//   id     = identifiant TMDB (optionnel : à utiliser si la recherche tombe sur la mauvaise série)
//   themes = clés de thème (voir THEMES dans js/main.js)
//   wiki   = sous-domaine Fandom pour l'image du personnage (optionnel : sinon photo de l'acteur)
//   suffix = texte ajouté à la recherche sur le wiki (optionnel)
// L'ordre est important : les 5 premières séries existent déjà, on ajoute à la suite.
const SHOWS = [
  { q: "Game of Thrones", themes: ["action", "aventure", "fantastique", "drame"], wiki: "gameofthrones" },
  { q: "The Walking Dead", themes: ["horreur", "action", "aventure", "drame"], wiki: "walkingdead", suffix: " (TV Series)" },
  { q: "La Casa de Papel", themes: ["crime", "action", "drame"], wiki: "lacasadepapel" },
  { q: "Desperate Housewives", themes: ["comedie", "drame", "amour"], wiki: "desperatehousewives" },
  { q: "The Vampire Diaries", themes: ["fantastique", "horreur", "amour", "drame"], wiki: "vampirediaries" },

  { q: "Breaking Bad", themes: ["crime", "drame"], wiki: "breakingbad" },
  { q: "Better Call Saul", themes: ["crime", "drame"], wiki: "breakingbad" },
  { q: "Stranger Things", themes: ["scifi", "horreur", "aventure", "drame"], wiki: "strangerthings" },
  { q: "Friends", themes: ["comedie", "amour"], wiki: "friends" },
  { q: "How I Met Your Mother", themes: ["comedie", "amour"], wiki: "howimetyourmother" },
  { q: "The Big Bang Theory", themes: ["comedie"], wiki: "bigbangtheory" },
  { q: "The Office", themes: ["comedie"], wiki: "theoffice" },
  { q: "Prison Break", themes: ["action", "crime", "drame"], wiki: "prisonbreak" },
  { q: "Dexter", themes: ["crime", "drame", "horreur"], wiki: "dexter" },
  { q: "Lost : Les Disparus", themes: ["aventure", "fantastique", "scifi", "drame"], wiki: "lostpedia" },
  { q: "Supernatural", themes: ["fantastique", "horreur", "action"], wiki: "supernatural" },
  { q: "Grey's Anatomy", themes: ["drame", "amour"], wiki: "greysanatomy" },
  { q: "Gossip Girl", themes: ["drame", "amour"], wiki: "gossipgirl" },
  { q: "Riverdale", themes: ["drame", "crime", "amour"], wiki: "riverdale" },
  { q: "The Boys", themes: ["action", "scifi", "comedie"], wiki: "theboys" },
  { q: "The Witcher", themes: ["fantastique", "action", "aventure"], wiki: "witcher" },
  { q: "House of the Dragon", themes: ["fantastique", "drame", "action"], wiki: "houseofthedragon" },
  { q: "Peaky Blinders", themes: ["crime", "drame", "action"], wiki: "peaky-blinders" },
  { q: "Elite", themes: ["drame", "crime", "amour"], wiki: "elite" },
  { q: "Squid Game", themes: ["action", "drame", "crime"], wiki: "squidgame" },
  { q: "Narcos", themes: ["crime", "action", "drame"], wiki: "narcos" },
  { q: "Vikings", themes: ["action", "aventure", "drame"], wiki: "vikings" },
  { q: "The Mandalorian", themes: ["scifi", "action", "aventure"], wiki: "starwars" },
  { q: "Mercredi", themes: ["fantastique", "comedie", "horreur"], wiki: "wednesday" },
  { q: "Sherlock", themes: ["crime", "drame"], wiki: "sherlock" },
  { q: "Doctor Who", themes: ["scifi", "aventure"], wiki: "tardis" },
  { q: "The Flash", themes: ["action", "scifi", "aventure"], wiki: "arrow" },
  { q: "Arrow", themes: ["action", "crime"], wiki: "arrow" },
  { q: "Teen Wolf", themes: ["fantastique", "horreur", "action", "drame"], wiki: "teenwolf" },
  { q: "Pretty Little Liars", themes: ["drame", "crime", "amour"], wiki: "prettylittleliars" },
  { q: "Euphoria", themes: ["drame", "amour"], wiki: "euphoriahbo" },
  { q: "La Chronique des Bridgerton", themes: ["amour", "drame"], wiki: "bridgerton" },
  { q: "Emily in Paris", themes: ["comedie", "amour"], wiki: "emilyinparis" },
  { q: "Sex Education", themes: ["comedie", "amour", "drame"], wiki: "sex-education" },
  { q: "Brooklyn Nine-Nine", themes: ["comedie", "crime"], wiki: null },
  { q: "Modern Family", themes: ["comedie"], wiki: "modernfamily" },
  { q: "Malcolm", themes: ["comedie"], wiki: "malcolminthemiddle" },
  { q: "Scrubs", themes: ["comedie", "drame"], wiki: "scrubs" },
  { q: "The Last of Us", themes: ["horreur", "action", "drame", "aventure"], wiki: "thelastofus" },
  { q: "The Umbrella Academy", themes: ["scifi", "action", "fantastique", "comedie"], wiki: "umbrellaacademy" },
  { q: "Outer Banks", themes: ["aventure", "drame", "crime", "amour"], wiki: "outerbanks" },
  { q: "Lucifer", themes: ["fantastique", "crime", "comedie"], wiki: "lucifer" },
  { q: "Once Upon a Time", themes: ["fantastique", "aventure", "amour"], wiki: "onceuponatime" },
  { q: "Buffy contre les vampires", themes: ["fantastique", "horreur", "action"], wiki: "buffy" },
  { q: "The Originals", themes: ["fantastique", "horreur", "drame"], wiki: "vampirediaries" },
  { q: "Lupin", themes: ["crime", "aventure", "drame"], wiki: "lupin-netflix" },
  { q: "Dark", id: 70523, themes: ["scifi", "drame", "crime"], wiki: "dark-netflix" },
  { q: "You", themes: ["crime", "amour", "drame"], wiki: "you" },
  { q: "Ozark", themes: ["crime", "drame"], wiki: "ozark" },
];

const PER_SHOW = 40;
const IMG = "https://image.tmdb.org/t/p/w342";

// Rareté selon le rang du personnage dans sa série.
const ORDER = ["figurant", "second", "principal", "culte", "iconique", "cliffhanger"];
// Les têtes d'affiche (n°1 ou n°2 au générique) sont au minimum Légendaire (id iconique).
function rarityFor(rank, person) {
  const byRank = rarityForRank(rank);
  const floor = (person.order ?? 99) <= 1 ? "iconique" : "figurant";
  return ORDER.indexOf(byRank) >= ORDER.indexOf(floor) ? byRank : floor;
}

function rarityForRank(rank) {
  if (rank === 0) return "cliffhanger";
  if (rank <= 2) return "iconique";
  if (rank <= 5) return "culte";
  if (rank <= 11) return "principal";
  if (rank <= 21) return "second";
  return "figurant";
}

async function tmdb(endpoint, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // Jeton d'accès en lecture (long, commence par eyJ) : en-tête Bearer. Clé API v3 (32 caractères) : paramètre api_key.
  const headers = { accept: "application/json" };
  if (TOKEN.startsWith("eyJ")) headers.Authorization = `Bearer ${TOKEN}`;
  else url.searchParams.set("api_key", TOKEN);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${res.status} sur ${endpoint}`);
  return res.json();
}

async function wikiQuery(sub, extra) {
  const url = new URL(`https://${sub}.fandom.com/api.php`);
  const params = { action: "query", prop: "pageimages", piprop: "thumbnail", pithumbsize: 400, format: "json", redirects: 1, ...extra };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

// Image du personnage sur le wiki : titre exact d'abord, puis recherche. Renvoie null si rien.
async function wikiImage(cfg, character) {
  if (!cfg.wiki) return null;
  try {
    const exact = await wikiQuery(cfg.wiki, { titles: character });
    const hit = exact.find((p) => p.thumbnail);
    if (hit) return hit.thumbnail.source;
    const found = await wikiQuery(cfg.wiki, { generator: "search", gsrsearch: character + (cfg.suffix ?? ""), gsrlimit: 1 });
    return found.find((p) => p.thumbnail)?.thumbnail.source ?? null;
  } catch {
    return null;
  }
}

async function fetchShow(cfg, showIndex) {
  const show = cfg.id ? { id: cfg.id } : (await tmdb("/search/tv", { query: cfg.q, language: "fr-FR" })).results[0];
  if (!show) throw new Error(`Série introuvable : ${cfg.q}`);
  const detail = await tmdb(`/tv/${show.id}`, { language: "fr-FR" });
  const credits = await tmdb(`/tv/${show.id}/aggregate_credits`);

  const pool = credits.cast
    .map((p) => {
      const role = [...p.roles].sort((a, b) => b.episode_count - a.episode_count)[0];
      return { person: p, role };
    })
    .filter((c) => c.role.character && c.person.profile_path);
  if (pool.length < 10) throw new Error(`Pas assez de personnages pour ${detail.name} (${pool.length})`);

  // Importance = 35 % nombre d'épisodes, 65 % ordre au générique (TMDB `order`, 0 = tête d'affiche).
  // Ça évite de classer bas un personnage principal qui est parti tôt (ex. Rick dans The Walking Dead).
  const maxEp = Math.max(...pool.map((c) => c.role.episode_count));
  const score = (c) => 0.35 * (c.role.episode_count / maxEp) + 0.65 * (1 - Math.min(c.person.order ?? 40, 40) / 40);
  const cast = pool.sort((a, b) => score(b) - score(a)).slice(0, PER_SHOW);
  const epsPerSeason = detail.number_of_episodes / Math.max(detail.number_of_seasons, 1);

  const clean = (role) => role.character.split(" / ")[0].replace(/\s*\(.*\)/, "");
  const wikiImages = await Promise.all(cast.map(({ role }) => wikiImage(cfg, clean(role))));
  const found = wikiImages.filter(Boolean).length;
  const top = cast.slice(0, 3).map((c) => c.role.character.split(" / ")[0]).join(", ");
  console.log(`${detail.name.padEnd(30)} ${cast.length} persos · images wiki ${String(found).padStart(2)}/${cast.length} · ${top}`);

  return cast.map(({ person, role }, rank) => ({
    id: `${show.id}-${person.id}`,
    name: role.character.split(" / ")[0],
    characterImage: wikiImages[rank],
    actorImage: IMG + person.profile_path,
    actor: person.name,
    show: detail.name,
    themes: cfg.themes,
    rarity: rarityFor(rank, person),
    charisme: Math.round(100 - (rank / PER_SHOW) * 70),
    repliques: Math.round((role.episode_count / maxEp) * 100),
    saisons: Math.min(detail.number_of_seasons, Math.max(1, Math.ceil(role.episode_count / epsPerSeason))),
    image: wikiImages[rank] ?? IMG + person.profile_path,
    hue: showIndex < 5 ? (showIndex * 70) % 360 : (showIndex * 47) % 360,
  }));
}

(async () => {
  const all = [];
  const seenShows = new Set();
  const failed = [];
  for (let i = 0; i < SHOWS.length; i++) {
    try {
      const cards = await fetchShow(SHOWS[i], i);
      if (seenShows.has(cards[0].show)) { console.log(`(doublon ignoré : ${cards[0].show})`); continue; }
      seenShows.add(cards[0].show);
      all.push(...cards);
    } catch (e) {
      console.log(`!! ${SHOWS[i].q} : ${e.message}`);
      failed.push(SHOWS[i].q);
    }
  }
  console.log(`\n${seenShows.size} séries, ${all.length} cartes.${failed.length ? ` Échecs : ${failed.join(", ")}` : ""}`);
  if (process.argv.includes("--dry")) return console.log("(--dry : rien d'écrit)");
  const out = path.join(__dirname, "..", "js", "data.js");
  const header = "// Généré par scripts/fetch-tmdb.js. Données et images : TMDB.\n";
  fs.writeFileSync(out, `${header}const CHARACTERS = ${JSON.stringify(all, null, 2)};\n`);
  console.log(`Écrit dans js/data.js`);
})().catch((e) => { console.error(e.message); process.exit(1); });
