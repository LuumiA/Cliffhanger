// @ts-nocheck
// Marché entre joueurs, échanges et boutique. Utilise les globales de main.js (db, state, $, esc, makeCard, RANK, rarityOf...).

const TICKET = '<svg class="tk" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/></svg>';
const fmt = (n) => Number(n).toLocaleString("fr-FR");
const priceHTML = (n) => `<span class="price">${TICKET}${fmt(n)}</span>`;

const ERRORS = {
  pas_de_doublon: "Seuls les doublons peuvent être échangés : tu dois en garder un exemplaire.",
  pas_de_carte: "Tu ne possèdes pas cette carte.",
  doublon_indisponible: "Ce joueur n'a plus cette carte en double.",
  doublons_prives: "Ce joueur garde ses doublons privés.",
  joueur_introuvable: "Aucun joueur avec ce pseudo.",
  soi_meme: "Tu ne peux pas t'échanger une carte avec toi-même.",
  annonce_indisponible: "Cette annonce n'est plus disponible.",
  propre_annonce: "C'est ta propre annonce.",
  pas_assez_de_tickets: "Tu n'as pas assez de tickets.",
  prix_invalide: "Prix invalide (entre 1 et 1 000 000 tickets).",
  trop_d_annonces: "Tu as déjà 30 annonces en cours.",
  trop_d_echanges: "Tu as déjà 20 propositions en attente.",
  echange_introuvable: "Cette proposition n'existe plus.",
  stock_plein: "Ton stock de boosters est déjà plein.",
};
const errText = (e) => { const k = Object.keys(ERRORS).find((x) => e.message.includes(x)); return k ? ERRORS[k] : "Erreur : " + e.message; };

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3100);
}

// Bouton à double clic : le premier clic demande confirmation, le second valide.
function confirmButton(btn, label, action) {
  btn.innerHTML = label;
  btn.onclick = async () => {
    if (!btn.dataset.armed) {
      btn.dataset.armed = "1";
      btn.textContent = "Confirmer ?";
      setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = label; } }, 3000);
      return;
    }
    btn.disabled = true;
    await action();
    if (btn.isConnected) { btn.disabled = false; delete btn.dataset.armed; btn.innerHTML = label; }
  };
}

let econ = null;
async function loadEconomy() {
  if (econ) return;
  const { data } = await db.rpc("get_economy");
  econ = data ?? { suggested: {}, booster_price: 300, fee_percent: 5 };
}
const suggested = (rarity) => econ?.suggested?.[rarity] ?? 10;
const dupCards = () => state.cards.filter((c) => (state.owned.get(c.id) ?? 0) > 1).sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name));
const refreshAll = async () => { await Promise.all([syncLimits(), loadOwned()]); };

// ---------- Onglets ----------
let marketTab = "browse";
function setMarketTab(tab) {
  marketTab = tab;
  document.querySelectorAll("#market-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.m === tab));
  document.querySelectorAll(".mpane").forEach((p) => (p.hidden = p.id !== `m-${tab}`));
  ({ browse: renderBrowse, mine: renderMine, trades: renderTrades, shop: renderShop })[tab]();
}
document.querySelectorAll("#market-tabs button").forEach((b) => b.addEventListener("click", () => setMarketTab(b.dataset.m)));

async function loadMarket() {
  await loadEconomy();
  setMarketTab(marketTab);
}

// ---------- Marché : parcourir ----------
const mf = { search: "", rarity: "all", sort: "new" };

async function renderBrowse() {
  const pane = $("m-browse");
  if (!pane.dataset.ready) {
    pane.dataset.ready = "1";
    pane.innerHTML = `
      <div class="filters">
        <input id="mf-search" type="search" placeholder="Rechercher un personnage, une série, un acteur">
        <select id="mf-rarity"><option value="all">Toutes les raretés</option>${[...RARITIES].reverse().map((r) => `<option value="${r.id}">${r.name}</option>`).join("")}</select>
        <select id="mf-sort"><option value="new">Plus récentes</option><option value="price">Prix croissant</option><option value="rarity">Plus rares d'abord</option></select>
      </div>
      <div id="mf-grid" class="mgrid"></div>`;
    let timer;
    $("mf-search").addEventListener("input", (e) => { mf.search = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(renderBrowse, 300); });
    $("mf-rarity").addEventListener("change", (e) => { mf.rarity = e.target.value; renderBrowse(); });
    $("mf-sort").addEventListener("change", (e) => { mf.sort = e.target.value; renderBrowse(); });
  }
  const grid = $("mf-grid");
  const { data, error } = await db.rpc("get_listings", { p_search: mf.search || null, p_rarity: mf.rarity === "all" ? null : mf.rarity, p_sort: mf.sort });
  if (error) { grid.textContent = errText(error); return; }
  if (!data.length) { grid.innerHTML = '<p class="muted center wide">Aucune annonce pour le moment. Mets tes cartes en vente depuis « Mes ventes » !</p>'; return; }
  grid.replaceChildren(...data.map(listingTile));
}

function listingTile(l) {
  const el = document.createElement("div");
  el.className = "listing";
  const card = makeCard(l.card, { width: 170 });
  card.addEventListener("click", () => openModal(l.card, 0, false));
  const info = document.createElement("div");
  info.className = "linfo";
  info.innerHTML = `<div class="lrow">${priceHTML(l.price)}<span class="seller">${l.mine ? "toi" : esc(l.seller)}</span></div>`;
  const btn = document.createElement("button");
  btn.className = "btn small";
  if (l.mine) {
    btn.className = "btn ghost small";
    confirmButton(btn, "Retirer", async () => { await cancelListing(l.id); });
  } else if (state.coins < l.price) {
    btn.disabled = true;
    btn.className = "btn ghost small";
    btn.textContent = "Pas assez de tickets";
  } else {
    confirmButton(btn, "Acheter", async () => {
      const { error } = await db.rpc("buy_listing", { p_id: l.id });
      if (error) { toast(errText(error), true); renderBrowse(); return; }
      toast(`Carte achetée : ${l.card.name}`);
      await refreshAll();
      renderBrowse();
    });
  }
  info.appendChild(btn);
  el.append(card, info);
  return el;
}

async function cancelListing(id) {
  const { error } = await db.rpc("cancel_listing", { p_id: id });
  if (error) { toast(errText(error), true); return; }
  toast("Annonce retirée, la carte est de retour dans ta collection.");
  await refreshAll();
  setMarketTab(marketTab);
}

// ---------- Mes ventes ----------
let sellCard = null;

// Grille de tuiles à choisir (mes doublons, ou ceux d'un autre joueur) : items = [{card, qty}]
function tilePicker(container, items, selectedId, onPick, emptyText) {
  let q = "";
  const draw = () => {
    const list = items.filter(({ card }) => !q || card.name.toLowerCase().includes(q) || card.show.toLowerCase().includes(q)).slice(0, 60);
    container.innerHTML = `
      ${items.length > 8 ? '<input class="pk-search" type="search" placeholder="Chercher une carte">' : ""}
      <div class="pk-grid">${list.map(({ card, qty }) => `
        <button class="pk-tile${card.id === selectedId() ? " on" : ""}" data-id="${esc(card.id)}" style="--c:${rarityOf(card.rarity).color}">
          ${card.image ? `<img src="${esc(card.image)}" alt="" loading="lazy">` : ""}<em>x${qty}</em><span>${esc(card.name)}</span></button>`).join("") || `<p class="muted">${emptyText}</p>`}</div>`;
    const search = container.querySelector(".pk-search");
    if (search) { search.value = q; search.addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); const p = e.target.selectionStart; draw(); const i = container.querySelector(".pk-search"); i.focus(); i.setSelectionRange(p, p); }); }
    container.querySelectorAll(".pk-tile").forEach((b) => b.addEventListener("click", () => { onPick(items.find((x) => x.card.id === b.dataset.id).card); draw(); }));
  };
  draw();
}

async function renderMine() {
  const pane = $("m-mine");
  const dups = state.cards.filter((c) => state.owned.has(c.id)).sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.name.localeCompare(b.name)).map((card) => ({ card, qty: state.owned.get(card.id) }));
  pane.innerHTML = `
    <div class="box">
      <div class="box-head"><b>Mettre une carte en vente</b><span>frais de ${econ.fee_percent} %</span></div>
      <div id="sell-pick"></div>
      <div id="sell-form" class="sellform" hidden></div>
    </div>
    <div class="section-head"><h2>Mes annonces</h2></div>
    <div id="my-listings" class="mgrid"><p class="muted">Chargement…</p></div>`;
  tilePicker($("sell-pick"), dups, () => sellCard?.id, (c) => { sellCard = c; renderSellForm(); }, "Tu n'as aucune carte pour l'instant. Ouvre des boosters !");
  if (sellCard && !dups.some((d) => d.card.id === sellCard.id)) sellCard = null;
  renderSellForm();

  const { data, error } = await db.rpc("get_my_listings");
  const box = $("my-listings");
  if (error) { box.textContent = errText(error); return; }
  if (!data.length) { box.innerHTML = '<p class="muted">Aucune annonce.</p>'; return; }
  box.replaceChildren(...data.map((l) => {
    const el = document.createElement("div");
    el.className = "listing" + (l.status === "sold" ? " sold" : "");
    const card = makeCard(l.card, { width: 150 });
    card.addEventListener("click", () => openModal(l.card, 0, false));
    const info = document.createElement("div");
    info.className = "linfo";
    if (l.status === "active") {
      info.innerHTML = `<div class="lrow">${priceHTML(l.price)}<span class="seller">en vente</span></div>`;
      const b = document.createElement("button");
      b.className = "btn ghost small";
      confirmButton(b, "Retirer", async () => { await cancelListing(l.id); });
      info.appendChild(b);
    } else {
      info.innerHTML = `<div class="lrow">${priceHTML(l.price - Math.ceil(l.price * econ.fee_percent / 100))}<span class="seller">vendue à ${esc(l.buyer ?? "?")}</span></div>`;
    }
    el.append(card, info);
    return el;
  }));
}

function renderSellForm() {
  const form = $("sell-form");
  if (!sellCard) { form.hidden = true; return; }
  const sugg = suggested(sellCard.rarity);
  form.hidden = false;
  form.innerHTML = `
    <p><b>${esc(sellCard.name)}</b> · ${rarityOf(sellCard.rarity).name} <span class="muted">· prix conseillé ${priceHTML(sugg)}</span></p>
    <div class="sf-row">
      <label>Prix <input id="sell-price" type="number" min="1" max="1000000" value="${sugg}"></label>
      <button class="btn" id="sell-go">Mettre en vente</button>
    </div>
    <p class="muted small-note" id="sell-net"></p>`;
  const price = $("sell-price"), net = $("sell-net");
  const upd = () => { const p = Math.floor(Number(price.value) || 0); net.innerHTML = p >= 1 ? `Tu recevras ${priceHTML(p - Math.ceil(p * econ.fee_percent / 100))} une fois la carte vendue.` : ""; };
  price.addEventListener("input", upd); upd();
  $("sell-go").addEventListener("click", async () => {
    const p = Math.floor(Number(price.value));
    $("sell-go").disabled = true;
    const { error } = await db.rpc("create_listing", { p_card: sellCard.id, p_price: p });
    $("sell-go").disabled = false;
    if (error) { toast(errText(error), true); return; }
    toast(`${sellCard.name} est en vente pour ${fmt(p)} tickets.`);
    sellCard = null;
    await refreshAll();
    renderMine();
  });
}

// ---------- Échanges ----------
let tradeUser = "";       // joueur avec qui on veut échanger
let theirDups = null;     // ses doublons : [{card, qty}]
let wantCard = null, giveCard = null;

async function renderTrades() {
  const pane = $("m-trades");
  pane.innerHTML = `
    <div class="box">
      <div class="box-head"><b>Proposer un échange</b><span>1 doublon contre 1 doublon</span></div>
      <div class="sf-row"><input id="tr-user" type="text" placeholder="Pseudo du joueur" value="${esc(tradeUser)}"><button class="btn ghost" id="tr-load">Voir ses doublons</button></div>
      <div id="tr-body"></div>
    </div>
    <div class="section-head"><h2>Mes échanges</h2></div>
    <div id="tr-list"><p class="muted">Chargement…</p></div>`;
  $("tr-load").addEventListener("click", () => { tradeUser = $("tr-user").value.trim(); loadTheirDups(); });
  $("tr-user").addEventListener("keydown", (e) => { if (e.key === "Enter") $("tr-load").click(); });
  if (tradeUser && theirDups) renderTradeBody(); else if (tradeUser) loadTheirDups();
  loadTradeList();
}

async function loadTheirDups() {
  const body = $("tr-body");
  theirDups = null; wantCard = null; giveCard = null;
  if (!tradeUser) { body.innerHTML = ""; return; }
  body.innerHTML = '<p class="muted">Chargement…</p>';
  const { data, error } = await db.rpc("get_public_profile", { p_username: tradeUser });
  if (error) { body.textContent = errText(error); return; }
  if (!data) { body.innerHTML = '<p class="muted">Aucun joueur avec ce pseudo.</p>'; return; }
  if (data.is_me) { body.innerHTML = '<p class="muted">C\'est toi ! Choisis un autre joueur.</p>'; return; }
  if (data.restricted || data.dups_private) { body.innerHTML = `<p class="muted">${esc(data.username)} garde ses doublons privés : tu ne peux pas lui proposer d'échange.</p>`; return; }
  tradeUser = data.username;
  theirDups = (data.dups ?? []).map((c) => ({ card: c, qty: c.qty }));
  renderTradeBody();
}

function renderTradeBody() {
  const body = $("tr-body");
  const mine = dupCards().map((card) => ({ card, qty: state.owned.get(card.id) }));
  body.innerHTML = `
    <h4>Ce que tu veux : doublons de ${esc(tradeUser)}</h4><div id="tr-want"></div>
    <h4>Ce que tu donnes : tes doublons</h4><div id="tr-give"></div>
    <div class="sf-row"><button class="btn" id="tr-send" disabled>Envoyer la proposition</button><span class="muted" id="tr-sum"></span></div>`;
  const sum = () => {
    $("tr-send").disabled = !(wantCard && giveCard);
    $("tr-sum").textContent = wantCard && giveCard ? `Tu donnes ${giveCard.name} contre ${wantCard.name}.` : "";
  };
  tilePicker($("tr-want"), theirDups, () => wantCard?.id, (c) => { wantCard = c; sum(); }, `${tradeUser} n'a aucun doublon pour l'instant.`);
  tilePicker($("tr-give"), mine, () => giveCard?.id, (c) => { giveCard = c; sum(); }, "Tu n'as aucun doublon à proposer.");
  sum();
  $("tr-send").addEventListener("click", async () => {
    $("tr-send").disabled = true;
    const { error } = await db.rpc("propose_trade", { p_to: tradeUser, p_give: giveCard.id, p_want: wantCard.id });
    if (error) { toast(errText(error), true); $("tr-send").disabled = false; return; }
    toast(`Proposition envoyée à ${tradeUser}.`);
    wantCard = null; giveCard = null; theirDups = null;
    renderTrades();
  });
}

async function loadTradeList() {
  const box = $("tr-list");
  const { data, error } = await db.rpc("get_trades");
  if (error) { box.textContent = errText(error); return; }
  setTradeBadge(data.filter((t) => t.incoming && t.status === "pending").length);
  if (!data.length) { box.innerHTML = '<p class="muted">Aucun échange pour le moment.</p>'; return; }
  const STATUS = { accepted: "Accepté", declined: "Refusé", cancelled: "Annulé", pending: "En attente" };
  box.replaceChildren(...data.map((t) => {
    const el = document.createElement("div");
    el.className = `trade ${t.status}`;
    const miniCard = (c) => { const m = makeCard(c, { width: 110 }); m.addEventListener("click", () => openModal(c, 0, false)); return m; };
    // « give » = ce que l'expéditeur donne ; pour moi c'est ce que je reçois quand la proposition est entrante
    const left = t.incoming ? t.want : t.give;   // ce que je donne
    const right = t.incoming ? t.give : t.want;  // ce que je reçois
    const head = document.createElement("div");
    head.className = "thead";
    head.innerHTML = `<b>${t.incoming ? "De " : "Pour "}${esc(t.other)}</b><span class="tstatus">${STATUS[t.status]}</span>`;
    const cards = document.createElement("div");
    cards.className = "tcards";
    const l = document.createElement("div"); l.className = "tside"; l.innerHTML = "<small>Tu donnes</small>"; l.appendChild(miniCard(left));
    const r = document.createElement("div"); r.className = "tside"; r.innerHTML = "<small>Tu reçois</small>"; r.appendChild(miniCard(right));
    const mid = document.createElement("span"); mid.className = "tarrow"; mid.textContent = "⇄";
    cards.append(l, mid, r);
    el.append(head, cards);
    if (t.status === "pending") {
      const act = document.createElement("div");
      act.className = "tact";
      if (t.incoming) {
        const ok = document.createElement("button"); ok.className = "btn small"; ok.textContent = "Accepter";
        const no = document.createElement("button"); no.className = "btn ghost small"; no.textContent = "Refuser";
        const answer = async (accept) => {
          ok.disabled = no.disabled = true;
          const { data: res, error: e } = await db.rpc("respond_trade", { p_id: t.id, p_accept: accept });
          if (e) { toast(errText(e), true); }
          else if (res === "accepted") toast("Échange réalisé !");
          else if (res === "unavailable") toast("L'un de vous n'a plus le doublon : échange annulé.", true);
          await refreshAll();
          renderTrades();
        };
        ok.addEventListener("click", () => answer(true));
        no.addEventListener("click", () => answer(false));
        act.append(ok, no);
      } else {
        const b = document.createElement("button"); b.className = "btn ghost small";
        confirmButton(b, "Annuler la proposition", async () => {
          const { error: e } = await db.rpc("cancel_trade", { p_id: t.id });
          if (e) toast(errText(e), true);
          renderTrades();
        });
        act.appendChild(b);
      }
      el.appendChild(act);
    }
    return el;
  }));
}

function setTradeBadge(n) {
  const b = $("trade-badge"), d = $("market-dot");
  b.hidden = d.hidden = n === 0;
  b.textContent = n;
}
async function refreshTradeBadge() {
  if (!state.userId) return;
  const { data } = await db.rpc("get_trades");
  if (data) setTradeBadge(data.filter((t) => t.incoming && t.status === "pending").length);
}

// Depuis un profil : « Proposer un échange »
function startTradeWith(username) {
  tradeUser = username;
  theirDups = null; wantCard = null; giveCard = null;
  marketTab = "trades";
  showView("market");
}

// ---------- Boutique ----------
function renderShop() {
  const pane = $("m-shop");
  const full = !state.isAdmin && state.stock >= state.cap;
  const afford = state.coins >= econ.booster_price;
  pane.innerHTML = `
    <div class="shop">
      <div class="shop-card">
        <div class="shop-art">🎬</div>
        <div>
          <h3>Booster supplémentaire</h3>
          <p class="muted">Ajoute 1 booster à ton stock (${state.stock}/${state.cap}). Il s'ouvre quand tu veux, sans attendre.</p>
          <div class="sf-row">${priceHTML(econ.booster_price)}<button class="btn" id="buy-booster" ${full || !afford ? "disabled" : ""}>${full ? "Stock plein" : afford ? "Acheter" : "Pas assez de tickets"}</button></div>
        </div>
      </div>
      <div class="box">
        <div class="box-head"><b>Gagner des tickets</b></div>
        <p class="muted">Les tickets viennent des autres joueurs : vends tes cartes sur le marché (même celles que tu n'as qu'en un exemplaire). Le prix est libre, et ${econ.fee_percent} % de frais sont prélevés sur chaque vente.</p>
        <button class="btn ghost" id="go-sell">Mettre une carte en vente</button>
      </div>
    </div>`;
  $("go-sell").addEventListener("click", () => setMarketTab("mine"));
  $("buy-booster").addEventListener("click", async () => {
    $("buy-booster").disabled = true;
    const { error } = await db.rpc("buy_booster");
    if (error) { toast(errText(error), true); renderShop(); return; }
    toast("Booster ajouté à ton stock !");
    await syncLimits();
    renderShop();
  });
}

// ---------- Actions dans la fenêtre de zoom d'une carte ----------
function addModalActions(card, qty, holder) {
  if (qty < 1) return;
  const bar = document.createElement("div");
  bar.className = "modal-actions";
  bar.innerHTML = `<button class="btn small" id="ma-sell">Mettre en vente</button>`;
  holder.appendChild(bar);
  bar.querySelector("#ma-sell").addEventListener("click", async () => {
    await loadEconomy();
    sellCard = card;
    marketTab = "mine";
    $("modal").hidden = true;
    showView("market");
  });
}
