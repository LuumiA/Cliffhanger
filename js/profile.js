// @ts-nocheck
// Profils : affichage (le sien ou celui d'un autre joueur) et personnalisation.
// Utilise les variables globales de main.js (db, state, $, esc, makeCard, RARITIES, RANK, openModal...).

// ---------- Rangs, titres, cadres (les mêmes seuils sont vérifiés côté serveur dans migration-4.sql) ----------
const RANKS = [
  { key: "debutant", name: "Débutant", min: 0, color: "#8a8f98" },
  { key: "spectateur", name: "Spectateur", min: 10, color: "#4caf6a" },
  { key: "fan", name: "Fan", min: 50, color: "#3f8ef0" },
  { key: "cinephile", name: "Cinéphile", min: 150, color: "#9b5de5" },
  { key: "critique", name: "Critique", min: 400, color: "#f2b632" },
  { key: "showrunner", name: "Showrunner", min: 900, color: "#ff7a45" },
  { key: "legende", name: "Légende", min: 1500, color: "#ff4d8d" },
];
const rankOf = (u) => [...RANKS].reverse().find((r) => u >= r.min);

const TITLES = [
  { key: "spectateur", name: "Spectateur", how: "Posséder 10 persos différents", ok: (s) => s.unique >= 10 },
  { key: "fan", name: "Fan", how: "Posséder 50 persos différents", ok: (s) => s.unique >= 50 },
  { key: "cinephile", name: "Cinéphile", how: "Posséder 150 persos différents", ok: (s) => s.unique >= 150 },
  { key: "critique", name: "Critique", how: "Posséder 400 persos différents", ok: (s) => s.unique >= 400 },
  { key: "showrunner", name: "Showrunner", how: "Posséder 900 persos différents", ok: (s) => s.unique >= 900 },
  { key: "legende", name: "Légende du petit écran", how: "Posséder 1 500 persos différents", ok: (s) => s.unique >= 1500 },
  { key: "cliffhanger", name: "Fin de saison", how: "Obtenir une carte Cliffhanger", ok: (s) => s.cliff >= 1 },
  { key: "saison_complete", name: "Saison complète", how: "Compléter 1 série", ok: (s) => s.complete >= 1 },
  { key: "integrale", name: "Intégrale", how: "Compléter 5 séries", ok: (s) => s.complete >= 5 },
];

const FRAMES = [
  { key: null, name: "Automatique", how: "Couleur de ton rang", ok: () => true },
  { key: "bronze", name: "Bronze", how: "Posséder 50 persos différents", ok: (s) => s.unique >= 50 },
  { key: "argent", name: "Argent", how: "Posséder 150 persos différents", ok: (s) => s.unique >= 150 },
  { key: "or", name: "Or", how: "Posséder 400 persos différents", ok: (s) => s.unique >= 400 },
  { key: "platine", name: "Platine", how: "Posséder 900 persos différents", ok: (s) => s.unique >= 900 },
  { key: "cliffhanger", name: "Cliffhanger", how: "Posséder 3 cartes Cliffhanger", ok: (s) => s.cliff >= 3 },
  { key: "serie", name: "Intégrale", how: "Compléter 1 série", ok: (s) => s.complete >= 1 },
];

const BLOCKS = [
  { key: "showcase", name: "Vitrine" },
  { key: "collection", name: "Collection" },
  { key: "series", name: "Séries" },
  { key: "dups", name: "Doublons" },
];
const STYLES = [
  { key: "glass", name: "Boîtes en verre", desc: "Chaque carte sous verre, la favorite en tête." },
  { key: "spotlight", name: "Projecteur", desc: "La favorite en grand, les autres à côté." },
  { key: "binder", name: "Classeur", desc: "Toutes les cartes à plat, sans décor." },
];

const statsOf = (p) => ({ unique: p.unique_cards, cliff: p.cliff_cards, complete: p.complete_series });
const titleName = (key) => TITLES.find((t) => t.key === key)?.name;

// ---------- Avatar ----------
function avatarHTML(p, size = 62) {
  const rank = rankOf(p.unique_cards);
  const inner = p.avatar?.image
    ? `<img src="${esc(p.avatar.image)}" alt="">`
    : `<span>${esc((p.username[0] ?? "?").toUpperCase())}</span>`;
  return `<div class="avatar f-${p.frame ?? "auto"}" style="--rank:${rank.color};--s:${size}px"><div class="avatar-in" style="--hue:${p.avatar?.hue ?? 350}">${inner}</div></div>`;
}

// ---------- Ouvrir un profil ----------
function openProfile(name) {
  state.viewing = name && name !== state.username ? name : null;
  history.replaceState(null, "", state.viewing ? `#/u/${encodeURIComponent(state.viewing)}` : location.pathname);
  showView("profile");
}

function routeFromHash() {
  const m = location.hash.match(/^#\/u\/(.+)$/);
  if (!m) return false;
  openProfile(decodeURIComponent(m[1]));
  return true;
}
window.addEventListener("hashchange", () => { if (!$("game").hidden) routeFromHash(); });

$("profile-back").addEventListener("click", () => {
  state.viewing = null;
  history.replaceState(null, "", location.pathname);
  showView("ranking");
});

async function loadProfileView(name) {
  const body = $("profile-body");
  body.innerHTML = '<p class="muted">Chargement…</p>';
  $("profile-back").hidden = !state.viewing;
  const { data, error } = await db.rpc("get_public_profile", { p_username: name });
  if (error) { body.textContent = "Erreur : " + error.message; return; }
  if (!data) { body.innerHTML = '<p class="muted">Ce joueur n\'existe pas.</p>'; return; }
  state.profile = data;
  renderProfileView(data);
}

function copyProfileLink(p, btn) {
  const url = `${location.origin}${location.pathname}#/u/${encodeURIComponent(p.username)}`;
  const done = () => { const old = btn.textContent; btn.textContent = "Lien copié !"; setTimeout(() => (btn.textContent = old), 1500); };
  navigator.clipboard?.writeText(url).then(done, () => prompt("Copie ce lien :", url));
  if (!navigator.clipboard) prompt("Copie ce lien :", url);
}

// ---------- Affichage ----------
function renderProfileView(p) {
  const body = $("profile-body");
  const rank = rankOf(p.unique_cards);
  const pct = p.total_cards ? (p.unique_cards / p.total_cards) * 100 : 0;
  const since = new Date(p.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  const head = document.createElement("div");
  head.className = "profile-head";
  head.innerHTML = `
    ${avatarHTML(p, 110)}
    <div class="profile-id">
      <p class="eyebrow"><span class="rank-chip" style="--c:${rank.color}">${rank.name}</span>${p.title ? ` <span class="ptitle">${esc(titleName(p.title) ?? "")}</span>` : ""}${p.is_admin ? ' <span class="rank-chip admin">Admin</span>' : ""}</p>
      <h2 class="title">${esc(p.username)}</h2>
      <p class="sub">Membre depuis le ${since}${p.is_me ? ' <span class="tag-me">c\'est toi</span>' : ""}</p>
      ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
      <div class="profile-actions">
        ${p.is_me ? '<button class="btn small" id="p-edit">Personnaliser</button>' : ""}
        ${p.is_me ? '<button class="btn ghost small" id="p-logout">Déconnexion</button>' : ""}
        ${p.is_me ? "" : '<button class="btn small" id="p-trade">Proposer un échange</button>'}
        <button class="btn ghost small" id="p-copy">${p.is_me ? "Copier mon lien" : "Copier le lien"}</button>
      </div>
    </div>
    <div class="profile-stats">
      <div><b>${p.unique_cards}<small>/${p.total_cards}</small></b><span>cartes uniques</span></div>
      <div><b>${pctText(pct)}%</b><span>complétion</span></div>
      <div><b>${p.cliff_cards}</b><span>Cliffhanger</span></div>
      <div><b>${p.complete_series}</b><span>séries complètes</span></div>
    </div>`;
  body.replaceChildren(head);
  head.querySelector("#p-copy").addEventListener("click", (e) => copyProfileLink(p, e.currentTarget));
  head.querySelector("#p-logout")?.addEventListener("click", () => $("logout").click());
  head.querySelector("#p-trade")?.addEventListener("click", () => startTradeWith(p.username));
  head.querySelector("#p-edit")?.addEventListener("click", () => openEditor(p));

  if (p.restricted) {
    const note = document.createElement("div");
    note.className = "box center muted";
    note.textContent = "Ce profil est privé : seuls le pseudo, l'avatar et le rang sont visibles.";
    body.appendChild(note);
    return;
  }

  const hidden = new Set(p.blocks?.hidden ?? []);
  for (const key of p.blocks?.order ?? BLOCKS.map((b) => b.key)) {
    if (hidden.has(key) && !p.is_me) continue;
    const node = BLOCK_RENDER[key]?.(p, hidden.has(key));
    if (node) body.appendChild(node);
  }
}

function section(title, eyebrow, extra = "") {
  const el = document.createElement("div");
  el.className = "pblock";
  el.innerHTML = `<div class="section-head"><p class="eyebrow">${eyebrow}</p><h2>${title}${extra}</h2></div>`;
  return el;
}

function cardTile(c, width) {
  const el = makeCard(c, { qty: c.qty, width });
  el.addEventListener("click", () => openModal(c, c.qty, !!state.profile?.is_me));
  return el;
}

const hiddenBadge = (isHidden) => (isHidden ? ' <small class="hid">masqué pour les autres</small>' : "");

const BLOCK_RENDER = {
  showcase(p, isHidden) {
    const el = section("Vitrine", "Vitrine", hiddenBadge(isHidden));
    const cards = p.showcase ?? [];
    if (!cards.length) { el.insertAdjacentHTML("beforeend", '<p class="muted">Aucune carte pour le moment.</p>'); return el; }
    const wrap = document.createElement("div");
    wrap.className = `sc sc-${p.style ?? "glass"}`;
    if (p.style === "spotlight") {
      const side = document.createElement("div");
      side.className = "sc-side";
      cards.slice(1).forEach((c) => side.appendChild(cardTile(c, 150)));
      wrap.append(cardTile(cards[0], 270), side);
    } else {
      cards.forEach((c, i) => {
        const box = document.createElement("div");
        box.className = "sc-box" + (i === 0 && p.style === "glass" ? " fav" : "");
        box.appendChild(cardTile(c, i === 0 && p.style === "glass" ? 220 : 190));
        wrap.appendChild(box);
      });
    }
    el.appendChild(wrap);
    return el;
  },

  collection(p, isHidden) {
    const el = section("Collection", "Collection", hiddenBadge(isHidden));
    if (p.collection_private) { el.insertAdjacentHTML("beforeend", '<div class="box muted">Collection privée.</div>'); return el; }
    const counts = p.rarity_counts ?? {};
    const n = p.unique_cards;
    const box = document.createElement("div");
    box.className = "box";
    box.innerHTML = `
      <div class="box-head"><b>${n} cartes uniques</b><span>${pctText(p.total_cards ? (n / p.total_cards) * 100 : 0)} %</span></div>
      <div class="rbar">${RARITIES.filter((r) => counts[r.id]).map((r) => `<i style="--c:${r.color};width:${(counts[r.id] / Math.max(n, 1)) * 100}%"></i>`).join("")}</div>
      <div class="rchips">${[...RARITIES].reverse().map((r) => `<span style="--c:${r.color}">${r.name} <b>${counts[r.id] ?? 0}</b></span>`).join("")}</div>`;
    el.appendChild(box);
    return el;
  },

  series(p, isHidden) {
    const el = section("Séries", "Univers", hiddenBadge(isHidden));
    if (p.collection_private) { el.insertAdjacentHTML("beforeend", '<div class="box muted">Collection privée.</div>'); return el; }
    const list = (p.series ?? []).slice(0, 12);
    const box = document.createElement("div");
    box.className = "box";
    box.innerHTML = list.length
      ? `<div class="universes">${list.map((s) => `<div class="uni"><div class="top"><b>${esc(s.show)}</b><span>${s.got}/${s.total}</span></div><div class="show-bar"><i style="width:${(s.got / s.total) * 100}%"></i></div></div>`).join("")}</div>`
      : '<span class="muted">Aucune série commencée.</span>';
    el.appendChild(box);
    return el;
  },

  dups(p, isHidden) {
    const el = section(`Doublons <small>${p.dups?.length ?? 0}</small>`, "Échanges", hiddenBadge(isHidden));
    if (p.dups_private) { el.insertAdjacentHTML("beforeend", '<div class="box muted">Doublons privés.</div>'); return el; }
    if (!p.dups?.length) { el.insertAdjacentHTML("beforeend", '<p class="muted">Pas de doublons.</p>'); return el; }
    const grid = document.createElement("div");
    grid.className = "grid showcase";
    p.dups.forEach((c) => grid.appendChild(cardTile(c)));
    el.appendChild(grid);
    return el;
  },
};

// ---------- Personnalisation ----------
let draft = null;      // copie modifiable du profil
let editTab = "look";

function ownedCards() {
  return state.cards.filter((c) => state.owned.has(c.id)).sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name));
}

function openEditor(p) {
  draft = {
    username: p.username,
    bio: p.bio ?? "",
    title: p.title ?? null,
    frame: p.frame ?? null,
    avatar: p.avatar?.id ?? null,
    style: p.style ?? "glass",
    showcase: [...(p.showcase_ids ?? [])],
    order: [...(p.blocks?.order ?? BLOCKS.map((b) => b.key))],
    hidden: [...(p.blocks?.hidden ?? [])],
    privacy: { profile: "public", collection: "public", dups: "public", ...(p.privacy ?? {}) },
  };
  // Un bloc absent de la liste (ajouté plus tard) est remis à la fin.
  BLOCKS.forEach((b) => { if (!draft.order.includes(b.key)) draft.order.push(b.key); });
  draft.profile = p;
  $("edit-msg").textContent = "";
  $("edit-modal").hidden = false;
  document.body.style.overflow = "hidden";
  setEditTab("look");
}

function closeEditor() {
  $("edit-modal").hidden = true;
  document.body.style.overflow = "";
}

function setEditTab(tab) {
  editTab = tab;
  document.querySelectorAll("#edit-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".tab-pane").forEach((el) => (el.hidden = el.id !== `tab-${tab}`));
  renderEditHeader();
  ({ look: renderLook, blocks: renderBlocksTab, showcase: renderShowcaseTab, privacy: renderPrivacyTab })[tab]();
}

function previewProfile() {
  const p = draft.profile;
  const avatarCard = draft.avatar ? state.cards.find((c) => c.id === draft.avatar) : null;
  return { ...p, username: draft.username, frame: draft.frame, title: draft.title, avatar: avatarCard ? { id: avatarCard.id, image: avatarCard.image, hue: avatarCard.hue } : null };
}

function renderEditHeader() {
  const p = previewProfile();
  const rank = rankOf(p.unique_cards);
  $("edit-id").innerHTML = `${avatarHTML(p, 64)}<div><b class="eid-name">${esc(p.username)}</b><div><span class="rank-chip" style="--c:${rank.color}">${rank.name}</span>${p.title ? ` <span class="ptitle">${esc(titleName(p.title) ?? "")}</span>` : ""}</div></div>`;
}

// Sélecteur de cartes possédées : max = nombre de cartes à choisir. sel() lit la sélection, set(ids) l'enregistre.
function buildPicker(container, { max, sel, set, empty }) {
  const all = ownedCards();
  let q = "";
  const draw = () => {
    const chosen = sel();
    const list = all.filter((c) => !q || c.name.toLowerCase().includes(q) || c.show.toLowerCase().includes(q)).slice(0, 60);
    container.innerHTML = `
      <div class="pk-chosen">${chosen.length ? chosen.map((id, i) => {
        const c = state.cards.find((x) => x.id === id);
        return `<button class="pk-sel" data-id="${esc(id)}" title="Retirer">${max > 1 ? `<i>${i + 1}</i>` : ""}${c?.image ? `<img src="${esc(c.image)}" alt="">` : ""}<span>${esc(c?.name ?? id)}</span></button>`;
      }).join("") : `<span class="muted">${empty}</span>`}</div>
      <input class="pk-search" type="search" placeholder="Chercher parmi tes cartes" value="${esc(q)}">
      <div class="pk-grid">${list.map((c) => {
        const on = chosen.includes(c.id);
        return `<button class="pk-tile${on ? " on" : ""}" data-id="${esc(c.id)}" style="--c:${rarityOf(c.rarity).color}">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ""}<span>${esc(c.name)}</span></button>`;
      }).join("") || '<p class="muted">Aucune carte ne correspond.</p>'}</div>`;
    container.querySelector(".pk-search").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; draw(); const i = container.querySelector(".pk-search"); i.focus(); i.setSelectionRange(pos, pos); });
    container.querySelectorAll(".pk-sel").forEach((b) => b.addEventListener("click", () => { set(sel().filter((x) => x !== b.dataset.id)); draw(); afterPick(); }));
    container.querySelectorAll(".pk-tile").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id, cur = sel();
      if (cur.includes(id)) set(cur.filter((x) => x !== id));
      else if (max === 1) set([id]);
      else if (cur.length < max) set([...cur, id]);
      draw(); afterPick();
    }));
  };
  draw();
}
const afterPick = () => renderEditHeader();

function renderLook() {
  const s = statsOf(draft.profile);
  const admin = draft.profile.is_admin;
  const locked = (item) => !(admin || item.ok(s));
  const pane = $("tab-look");
  pane.innerHTML = `
    <h4>Pseudo</h4>
    <input id="ed-name" type="text" maxlength="20" value="${esc(draft.username)}" placeholder="Ton pseudo (3 à 20 caractères)">
    <h4>Bio</h4>
    <div class="bio-wrap"><textarea id="ed-bio" maxlength="160" placeholder="Une phrase sur toi : tes séries préférées, ce que tu cherches...">${esc(draft.bio)}</textarea><span id="bio-count">${draft.bio.length}/160</span></div>
    <h4>Avatar <small>choisis un personnage que tu possèdes</small></h4>
    <div id="ed-avatar"></div>
    <h4>Titre <small>${TITLES.filter((t) => !locked(t)).length} débloqué(s) sur ${TITLES.length} · survole un titre grisé pour savoir comment l'obtenir</small></h4>
    <div class="chips-wrap">
      <button class="chip${draft.title === null ? " on" : ""}" data-title="">Aucun</button>
      ${TITLES.map((t) => `<button class="chip${draft.title === t.key ? " on" : ""}${locked(t) ? " lock" : ""}" data-title="${t.key}" ${locked(t) ? `disabled title="${esc(t.how)}"` : ""}>${locked(t) ? "🔒 " : ""}${t.name}</button>`).join("")}
    </div>
    <h4>Cadre d'avatar <small>${FRAMES.filter((f) => !locked(f)).length} débloqué(s) sur ${FRAMES.length}</small></h4>
    <div class="frames">
      ${FRAMES.map((f) => `<button class="frame-tile${draft.frame === f.key ? " on" : ""}${locked(f) ? " lock" : ""}" data-frame="${f.key ?? ""}" ${locked(f) ? "disabled" : ""}>
        ${avatarHTML({ ...previewProfile(), frame: f.key }, 56)}<b>${f.name}</b><small>${locked(f) ? esc(f.how) : ""}</small></button>`).join("")}
    </div>`;

  $("ed-name").addEventListener("input", (e) => { draft.username = e.target.value.trim(); renderEditHeader(); });
  $("ed-bio").addEventListener("input", (e) => { draft.bio = e.target.value; $("bio-count").textContent = `${draft.bio.length}/160`; });
  buildPicker($("ed-avatar"), { max: 1, sel: () => (draft.avatar ? [draft.avatar] : []), set: (ids) => { draft.avatar = ids[0] ?? null; }, empty: "Aucun avatar : ton initiale sera utilisée." });
  pane.querySelectorAll("[data-title]").forEach((b) => b.addEventListener("click", () => { draft.title = b.dataset.title || null; setEditTab("look"); }));
  pane.querySelectorAll("[data-frame]").forEach((b) => b.addEventListener("click", () => { draft.frame = b.dataset.frame || null; setEditTab("look"); }));
}

function renderBlocksTab() {
  const pane = $("tab-blocks");
  pane.innerHTML = `
    <h4>Ordre des blocs <small>sous ton en-tête, de haut en bas</small></h4>
    <div class="blocks">
      ${draft.order.map((key, i) => {
        const b = BLOCKS.find((x) => x.key === key);
        const off = draft.hidden.includes(key);
        return `<div class="block-row"><b>${b.name}</b><div>
          <button class="sq" data-move="${i}:-1" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="sq" data-move="${i}:1" ${i === draft.order.length - 1 ? "disabled" : ""}>↓</button>
          <button class="chip${off ? "" : " on"}" data-toggle="${key}">${off ? "Masqué" : "Affiché"}</button></div></div>`;
      }).join("")}
    </div>
    <p class="muted small-note">Un bloc masqué n'est montré à personne d'autre que toi.</p>
    <h4>Style de vitrine</h4>
    <div class="styles">${STYLES.map((s) => `<button class="style-tile${draft.style === s.key ? " on" : ""}" data-style="${s.key}"><b>${s.name}</b><small>${s.desc}</small></button>`).join("")}</div>`;
  pane.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
    const [i, d] = b.dataset.move.split(":").map(Number);
    [draft.order[i], draft.order[i + d]] = [draft.order[i + d], draft.order[i]];
    renderBlocksTab();
  }));
  pane.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.toggle;
    draft.hidden = draft.hidden.includes(k) ? draft.hidden.filter((x) => x !== k) : [...draft.hidden, k];
    renderBlocksTab();
  }));
  pane.querySelectorAll("[data-style]").forEach((b) => b.addEventListener("click", () => { draft.style = b.dataset.style; renderBlocksTab(); }));
}

function renderShowcaseTab() {
  const pane = $("tab-showcase");
  pane.innerHTML = `<h4>Ta vitrine <small>choisis jusqu'à 4 cartes, la première est ta favorite</small></h4><div id="ed-showcase"></div>`;
  buildPicker($("ed-showcase"), { max: 4, sel: () => draft.showcase, set: (ids) => { draft.showcase = ids; }, empty: "Aucune carte choisie : tes 4 plus belles cartes seront affichées." });
}

function renderPrivacyTab() {
  const rows = [
    { key: "profile", name: "Mon profil", desc: "En privé, on ne voit plus que ton pseudo, ton avatar et ton rang." },
    { key: "collection", name: "Ma collection", desc: "Raretés et séries de ta collection. Les cartes de ta vitrine restent visibles." },
    { key: "dups", name: "Mes doublons", desc: "Les cartes que tu pourrais échanger." },
  ];
  $("tab-privacy").innerHTML = rows.map((r) => `
    <h4>${r.name}</h4>
    <div class="seg"><button class="${draft.privacy[r.key] === "public" ? "on" : ""}" data-priv="${r.key}:public">Public</button>
    <button class="${draft.privacy[r.key] === "private" ? "on" : ""}" data-priv="${r.key}:private">Privé</button>
    <button disabled title="Disponible quand les amis seront ajoutés">Amis (bientôt)</button></div>
    <p class="muted small-note">${r.desc}</p>`).join("");
  $("tab-privacy").querySelectorAll("[data-priv]").forEach((b) => b.addEventListener("click", () => {
    const [k, v] = b.dataset.priv.split(":");
    draft.privacy[k] = v;
    renderPrivacyTab();
  }));
}

const SAVE_ERRORS = {
  titre_verrouille: "Ce titre n'est pas encore débloqué.",
  cadre_verrouille: "Ce cadre n'est pas encore débloqué.",
  avatar_non_possede: "Tu ne possèdes pas la carte choisie pour l'avatar.",
  vitrine_non_possedee: "Une carte de ta vitrine ne fait pas partie de ta collection.",
  bio_trop_longue: "La bio est trop longue (160 caractères maximum).",
};

async function saveProfile() {
  const msg = $("edit-msg");
  msg.textContent = "";
  const name = draft.username;
  if (name.length < 3 || name.length > 20) { msg.textContent = "Le pseudo doit faire entre 3 et 20 caractères."; setEditTab("look"); return; }
  $("edit-save").disabled = true;

  const { error } = await db.rpc("save_profile", {
    p_bio: draft.bio, p_title: draft.title, p_avatar: draft.avatar, p_frame: draft.frame,
    p_blocks: { order: draft.order, hidden: draft.hidden }, p_style: draft.style,
    p_showcase: draft.showcase, p_privacy: draft.privacy,
  });
  if (error) {
    $("edit-save").disabled = false;
    const key = Object.keys(SAVE_ERRORS).find((k) => error.message.includes(k));
    msg.textContent = key ? SAVE_ERRORS[key] : "Erreur : " + error.message;
    return;
  }

  if (name !== state.username) {
    const { data: { session } } = await db.auth.getSession();
    const { error: e2 } = await db.from("profiles").update({ username: name }).eq("id", session.user.id);
    if (e2) {
      $("edit-save").disabled = false;
      msg.textContent = e2.code === "23505" ? "Ce pseudo est déjà pris (le reste a bien été enregistré)." : e2.message;
      setEditTab("look");
      return;
    }
    state.username = name;
  }
  $("edit-save").disabled = false;
  closeEditor();
  state.viewing = null;
  loadProfileView(state.username);
}

document.querySelectorAll("#edit-tabs button").forEach((b) => b.addEventListener("click", () => setEditTab(b.dataset.tab)));
$("edit-close").addEventListener("click", closeEditor);
$("edit-cancel").addEventListener("click", closeEditor);
$("edit-save").addEventListener("click", saveProfile);
$("edit-modal").addEventListener("click", (e) => { if (e.target === $("edit-modal")) closeEditor(); });
