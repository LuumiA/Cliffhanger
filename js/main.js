// @ts-nocheck
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RANK = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));
const rarityOf = (id) => RARITIES.find((r) => r.id === id);
const TOTAL_WEIGHT = RARITIES.reduce((s, r) => s + r.weight, 0);

// Thèmes de booster (l'ordre est celui de l'affichage). Les cartes portent les clés dans `themes`.
const THEMES = [
  { key: "action", name: "Action", emoji: "💥", hue: 8 },
  { key: "aventure", name: "Aventure", emoji: "🧭", hue: 35 },
  { key: "fantastique", name: "Fantastique", emoji: "🐉", hue: 270 },
  { key: "scifi", name: "Science-fiction", emoji: "🚀", hue: 240 },
  { key: "horreur", name: "Horreur", emoji: "🧟", hue: 100 },
  { key: "amour", name: "Amour", emoji: "💘", hue: 335 },
  { key: "crime", name: "Crime & Thriller", emoji: "🕵️", hue: 215 },
  { key: "comedie", name: "Comédie", emoji: "😂", hue: 52 },
  { key: "drame", name: "Drame", emoji: "🎭", hue: 190 },
];
const themeOf = (key) => THEMES.find((t) => t.key === key);

const state = {
  cards: [], // toutes les cartes du jeu
  owned: new Map(), // card_id -> quantité
  filters: { rarity: "all", show: "all", theme: "all", search: "", missing: true },
  selected: null, // thème du booster choisi (null = Mix)
  stock: 0, // boosters en stock (le serveur fait foi)
  cap: 20, // stock maximum
  nextIn: null, // secondes avant le prochain booster (null = stock plein)
  coins: 0, // monnaie du jeu
  userId: null,
  isAdmin: false, // compte admin : pas de cooldown (le serveur le vérifie aussi)
  username: "",
  memberSince: null,
  cdTimer: null,
  opening: false,
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const pctText = (p) => (p < 1 ? p.toFixed(1) : String(Math.round(p * 10) / 10)).replace(".", ",");
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const shows = () => [...new Set(state.cards.map((c) => c.show))].sort();
const topCard = (cards) => cards.reduce((a, b) => (RANK[b.rarity] > RANK[a.rarity] ? b : a));

function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

// ---------- Carte ----------
// opts: qty, locked, faceDown, width, isNew
function makeCard(c, opts = {}) {
  const r = rarityOf(c.rarity);
  const el = document.createElement("div");
  el.className = `tilt rarity-${c.rarity}${opts.faceDown ? "" : " nofl"}${opts.locked ? " locked" : ""}`;
  el.style.setProperty("--accent", r.color);
  el.style.setProperty("--hue", c.hue);
  if (opts.width) el.style.setProperty("--w", opts.width + "px");
  el.innerHTML = `
    <div class="flip">
      <div class="face back"></div>
      <div class="face front">
        <div class="card"><div class="card-in">
          <div class="c-top"><span class="c-show">${esc(c.show)}</span><span class="c-rar">${r.name}</span></div>
          <div class="art">
            ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : `<span class="initials">${esc(initials(c.name))}</span>`}
            ${opts.isNew ? `<span class="qty new">NOUVEAU</span>` : opts.qty > 1 ? `<span class="qty">x${opts.qty}</span>` : ""}
          </div>
          <div class="c-name"><b>${esc(c.name)}</b><small>${esc(c.actor)}</small></div>
          <div class="c-stats">
            <div><b>${c.charisme}</b><small>Charisme</small></div>
            <div><b>${c.repliques}</b><small>Répliques</small></div>
            <div><b>${c.saisons}</b><small>Saisons</small></div>
          </div>
        </div></div>
        <div class="foil"></div><div class="glare"></div>
      </div>
    </div>`;
  bindTilt(el, opts.tilt);
  return el;
}

function bindTilt(el, max = 0.8) {
  el.addEventListener("pointermove", (e) => {
    const b = el.getBoundingClientRect();
    const x = (e.clientX - b.left) / b.width;
    const y = (e.clientY - b.top) / b.height;
    el.style.setProperty("--rx", `${(0.5 - y) * max}deg`);
    el.style.setProperty("--ry", `${(x - 0.5) * max}deg`);
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
  });
  el.addEventListener("pointerleave", () => {
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  });
}

// ---------- Navigation ----------
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  window.scrollTo({ top: 0 });
  if (name === "booster") { renderStats(); loadLive(); }
  if (name === "collection") renderCollection();
  if (name === "series") renderSeries();
  if (name === "ranking") loadRanking();
  if (name === "market") loadMarket();
  if (name === "profile") loadProfileView(state.viewing || state.username);
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  state.viewing = null;
  history.replaceState(null, "", location.pathname);
  showView(t.dataset.view);
}));
$("home-link").addEventListener("click", () => { $("stage").hidden = true; $("modal").hidden = true; showView("booster"); });

// ---------- Cooldown (affichage : la vraie vérification est côté serveur) ----------
const STEP = 10 * 60; // un booster toutes les 10 minutes
const canOpen = () => state.isAdmin || state.stock > 0;

function cdValue() {
  return state.isAdmin ? "∞" : `${state.stock}/${state.cap}`;
}
function cdLabel() {
  if (state.isAdmin) return "boosters illimités (admin)";
  if (state.nextIn === null) return "boosters en stock · stock plein";
  return `boosters en stock · prochain dans ${mmss(state.nextIn)}`;
}
const stepProgress = () => (state.isAdmin || state.nextIn === null ? 100 : ((STEP - state.nextIn) / STEP) * 100);

// Affichage seulement : la vraie vérification est faite par le serveur.
function renderCooldown() {
  const locked = !canOpen();
  $("status-stock").textContent = cdValue();
  $("status-bar").style.width = `${stepProgress()}%`;
  $("status-coins").textContent = state.coins.toLocaleString("fr-FR");
  $("status").title = state.isAdmin ? "Boosters illimités" : state.nextIn === null ? "Stock plein" : `Prochain booster dans ${mmss(state.nextIn)}`;
  $("status").classList.toggle("empty", locked);

  const stat = $("stat-cd"), bar = $("stat-cd-bar"), lab = $("stat-cd-label");
  if (stat) stat.textContent = cdValue();
  if (lab) lab.textContent = cdLabel();
  if (bar) bar.style.width = `${stepProgress()}%`;

  const btn = $("panel-open"), cd = $("panel-cd");
  if (btn) btn.disabled = locked || state.opening;
  if (cd) cd.textContent = locked ? `Plus de booster : prochain dans ${mmss(state.nextIn ?? 0)}` : "";
  const hero = $("hero-open");
  if (hero) hero.disabled = locked || state.opening;
}

// Le décompte tourne côté navigateur ; à zéro on redemande le stock au serveur.
function startTicker() {
  clearInterval(state.cdTimer);
  state.cdTimer = setInterval(() => {
    if (state.nextIn === null) return;
    state.nextIn = Math.max(0, state.nextIn - 1);
    renderCooldown();
    if (state.nextIn === 0) { clearInterval(state.cdTimer); syncLimits(); }
  }, 1000);
}

// Le serveur a refusé : plus de booster en stock.
function startCooldown(seconds) {
  state.stock = 0;
  state.nextIn = seconds;
  renderCooldown();
  startTicker();
}

// Relit le stock, le délai avant le prochain booster et la monnaie auprès du serveur.
async function syncLimits() {
  if (!state.userId) return;
  const { data, error } = await db.rpc("get_booster_status");
  if (error) return console.error(error);
  state.stock = data.stock;
  state.cap = data.cap;
  state.nextIn = data.next_in;
  state.coins = data.coins ?? 0;
  state.isAdmin = data.admin;
  renderCooldown();
  startTicker();
}

// ---------- Données ----------
async function loadCards() {
  if (state.cards.length) return;
  // La base renvoie 1000 lignes au maximum par requête : on lit par pages.
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("cards").select("*").order("id").range(from, from + 999);
    if (error) return console.error(error);
    all.push(...data);
    if (data.length < 1000) break;
  }
  state.cards = all;
  buildFilters();
  renderHero();
  renderBoosters();
}

async function loadOwned() {
  const { data, error } = await db.from("collection").select("card_id, quantity");
  if (error) return console.error(error);
  state.owned = new Map(data.map((r) => [r.card_id, r.quantity]));
  renderStats();
  renderPanel();
  if (!$("view-collection").hidden) renderCollection();
  if (!$("view-series").hidden) renderSeries();
  if (!$("view-profile").hidden && !state.viewing) loadProfileView(state.username);
}

async function loadProfile(userId) {
  const { data } = await db.from("profiles").select("username, created_at, is_admin").eq("id", userId).maybeSingle();
  if (data) { state.username = data.username; state.memberSince = data.created_at; state.isAdmin = data.is_admin; }
}

// ---------- Accueil : bandeau, stats ----------
function renderHero() {
  const picks = [];
  const used = new Set();
  [...state.cards].sort((a, b) => RANK[b.rarity] - RANK[a.rarity]).forEach((c) => {
    if (picks.length < 3 && !used.has(c.show)) { picks.push(c); used.add(c.show); }
  });
  $("hero-cards").replaceChildren(...picks.map((c) => makeCard(c)));
}

function renderStats() {
  const total = state.cards.length;
  const n = state.owned.size;
  const pct = total ? (n / total) * 100 : 0;
  const all = shows();
  const done = all.filter((s) => state.cards.filter((c) => c.show === s).every((c) => state.owned.has(c.id))).length;
  const dups = [...state.owned.values()].reduce((s, q) => s + (q - 1), 0);
  const top = state.cards.filter((c) => state.owned.has(c.id) && RANK[c.rarity] >= RANK.culte).length;
  $("stats").innerHTML = `
    <div class="stat"><b id="stat-cd">${cdValue()}</b><span id="stat-cd-label">${cdLabel()}</span><div class="mini"><i id="stat-cd-bar" style="--c:var(--gold);width:${stepProgress()}%"></i></div></div>
    <div class="stat"><b>${pctText(pct)} %</b><span>collection · ${n} / ${total} cartes</span><div class="mini"><i style="--c:#3f8ef0;width:${pct}%"></i></div></div>
    <div class="stat"><b>${done}/${all.length}</b><span>séries complètes</span><div class="mini"><i style="--c:#5ee08a;width:${all.length ? (done / all.length) * 100 : 0}%"></i></div></div>
    <div class="stat"><b>${dups}</b><span>doublons à échanger</span></div>
    <div class="stat"><b>${top}</b><span>cartes Épique ou plus</span></div>`;
}

// ---------- Choix du booster ----------
function boosterList() {
  const mix = { key: null, name: "Mix", emoji: "🎬", hue: 350, cards: state.cards };
  const themed = THEMES.map((t) => ({ ...t, cards: state.cards.filter((c) => c.themes?.includes(t.key)) })).filter((t) => t.cards.length);
  return [mix, ...themed];
}

function renderBoosters() {
  const list = boosterList();
  $("booster-grid").replaceChildren(...list.map((b) => {
    const el = document.createElement("button");
    el.className = "bt" + (b.key === state.selected ? " sel" : "");
    el.innerHTML = `
      <div class="mini-pack" style="--hue:${b.hue}">
        <div class="mini-emblem emoji">${b.emoji}</div>
        <div class="mini-name">${esc(b.name)}</div>
        <span class="mini-tag">5 cartes</span>
      </div>
      <small>${b.cards.length} personnages</small>`;
    el.addEventListener("click", () => { state.selected = b.key; renderBoosters(); renderPanel(); });
    return el;
  }));
  renderPanel();
}

function renderPanel() {
  if (!state.cards.length) return;
  const b = boosterList().find((x) => x.key === state.selected);
  const got = b.cards.filter((c) => state.owned.has(c.id)).length;
  const missing = b.cards.length - got;
  $("booster-panel").innerHTML = `
    <p class="eyebrow">Booster sélectionné</p>
    <h3>${esc(b.name)}</h3>
    <p class="muted">${b.key ? `Séries : ${[...new Set(b.cards.map((c) => c.show))].map(esc).join(", ")}` : "Tous les personnages"}</p>
    <div class="pgrid">
      <div><b>5</b><span>cartes par booster</span></div>
      <div><b>${b.cards.length}</b><span>persos possibles</span></div>
      <div><b>${got}</b><span>déjà obtenus</span></div>
      <div><b>${missing}</b><span>à découvrir</span></div>
    </div>
    <button class="btn ghost link" id="panel-see">Voir les ${b.cards.length} persos →</button>
    <p class="chance">Chance par carte</p>
    ${[...RARITIES].reverse().map((r) => {
      const p = (r.weight / TOTAL_WEIGHT) * 100;
      return `<div class="crow" style="--c:${r.color}"><i></i><b>${r.name}</b><div class="bar"><em style="width:${Math.min(100, p * 1.6)}%"></em></div><span>${pctText(p)} %</span></div>`;
    }).join("")}
    <button class="btn big-btn" id="panel-open">Ouvrir le booster</button>
    <p class="cd" id="panel-cd"></p>`;
  $("panel-open").addEventListener("click", () => openBooster(state.selected));
  $("panel-see").addEventListener("click", () => {
    state.filters.theme = b.key ?? "all";
    state.filters.show = "all";
    $("filter-theme").value = state.filters.theme;
    $("filter-show").value = "all";
    showView("collection");
  });
  renderCooldown();
}

$("hero-open").addEventListener("click", () => { state.selected = null; renderBoosters(); openBooster(null); });
$("hero-see").addEventListener("click", () => $("choose").scrollIntoView({ behavior: "smooth" }));

// ---------- Ouverture d'un booster ----------
const SWIPE_PX = 70;      // distance à partir de laquelle un glissement compte
const TAP_PX = 8;         // en dessous : c'est un simple clic
const TEAR_PX = 150;      // glissement du paquet pour l'ouvrir
let cancelPack = null;

// Attend que le joueur ouvre le paquet : glissement vers la droite OU clic. Renvoie false s'il annule.
function waitForPackOpen(pack) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const done = (ok) => { ctl.abort(); cancelPack = null; resolve(ok); };
    cancelPack = () => done(false);
    let startX = null;

    const setTear = (px) => pack.style.setProperty("--tp", Math.min(1, Math.max(0, px / TEAR_PX)));
    pack.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      pack.setPointerCapture(e.pointerId);
      pack.classList.add("drag");
    }, { signal: ctl.signal });
    pack.addEventListener("pointermove", (e) => { if (startX !== null) setTear(e.clientX - startX); }, { signal: ctl.signal });
    pack.addEventListener("pointerup", (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      pack.classList.remove("drag");
      if (dx >= TEAR_PX || Math.abs(dx) < TAP_PX) done(true);
      else setTear(0);
    }, { signal: ctl.signal });
    pack.addEventListener("pointercancel", () => { startX = null; pack.classList.remove("drag"); setTear(0); }, { signal: ctl.signal });
    pack.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") done(true); }, { signal: ctl.signal });
  });
}

async function openBooster(theme) {
  if (state.opening || !canOpen()) return;
  state.opening = true;
  renderCooldown();

  const stage = $("stage"), pack = $("stage-pack");
  pack.className = "pack interactive";
  pack.style.setProperty("--tp", 0);
  pack.hidden = false;
  pack.tabIndex = 0;
  $("swipe-hint").hidden = false;
  $("deck").hidden = true;
  $("deck").replaceChildren();
  $("stage-cards").replaceChildren();
  $("close-stage").hidden = true;
  $("reveal-all").hidden = true;
  $("cancel-stage").hidden = false;
  $("stage-hint").textContent = theme ? `Booster ${themeOf(theme).name}` : "Booster Mix";
  $("stage-pack-sub").textContent = theme ? themeOf(theme).name : "Mix";
  stage.hidden = false;

  const go = await waitForPackOpen(pack);
  if (!go) {
    stage.hidden = true;
    state.opening = false;
    renderCooldown();
    return;
  }

  // Le paquet se déchire pendant que le serveur tire les cartes.
  $("swipe-hint").hidden = true;
  $("cancel-stage").hidden = true;
  pack.classList.add("snap");
  pack.style.setProperty("--tp", 1);
  const [{ data, error }] = await Promise.all([db.rpc("open_booster", { p_theme: theme }), wait(650)]);

  if (error) {
    stage.hidden = true;
    state.opening = false;
    const m = error.message.match(/cooldown:(\d+)/);
    if (m) startCooldown(Number(m[1]));
    else { renderCooldown(); alert("Erreur : " + error.message); }
    return;
  }

  pack.classList.add("gone");
  await wait(350);
  pack.hidden = true;

  const seen = new Set(state.owned.keys());
  // La carte la plus rare est révélée en dernier.
  const pulled = [...data].sort((a, b) => RANK[a.rarity] - RANK[b.rarity]).map((card) => {
    const isNew = !seen.has(card.id);
    seen.add(card.id);
    return { card, isNew };
  });
  syncLimits();
  loadOwned();
  loadLive();
  startDeck(pulled);
}

// Les cartes sont empilées : on glisse (gauche ou droite) ou on clique pour retourner, puis pour passer à la suivante.
function startDeck(pulled) {
  const deck = $("deck");
  const n = pulled.length;
  let idx = 0, busy = false, drag = null;
  // Taille adaptée à l'écran (téléphone compris).
  const cw = Math.min(240, Math.round(window.innerWidth * 0.66));
  deck.style.width = cw + 20 + "px";
  deck.style.height = Math.round(cw * 1.5) + 10 + "px";
  deck.replaceChildren();
  deck.hidden = false;
  $("reveal-all").hidden = false;

  const items = pulled.map(({ card, isNew }) => {
    const wrap = document.createElement("div");
    wrap.className = "deck-card";
    const el = makeCard(card, { faceDown: true, isNew, width: cw });
    wrap.appendChild(el);
    deck.appendChild(wrap);
    return { wrap, el, card, isNew, flipped: false };
  });

  const hint = () => {
    const it = items[idx];
    $("stage-hint").textContent = `Carte ${idx + 1} / ${n} · ${it.flipped ? (idx === n - 1 ? "glisse ou touche pour terminer" : "glisse ou touche pour la suivante") : "glisse ou touche pour la retourner"}`;
  };

  const layout = () => {
    items.forEach((it, k) => {
      if (k < idx) return;
      const i = k - idx;
      it.wrap.style.zIndex = n - k;
      it.wrap.style.opacity = 1;
      it.wrap.style.transform = `translate(-50%, ${i * -9}px) rotate(${i === 0 ? 0 : (i % 2 ? 1 : -1) * (1.2 + i * 0.6)}deg) scale(${1 - i * 0.035})`;
    });
    if (idx < n) hint();
  };

  const finish = () => {
    deck.hidden = true;
    $("reveal-all").hidden = true;
    $("stage-hint").textContent = "Booster ouvert";
    const row = $("stage-cards");
    row.replaceChildren(...items.map((it) => makeCard(it.card, { isNew: it.isNew, width: Math.min(150, Math.floor((window.innerWidth - 56) / 3)) })));
    $("close-stage").hidden = false;
  };

  const advance = (dir) => {
    const it = items[idx];
    if (!it.flipped) {
      it.flipped = true;
      it.el.classList.add("flipped");
      layout();
      if (RANK[it.card.rarity] >= RANK.culte) {
        const f = $("flash");
        f.style.setProperty("--flash", rarityOf(it.card.rarity).color);
        f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
      }
      return;
    }
    busy = true;
    it.wrap.style.transform = `translate(calc(-50% + ${dir * 460}px), -40px) rotate(${dir * 24}deg)`;
    it.wrap.style.opacity = 0;
    idx++;
    layout();
    setTimeout(() => {
      it.wrap.remove();
      busy = false;
      if (idx >= n) finish();
    }, 380);
  };

  deck.onpointerdown = (e) => {
    if (busy || idx >= n) return;
    drag = { x: e.clientX, dx: 0 };
    deck.setPointerCapture(e.pointerId);
    items[idx].wrap.style.transition = "none";
  };
  deck.onpointermove = (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    items[idx].wrap.style.transform = `translate(calc(-50% + ${drag.dx}px), 0) rotate(${drag.dx * 0.06}deg)`;
  };
  deck.onpointerup = () => {
    if (!drag) return;
    const dx = drag.dx;
    drag = null;
    items[idx].wrap.style.transition = "";
    if (Math.abs(dx) >= SWIPE_PX) advance(dx > 0 ? 1 : -1);
    else if (Math.abs(dx) < TAP_PX) advance(1);
    else layout();
  };
  deck.onpointercancel = () => {
    drag = null;
    if (idx < n) { items[idx].wrap.style.transition = ""; layout(); }
  };

  $("reveal-all").onclick = () => { busy = false; idx = n; items.forEach((it) => it.wrap.remove()); finish(); };
  layout();
}

$("cancel-stage").addEventListener("click", () => cancelPack?.());
$("close-stage").addEventListener("click", () => {
  $("stage").hidden = true;
  state.opening = false;
  renderCooldown();
});

// ---------- Gros tirages ----------
async function loadLive() {
  const { data, error } = await db.rpc("get_recent_pulls");
  if (error) return console.error(error);
  if (!data.length) return;
  $("live-row").innerHTML = data.map((p) => {
    const r = rarityOf(p.rarity);
    return `<div class="live-card" style="--c:${r.color}">
      <div class="live-art">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : ""}<span>${r.name}</span><b>${esc(p.card_name)}</b></div>
      <div class="live-who">${esc(p.username)}</div>
      <div class="live-time">${timeAgo(p.created_at)}</div>
    </div>`;
  }).join("");
}

// ---------- Collection ----------
function buildFilters() {
  $("filter-show").innerHTML = `<option value="all">Toutes les séries</option>` + shows().map((s) => `<option>${esc(s)}</option>`).join("");
  $("filter-theme").innerHTML = `<option value="all">Tous les thèmes</option>` + THEMES.map((t) => `<option value="${t.key}">${t.emoji} ${t.name}</option>`).join("");
  const chips = [{ id: "all", name: "Toutes", color: "var(--red)" }, ...RARITIES];
  $("rarity-chips").innerHTML = chips.map((r) => `<button class="chip${r.id === "all" ? " on" : ""}" data-r="${r.id}" style="--c:${r.color}">${r.name}</button>`).join("");
  $("rarity-chips").querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    state.filters.rarity = b.dataset.r;
    $("rarity-chips").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === b));
    renderCollection();
  }));
}

const PAGE_SIZE = 48;

function renderMore() {
  const grid = $("collection");
  const from = grid.children.length;
  state.list.slice(from, state.shown).forEach((c) => {
    const qty = state.owned.get(c.id) ?? 0;
    const el = makeCard(c, { qty, locked: !qty });
    if (qty) el.addEventListener("click", () => openModal(c));
    grid.appendChild(el);
  });
  const left = state.list.length - grid.children.length;
  $("more").hidden = left <= 0;
  $("more").textContent = `Afficher plus (${left} restantes)`;
}
$("more").addEventListener("click", () => { state.shown += PAGE_SIZE; renderMore(); });

function renderCollection() {
  const f = state.filters, q = f.search.trim().toLowerCase();
  const list = state.cards
    .filter((c) => (f.rarity === "all" || c.rarity === f.rarity) && (f.show === "all" || c.show === f.show))
    .filter((c) => f.theme === "all" || c.themes?.includes(f.theme))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.actor ?? "").toLowerCase().includes(q))
    .filter((c) => f.missing || state.owned.has(c.id))
    .sort((a, b) => (state.owned.has(b.id) - state.owned.has(a.id)) || RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name));

  // Affichage progressif : 2000 cartes d'un coup ralentiraient la page (surtout sur téléphone).
  state.shown = PAGE_SIZE;
  state.list = list;
  $("collection").replaceChildren();
  renderMore();
  $("empty").hidden = list.length > 0;
  const n = state.owned.size, total = state.cards.length;
  $("collection-count").textContent = `${n} / ${total} personnages découverts`;
  $("coll-bar").style.width = total ? `${(n / total) * 100}%` : "0";
}

$("search").addEventListener("input", (e) => { state.filters.search = e.target.value; renderCollection(); });
$("filter-show").addEventListener("change", (e) => { state.filters.show = e.target.value; renderCollection(); });
$("filter-theme").addEventListener("change", (e) => { state.filters.theme = e.target.value; renderCollection(); });
$("show-missing").addEventListener("change", (e) => { state.filters.missing = e.target.checked; renderCollection(); });

// ---------- Séries ----------
function renderSeries() {
  $("series-grid").replaceChildren(...shows().map((show) => {
    const cards = state.cards.filter((c) => c.show === show);
    const got = cards.filter((c) => state.owned.has(c.id)).length;
    const top = topCard(cards);
    const tile = document.createElement("button");
    tile.className = "show-tile";
    tile.innerHTML = `
      ${top.image ? `<img src="${esc(top.image)}" alt="" loading="lazy">` : ""}
      <div class="show-info">
        <b>${esc(show)}</b>
        <div class="show-bar"><i style="width:${(got / cards.length) * 100}%"></i></div>
        <small>${got} / ${cards.length} personnages${got === cards.length ? ' · <span class="show-done">Série complète !</span>' : ""}</small>
      </div>`;
    tile.addEventListener("click", () => {
      state.filters.show = show;
      state.filters.theme = "all";
      $("filter-show").value = show;
      $("filter-theme").value = "all";
      showView("collection");
    });
    return tile;
  }));
}

// ---------- Classement ----------
async function loadRanking() {
  const { data, error } = await db.rpc("get_leaderboard");
  if (error) { $("rank-list").textContent = "Erreur : " + error.message; return; }
  const total = state.cards.length;
  const top3 = data.filter((r) => r.rank <= 3);
  const order = [2, 1, 3].map((n) => top3.find((r) => Number(r.rank) === n)).filter(Boolean);
  $("podium").innerHTML = order.map((r) => `
    <div class="pod p${r.rank} clickable" data-user="${esc(r.username)}">
      <div class="av">${esc(r.username[0].toUpperCase())}</div>
      <b>${esc(r.username)}${r.is_me ? " (toi)" : ""}</b>
      <small>${r.top_cards} carte(s) Épique+</small>
      <div class="step"><em>${r.rank}</em><small>${r.unique_cards} / ${total} cartes</small></div>
    </div>`).join("");

  let prev = 0;
  $("rank-list").innerHTML = data.filter((r) => r.rank > 3).map((r) => {
    const gap = Number(r.rank) - prev > 1 && prev > 3 ? `<div class="rank-row"><span class="n">…</span></div>` : "";
    prev = Number(r.rank);
    return gap + `<div class="rank-row clickable${r.is_me ? " me" : ""}" data-user="${esc(r.username)}">
      <span class="n">${r.rank}</span>
      <span class="u"><span class="av">${esc(r.username[0].toUpperCase())}</span>${esc(r.username)}${r.is_me ? ' <span class="tag">toi</span>' : ""}</span>
      <span class="c">${r.unique_cards}<small>cartes</small></span>
      <span class="t">${r.top_cards} Épique+</span>
    </div>`;
  }).join("") || '<p class="muted center" style="padding:20px">Pas encore d\'autres joueurs.</p>';
  document.querySelectorAll('#podium [data-user], #rank-list [data-user]').forEach((el) => el.addEventListener('click', () => openProfile(el.dataset.user)));
}

// ---------- Zoom ----------
function openModal(c, qty = state.owned.get(c.id), own = true) {
  const holder = $("modal-card");
  holder.replaceChildren(makeCard(c, { qty, tilt: 4, width: Math.min(340, window.innerWidth - 40) }));
  if (own && typeof addModalActions === "function") addModalActions(c, qty, holder);
  $("modal").hidden = false;
}
$("modal").addEventListener("click", (e) => { if (!e.target.closest(".tilt, .modal-actions")) $("modal").hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("modal").hidden = true; });

// ---------- Connexion ----------
const credentials = () => ({ email: $("email").value.trim(), password: $("password").value });

$("login").addEventListener("click", async () => {
  $("auth-msg").textContent = "";
  const { error } = await db.auth.signInWithPassword(credentials());
  if (error) $("auth-msg").textContent = error.message;
});
$("signup").addEventListener("click", async () => {
  $("auth-msg").textContent = "";
  const { data, error } = await db.auth.signUp(credentials());
  if (error) $("auth-msg").textContent = error.message;
  else if (!data.session) $("auth-msg").textContent = "Compte créé. Vérifie ta boîte mail pour confirmer, puis connecte-toi.";
});
$("logout").addEventListener("click", () => db.auth.signOut());

async function onSession(session) {
  state.userId = session?.user.id ?? null;
  $("auth").hidden = !!session;
  $("game").hidden = !session;
  if (!session) {
    clearInterval(state.cdTimer);
    state.owned = new Map();
    state.stock = 0;
    state.nextIn = null;
    state.coins = 0;
    state.userId = null;
    $("stage").hidden = true;
    return;
  }
  showView("booster");
  await Promise.all([loadCards(), loadProfile(session.user.id)]);
  await loadOwned();
  routeFromHash();
  if (typeof refreshTradeBadge === "function") refreshTradeBadge();
  syncLimits();
  loadLive();
}

// Les requêtes ne doivent pas partir directement dans ce callback (supabase-js peut se bloquer) : on les décale.
db.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => onSession(session), 0);
});
