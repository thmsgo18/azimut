/* Azimut — suivi de candidatures de stage.
   Interface 100 % locale : toutes les écritures passent par l'API du serveur,
   qui elle-même passe par les fonctions métier (jamais de SQL direct). */

"use strict";

/* ========================================================================
   État global et utilitaires
   ======================================================================== */

const etat = {
  valeurs: null,          // listes de valeurs autorisées (chargées au démarrage)
  ia: null,               // état des réglages IA (clé définie ou non)
  modeCandidatures: "kanban",
  filtres: { statut: "", priorite: "", sous_domaine: "", texte: "" },
  agendaBase: null,       // premier jour du mois affiché dans l'agenda
  agendaMode: "mois",
  rechercheTexte: "",
  focusRecherche: false,
  propositionEntreprise: null,  // infos entreprise proposées par l'IA, écrites après validation
  selectionComparaison: new Set(),  // ids cochés en vue liste, pour le comparateur
};

/* Couleurs par type d'objet (recherche) et par type d'échéance (agenda) —
   toujours accompagnées d'un libellé texte, jamais la couleur seule. */
const COULEURS_TYPE = {
  candidature: "var(--accent)",
  entreprise: "var(--st-reponse)",
  contact: "var(--violet)",
};
const COULEURS_ECHEANCE = {
  relance: "var(--st-relancee)",
  entretien: "var(--st-entretien)",
  debut: "var(--st-accepte)",
};

/* Icônes SVG des états vides (aucun emoji dans l'interface). */
const ICONES = {
  boussole:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>',
  candidatures:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="5" height="13" rx="1.5"/></svg>',
  entreprises:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5a1.5 1.5 0 0 1 1.5-1.5H13A1.5 1.5 0 0 1 14.5 5v16"/><path d="M14.5 9H18a1.5 1.5 0 0 1 1.5 1.5V21"/><path d="M8 7.5h3M8 11h3M8 14.5h3"/></svg>',
  contacts:
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 20c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2"/><path d="M16.5 5.4a3.4 3.4 0 0 1 0 5.2"/><path d="M17.8 14.9c1.6.8 2.7 2.6 2.9 5.1"/></svg>',
};

const COULEURS_STATUT = {
  "À préparer": "var(--st-a-preparer)",
  "Envoyée": "var(--st-envoyee)",
  "Relancée": "var(--st-relancee)",
  "Réponse reçue": "var(--st-reponse)",
  "Entretien": "var(--st-entretien)",
  "Refus": "var(--st-refus)",
  "Accepté": "var(--st-accepte)",
};

function echapper(texte) {
  const div = document.createElement("div");
  div.textContent = texte == null ? "" : String(texte);
  return div.innerHTML;
}

/* echapper() protège le contenu texte (<, >, &) mais pas les guillemets —
   sans conséquence tant qu'on écrit dans du texte, mais une valeur insérée
   dans un attribut HTML="..." doit AUSSI échapper " (sinon l'attribut se
   referme prématurément au premier guillemet, ex. du JSON stringifié). */
function echapperAttribut(texte) {
  return echapper(texte).replace(/"/g, "&quot;");
}

function dateFr(iso) {
  if (!iso) return "";
  const [annee, mois, jour] = String(iso).split("-");
  return jour && mois ? `${jour}/${mois}/${annee}` : String(iso);
}

function toast(message, erreur = false) {
  const zone = document.getElementById("toasts");
  const element = document.createElement("div");
  element.className = "toast" + (erreur ? " erreur" : "");
  element.textContent = message;
  zone.appendChild(element);
  setTimeout(() => element.remove(), erreur ? 6000 : 3200);
}

async function api(chemin, options = {}) {
  let reponse;
  try {
    reponse = await fetch(chemin, {
      headers: options.corps ? { "Content-Type": "application/json" } : undefined,
      method: options.methode || "GET",
      body: options.corps ? JSON.stringify(options.corps) : undefined,
    });
  } catch {
    throw new Error("Le serveur interne ne répond plus — fermer puis relancer Azimut.");
  }
  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* réponse vide */ }
  if (!reponse.ok) {
    throw new Error((donnees && donnees.erreur) || "Erreur inattendue du serveur.");
  }
  return donnees;
}

/* ========================================================================
   Navigation
   ======================================================================== */

const VUES = {
  bord: vueBord,
  candidatures: vueCandidatures,
  relances: vueRelances,
  agenda: vueAgenda,
  entreprises: vueEntreprises,
  contacts: vueContacts,
  documents: vueDocuments,
  statistiques: vueStats,
  recherche: vueRecherche,
  comparer: vueComparateur,
  reglages: vueReglages,
};

const ACTIVATIONS = {
  candidatures: activerCandidatures,
  relances: activerRelances,
  agenda: activerAgenda,
  recherche: activerRecherche,
  comparer: activerComparateur,
  statistiques: activerStats,
  reglages: activerReglages,
};

async function rendre() {
  const brut = location.hash.replace(/^#\//, "");
  const conteneur = document.getElementById("vue");
  try {
    if (brut.startsWith("entretien/")) {
      // Mode entretien : plein écran, hors navigation classique.
      const numero = Number(brut.split("/")[1]);
      document.querySelectorAll(".nav a").forEach((l) => l.classList.remove("actif"));
      conteneur.innerHTML = await vueModeEntretien(numero);
      activerModeEntretien(numero);
      return;
    }
    const nom = VUES[brut] ? brut : "bord";
    document.querySelectorAll(".nav a").forEach((lien) => {
      lien.classList.toggle("actif", lien.dataset.vue === nom);
    });
    conteneur.innerHTML = await VUES[nom]();
    if (ACTIVATIONS[nom]) ACTIVATIONS[nom]();
  } catch (erreur) {
    conteneur.innerHTML = `<div class="etat-vide"><div class="titre">Impossible de charger la page</div><p>${echapper(erreur.message)}</p></div>`;
  }
}

window.addEventListener("hashchange", rendre);

/* ========================================================================
   Tableau de bord
   ======================================================================== */

function barres(donnees, ordre) {
  const entrees = ordre
    ? ordre.map((libelle) => [libelle, donnees[libelle] || 0])
    : Object.entries(donnees).sort((a, b) => b[1] - a[1]);
  const maximum = Math.max(1, ...entrees.map(([, valeur]) => valeur));
  return entrees
    .map(
      ([libelle, valeur]) => `
      <div class="ligne-barre">
        <span class="libelle" title="${echapper(libelle)}">${echapper(libelle)}</span>
        <div class="piste"><div class="remplissage${valeur === 0 ? " vide" : ""}" style="width:${(valeur / maximum) * 100}%"></div></div>
        <span class="valeur">${valeur}</span>
      </div>`
    )
    .join("");
}

async function vueBord() {
  const stats = await api("/api/stats");
  if (stats.total === 0 && stats.total_contacts === 0) {
    return `
      <div class="entete-vue"><h1>Tableau de bord</h1></div>
      <div class="etat-vide">
        <div class="icone">${ICONES.boussole}</div>
        <div class="titre">Bienvenue dans Azimut</div>
        <p>Ajoute ta première candidature de stage pour voir apparaître ton tableau de bord : statuts, relances à faire et entretiens à venir.</p>
        <button class="btn btn-accent" onclick="ouvrirFormCandidature()">Ajouter ma première candidature</button>
      </div>`;
  }

  const entretiens = stats.entretiens_a_venir
    .map(
      (cand) => `
      <div class="echeance" onclick="ouvrirDetailCandidature(${cand.id})">
        <span class="echeance-date">${dateFr(cand.date_entretien)}</span>
        <div class="echeance-texte">
          <div class="principal">${echapper(cand.entreprise)}</div>
          <div class="secondaire">${echapper(cand.poste)}</div>
        </div>
      </div>`
    )
    .join("");
  const relances = stats.relances_a_faire
    .map(
      (cand) => `
      <div class="echeance" onclick="ouvrirDetailCandidature(${cand.id})">
        <span class="echeance-date">${dateFr(cand.date_relance_prevue)}</span>
        <div class="echeance-texte">
          <div class="principal">${echapper(cand.entreprise)}</div>
          <div class="secondaire">${echapper(cand.poste)}</div>
        </div>
      </div>`
    )
    .join("");

  return `
    <div class="entete-vue">
      <div>
        <h1>Tableau de bord</h1>
        <div class="sous-titre">Vue d'ensemble de ta recherche de stage</div>
      </div>
    </div>
    <div class="rangee-kpi">
      <div class="tuile">
        <div class="tuile-libelle">Candidatures</div>
        <div class="tuile-valeur">${stats.total}</div>
        <div class="tuile-detail">dont ${stats.en_cours} en attente de réponse</div>
      </div>
      <div class="tuile">
        <div class="tuile-libelle">Taux de réponse</div>
        <div class="tuile-valeur">${stats.taux_reponse}<span style="font-size:18px;">%</span></div>
        <div class="tuile-detail">réponses reçues, entretiens inclus</div>
      </div>
      <div class="tuile">
        <div class="tuile-libelle">Entretiens à venir</div>
        <div class="tuile-valeur">${stats.entretiens_a_venir.length}</div>
        <div class="tuile-detail">${stats.par_statut["Entretien"]} candidature(s) au stade entretien</div>
      </div>
      <div class="tuile">
        <div class="tuile-libelle">Contacts</div>
        <div class="tuile-valeur">${stats.total_contacts}</div>
        <div class="tuile-detail">${stats.contacts_par_statut["Répondu"] || 0} ont répondu</div>
      </div>
    </div>
    <div class="grille-bord">
      <div class="carte">
        <h2>Candidatures par statut</h2>
        ${barres(stats.par_statut, etat.valeurs.statuts)}
      </div>
      <div class="carte">
        <h2>Par sous-domaine</h2>
        ${Object.keys(stats.par_domaine).length ? barres(stats.par_domaine) : `<div class="sous-titre">Renseigne le sous-domaine de tes candidatures pour voir la répartition.</div>`}
      </div>
      <div class="carte">
        <h2>Relances à faire</h2>
        ${relances || `<div class="sous-titre">Rien à relancer aujourd'hui.</div>`}
      </div>
      <div class="carte">
        <h2>Entretiens à venir</h2>
        ${entretiens || `<div class="sous-titre">Aucun entretien planifié pour l'instant.</div>`}
      </div>
    </div>`;
}

function activerBord() { /* rien à brancher : liens inline */ }

/* ========================================================================
   Candidatures : kanban + liste
   ======================================================================== */

function candidatureVisible(cand) {
  const f = etat.filtres;
  if (f.statut && cand.statut !== f.statut) return false;
  if (f.priorite && cand.priorite !== f.priorite) return false;
  if (f.sous_domaine && cand.sous_domaine !== f.sous_domaine) return false;
  if (f.texte) {
    const aiguille = f.texte.toLowerCase();
    const botte = `${cand.entreprise} ${cand.poste} ${cand.ville || ""}`.toLowerCase();
    if (!botte.includes(aiguille)) return false;
  }
  return true;
}

function carteCandidature(cand) {
  const puces = [];
  if (cand.priorite === "Haute") {
    puces.push(`<span class="puce puce-priorite-Haute">Priorité haute</span>`);
  }
  if (cand.sous_domaine) {
    puces.push(`<span class="puce">${echapper(cand.sous_domaine)}</span>`);
  }
  return `
    <article class="carte-cand" data-id="${cand.id}">
      <div class="entreprise">${echapper(cand.entreprise)}</div>
      <div class="poste">${echapper(cand.poste)}</div>
      <div class="meta">
        ${puces.join("")}
        <span class="date">${dateFr(cand.date_envoi)}</span>
      </div>
    </article>`;
}

function optionsSelect(liste, selection, avecVide = true) {
  const vide = avecVide ? `<option value="">—</option>` : "";
  return vide + liste
    .map((v) => `<option value="${echapper(v)}"${v === selection ? " selected" : ""}>${echapper(v)}</option>`)
    .join("");
}

async function vueCandidatures() {
  const liste = (await api("/api/candidatures")).filter(candidatureVisible);
  const v = etat.valeurs;
  const filtres = `
    <div class="filtres">
      <input type="text" id="filtre-texte" placeholder="Rechercher…" value="${echapper(etat.filtres.texte)}">
      <select id="filtre-statut">
        <option value="">Tous les statuts</option>
        ${v.statuts.map((s) => `<option${etat.filtres.statut === s ? " selected" : ""}>${echapper(s)}</option>`).join("")}
      </select>
      <select id="filtre-priorite">
        <option value="">Toutes priorités</option>
        ${v.priorites.map((p) => `<option${etat.filtres.priorite === p ? " selected" : ""}>${echapper(p)}</option>`).join("")}
      </select>
      <select id="filtre-domaine">
        <option value="">Tous sous-domaines</option>
        ${v.sous_domaines.map((d) => `<option${etat.filtres.sous_domaine === d ? " selected" : ""}>${echapper(d)}</option>`).join("")}
      </select>
    </div>`;

  let corps;
  if (liste.length === 0) {
    const filtreActif = etat.filtres.statut || etat.filtres.priorite || etat.filtres.sous_domaine || etat.filtres.texte;
    corps = `
      <div class="etat-vide">
        <div class="icone">${ICONES.candidatures}</div>
        <div class="titre">${filtreActif ? "Aucune candidature ne correspond aux filtres" : "Aucune candidature pour l'instant"}</div>
        <p>${filtreActif ? "Essaie d'élargir ou de réinitialiser les filtres." : "Ajoute ta première candidature pour démarrer le suivi."}</p>
        ${filtreActif ? "" : `<button class="btn btn-accent" onclick="ouvrirFormCandidature()">Ajouter une candidature</button>`}
      </div>`;
  } else if (etat.modeCandidatures === "kanban") {
    corps = `<div class="kanban">${v.statuts
      .map((statut) => {
        const cartes = liste.filter((cand) => cand.statut === statut);
        return `
        <section class="colonne" data-statut="${echapper(statut)}" style="--couleur-statut:${COULEURS_STATUT[statut]}">
          <div class="colonne-entete">
            <span class="point"></span>${echapper(statut)}
            <span class="compte">${cartes.length}</span>
          </div>
          <div class="colonne-cartes">${cartes.map(carteCandidature).join("")}</div>
        </section>`;
      })
      .join("")}</div>`;
  } else {
    // Une sélection ne survit que si les candidatures existent encore dans la liste affichée.
    const idsVisibles = new Set(liste.map((c) => c.id));
    for (const id of etat.selectionComparaison) {
      if (!idsVisibles.has(id)) etat.selectionComparaison.delete(id);
    }
    corps = `
      <div class="enveloppe-tableau"><table class="tableau">
        <thead><tr>
          <th></th><th>Entreprise</th><th>Poste</th><th>Statut</th><th>Priorité</th>
          <th>Envoyée le</th><th>Relance prévue</th><th>Ville</th>
        </tr></thead>
        <tbody>
          ${liste
            .map(
              (cand) => `
            <tr onclick="ouvrirDetailCandidature(${cand.id})">
              <td onclick="event.stopPropagation()">
                <input type="checkbox" class="case-comparaison" data-id="${cand.id}"
                       ${etat.selectionComparaison.has(cand.id) ? "checked" : ""}>
              </td>
              <td class="cellule-principale">${echapper(cand.entreprise)}
                ${cand.lien_dernier_etat === "mort" ? `<span class="puce puce-lien-mort" title="Le lien de l'offre ne répond plus">Lien mort</span>` : ""}
              </td>
              <td>${echapper(cand.poste)}</td>
              <td><span class="puce puce-statut" style="--couleur-statut:${COULEURS_STATUT[cand.statut]}"><span class="point"></span>${echapper(cand.statut)}</span></td>
              <td class="cellule-secondaire">${echapper(cand.priorite || "")}</td>
              <td class="cellule-date">${dateFr(cand.date_envoi)}</td>
              <td class="cellule-date">${dateFr(cand.date_relance_prevue)}</td>
              <td class="cellule-secondaire">${echapper(cand.ville || "")}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`;
  }

  const barreComparaison = etat.modeCandidatures === "liste" && etat.selectionComparaison.size >= 2
    ? `<div class="barre-comparaison">
        <span>${etat.selectionComparaison.size} candidatures sélectionnées</span>
        <button class="btn btn-accent" onclick="location.hash='#/comparer'">Comparer</button>
       </div>`
    : "";

  return `
    <div class="entete-vue">
      <h1>Candidatures</h1>
      <div class="bascule">
        <button data-mode="kanban" class="${etat.modeCandidatures === "kanban" ? "actif" : ""}">Pipeline</button>
        <button data-mode="liste" class="${etat.modeCandidatures === "liste" ? "actif" : ""}">Liste</button>
      </div>
      <button class="btn btn-accent" onclick="ouvrirFormCandidature()">+ Ajouter</button>
    </div>
    ${filtres}
    ${barreComparaison}
    ${corps}`;
}

function activerCandidatures() {
  document.querySelectorAll(".bascule button").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      etat.modeCandidatures = bouton.dataset.mode;
      rendre();
    });
  });
  const brancherFiltre = (id, cle, evenement = "change") => {
    const champ = document.getElementById(id);
    if (champ) champ.addEventListener(evenement, () => {
      etat.filtres[cle] = champ.value;
      rendre();
    });
  };
  brancherFiltre("filtre-statut", "statut");
  brancherFiltre("filtre-priorite", "priorite");
  brancherFiltre("filtre-domaine", "sous_domaine");

  document.querySelectorAll(".case-comparaison").forEach((case_) => {
    case_.addEventListener("change", () => {
      const id = Number(case_.dataset.id);
      if (case_.checked) etat.selectionComparaison.add(id);
      else etat.selectionComparaison.delete(id);
      rendre();
    });
  });
  const recherche = document.getElementById("filtre-texte");
  if (recherche) {
    let minuteur;
    recherche.addEventListener("input", () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => {
        etat.filtres.texte = recherche.value;
        const position = recherche.selectionStart;
        rendre().then(() => {
          const champ = document.getElementById("filtre-texte");
          if (champ) { champ.focus(); champ.setSelectionRange(position, position); }
        });
      }, 250);
    });
  }

  // Glisser-déposer entre colonnes du kanban (Pointer Events : fiable à la
  // souris comme au trackpad ; un simple clic ouvre le détail).
  document.querySelectorAll(".carte-cand").forEach((carte) => {
    carte.addEventListener("pointerdown", (depart) => {
      if (depart.button !== 0) return;
      const numero = Number(carte.dataset.id);
      const statutActuel = carte.closest(".colonne")?.dataset.statut;
      let fantome = null;
      let colonneSurvolee = null;

      const surMouvement = (mouvement) => {
        const dx = mouvement.clientX - depart.clientX;
        const dy = mouvement.clientY - depart.clientY;
        if (!fantome) {
          if (Math.hypot(dx, dy) < 6) return;
          const rect = carte.getBoundingClientRect();
          fantome = carte.cloneNode(true);
          fantome.style.cssText =
            `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;` +
            "margin:0;pointer-events:none;z-index:100;opacity:0.92;" +
            "box-shadow:0 12px 32px rgba(0,0,0,0.28);";
          document.body.appendChild(fantome);
          carte.classList.add("en-glisse");
        }
        fantome.style.transform = `translate(${dx}px, ${dy}px) rotate(1.5deg)`;
        const dessous = document.elementFromPoint(mouvement.clientX, mouvement.clientY);
        const colonne = dessous ? dessous.closest(".colonne") : null;
        if (colonneSurvolee && colonneSurvolee !== colonne) {
          colonneSurvolee.classList.remove("survol-depot");
        }
        colonneSurvolee = colonne;
        if (colonne) colonne.classList.add("survol-depot");
      };

      const surFin = async () => {
        document.removeEventListener("pointermove", surMouvement);
        document.removeEventListener("pointerup", surFin);
        if (!fantome) {
          ouvrirDetailCandidature(numero); // simple clic, pas un glissement
          return;
        }
        fantome.remove();
        carte.classList.remove("en-glisse");
        if (colonneSurvolee) {
          colonneSurvolee.classList.remove("survol-depot");
          const statut = colonneSurvolee.dataset.statut;
          if (statut && statut !== statutActuel) {
            try {
              await api(`/api/candidatures/${numero}`, { methode: "PATCH", corps: { statut } });
              toast(`Statut mis à jour : ${statut}`);
              rendre();
            } catch (erreur) {
              toast(erreur.message, true);
            }
          }
        }
      };

      document.addEventListener("pointermove", surMouvement);
      document.addEventListener("pointerup", surFin);
    });
  });
}

/* ========================================================================
   Relances : liste priorisée du jour, un clic pour marquer fait
   ======================================================================== */

async function vueRelances() {
  const liste = await api("/api/relances");
  if (!liste.length) {
    return `
      <div class="entete-vue"><h1>Relances</h1></div>
      <div class="etat-vide">
        <div class="icone">${ICONES.candidatures}</div>
        <div class="titre">Rien à relancer aujourd'hui</div>
        <p>Les candidatures dont la date de relance prévue est aujourd'hui ou dépassée
        apparaîtront ici, des plus urgentes aux plus récentes.</p>
      </div>`;
  }
  const aujourdHui = dateISOLocale(new Date());
  const lignes = liste
    .map((cand) => {
      const enRetard = cand.date_relance_prevue < aujourdHui;
      return `
      <div class="ligne-relance${enRetard ? " en-retard" : ""}">
        <div class="ligne-relance-info" onclick="ouvrirDetailCandidature(${cand.id})">
          <div class="ligne-relance-titre">
            <strong>${echapper(cand.entreprise)}</strong> — ${echapper(cand.poste)}
            ${cand.priorite === "Haute" ? `<span class="puce puce-priorite-Haute">Priorité haute</span>` : ""}
          </div>
          <div class="cellule-secondaire">
            ${enRetard ? `En retard depuis le ${dateFr(cand.date_relance_prevue)}` : "Prévue aujourd'hui"}
            · ${echapper(cand.statut)} · ${cand.nb_relances || 0} relance(s) déjà faite(s)
          </div>
        </div>
        <button type="button" class="btn btn-accent" onclick="marquerRelance(${cand.id})">Relancé</button>
      </div>`;
    })
    .join("");
  return `
    <div class="entete-vue">
      <div><h1>Relances</h1><div class="sous-titre">${liste.length} à faire, des plus urgentes aux plus récentes</div></div>
    </div>
    <div class="carte liste-relances">${lignes}</div>`;
}

function activerRelances() { /* liens inline */ }

async function marquerRelance(id) {
  try {
    await api(`/api/candidatures/${id}/relancer`, { methode: "POST" });
    toast("Relance enregistrée");
    rendre();
  } catch (erreur) {
    toast(erreur.message, true);
  }
}

/* ========================================================================
   Comparateur : plusieurs candidatures côte à côte
   ======================================================================== */

const CRITERES_COMPARATEUR = [
  ["statut", "Statut"],
  ["priorite", "Priorité"],
  ["sous_domaine", "Sous-domaine"],
  ["ville", "Ville"],
  ["mode_travail", "Mode de travail"],
  ["duree", "Durée"],
  ["gratification", "Gratification (€/mois)"],
  ["date_debut_souhaitee", "Début souhaité"],
  ["convention_envoyee", "Convention envoyée"],
  ["source", "Source"],
  ["date_envoi", "Envoyée le"],
  ["date_entretien", "Entretien le"],
];

async function vueComparateur() {
  const ids = [...etat.selectionComparaison];
  if (ids.length < 2) {
    return `
      <div class="entete-vue"><h1>Comparer</h1></div>
      <div class="etat-vide">
        <div class="icone">${ICONES.candidatures}</div>
        <div class="titre">Aucune sélection à comparer</div>
        <p>Dans Candidatures (vue liste), coche au moins deux candidatures puis clique « Comparer ».</p>
        <button class="btn btn-accent" onclick="location.hash='#/candidatures'">Aller aux candidatures</button>
      </div>`;
  }
  const toutes = await api("/api/candidatures");
  const selection = ids.map((id) => toutes.find((c) => c.id === id)).filter(Boolean);
  const formater = (cle, valeur) => {
    if (valeur === null || valeur === undefined || valeur === "") return "—";
    if (cle === "gratification") return `${valeur} €/mois`;
    if (cle.startsWith("date_")) return dateFr(valeur);
    return echapper(valeur);
  };
  const lignes = CRITERES_COMPARATEUR
    .map(
      ([cle, libelle]) => `
      <tr>
        <th>${libelle}</th>
        ${selection.map((cand) => `<td>${formater(cle, cand[cle])}</td>`).join("")}
      </tr>`
    )
    .join("");
  return `
    <div class="entete-vue">
      <h1>Comparer</h1>
      <button class="btn" onclick="viderComparateur()">Vider la sélection</button>
    </div>
    <div class="enveloppe-tableau"><table class="tableau tableau-comparateur">
      <thead><tr>
        <th>Critère</th>
        ${selection.map((cand) => `<th>${echapper(cand.entreprise)}<div class="cellule-secondaire">${echapper(cand.poste)}</div></th>`).join("")}
      </tr></thead>
      <tbody>${lignes}</tbody>
    </table></div>`;
}

function activerComparateur() { /* liens inline */ }

function viderComparateur() {
  etat.selectionComparaison.clear();
  location.hash = "#/candidatures";
}

/* ========================================================================
   Panneau latéral : formulaire candidature (création et édition)
   ======================================================================== */

function ouvrirPanneau(titre, corpsHTML, piedHTML) {
  document.getElementById("panneau-titre").textContent = titre;
  document.getElementById("panneau-corps").innerHTML = corpsHTML;
  document.getElementById("panneau-pied").innerHTML = piedHTML;
  document.getElementById("voile").classList.add("visible");
  const panneau = document.getElementById("panneau");
  panneau.classList.add("ouvert");
  panneau.setAttribute("aria-hidden", "false");
}

function fermerPanneau() {
  document.getElementById("voile").classList.remove("visible");
  const panneau = document.getElementById("panneau");
  panneau.classList.remove("ouvert");
  panneau.setAttribute("aria-hidden", "true");
}

function champTexte(nom, libelle, valeur = "", type = "text", pleineLargeur = false) {
  return `
    <div class="champ${pleineLargeur ? " pleine-largeur" : ""}">
      <label for="champ-${nom}">${libelle}</label>
      <input type="${type}" id="champ-${nom}" name="${nom}" value="${echapper(valeur ?? "")}">
    </div>`;
}

function champSelect(nom, libelle, liste, valeur, avecVide = true) {
  return `
    <div class="champ">
      <label for="champ-${nom}">${libelle}</label>
      <select id="champ-${nom}" name="${nom}">${optionsSelect(liste, valeur, avecVide)}</select>
    </div>`;
}

function champMotDePasse(nom, libelle, valeur = "") {
  return `
    <div class="champ">
      <label for="champ-${nom}">${libelle}</label>
      <div class="champ-mdp">
        <input type="password" id="champ-${nom}" name="${nom}" value="${echapper(valeur ?? "")}" autocomplete="off">
        <button type="button" class="btn btn-discret btn-oeil" data-cible="champ-${nom}">Afficher</button>
      </div>
    </div>`;
}

function champZone(nom, libelle, valeur = "") {
  return `
    <div class="champ pleine-largeur">
      <label for="champ-${nom}">${libelle}</label>
      <textarea id="champ-${nom}" name="${nom}">${echapper(valeur ?? "")}</textarea>
    </div>`;
}

function champAffiche(libelle, contenuHTML, pleineLargeur = false) {
  const vide = contenuHTML === null || contenuHTML === undefined || contenuHTML === "";
  return `
    <div class="champ${pleineLargeur ? " pleine-largeur" : ""}">
      <label>${libelle}</label>
      <div class="valeur-affichee${vide ? " vide" : ""}">${vide ? "—" : contenuHTML}</div>
    </div>`;
}

function champAfficheMotDePasse(nom, libelle, valeur) {
  return `
    <div class="champ">
      <label>${libelle}</label>
      <div class="champ-mdp">
        <input type="password" id="champ-${nom}" value="${echapper(valeur ?? "")}" readonly>
        <button type="button" class="btn btn-discret btn-oeil" data-cible="champ-${nom}">Afficher</button>
      </div>
    </div>`;
}

function lireFormulaire(conteneur) {
  const donnees = {};
  conteneur.querySelectorAll("input[name], select[name], textarea[name]").forEach((champ) => {
    donnees[champ.name] = champ.value === "" ? null : champ.value;
  });
  return donnees;
}

async function ouvrirFormCandidature(cand = null) {
  const v = etat.valeurs;
  const creation = cand === null;
  cand = cand || {};
  let champEntreprise;
  if (creation) {
    const listeEntreprises = await api("/api/entreprises");
    champEntreprise = `
      <div class="champ">
        <label for="champ-entreprise">Entreprise *</label>
        <input type="text" id="champ-entreprise" name="entreprise" list="liste-entreprises" required>
        <datalist id="liste-entreprises">
          ${listeEntreprises.map((ent) => `<option value="${echapper(ent.nom)}">`).join("")}
        </datalist>
      </div>`;
  } else {
    champEntreprise = `
      <div class="champ">
        <label>Entreprise</label>
        <input type="text" value="${echapper(cand.entreprise)}" disabled>
      </div>`;
  }

  const corps = `
    <form id="form-candidature" class="grille-form" onsubmit="return false;">
      ${champEntreprise}
      ${champTexte("poste", "Poste / intitulé *", cand.poste)}
      ${champSelect("statut", "Statut", v.statuts, cand.statut || "À préparer", false)}
      ${champSelect("priorite", "Priorité", v.priorites, cand.priorite || "Moyenne", false)}
      ${champSelect("sous_domaine", "Sous-domaine", v.sous_domaines, cand.sous_domaine)}
      ${champSelect("type_candidature", "Type de candidature", v.types_candidature, cand.type_candidature)}
      ${champSelect("source", "Source", v.sources_candidature, cand.source)}
      ${champTexte("date_envoi", "Date d'envoi", cand.date_envoi, "date")}
      ${champTexte("date_relance_prevue", "Relance prévue le", cand.date_relance_prevue, "date")}
      ${champTexte("nb_relances", "Nb de relances", cand.nb_relances ?? (creation ? 0 : ""), "number")}
      ${champTexte("date_reponse", "Réponse reçue le", cand.date_reponse, "date")}
      ${champTexte("date_entretien", "Entretien le", cand.date_entretien, "date")}
      ${champTexte("date_debut_souhaitee", "Début souhaité le", cand.date_debut_souhaitee, "date")}
      ${champTexte("duree", "Durée", cand.duree)}
      ${champTexte("gratification", "Gratification (€/mois)", cand.gratification, "number")}
      ${champTexte("ville", "Ville", cand.ville)}
      ${champSelect("mode_travail", "Mode de travail", v.modes_travail, cand.mode_travail)}
      ${champSelect("convention_envoyee", "Convention envoyée", v.conventions, cand.convention_envoyee || "Non", false)}
      ${champTexte("lien_offre", "Lien de l'offre", cand.lien_offre, "url", true)}
      ${champTexte("portail_url", "Portail de candidature (URL de connexion)", cand.portail_url, "url", true)}
      ${champTexte("portail_identifiant", "Identifiant du portail", cand.portail_identifiant)}
      ${champMotDePasse("portail_mdp", "Mot de passe du portail", cand.portail_mdp)}
      ${champZone("texte_offre", "Texte de l'offre (archive)", cand.texte_offre)}
      ${champZone("notes", "Notes", cand.notes)}
      ${creation ? "" : champZone("notes_entretien", "Notes d'entretien", cand.notes_entretien)}
    </form>`;

  // À la création : zone d'analyse IA (si une clé API est configurée dans Réglages).
  let zoneIA = "";
  if (creation) {
    zoneIA = etat.ia && etat.ia.cle_api_definie
      ? `
      <div class="zone-ia">
        <label for="ia-texte">Pré-remplir depuis une offre (IA)</label>
        <textarea id="ia-texte" placeholder="Colle ici le texte complet de l'offre — l'IA propose, tu relis, rien n'est enregistré sans toi."></textarea>
        <div class="zone-ia-actions">
          <input type="url" id="ia-lien" placeholder="Lien de l'offre (optionnel)">
          <button type="button" class="btn btn-accent" id="btn-analyser">Analyser</button>
        </div>
      </div>`
      : `
      <p class="astuce-ia">Astuce : ajoute une clé API dans
        <a class="lien-detail" href="#/reglages" onclick="fermerPanneau()">Réglages</a>
        pour pré-remplir ce formulaire en collant le texte d'une offre.</p>`;
  }

  // À la création : joindre tout de suite un ou plusieurs fichiers (offre en
  // PDF, CV, lettre…) — envoyés juste après la création de la candidature.
  let zoneDocuments = "";
  if (creation) {
    zoneDocuments = `
      <div class="zone-ia">
        <label for="fichiers-a-joindre">Joindre des fichiers (offre en PDF, CV, lettre…)</label>
        <div class="zone-ia-actions">
          <select id="fichiers-type" style="max-width:220px;">${optionsSelect(v.types_document, "Offre (PDF)", false)}</select>
          <input type="file" id="fichiers-a-joindre" multiple style="flex:1;">
        </div>
      </div>`;
  }

  // En édition : documents et journal de la candidature.
  let sectionsSupplementaires = "";
  if (!creation) {
    const [journal, docs] = await Promise.all([
      api(`/api/candidatures/${cand.id}/evenements`),
      api(`/api/documents?candidature=${cand.id}`),
    ]);
    sectionsSupplementaires = sectionsCandidature(cand.id, journal, docs);
  }

  const pied = creation
    ? `<button class="btn" onclick="fermerPanneau()">Annuler</button>
       <button class="btn btn-accent" id="btn-enregistrer">Ajouter la candidature</button>`
    : `<button class="btn btn-danger" id="btn-supprimer">Supprimer</button>
       <button class="btn" id="btn-fiche">Fiche entretien</button>
       <button class="btn" id="btn-mode-entretien">Mode entretien</button>
       <button class="btn btn-accent" id="btn-enregistrer">Enregistrer</button>`;

  ouvrirPanneau(
    creation ? "Nouvelle candidature" : `${cand.entreprise} — modifier`,
    zoneIA + corps + zoneDocuments + sectionsSupplementaires,
    pied
  );

  if (creation) {
    etat.propositionEntreprise = null;
    const boutonAnalyser = document.getElementById("btn-analyser");
    if (boutonAnalyser) {
      boutonAnalyser.addEventListener("click", async () => {
        const texte = document.getElementById("ia-texte").value;
        if (!texte.trim()) { toast("Colle d'abord le texte de l'offre.", true); return; }
        boutonAnalyser.disabled = true;
        boutonAnalyser.textContent = "Analyse en cours…";
        try {
          const proposition = await api("/api/agent/analyser", {
            methode: "POST",
            corps: { texte, lien: document.getElementById("ia-lien").value || null },
          });
          remplirDepuisProposition(proposition);
          etat.propositionEntreprise = proposition.entreprise && proposition.entreprise.nom
            ? proposition.entreprise : null;
          toast("Formulaire pré-rempli — relis et corrige avant d'ajouter.");
          if (proposition.avertissement) toast(proposition.avertissement, true);
        } catch (erreur) {
          toast(erreur.message, true);
        } finally {
          boutonAnalyser.disabled = false;
          boutonAnalyser.textContent = "Analyser";
        }
      });
    }
  }

  document.getElementById("btn-enregistrer").addEventListener("click", async () => {
    const donnees = lireFormulaire(document.getElementById("form-candidature"));
    if (donnees.nb_relances !== null && donnees.nb_relances !== undefined) {
      donnees.nb_relances = donnees.nb_relances ?? 0;
    }
    try {
      if (creation) {
        // Avertissement (non bloquant) : intitulé proche ou même lien d'offre
        // qu'une candidature déjà enregistrée. Le vrai doublon (entreprise +
        // poste identiques) reste, lui, refusé net par le serveur.
        const parametres = new URLSearchParams({
          entreprise: donnees.entreprise || "",
          poste: donnees.poste || "",
          lien_offre: donnees.lien_offre || "",
        });
        const similaires = await api(`/api/candidatures/similaires?${parametres}`);
        if (similaires.length && !(await confirmerSimilaires(similaires))) {
          return;
        }
        const creee = await api("/api/candidatures", { methode: "POST", corps: donnees });
        toast(`Candidature ajoutée : ${creee.poste} chez ${creee.entreprise}`);
        // Fichiers joints (offre en PDF, CV…) : envoyés maintenant que la
        // candidature existe.
        const fichiersAJoindre = document.getElementById("fichiers-a-joindre")?.files;
        if (fichiersAJoindre && fichiersAJoindre.length) {
          await televerserDocument(
            creee.id, fichiersAJoindre, document.getElementById("fichiers-type").value, null
          );
        }
        // Infos entreprise proposées par l'IA : écrites seulement maintenant,
        // après validation (les champs déjà remplis ne sont jamais écrasés).
        const proposition = etat.propositionEntreprise;
        etat.propositionEntreprise = null;
        if (proposition && (proposition.site_web || proposition.contexte_actus)) {
          try {
            await api("/api/entreprises", { methode: "POST", corps: proposition });
          } catch (erreurEntreprise) {
            toast(erreurEntreprise.message, true);
          }
        }
      } else {
        await api(`/api/candidatures/${cand.id}`, { methode: "PATCH", corps: donnees });
        toast("Candidature enregistrée");
      }
      fermerPanneau();
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });

  if (!creation) {
    document.getElementById("btn-supprimer").addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer cette candidature ?",
        `« ${cand.poste} » chez ${cand.entreprise} sera définitivement supprimée de la base.`
      );
      if (!accord) return;
      try {
        await api(`/api/candidatures/${cand.id}`, { methode: "DELETE" });
        toast("Candidature supprimée");
        fermerPanneau();
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
    document.getElementById("btn-fiche").addEventListener("click", () => {
      ouvrirFicheEntretien(cand.id);
    });
    document.getElementById("btn-mode-entretien").addEventListener("click", () => {
      fermerPanneau();
      location.hash = `#/entretien/${cand.id}`;
    });
  }
}

function remplirDepuisProposition(proposition) {
  const fixer = (nom, valeur) => {
    const champ = document.getElementById(`champ-${nom}`);
    if (champ && valeur !== null && valeur !== undefined && valeur !== "") champ.value = valeur;
  };
  if (proposition.entreprise && proposition.entreprise.nom) {
    fixer("entreprise", proposition.entreprise.nom);
  }
  const cand = proposition.candidature || {};
  [
    "poste", "sous_domaine", "type_candidature", "ville", "mode_travail", "duree",
    "gratification", "date_debut_souhaitee", "source", "lien_offre", "texte_offre",
  ].forEach((nom) => fixer(nom, cand[nom]));
}

function sectionsCandidature(numero, journal, docs) {
  const lignesDocs = docs
    .map(
      (doc) => `
    <div class="ligne-document">
      <span class="puce">${echapper(doc.type_document || "Autre")}</span>
      <a class="lien-detail" href="/api/documents/${doc.id}/telecharger">${echapper(doc.nom_fichier)}</a>
      <span class="cellule-secondaire">${dateFr(doc.date_ajout)}</span>
      <button type="button" class="btn btn-danger btn-mini" onclick="supprimerDocument(${doc.id}, ${numero})">Supprimer</button>
    </div>`
    )
    .join("");
  const lignesJournal = journal
    .map(
      (evenement) => `
    <div class="ligne-journal">
      <span class="journal-date">${dateFr(evenement.horodatage.slice(0, 10))} ${echapper(evenement.horodatage.slice(11, 16))}</span>
      <span>${echapper(evenement.description)}</span>
    </div>`
    )
    .join("");
  return `
    <h3 class="section-panneau">Documents envoyés</h3>
    ${lignesDocs || `<p class="sous-titre">Aucun document lié à cette candidature.</p>`}
    <div class="ajout-document">
      <select id="doc-type-panneau">${optionsSelect(etat.valeurs.types_document, null, false)}</select>
      <input type="file" id="doc-fichier-panneau" multiple>
      <button type="button" class="btn" id="btn-doc-panneau"
        onclick="televerserDocument(${numero}, document.getElementById('doc-fichier-panneau').files, document.getElementById('doc-type-panneau').value, () => ouvrirDetailCandidature(${numero}))">
        Ajouter</button>
    </div>
    <h3 class="section-panneau">Historique</h3>
    <div class="journal">${lignesJournal || `<p class="sous-titre">Aucun événement enregistré.</p>`}</div>`;
}

function contenuFicheCandidature(cand) {
  const lienOffre = cand.lien_offre
    ? `<a class="lien-detail" href="${echapper(cand.lien_offre)}" target="_blank" rel="noopener">${echapper(cand.lien_offre)}</a>` +
      (cand.lien_dernier_etat === "mort" ? ` <span class="puce puce-lien-mort">Lien mort</span>` : "")
    : null;
  const portailUrl = cand.portail_url
    ? `<a class="lien-detail" href="${echapper(cand.portail_url)}" target="_blank" rel="noopener">${echapper(cand.portail_url)}</a>`
    : null;

  return `
    <div class="fiche-entete-detail">
      <div>
        <h2>${echapper(cand.poste)}</h2>
        <p class="fiche-soustitre">${echapper(cand.entreprise)}${cand.ville ? " · " + echapper(cand.ville) : ""}</p>
      </div>
      ${cand.statut ? `<span class="puce puce-statut" style="--couleur-statut:${COULEURS_STATUT[cand.statut]}"><span class="point"></span>${echapper(cand.statut)}</span>` : ""}
    </div>
    <div class="grille-form">
      ${champAffiche("Priorité", cand.priorite ? echapper(cand.priorite) : null)}
      ${champAffiche("Sous-domaine", cand.sous_domaine ? echapper(cand.sous_domaine) : null)}
      ${champAffiche("Type de candidature", cand.type_candidature ? echapper(cand.type_candidature) : null)}
      ${champAffiche("Source", cand.source ? echapper(cand.source) : null)}
      ${champAffiche("Envoyée le", dateFr(cand.date_envoi))}
      ${champAffiche("Relance prévue le", dateFr(cand.date_relance_prevue))}
      ${champAffiche("Nb de relances", cand.nb_relances || null)}
      ${champAffiche("Réponse reçue le", dateFr(cand.date_reponse))}
      ${champAffiche("Entretien le", dateFr(cand.date_entretien))}
      ${champAffiche("Début souhaité le", dateFr(cand.date_debut_souhaitee))}
      ${champAffiche("Durée", cand.duree ? echapper(cand.duree) : null)}
      ${champAffiche("Gratification", cand.gratification ? `${echapper(cand.gratification)} €/mois` : null)}
      ${champAffiche("Mode de travail", cand.mode_travail ? echapper(cand.mode_travail) : null)}
      ${champAffiche("Convention envoyée", cand.convention_envoyee ? echapper(cand.convention_envoyee) : null)}
      ${champAffiche("Lien de l'offre", lienOffre, true)}
      ${portailUrl ? champAffiche("Portail de candidature", portailUrl, true) : ""}
      ${cand.portail_identifiant ? champAffiche("Identifiant du portail", echapper(cand.portail_identifiant)) : ""}
    </div>
    ${cand.portail_mdp ? champAfficheMotDePasse("mdp-portail-affiche", "Mot de passe du portail", cand.portail_mdp) : ""}
    ${cand.texte_offre ? `<h3 class="section-panneau">Texte de l'offre</h3><div class="texte-long">${echapper(cand.texte_offre)}</div>` : ""}
    ${cand.notes ? `<h3 class="section-panneau">Notes</h3><div class="texte-long">${echapper(cand.notes)}</div>` : ""}
    ${cand.notes_entretien ? `<h3 class="section-panneau">Notes d'entretien</h3><div class="texte-long">${echapper(cand.notes_entretien)}</div>` : ""}`;
}

async function ouvrirDetailCandidature(numero) {
  try {
    const cand = await api(`/api/candidatures/${numero}`);
    const [journal, docs] = await Promise.all([
      api(`/api/candidatures/${numero}/evenements`),
      api(`/api/documents?candidature=${numero}`),
    ]);
    const corps = contenuFicheCandidature(cand) + sectionsCandidature(numero, journal, docs);
    const peutRelancerIA = etat.ia && etat.ia.cle_api_definie
      && ["Envoyée", "Relancée"].includes(cand.statut);
    const pied = `
      <button class="btn btn-danger" id="btn-supprimer">Supprimer</button>
      ${peutRelancerIA ? `<button class="btn" id="btn-brouillon-relance">Brouillon de relance</button>` : ""}
      <button class="btn" id="btn-fiche">Fiche entretien</button>
      <button class="btn" id="btn-mode-entretien">Mode entretien</button>
      <button class="btn btn-accent" id="btn-modifier">Modifier</button>`;
    ouvrirPanneau(`${cand.poste} — ${cand.entreprise}`, corps, pied);

    document.getElementById("btn-modifier").addEventListener("click", () => ouvrirFormCandidature(cand));
    document.getElementById("btn-fiche").addEventListener("click", () => ouvrirFicheEntretien(cand.id));
    document.getElementById("btn-mode-entretien").addEventListener("click", () => {
      fermerPanneau();
      location.hash = `#/entretien/${cand.id}`;
    });
    const boutonRelance = document.getElementById("btn-brouillon-relance");
    if (boutonRelance) {
      boutonRelance.addEventListener("click", async () => {
        boutonRelance.disabled = true;
        boutonRelance.textContent = "Génération…";
        try {
          const resultat = await api(`/api/agent/relance/${numero}`, { methode: "POST", corps: {} });
          ouvrirModale(
            "Brouillon de relance",
            `<p class="sous-titre">À relire avant d'envoyer — rien n'est envoyé automatiquement.</p>
             <textarea id="texte-brouillon-relance" style="min-height:220px;" readonly>${echapper(resultat.texte)}</textarea>`,
            `<button class="btn" onclick="fermerModale()">Fermer</button>
             <button class="btn btn-accent" id="btn-copier-relance">Copier</button>`
          );
          document.getElementById("btn-copier-relance").addEventListener("click", async () => {
            await navigator.clipboard.writeText(document.getElementById("texte-brouillon-relance").value);
            toast("Message copié");
          });
        } catch (erreur) {
          toast(erreur.message, true);
        } finally {
          boutonRelance.disabled = false;
          boutonRelance.textContent = "Brouillon de relance";
        }
      });
    }
    document.getElementById("btn-supprimer").addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer cette candidature ?",
        `« ${cand.poste} » chez ${cand.entreprise} sera définitivement supprimée de la base.`
      );
      if (!accord) return;
      try {
        await api(`/api/candidatures/${numero}`, { methode: "DELETE" });
        toast("Candidature supprimée");
        fermerPanneau();
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  } catch (erreur) {
    toast(erreur.message, true);
  }
}

/* ========================================================================
   Entreprises
   ======================================================================== */

async function vueEntreprises() {
  const [liste, paires] = await Promise.all([
    api("/api/entreprises"),
    api("/api/entreprises/doublons_suspects"),
  ]);
  const cartes = liste
    .map(
      (ent) => `
    <div class="carte carte-entreprise" onclick="ouvrirDetailEntreprise(${ent.id})">
      <div class="nom">${echapper(ent.nom)}</div>
      ${ent.site_web ? `<a class="site" href="${echapper(ent.site_web)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${echapper(ent.site_web)}</a>` : ""}
      <div class="contexte">${echapper(ent.contexte_actus || "Pas encore de contexte — ajoute le résultat de tes recherches (actus, missions, équipe).")}</div>
      <div class="compteurs">
        <span class="puce">${ent.nb_candidatures} candidature${ent.nb_candidatures > 1 ? "s" : ""}</span>
        <span class="puce">${ent.nb_contacts} contact${ent.nb_contacts > 1 ? "s" : ""}</span>
        ${ent.derniere_recherche ? `<span class="puce" title="Dernière recherche">Recherche du ${dateFr(ent.derniere_recherche)}</span>` : ""}
      </div>
    </div>`
    )
    .join("");

  const banniereFusion = paires.length
    ? `<div class="banniere-fusion">
        <span>${paires.length} doublon${paires.length > 1 ? "s" : ""} potentiel${paires.length > 1 ? "s" : ""} détecté${paires.length > 1 ? "s" : ""} (ex. « ${echapper(paires[0].a.nom)} » / « ${echapper(paires[0].b.nom)} »)</span>
        <button class="btn" onclick="ouvrirFusionEntreprises()">Vérifier</button>
      </div>`
    : "";

  return `
    <div class="entete-vue">
      <h1>Entreprises</h1>
      <button class="btn btn-accent" onclick="ouvrirFormEntreprise()">+ Ajouter</button>
    </div>
    ${banniereFusion}
    ${liste.length ? `<div class="grille-entreprises">${cartes}</div>` : `
      <div class="etat-vide">
        <div class="icone">${ICONES.entreprises}</div>
        <div class="titre">Aucune entreprise pour l'instant</div>
        <p>Les entreprises se créent automatiquement quand tu ajoutes une candidature, mais tu peux aussi en préparer une ici.</p>
        <button class="btn btn-accent" onclick="ouvrirFormEntreprise()">Ajouter une entreprise</button>
      </div>`}`;
}

function activerEntreprises() { /* liens inline */ }

async function ouvrirFusionEntreprises() {
  const [paires, liste] = await Promise.all([
    api("/api/entreprises/doublons_suspects"),
    api("/api/entreprises"),
  ]);
  const parId = Object.fromEntries(liste.map((e) => [e.id, e]));
  const ligne = (paire) => {
    const a = parId[paire.a.id] || paire.a;
    const b = parId[paire.b.id] || paire.b;
    const bouton = (garder, fusionner) => `
      <button type="button" class="btn btn-fusion" data-conserver="${garder.id}" data-supprimer="${fusionner.id}">
        Garder « ${echapper(garder.nom)} »
        <span class="cellule-secondaire">(${garder.nb_candidatures ?? 0} cand., ${garder.nb_contacts ?? 0} contact) — fusionner « ${echapper(fusionner.nom)} » dedans</span>
      </button>`;
    return `
      <div class="paire-fusion">
        <div class="paire-fusion-titre">
          <strong>${echapper(a.nom)}</strong> <span class="cellule-secondaire">↔</span> <strong>${echapper(b.nom)}</strong>
          <span class="puce">${Math.round(paire.score * 100)}% proche</span>
        </div>
        <div class="paire-fusion-actions">
          ${bouton(a, b)}
          ${bouton(b, a)}
        </div>
      </div>`;
  };
  ouvrirModale(
    "Entreprises peut-être en double",
    paires.length
      ? `<div class="liste-paires-fusion">${paires.map(ligne).join("")}</div>
         <p class="sous-titre">La fusion déplace les candidatures et contacts, complète les champs vides de l'entreprise conservée, et supprime l'autre. Irréversible.</p>`
      : `<p>Aucun doublon potentiel détecté.</p>`,
    `<button class="btn btn-accent" onclick="fermerModale()">Fermer</button>`
  );
  document.querySelectorAll(".btn-fusion").forEach((bouton) => {
    bouton.addEventListener("click", async () => {
      const conserver = Number(bouton.dataset.conserver);
      const supprimer = Number(bouton.dataset.supprimer);
      try {
        const resultat = await api("/api/entreprises/fusionner", {
          methode: "POST",
          corps: { conserver, supprimer },
        });
        fermerModale();
        toast(
          `Fusion effectuée : ${resultat.candidatures_deplacees} candidature(s) et ` +
          `${resultat.contacts_deplaces} contact(s) déplacé(s) vers « ${resultat.nom} ».`
        );
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  });
}

async function ouvrirFormEntreprise(numero = null) {
  const creation = numero === null;
  let ent = {};
  if (!creation) {
    const liste = await api("/api/entreprises");
    ent = liste.find((e) => e.id === numero) || {};
  }
  const corps = `
    <form id="form-entreprise" class="grille-form" onsubmit="return false;">
      ${champTexte("nom", "Nom *", ent.nom, "text", true)}
      ${champTexte("site_web", "Site web", ent.site_web, "url", true)}
      ${champZone("contexte_actus", "Contexte / actus (résumé de recherche)", ent.contexte_actus)}
      ${champTexte("derniere_recherche", "Dernière recherche le", ent.derniere_recherche, "date", true)}
    </form>`;
  const pied = creation
    ? `<button class="btn" onclick="fermerPanneau()">Annuler</button>
       <button class="btn btn-accent" id="btn-enregistrer">Ajouter l'entreprise</button>`
    : `<button class="btn btn-danger" id="btn-supprimer">Supprimer</button>
       <button class="btn btn-accent" id="btn-enregistrer">Enregistrer</button>`;
  ouvrirPanneau(creation ? "Nouvelle entreprise" : `${ent.nom} — modifier`, corps, pied);

  document.getElementById("btn-enregistrer").addEventListener("click", async () => {
    const donnees = lireFormulaire(document.getElementById("form-entreprise"));
    try {
      if (creation) {
        await api("/api/entreprises", { methode: "POST", corps: donnees });
        toast("Entreprise enregistrée");
      } else {
        await api(`/api/entreprises/${numero}`, { methode: "PATCH", corps: donnees });
        toast("Entreprise enregistrée");
      }
      fermerPanneau();
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });
  if (!creation) {
    document.getElementById("btn-supprimer").addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer cette entreprise ?",
        `« ${ent.nom} » sera supprimée (refusé s'il lui reste des candidatures ou contacts).`
      );
      if (!accord) return;
      try {
        await api(`/api/entreprises/${numero}`, { methode: "DELETE" });
        toast("Entreprise supprimée");
        fermerPanneau();
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  }
}

async function ouvrirDetailEntreprise(numero) {
  try {
    const [listeEntreprises, listeContacts, listeCandidatures] = await Promise.all([
      api("/api/entreprises"),
      api("/api/contacts"),
      api("/api/candidatures"),
    ]);
    const ent = listeEntreprises.find((e) => e.id === numero);
    if (!ent) { toast("Entreprise introuvable.", true); return; }
    const contactsEnt = listeContacts.filter((c) => c.entreprise === ent.nom);
    const candidaturesEnt = listeCandidatures.filter((c) => c.entreprise === ent.nom);

    const ligneContact = (c) => `
      <div class="ligne-liee" onclick="ouvrirDetailContact(${c.id})">
        <span class="cellule-principale">${echapper(c.nom)}${c.poste ? ` <span class="cellule-secondaire">— ${echapper(c.poste)}</span>` : ""}</span>
        ${c.statut_contact ? `<span class="puce">${echapper(c.statut_contact)}</span>` : ""}
      </div>`;
    const ligneCandidature = (c) => `
      <div class="ligne-liee" onclick="ouvrirDetailCandidature(${c.id})">
        <span class="cellule-principale">${echapper(c.poste)}</span>
        <span class="puce puce-statut" style="--couleur-statut:${COULEURS_STATUT[c.statut]}"><span class="point"></span>${echapper(c.statut)}</span>
      </div>`;

    const corps = `
      <div class="fiche-entete-detail">
        <div>
          <h2>${echapper(ent.nom)}</h2>
          ${ent.site_web ? `<p class="fiche-soustitre"><a class="lien-detail" href="${echapper(ent.site_web)}" target="_blank" rel="noopener">${echapper(ent.site_web)}</a></p>` : ""}
        </div>
      </div>
      <h3 class="section-panneau">Contexte / actus</h3>
      ${ent.contexte_actus
        ? `<div class="texte-long">${echapper(ent.contexte_actus)}</div>`
        : `<div class="valeur-affichee vide">Pas encore de contexte — ajoute le résultat de tes recherches.</div>`}
      ${ent.derniere_recherche ? `<p class="cellule-secondaire" style="margin-top:8px;">Dernière recherche le ${dateFr(ent.derniere_recherche)}</p>` : ""}

      <h3 class="section-panneau">Contacts (${contactsEnt.length})</h3>
      ${contactsEnt.length ? `<div class="liste-liee">${contactsEnt.map(ligneContact).join("")}</div>` : `<p class="sous-titre">Aucun contact pour l'instant.</p>`}

      <h3 class="section-panneau">Candidatures (${candidaturesEnt.length})</h3>
      ${candidaturesEnt.length ? `<div class="liste-liee">${candidaturesEnt.map(ligneCandidature).join("")}</div>` : `<p class="sous-titre">Aucune candidature pour l'instant.</p>`}`;

    const pied = `
      <button class="btn btn-danger" id="btn-supprimer">Supprimer</button>
      <button class="btn btn-accent" id="btn-modifier">Modifier</button>`;
    ouvrirPanneau(ent.nom, corps, pied);

    document.getElementById("btn-modifier").addEventListener("click", () => ouvrirFormEntreprise(numero));
    document.getElementById("btn-supprimer").addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer cette entreprise ?",
        `« ${ent.nom} » sera supprimée (refusé s'il lui reste des candidatures ou contacts).`
      );
      if (!accord) return;
      try {
        await api(`/api/entreprises/${numero}`, { methode: "DELETE" });
        toast("Entreprise supprimée");
        fermerPanneau();
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  } catch (erreur) {
    toast(erreur.message, true);
  }
}

/* ========================================================================
   Contacts
   ======================================================================== */

async function vueContacts() {
  const liste = await api("/api/contacts");
  const lignes = liste
    .map(
      (contact) => `
    <tr onclick="ouvrirDetailContact(${contact.id})">
      <td class="cellule-principale">${echapper(contact.nom)}</td>
      <td>${echapper(contact.entreprise)}</td>
      <td class="cellule-secondaire">${echapper(contact.poste || "")}</td>
      <td class="cellule-secondaire">${echapper(contact.valeur_contact || "")}</td>
      <td><span class="puce">${echapper(contact.statut_contact || "")}</span></td>
      <td class="cellule-date">${dateFr(contact.date_contact)}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="entete-vue">
      <h1>Contacts</h1>
      <button class="btn btn-accent" onclick="ouvrirFormContact()">+ Ajouter</button>
    </div>
    ${liste.length ? `
      <div class="enveloppe-tableau"><table class="tableau">
        <thead><tr><th>Nom</th><th>Entreprise</th><th>Poste</th><th>Contact</th><th>Statut</th><th>Contacté le</th></tr></thead>
        <tbody>${lignes}</tbody>
      </table></div>` : `
      <div class="etat-vide">
        <div class="icone">${ICONES.contacts}</div>
        <div class="titre">Aucun contact pour l'instant</div>
        <p>Ajoute les personnes repérées dans les équipes visées : recruteurs, leads, alumni…</p>
        <button class="btn btn-accent" onclick="ouvrirFormContact()">Ajouter un contact</button>
      </div>`}`;
}

function activerContacts() { /* liens inline */ }

async function ouvrirDetailContact(numero) {
  try {
    const [liste, listeEntreprises] = await Promise.all([
      api("/api/contacts"),
      api("/api/entreprises"),
    ]);
    const contact = liste.find((c) => c.id === numero);
    if (!contact) { toast("Contact introuvable.", true); return; }
    const entreprise = listeEntreprises.find((e) => e.nom === contact.entreprise);

    let valeurContact = null;
    if (contact.valeur_contact) {
      if (contact.type_contact === "Email") {
        valeurContact = `<a class="lien-detail" href="mailto:${echapper(contact.valeur_contact)}">${echapper(contact.valeur_contact)}</a>`;
      } else if (/^https?:\/\//i.test(contact.valeur_contact)) {
        valeurContact = `<a class="lien-detail" href="${echapper(contact.valeur_contact)}" target="_blank" rel="noopener">${echapper(contact.valeur_contact)}</a>`;
      } else {
        valeurContact = echapper(contact.valeur_contact);
      }
    }
    const ligneEntreprise = entreprise
      ? `<a class="lien-detail" href="#" onclick="event.preventDefault(); ouvrirDetailEntreprise(${entreprise.id})">${echapper(contact.entreprise)}</a>`
      : echapper(contact.entreprise);

    const corps = `
      <div class="fiche-entete-detail">
        <div>
          <h2>${echapper(contact.nom)}</h2>
          <p class="fiche-soustitre">${ligneEntreprise}${contact.poste ? " · " + echapper(contact.poste) : ""}</p>
        </div>
        ${contact.statut_contact ? `<span class="puce">${echapper(contact.statut_contact)}</span>` : ""}
      </div>
      <div class="grille-form">
        ${champAffiche("Équipe", contact.equipe ? echapper(contact.equipe) : null)}
        ${champAffiche("Type de contact", contact.type_contact ? echapper(contact.type_contact) : null)}
        ${champAffiche("Email / lien / téléphone", valeurContact, true)}
        ${champAffiche("Contacté le", dateFr(contact.date_contact))}
        ${champAffiche("Trouvé via", contact.source ? echapper(contact.source) : null)}
      </div>
      ${contact.notes ? `<h3 class="section-panneau">Notes</h3><div class="texte-long">${echapper(contact.notes)}</div>` : ""}`;

    const pied = `
      <button class="btn btn-danger" id="btn-supprimer">Supprimer</button>
      <button class="btn btn-accent" id="btn-modifier">Modifier</button>`;
    ouvrirPanneau(contact.nom, corps, pied);

    document.getElementById("btn-modifier").addEventListener("click", () => ouvrirFormContact(numero));
    document.getElementById("btn-supprimer").addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer ce contact ?",
        `${contact.nom} (${contact.entreprise}) sera supprimé de la base.`
      );
      if (!accord) return;
      try {
        await api(`/api/contacts/${numero}`, { methode: "DELETE" });
        toast("Contact supprimé");
        fermerPanneau();
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  } catch (erreur) {
    toast(erreur.message, true);
  }
}

async function ouvrirFormContact(numero = null) {
  const v = etat.valeurs;
  const creation = numero === null;
  let contact = {};
  const listeEntreprises = await api("/api/entreprises");
  if (!creation) {
    const liste = await api("/api/contacts");
    contact = liste.find((c) => c.id === numero) || {};
  }
  const champEntreprise = creation
    ? `<div class="champ">
        <label for="champ-entreprise">Entreprise *</label>
        <input type="text" id="champ-entreprise" name="entreprise" list="liste-entreprises" required>
        <datalist id="liste-entreprises">
          ${listeEntreprises.map((ent) => `<option value="${echapper(ent.nom)}">`).join("")}
        </datalist>
      </div>`
    : `<div class="champ"><label>Entreprise</label>
        <input type="text" value="${echapper(contact.entreprise)}" disabled></div>`;

  const corps = `
    <form id="form-contact" class="grille-form" onsubmit="return false;">
      ${champEntreprise}
      ${champTexte("nom", "Nom *", contact.nom)}
      ${champTexte("poste", "Poste", contact.poste)}
      ${champTexte("equipe", "Équipe", contact.equipe)}
      ${champSelect("type_contact", "Type de contact", v.types_contact, contact.type_contact)}
      ${champTexte("valeur_contact", "Email / lien / téléphone", contact.valeur_contact)}
      ${champSelect("statut_contact", "Statut", v.statuts_contact, contact.statut_contact || "À contacter", false)}
      ${champTexte("date_contact", "Contacté le", contact.date_contact, "date")}
      ${champSelect("source", "Trouvé via", v.sources_contact, contact.source)}
      ${champZone("notes", "Notes", contact.notes)}
    </form>`;
  const pied = creation
    ? `<button class="btn" onclick="fermerPanneau()">Annuler</button>
       <button class="btn btn-accent" id="btn-enregistrer">Ajouter le contact</button>`
    : `<button class="btn btn-danger" id="btn-supprimer">Supprimer</button>
       <button class="btn btn-accent" id="btn-enregistrer">Enregistrer</button>`;
  ouvrirPanneau(creation ? "Nouveau contact" : `${contact.nom} — modifier`, corps, pied);

  document.getElementById("btn-enregistrer").addEventListener("click", async () => {
    const donnees = lireFormulaire(document.getElementById("form-contact"));
    try {
      if (creation) {
        await api("/api/contacts", { methode: "POST", corps: donnees });
        toast("Contact ajouté");
      } else {
        await api(`/api/contacts/${numero}`, { methode: "PATCH", corps: donnees });
        toast("Contact enregistré");
      }
      fermerPanneau();
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });
  if (!creation) {
    document.getElementById("btn-supprimer").addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer ce contact ?",
        `${contact.nom} (${contact.entreprise}) sera supprimé de la base.`
      );
      if (!accord) return;
      try {
        await api(`/api/contacts/${numero}`, { methode: "DELETE" });
        toast("Contact supprimé");
        fermerPanneau();
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  }
}

/* ========================================================================
   Agenda : échéances en vue mois / 2 semaines, export .ics
   ======================================================================== */

function dateISOLocale(objet) {
  return `${objet.getFullYear()}-${String(objet.getMonth() + 1).padStart(2, "0")}-${String(objet.getDate()).padStart(2, "0")}`;
}

/* Lien « Ajouter à Google Agenda » pré-rempli pour une échéance (événement
   d'une journée). Google n'acceptant pas les abonnements à une adresse
   locale, ce lien par-événement est la voie recommandée pour Google Agenda. */
function lienGoogleAgenda(echeance) {
  const debut = new Date(`${echeance.date}T00:00:00`);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 1);
  const format = (d) => dateISOLocale(d).replace(/-/g, "");
  const parametres = new URLSearchParams({
    action: "TEMPLATE",
    text: `${echeance.libelle} — ${echeance.entreprise}`,
    dates: `${format(debut)}/${format(fin)}`,
    details: echeance.poste,
  });
  return `https://www.google.com/calendar/render?${parametres}`;
}

function chipEcheance(echeance) {
  const donneesEcheance = echapperAttribut(JSON.stringify(echeance));
  return `
    <span class="chip-echeance-groupe" style="--couleur-statut:${COULEURS_ECHEANCE[echeance.type]}">
      <button class="chip-echeance"
              onclick="ouvrirDetailCandidature(${echeance.candidature_id})"
              title="${echapper(echeance.libelle)} — ${echapper(echeance.entreprise)} (${echapper(echeance.poste)})">
        <span class="point"></span>${echapper(echeance.libelle)} · ${echapper(echeance.entreprise)}
      </button>
      <a class="chip-echeance-ajout" href="${lienGoogleAgenda(echeance)}" target="_blank" rel="noopener"
         title="Ajouter à Google Agenda" onclick="event.stopPropagation()">+</a>
      <button type="button" class="chip-echeance-ajout" data-echeance="${donneesEcheance}"
              title="Envoyer vers l'app Rappels (macOS)"
              onclick="event.stopPropagation(); pousserRappelDepuisBouton(this)">R</button>
    </span>`;
}

async function pousserRappelDepuisBouton(bouton) {
  const echeance = JSON.parse(bouton.dataset.echeance);
  const texteInitial = bouton.textContent;
  bouton.textContent = "…";
  try {
    await api("/api/rappels/echeance", { methode: "POST", corps: echeance });
    toast("Rappel créé dans l'app Rappels");
    bouton.textContent = "✓";
    setTimeout(() => { bouton.textContent = texteInitial; }, 1500);
  } catch (erreur) {
    toast(erreur.message, true);
    bouton.textContent = texteInitial;
  }
}

async function vueAgenda() {
  const echeances = await api("/api/agenda");
  if (!etat.agendaBase) {
    const maintenant = new Date();
    etat.agendaBase = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  }
  const parJour = {};
  echeances.forEach((e) => (parJour[e.date] = parJour[e.date] || []).push(e));

  const entete = `
    <div class="entete-vue">
      <h1>Agenda</h1>
      <div class="bascule">
        <button data-agenda="mois" class="${etat.agendaMode === "mois" ? "actif" : ""}">Mois</button>
        <button data-agenda="semaine" class="${etat.agendaMode === "semaine" ? "actif" : ""}">2 semaines</button>
      </div>
      <a class="btn" href="/api/agenda/ics" title="À importer dans Calendrier, Google Agenda ou Outlook">Exporter (.ics)</a>
      <button class="btn btn-accent" onclick="ouvrirConnexionCalendrier()">Connecter un calendrier</button>
    </div>
    <div class="legende-agenda">
      <span class="puce puce-statut" style="--couleur-statut:${COULEURS_ECHEANCE.relance}"><span class="point"></span>Relance prévue</span>
      <span class="puce puce-statut" style="--couleur-statut:${COULEURS_ECHEANCE.entretien}"><span class="point"></span>Entretien</span>
      <span class="puce puce-statut" style="--couleur-statut:${COULEURS_ECHEANCE.debut}"><span class="point"></span>Début souhaité</span>
    </div>`;

  if (etat.agendaMode === "semaine") {
    const blocs = [];
    const curseur = new Date();
    for (let i = 0; i < 14; i++) {
      const iso = dateISOLocale(curseur);
      const jour = parJour[iso] || [];
      if (jour.length) {
        const libelle = curseur.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        blocs.push(`
          <div class="jour-semaine">
            <div class="jour-semaine-titre">${echapper(libelle)}${i === 0 ? " — aujourd'hui" : ""}</div>
            ${jour.map(chipEcheance).join("")}
          </div>`);
      }
      curseur.setDate(curseur.getDate() + 1);
    }
    return entete + (blocs.length
      ? `<div class="carte">${blocs.join("")}</div>`
      : `<div class="etat-vide"><div class="titre">Rien dans les 14 prochains jours</div><p>Les relances prévues, entretiens et débuts souhaités apparaîtront ici.</p></div>`);
  }

  // Vue mois
  const base = etat.agendaBase;
  const nomMois = base.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const decalage = (new Date(base.getFullYear(), base.getMonth(), 1).getDay() + 6) % 7; // lundi = 0
  const joursDansMois = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const aujourdHui = dateISOLocale(new Date());
  const cellules = [];
  for (let i = 0; i < decalage; i++) cellules.push(`<div class="cellule-jour hors-mois"></div>`);
  for (let jour = 1; jour <= joursDansMois; jour++) {
    const iso = dateISOLocale(new Date(base.getFullYear(), base.getMonth(), jour));
    const evenementsJour = parJour[iso] || [];
    const visibles = evenementsJour.slice(0, 3).map(chipEcheance).join("");
    const reste = evenementsJour.length > 3 ? `<span class="sous-titre">+${evenementsJour.length - 3}</span>` : "";
    cellules.push(`
      <div class="cellule-jour${iso === aujourdHui ? " aujourdhui" : ""}">
        <div class="jour-numero">${jour}</div>
        ${visibles}${reste}
      </div>`);
  }
  return `${entete}
    <div class="agenda-nav">
      <button class="btn" id="agenda-precedent">‹</button>
      <div class="agenda-mois">${echapper(nomMois)}</div>
      <button class="btn" id="agenda-suivant">›</button>
      <button class="btn btn-discret" id="agenda-aujourdhui">Aujourd'hui</button>
    </div>
    <div class="grille-agenda-entete">${["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."].map((j) => `<div>${j}</div>`).join("")}</div>
    <div class="grille-agenda">${cellules.join("")}</div>`;
}

function activerAgenda() {
  document.querySelectorAll("[data-agenda]").forEach((bouton) => {
    bouton.addEventListener("click", () => { etat.agendaMode = bouton.dataset.agenda; rendre(); });
  });
  const decaler = (mois) => {
    etat.agendaBase = new Date(etat.agendaBase.getFullYear(), etat.agendaBase.getMonth() + mois, 1);
    rendre();
  };
  const precedent = document.getElementById("agenda-precedent");
  if (precedent) {
    precedent.addEventListener("click", () => decaler(-1));
    document.getElementById("agenda-suivant").addEventListener("click", () => decaler(1));
    document.getElementById("agenda-aujourdhui").addEventListener("click", () => {
      const maintenant = new Date();
      etat.agendaBase = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
      rendre();
    });
  }
}

/* « S'abonner » (webcal, en direct tant qu'Azimut tourne) pour Calendrier/
   Outlook, et marche à suivre pour Google Agenda (pas d'abonnement possible
   sur une adresse locale : lien par événement ou import du fichier .ics). */
function ouvrirConnexionCalendrier() {
  const lienAbonnement = location.origin.replace(/^http/, "webcal") + "/api/agenda/abonnement.ics";
  ouvrirModale(
    "Connecter un calendrier",
    `
    <div class="bloc-calendrier">
      <h3>Calendrier (Mac) et applications compatibles webcal</h3>
      <p class="sous-titre">S'abonner comme calendrier « en direct » : les échéances se mettent à jour
        automatiquement à chaque ouverture du calendrier, tant qu'Azimut est lancé.</p>
      <a class="btn btn-accent" href="${lienAbonnement}">S'abonner dans Calendrier</a>
    </div>
    <div class="bloc-calendrier">
      <h3>Google Agenda</h3>
      <p class="sous-titre">Google n'accepte pas les abonnements à une adresse locale (celle de ta
        machine) : deux façons de faire à la place.</p>
      <ul>
        <li>Ajouter une échéance précise : le bouton <strong>+</strong> à côté de chaque échéance
          dans l'agenda ouvre Google Agenda pré-rempli.</li>
        <li>Tout importer d'un coup : télécharger le fichier ci-dessous, puis dans Google Agenda →
          Paramètres → Importer et exporter → Importer.</li>
      </ul>
      <a class="btn" href="/api/agenda/ics">Télécharger le fichier .ics</a>
    </div>
    <div class="bloc-calendrier">
      <h3>Outlook et autres</h3>
      <p class="sous-titre">Le même fichier .ics s'importe dans la plupart des applications de
        calendrier (Outlook, Thunderbird…) ; certaines acceptent aussi l'abonnement par URL ci-dessus.</p>
    </div>
    <div class="bloc-calendrier">
      <h3>App Rappels (macOS)</h3>
      <p class="sous-titre">En plus du calendrier, chaque échéance peut aussi devenir un rappel daté
        (bouton <strong>R</strong> à côté de chaque échéance), ou toutes d'un coup ci-dessous. La toute
        première fois, macOS demande d'autoriser Azimut à automatiser Rappels — à accorder une fois.</p>
      <button class="btn" id="btn-tout-pousser-rappels">Envoyer toutes les échéances vers Rappels</button>
      <p class="sous-titre" id="resultat-rappels" style="margin-top:8px;"></p>
    </div>`,
    `<button class="btn btn-accent" onclick="fermerModale()">Fermer</button>`
  );
  document.getElementById("btn-tout-pousser-rappels").addEventListener("click", async (evenement) => {
    const bouton = evenement.currentTarget;
    bouton.disabled = true;
    bouton.textContent = "Envoi en cours…";
    try {
      const resultat = await api("/api/rappels/tout_pousser", { methode: "POST" });
      document.getElementById("resultat-rappels").textContent =
        `${resultat.reussies} rappel(s) créé(s)` + (resultat.echouees ? `, ${resultat.echouees} échec(s).` : ".");
      toast(`${resultat.reussies} rappel(s) envoyé(s) vers Rappels`);
    } catch (erreur) {
      toast(erreur.message, true);
    } finally {
      bouton.disabled = false;
      bouton.textContent = "Envoyer toutes les échéances vers Rappels";
    }
  });
}

/* ========================================================================
   Documents : CV / lettres envoyés, par candidature
   ======================================================================== */

async function vueDocuments() {
  const liste = await api("/api/documents");
  const lignes = liste
    .map(
      (doc) => `
    <tr>
      <td class="cellule-principale">${echapper(doc.nom_fichier)}</td>
      <td><span class="puce">${echapper(doc.type_document || "Autre")}</span></td>
      <td>${echapper(doc.entreprise)} <span class="cellule-secondaire">— ${echapper(doc.poste)}</span></td>
      <td class="cellule-date">${dateFr(doc.date_ajout)}</td>
      <td>
        <a class="btn btn-discret" href="/api/documents/${doc.id}/telecharger">Télécharger</a>
        <button class="btn btn-danger" onclick="supprimerDocument(${doc.id}, null)">Supprimer</button>
      </td>
    </tr>`
    )
    .join("");
  return `
    <div class="entete-vue">
      <h1>Documents</h1>
      <button class="btn btn-accent" onclick="ouvrirFormDocument()">+ Ajouter</button>
    </div>
    ${liste.length ? `
      <div class="enveloppe-tableau"><table class="tableau">
        <thead><tr><th>Fichier</th><th>Type</th><th>Candidature</th><th>Ajouté le</th><th></th></tr></thead>
        <tbody>${lignes}</tbody>
      </table></div>` : `
      <div class="etat-vide">
        <div class="icone">${ICONES.candidatures}</div>
        <div class="titre">Aucun document pour l'instant</div>
        <p>Associe à chaque candidature le CV et la lettre envoyés, pour retrouver « ce que j'ai envoyé chez X ».</p>
        <button class="btn btn-accent" onclick="ouvrirFormDocument()">Ajouter un document</button>
      </div>`}`;
}

async function ouvrirFormDocument() {
  const candidaturesListe = await api("/api/candidatures");
  if (!candidaturesListe.length) {
    toast("Ajoute d'abord une candidature.", true);
    return;
  }
  ouvrirModale(
    "Ajouter un document",
    `<div class="grille-form">
      <div class="champ pleine-largeur">
        <label for="doc-candidature">Candidature</label>
        <select id="doc-candidature">
          ${candidaturesListe.map((c) => `<option value="${c.id}">${echapper(c.entreprise)} — ${echapper(c.poste)}</option>`).join("")}
        </select>
      </div>
      <div class="champ">
        <label for="doc-type">Type</label>
        <select id="doc-type">${optionsSelect(etat.valeurs.types_document, null, false)}</select>
      </div>
      <div class="champ">
        <label for="doc-fichier">Fichier(s) — PDF ou autre</label>
        <input type="file" id="doc-fichier" multiple>
      </div>
    </div>`,
    `<button class="btn" onclick="fermerModale()">Annuler</button>
     <button class="btn btn-accent" id="btn-doc-ajouter">Ajouter</button>`,
    true
  );
  document.getElementById("btn-doc-ajouter").addEventListener("click", async () => {
    const fichiers = document.getElementById("doc-fichier").files;
    await televerserDocument(
      Number(document.getElementById("doc-candidature").value),
      fichiers,
      document.getElementById("doc-type").value,
      () => { fermerModale(); rendre(); }
    );
  });
}

/* Téléverse un ou plusieurs fichiers (offre en PDF, CV, lettre…) liés à une
   candidature. Accepte un seul File ou une FileList/tableau de plusieurs. */
async function televerserDocument(candidatureId, fichiers, type, apres) {
  const liste = fichiers instanceof FileList || Array.isArray(fichiers)
    ? Array.from(fichiers)
    : fichiers ? [fichiers] : [];
  if (!liste.length) {
    toast("Choisir d'abord un fichier.", true);
    return;
  }
  let reussis = 0;
  const erreurs = [];
  for (const fichier of liste) {
    const formulaire = new FormData();
    formulaire.append("fichier", fichier);
    formulaire.append("type", type);
    try {
      const reponse = await fetch(`/api/candidatures/${candidatureId}/documents`, {
        method: "POST", body: formulaire,
      });
      const donnees = await reponse.json();
      if (!reponse.ok) throw new Error(donnees.erreur || "Envoi du fichier impossible.");
      reussis += 1;
    } catch (erreur) {
      erreurs.push(`${fichier.name} : ${erreur.message}`);
    }
  }
  if (reussis) {
    toast(reussis === 1 ? "Document ajouté" : `${reussis} documents ajoutés`);
  }
  erreurs.forEach((message) => toast(message, true));
  if (reussis && apres) apres();
}

async function supprimerDocument(idDocument, idCandidature) {
  const accord = await confirmer(
    "Supprimer ce document ?",
    "Le fichier sera définitivement supprimé du dossier documents/."
  );
  if (!accord) return;
  try {
    await api(`/api/documents/${idDocument}`, { methode: "DELETE" });
    toast("Document supprimé");
    if (idCandidature) ouvrirDetailCandidature(idCandidature);
    else rendre();
  } catch (erreur) {
    toast(erreur.message, true);
  }
}

/* ========================================================================
   Statistiques avancées
   ======================================================================== */

function graphiqueHebdomadaire(serie) {
  const largeur = 600;
  const hauteur = 140;
  const marge = { haut: 10, bas: 20, cote: 6 };
  const zoneH = hauteur - marge.haut - marge.bas;
  const zoneL = largeur - marge.cote * 2;
  const maximum = Math.max(1, ...serie.map((s) => s.nombre));
  const pas = serie.length > 1 ? zoneL / (serie.length - 1) : 0;
  const points = serie.map((s, i) => ({
    ...s,
    x: marge.cote + i * pas,
    y: marge.haut + zoneH - (s.nombre / maximum) * zoneH,
  }));
  const chemin = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const base = marge.haut + zoneH;
  const aire = `${chemin} L${points[points.length - 1].x.toFixed(1)},${base} L${points[0].x.toFixed(1)},${base} Z`;
  const cercles = points
    .map((p) => `
      <circle class="point-graphique" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3">
        <title>Semaine du ${dateFr(p.debut)} au ${dateFr(p.fin)} : ${p.nombre} candidature${p.nombre > 1 ? "s" : ""} envoyée${p.nombre > 1 ? "s" : ""}</title>
      </circle>`)
    .join("");
  const premiere = points[0];
  const derniere = points[points.length - 1];
  return `
    <svg viewBox="0 0 ${largeur} ${hauteur}" class="graphique-ligne" preserveAspectRatio="none" role="img" aria-label="Candidatures envoyées par semaine, 12 dernières semaines">
      <line x1="${marge.cote}" y1="${base}" x2="${largeur - marge.cote}" y2="${base}" class="axe-graphique"/>
      <path d="${aire}" class="aire-graphique"/>
      <path d="${chemin}" class="trait-graphique"/>
      ${cercles}
      <text x="${premiere.x}" y="${hauteur - 4}" class="etiquette-graphique">${dateFr(premiere.debut)}</text>
      <text x="${derniere.x}" y="${hauteur - 4}" class="etiquette-graphique" text-anchor="end">${dateFr(derniere.debut)}</text>
    </svg>`;
}

async function vueStats() {
  const stats = await api("/api/stats/avancees");
  const liens = await api("/api/liens/etat");
  const obj = stats.objectif_hebdomadaire;
  if (!stats.total) {
    return `
      <div class="entete-vue"><h1>Statistiques</h1></div>
      <div class="etat-vide">
        <div class="icone">${ICONES.candidatures}</div>
        <div class="titre">Pas encore de données</div>
        <p>Les statistiques (entonnoir, délais, sources) apparaîtront dès tes premières candidatures.</p>
      </div>`;
  }
  const maximum = Math.max(1, ...stats.entonnoir.map((e) => e.nombre));
  const entonnoir = stats.entonnoir
    .map(
      (etape) => `
      <div class="ligne-barre">
        <span class="libelle">${echapper(etape.etape)}</span>
        <div class="piste"><div class="remplissage${etape.nombre === 0 ? " vide" : ""}" style="width:${(etape.nombre / maximum) * 100}%"></div></div>
        <span class="valeur">${etape.nombre}<span class="taux-detail"> · ${etape.taux}%</span></span>
      </div>`
    )
    .join("");
  const sources = stats.par_source
    .map(
      (source) => `
      <tr>
        <td class="cellule-principale">${echapper(source.source)}</td>
        <td>${source.envoyees}</td>
        <td>${source.reponses}</td>
        <td>
          <div class="ligne-barre ligne-barre-compacte">
            <div class="piste"><div class="remplissage${source.taux === 0 ? " vide" : ""}" style="width:${source.taux}%"></div></div>
            <span class="valeur">${source.taux}%</span>
          </div>
        </td>
      </tr>`
    )
    .join("");
  return `
    <div class="entete-vue">
      <div><h1>Statistiques</h1><div class="sous-titre">Ce qui marche, ce qui traîne — pour ajuster le tir</div></div>
    </div>
    <div class="rangee-kpi">
      <div class="tuile">
        <div class="tuile-libelle">Délai moyen de réponse</div>
        <div class="tuile-valeur">${stats.delai_moyen_reponse != null ? stats.delai_moyen_reponse + '<span style="font-size:16px;"> j</span>' : "—"}</div>
        <div class="tuile-detail">${stats.nb_delais_reponse ? `sur ${stats.nb_delais_reponse} réponse(s) datée(s)` : "aucune réponse datée pour l'instant"}</div>
      </div>
      <div class="tuile">
        <div class="tuile-libelle">Délai moyen jusqu'à l'entretien</div>
        <div class="tuile-valeur">${stats.delai_moyen_entretien != null ? stats.delai_moyen_entretien + '<span style="font-size:16px;"> j</span>' : "—"}</div>
        <div class="tuile-detail">entre l'envoi et la date d'entretien</div>
      </div>
    </div>
    <div class="grille-bord">
      <div class="carte">
        <h2>Candidatures envoyées par semaine</h2>
        ${graphiqueHebdomadaire(stats.serie_hebdomadaire)}
      </div>
      <div class="carte">
        <h2>Objectif hebdomadaire</h2>
        ${obj ? `
          <div class="ligne-barre">
            <span class="libelle">${obj.nombre} / ${obj.objectif} envoyées</span>
            <div class="piste"><div class="remplissage${obj.atteint ? " atteint" : ""}" style="width:${obj.pourcentage}%"></div></div>
            <span class="valeur">${obj.pourcentage}%</span>
          </div>
          <p class="sous-titre">Semaine du ${dateFr(obj.debut_semaine)} au ${dateFr(obj.fin_semaine)}${obj.atteint ? " — objectif atteint, bravo !" : "."}</p>
        ` : `<p class="sous-titre">Règle un objectif hebdomadaire dans <a class="lien-detail" href="#/reglages">Réglages</a> pour suivre ta progression ici.</p>`}
      </div>
      <div class="carte">
        <h2>Entonnoir (taux par rapport aux envoyées)</h2>
        ${entonnoir}
      </div>
      <div class="carte">
        <h2>Par source</h2>
        ${stats.par_source.length ? `
          <div class="enveloppe-tableau" style="border:none;"><table class="tableau" style="border:none;">
            <thead><tr><th>Source</th><th>Envoyées</th><th>Réponses</th><th>Taux de réponse</th></tr></thead>
            <tbody>${sources}</tbody>
          </table></div>` : `<div class="sous-titre">Renseigne la source de tes candidatures pour comparer.</div>`}
      </div>
      <div class="carte">
        <h2>Liens d'offres</h2>
        <p class="sous-titre">Un ping HTTP conservateur : seul un lien clairement retiré (404/410) est
        signalé « mort » — souvent le signe que le poste a été pourvu.</p>
        <div class="rangee-kpi" style="margin:12px 0;">
          <div class="tuile"><div class="tuile-libelle">Actifs</div><div class="tuile-valeur">${liens.actifs}</div></div>
          <div class="tuile"><div class="tuile-libelle">Morts</div><div class="tuile-valeur">${liens.morts}</div></div>
          <div class="tuile"><div class="tuile-libelle">Non vérifiés</div><div class="tuile-valeur">${liens.non_verifies}</div></div>
        </div>
        ${liens.liens_morts.length ? liens.liens_morts.map((l) => `
          <div class="ligne-lien-mort">
            <span onclick="ouvrirDetailCandidature(${l.id})" style="cursor:pointer;">
              <strong>${echapper(l.entreprise)}</strong> — ${echapper(l.poste)}
            </span>
            <a class="lien-detail" href="${echapper(l.lien_offre)}" target="_blank" rel="noopener">Voir l'offre</a>
          </div>`).join("") : ""}
        <div class="actions-reglages">
          <button class="btn btn-accent" id="btn-verifier-liens">Vérifier maintenant</button>
        </div>
        <p class="sous-titre" id="resultat-verification-liens" style="margin-top:8px;"></p>
      </div>
    </div>`;
}

function activerStats() {
  const bouton = document.getElementById("btn-verifier-liens");
  if (!bouton) return;
  bouton.addEventListener("click", async () => {
    bouton.disabled = true;
    bouton.textContent = "Vérification en cours…";
    try {
      const resultat = await api("/api/liens/verifier", { methode: "POST", corps: {} });
      document.getElementById("resultat-verification-liens").textContent =
        `${resultat.verifies} lien(s) vérifié(s) : ${resultat.actifs} actif(s), ` +
        `${resultat.morts} mort(s), ${resultat.inconnus} indéterminé(s).`;
      toast("Vérification terminée");
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    } finally {
      bouton.disabled = false;
      bouton.textContent = "Vérifier maintenant";
    }
  });
}

/* ========================================================================
   Recherche globale (Cmd+K)
   ======================================================================== */

function resultatRecherche(type, libelle, clic, titre, sousTitre, objet) {
  return `
    <div class="resultat" style="--couleur-type:${COULEURS_TYPE[type]}" onclick="${clic}">
      <div class="resultat-entete">
        <span class="badge-type">${libelle}</span>
        <span class="resultat-titre">${echapper(titre)}</span>
        <span class="resultat-sous">${echapper(sousTitre || "")}</span>
      </div>
      ${objet.extrait ? `<div class="resultat-extrait">${echapper(objet.extrait)}</div>` : ""}
      <div class="resultat-champs">Trouvé dans : ${objet.champs_trouves.map((c) => `<span class="puce">${echapper(c)}</span>`).join(" ")}</div>
    </div>`;
}

async function vueRecherche() {
  const requete = etat.rechercheTexte.trim();
  let corps = `<div class="etat-vide"><div class="icone">${ICONES.boussole}</div>
    <div class="titre">Tout retrouver, d'un coup d'œil</div>
    <p>Tape un mot : candidatures, entreprises et contacts sont fouillés partout (postes, notes, offres, emails…). Raccourci : ⌘K.</p></div>`;
  if (requete) {
    const resultats = await api(`/api/recherche?q=${encodeURIComponent(requete)}`);
    const rendus = [
      ...resultats.candidatures.map((c) =>
        resultatRecherche("candidature", "Candidature", `ouvrirDetailCandidature(${c.id})`,
          `${c.entreprise} — ${c.poste}`, `${c.statut}${c.ville ? " · " + c.ville : ""}`, c)),
      ...resultats.entreprises.map((e) =>
        resultatRecherche("entreprise", "Entreprise", `ouvrirDetailEntreprise(${e.id})`,
          e.nom, e.site_web || "", e)),
      ...resultats.contacts.map((c) =>
        resultatRecherche("contact", "Contact", `ouvrirDetailContact(${c.id})`,
          c.nom, `${c.entreprise}${c.poste ? " · " + c.poste : ""}`, c)),
    ];
    corps = rendus.length
      ? `<div class="liste-resultats">${rendus.join("")}</div>
         <p class="sous-titre">${rendus.length} résultat(s) — ${resultats.candidatures.length} candidature(s), ${resultats.entreprises.length} entreprise(s), ${resultats.contacts.length} contact(s)</p>`
      : `<div class="etat-vide"><div class="titre">Aucun résultat pour « ${echapper(requete)} »</div><p>La recherche ignore la casse et les accents. Essaie un mot plus court.</p></div>`;
  }
  return `
    <div class="entete-vue"><h1>Recherche</h1></div>
    <input type="text" id="champ-recherche" class="champ-recherche-grande"
           placeholder="Rechercher partout — entreprise, poste, note, contact…" value="${echapper(etat.rechercheTexte)}">
    ${corps}`;
}

function activerRecherche() {
  const champ = document.getElementById("champ-recherche");
  if (!champ) return;
  if (etat.focusRecherche) {
    champ.focus();
    champ.select();
    etat.focusRecherche = false;
  }
  let minuteur;
  champ.addEventListener("input", () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      etat.rechercheTexte = champ.value;
      const position = champ.selectionStart;
      rendre().then(() => {
        const nouveau = document.getElementById("champ-recherche");
        if (nouveau) { nouveau.focus(); nouveau.setSelectionRange(position, position); }
      });
    }, 280);
  });
}

/* ========================================================================
   Réglages : clé API, modèle, sauvegardes
   ======================================================================== */

async function vueReglages() {
  const r = await api("/api/reglages");
  etat.ia = r;
  const modelesAnthropic = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
  const estAnthropic = r.fournisseur_ia !== "openai_compatible";
  return `
    <div class="entete-vue">
      <div><h1>Réglages</h1><div class="sous-titre">Assistant IA, dossier de données, sauvegardes — tout reste sur cette machine</div></div>
    </div>
    <div class="grille-bord">
      <div class="carte">
        <h2>Assistant IA — analyse d'offres</h2>
        <p class="sous-titre">Avec une clé API — de n'importe quel fournisseur —, le formulaire
        « Nouvelle candidature » sait se pré-remplir en collant le texte d'une offre. La clé est
        stockée dans la base locale, masquée dans l'interface, jamais exportée ni partagée. Rien
        n'est écrit sans ta validation.</p>

        <div class="champ" style="margin-top:12px; max-width:320px;">
          <label for="reg-fournisseur">Fournisseur</label>
          <select id="reg-fournisseur">
            <option value="anthropic"${estAnthropic ? " selected" : ""}>Anthropic (Claude)</option>
            <option value="openai_compatible"${!estAnthropic ? " selected" : ""}>Compatible OpenAI (OpenAI, Mistral, Groq, Gemini, Ollama…)</option>
          </select>
        </div>

        <div class="champ" style="margin-top:10px;">
          <label for="reg-cle">Clé API</label>
          <div class="champ-mdp">
            <input type="password" id="reg-cle" autocomplete="off"
                   placeholder="${r.cle_api_definie ? `Clé enregistrée (${echapper(r.cle_api_masquee)}) — coller ici pour la remplacer` : "sk-…"}">
            <button type="button" class="btn btn-discret btn-oeil" data-cible="reg-cle">Afficher</button>
          </div>
        </div>

        <div id="bloc-fournisseur-anthropic" class="champ" style="margin-top:10px; max-width:320px;"${estAnthropic ? "" : " hidden"}>
          <label for="reg-modele-anthropic">Modèle</label>
          <select id="reg-modele-anthropic">
            ${modelesAnthropic.map((m) => `<option${m === r.modele_ia ? " selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>

        <div id="bloc-fournisseur-generique"${estAnthropic ? " hidden" : ""}>
          <div class="champ" style="margin-top:10px;">
            <label for="reg-modele-generique">Nom du modèle</label>
            <input type="text" id="reg-modele-generique"
                   placeholder="gpt-4o-mini, mistral-large-latest, gemini-2.0-flash, llama3.1 (Ollama)…"
                   value="${!estAnthropic ? echapper(r.modele_ia || "") : ""}">
          </div>
          <div class="champ" style="margin-top:10px;">
            <label for="reg-base-url">URL de base (optionnel)</label>
            <input type="text" id="reg-base-url"
                   placeholder="Vide = api.openai.com — ou l'URL d'un autre fournisseur"
                   value="${echapper(r.ia_base_url || "")}">
          </div>
          <p class="sous-titre">Exemples : Google Gemini → https://generativelanguage.googleapis.com/v1beta/openai/
          · Mistral → https://api.mistral.ai/v1 · Groq → https://api.groq.com/openai/v1
          · Ollama local → http://localhost:11434/v1</p>
        </div>

        <label class="case" id="ligne-recherche-web"${estAnthropic ? "" : " hidden"}>
          <input type="checkbox" id="reg-web" ${r.recherche_web === "Oui" ? "checked" : ""}>
          Chercher automatiquement le contexte de l'entreprise sur le web (Anthropic uniquement, un appel de plus par analyse)
        </label>
        ${estAnthropic ? "" : `<p class="sous-titre">La recherche automatique de contexte entreprise n'est disponible qu'avec Anthropic.</p>`}

        <div class="actions-reglages">
          <button class="btn btn-accent" id="reg-enregistrer">Enregistrer</button>
          <button class="btn" id="reg-tester"${r.cle_api_definie ? "" : " disabled"}>Tester la connexion</button>
          ${r.cle_api_definie ? `<button class="btn btn-danger" id="reg-supprimer-cle">Supprimer la clé</button>` : ""}
        </div>
      </div>

      <div class="carte">
        <h2>Dossier de données</h2>
        <p class="sous-titre">Documents joints (CV, lettres, offres en PDF) et sauvegardes de la
        base sont rangés ici, comme n'importe quel autre dossier — visibles et mis à jour dans le
        Finder en temps réel. Choisis un dossier suivi par iCloud Drive ou Dropbox pour qu'ils s'y
        synchronisent automatiquement, ou garde l'emplacement par défaut.</p>
        <div class="champ" style="margin-top:12px;">
          <label>Emplacement actuel</label>
          <input type="text" value="${echapper(r.dossier_donnees || "Par défaut — dossier du programme")}" readonly>
        </div>
        <div class="actions-reglages">
          <button class="btn btn-accent" id="reg-choisir-dossier">Choisir un dossier…</button>
          ${r.dossier_donnees ? `<button class="btn" id="reg-dossier-defaut">Revenir à l'emplacement par défaut</button>` : ""}
        </div>
        <p class="sous-titre">Les fichiers déjà présents dans l'ancien emplacement n'y sont pas
        déplacés automatiquement — seuls les prochains y sont écrits.</p>
      </div>

      <div class="carte">
        <h2>Sauvegardes</h2>
        <p class="sous-titre">Une copie datée de la base est créée automatiquement à chaque lancement
        de l'appli (les 10 dernières sont conservées). L'export Excel est la sauvegarde lisible et
        partageable ; la copie de la base est la sauvegarde intégrale (mots de passe et réglages compris).</p>
        <div class="actions-reglages">
          <button class="btn btn-accent" id="reg-sauvegarder">Sauvegarder maintenant</button>
        </div>
        <div id="reg-resultat-sauvegarde" class="sous-titre" style="margin-top:8px;"></div>
      </div>

      <div class="carte">
        <h2>Objectif hebdomadaire</h2>
        <p class="sous-titre">Un nombre de candidatures à envoyer chaque semaine (lundi-dimanche) —
        la progression s'affiche dans Statistiques. Laisser vide pour désactiver.</p>
        <div class="champ" style="margin-top:12px; max-width:160px;">
          <label for="reg-objectif">Candidatures envoyées / semaine</label>
          <input type="number" id="reg-objectif" min="1" step="1"
                 value="${echapper(r.objectif_hebdomadaire || "")}" placeholder="ex. 5">
        </div>
        <div class="actions-reglages">
          <button class="btn btn-accent" id="reg-enregistrer-objectif">Enregistrer</button>
        </div>
      </div>

      <div class="carte">
        <h2>Notifications proactives</h2>
        <p class="sous-titre">Avec <code>Azimut Widget.app</code> ouvert (barre de menus), une
        notification macOS s'affiche dès qu'un lien d'offre meurt ou qu'une relance devient due —
        sans avoir besoin d'ouvrir la fenêtre principale. La première fois, macOS demande
        d'autoriser les notifications pour le widget.</p>
        <label class="case" style="margin-top:10px;">
          <input type="checkbox" id="reg-notifications" ${r.notifications_macos === "Oui" ? "checked" : ""}>
          Activer les notifications proactives
        </label>
      </div>

      <div class="carte">
        <h2>Capture rapide depuis Safari</h2>
        <p class="sous-titre">Un Raccourci macOS pour envoyer la page (ou le texte sélectionné) vue
        dans Safari directement vers Azimut, en brouillon à compléter — Azimut doit être ouvert pour
        le recevoir. À construire une fois dans l'app Raccourcis :</p>
        <div class="bloc-raccourci">
          <ol>
            <li>Nouveau Raccourci, ajouter <strong>« Obtenir la page web actuelle »</strong> (Safari).</li>
            <li>Ajouter <strong>« Obtenir le contenu de l'URL »</strong> : méthode <code>POST</code>,
              URL <code>${echapper(location.origin)}/api/rapide/offre</code>, corps JSON avec les champs
              <code>lien</code> (la page web actuelle) et <code>texte</code> (le texte sélectionné, si besoin
              via « Obtenir le texte sélectionné » avant cette étape).</li>
            <li>Ajouter <strong>« Afficher une notification »</strong> pour voir le résultat.</li>
            <li>Épingler le Raccourci au Dock, au menu Partage, ou lui donner un raccourci clavier.</li>
          </ol>
        </div>
        <p class="sous-titre" style="margin-top:8px;">La candidature créée porte un statut « À préparer »
        et une note qui rappelle son origine — à relire et compléter dans Azimut.</p>
      </div>

      <div class="carte">
        <h2>Pour les IA (Claude Code ou autre)</h2>
        <p class="sous-titre">Avec ou sans clé API ici, n'importe quelle IA peut alimenter la base
        proprement : le fichier <code>CLAUDE.md</code> à la racine du projet documente les fonctions
        Python, la CLI et les règles (valeurs autorisées, anti-doublons, jamais de SQL direct).
        Il suffit d'ouvrir le dossier du projet avec l'IA et de lui coller une offre.</p>
      </div>
    </div>`;
}

function activerReglages() {
  const bouton = document.getElementById("reg-enregistrer");
  if (!bouton) return;

  const selectFournisseur = document.getElementById("reg-fournisseur");
  selectFournisseur.addEventListener("change", () => {
    const estAnthropic = selectFournisseur.value !== "openai_compatible";
    document.getElementById("bloc-fournisseur-anthropic").hidden = !estAnthropic;
    document.getElementById("bloc-fournisseur-generique").hidden = estAnthropic;
    document.getElementById("ligne-recherche-web").hidden = !estAnthropic;
  });

  bouton.addEventListener("click", async () => {
    const estAnthropic = selectFournisseur.value !== "openai_compatible";
    const corps = {
      fournisseur_ia: selectFournisseur.value,
      recherche_web: document.getElementById("reg-web").checked ? "Oui" : "Non",
    };
    if (estAnthropic) {
      corps.modele_ia = document.getElementById("reg-modele-anthropic").value;
      corps.ia_base_url = "";
    } else {
      corps.modele_ia = document.getElementById("reg-modele-generique").value.trim();
      corps.ia_base_url = document.getElementById("reg-base-url").value.trim();
    }
    const cle = document.getElementById("reg-cle").value.trim();
    if (cle) corps.cle_api = cle;
    try {
      etat.ia = await api("/api/reglages", { methode: "POST", corps });
      toast("Réglages enregistrés");
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });

  document.getElementById("reg-tester").addEventListener("click", async (evenement) => {
    const cible = evenement.currentTarget;
    cible.disabled = true;
    cible.textContent = "Test en cours…";
    try {
      const resultat = await api("/api/agent/tester", { methode: "POST" });
      toast(`Connexion réussie (${resultat.fournisseur} — ${resultat.modele})`);
    } catch (erreur) {
      toast(erreur.message, true);
    } finally {
      cible.disabled = false;
      cible.textContent = "Tester la connexion";
    }
  });

  const supprimerCle = document.getElementById("reg-supprimer-cle");
  if (supprimerCle) {
    supprimerCle.addEventListener("click", async () => {
      const accord = await confirmer(
        "Supprimer la clé API ?",
        "L'analyse d'offres sera désactivée jusqu'à ce qu'une nouvelle clé soit enregistrée."
      );
      if (!accord) return;
      try {
        etat.ia = await api("/api/reglages", { methode: "POST", corps: { cle_api: "" } });
        toast("Clé supprimée");
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  }

  document.getElementById("reg-sauvegarder").addEventListener("click", async () => {
    try {
      const resultat = await api("/api/sauvegarde", { methode: "POST" });
      document.getElementById("reg-resultat-sauvegarde").textContent =
        `Sauvegarde créée : ${resultat.chemin}`;
      toast("Base sauvegardée");
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });

  // Dossier de données : sélecteur natif si l'app de bureau l'expose, sinon
  // saisie manuelle (aussi ce qui s'affiche en aperçu navigateur).
  document.getElementById("reg-choisir-dossier").addEventListener("click", async () => {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.choisir_dossier_donnees) {
      try {
        const dossier = await window.pywebview.api.choisir_dossier_donnees();
        if (dossier) {
          toast("Dossier de données mis à jour");
          rendre();
        }
      } catch (erreur) {
        toast("Sélecteur indisponible : " + erreur.message, true);
      }
      return;
    }
    const chemin = await demanderTexte(
      "Dossier de données",
      "/Users/toi/Documents/Azimut",
      etat.ia.dossier_donnees || ""
    );
    if (chemin === null) return;
    try {
      await api("/api/reglages/dossier_donnees", { methode: "POST", corps: { dossier: chemin } });
      toast("Dossier de données mis à jour");
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });

  const boutonDefaut = document.getElementById("reg-dossier-defaut");
  if (boutonDefaut) {
    boutonDefaut.addEventListener("click", async () => {
      try {
        await api("/api/reglages/dossier_donnees", { methode: "POST", corps: { dossier: "" } });
        toast("Retour à l'emplacement par défaut");
        rendre();
      } catch (erreur) {
        toast(erreur.message, true);
      }
    });
  }

  document.getElementById("reg-enregistrer-objectif").addEventListener("click", async () => {
    const valeur = document.getElementById("reg-objectif").value.trim();
    try {
      await api("/api/reglages", { methode: "POST", corps: { objectif_hebdomadaire: valeur } });
      toast(valeur ? "Objectif enregistré" : "Objectif désactivé");
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });

  document.getElementById("reg-notifications").addEventListener("change", async (evenement) => {
    try {
      await api("/api/reglages", {
        methode: "POST",
        corps: { notifications_macos: evenement.target.checked ? "Oui" : "Non" },
      });
      toast(evenement.target.checked ? "Notifications activées" : "Notifications désactivées");
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });
}

/* ========================================================================
   Mode entretien : fiche à gauche, notes en direct à droite
   ======================================================================== */

async function vueModeEntretien(numero) {
  const [fiche, cand] = await Promise.all([
    api(`/api/entretien/${numero}`),
    api(`/api/candidatures/${numero}`),
  ]);
  return `
    <div class="entete-vue">
      <button class="btn" onclick="location.hash='#/candidatures'">← Retour</button>
      <div style="flex:1;">
        <h1>${echapper(cand.entreprise)}</h1>
        <div class="sous-titre">${echapper(cand.poste)} — mode entretien${cand.date_entretien ? " · " + dateFr(cand.date_entretien) : ""}</div>
      </div>
      <span class="sous-titre" id="indicateur-notes"></span>
    </div>
    <div class="mode-entretien">
      <div class="carte fiche">${rendreMarkdown(fiche.markdown)}</div>
      <div class="carte colonne-notes">
        <h2>Notes d'entretien</h2>
        <textarea id="zone-notes-entretien"
          placeholder="Prends tes notes ici pendant le rendez-vous — elles s'enregistrent automatiquement dans la candidature.">${echapper(cand.notes_entretien || "")}</textarea>
      </div>
    </div>`;
}

function activerModeEntretien(numero) {
  const zone = document.getElementById("zone-notes-entretien");
  const indicateur = document.getElementById("indicateur-notes");
  if (!zone) return;
  zone.focus();
  let minuteur;
  zone.addEventListener("input", () => {
    indicateur.textContent = "Enregistrement…";
    clearTimeout(minuteur);
    minuteur = setTimeout(async () => {
      try {
        await api(`/api/candidatures/${numero}`, {
          methode: "PATCH",
          corps: { notes_entretien: zone.value },
        });
        const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        indicateur.textContent = `Enregistré à ${heure}`;
      } catch (erreur) {
        indicateur.textContent = "";
        toast(erreur.message, true);
      }
    }, 800);
  });
}

/* ========================================================================
   Modale : fiche entretien + confirmations
   ======================================================================== */

function ouvrirModale(titre, corpsHTML, piedHTML, etroite = false) {
  document.getElementById("modale-titre").textContent = titre;
  document.getElementById("modale-corps").innerHTML = corpsHTML;
  document.getElementById("modale-pied").innerHTML = piedHTML;
  document.getElementById("modale-boite").classList.toggle("etroite", etroite);
  document.getElementById("modale").classList.add("visible");
}

function fermerModale() {
  document.getElementById("modale").classList.remove("visible");
}

function confirmer(titre, message) {
  return new Promise((resoudre) => {
    ouvrirModale(
      titre,
      `<p>${echapper(message)}</p>`,
      `<button class="btn" id="btn-annuler">Annuler</button>
       <button class="btn btn-accent" id="btn-confirmer" style="background:var(--danger);border-color:var(--danger);">Supprimer</button>`,
      true
    );
    document.getElementById("btn-annuler").addEventListener("click", () => {
      fermerModale();
      resoudre(false);
    });
    document.getElementById("btn-confirmer").addEventListener("click", () => {
      fermerModale();
      resoudre(true);
    });
  });
}

/* Petite saisie de texte modale (remplace prompt(), pas fiable dans une
   WKWebView) — utilisée pour la saisie manuelle du dossier de données. */
function demanderTexte(titre, placeholder, valeurInitiale = "") {
  return new Promise((resoudre) => {
    ouvrirModale(
      titre,
      `<input type="text" id="champ-demande-texte" value="${echapper(valeurInitiale)}"
              placeholder="${echapper(placeholder)}" style="width:100%;">`,
      `<button class="btn" id="btn-annuler-texte">Annuler</button>
       <button class="btn btn-accent" id="btn-valider-texte">Valider</button>`,
      true
    );
    const champ = document.getElementById("champ-demande-texte");
    champ.focus();
    champ.select();
    const valider = () => {
      const valeur = champ.value;
      fermerModale();
      resoudre(valeur);
    };
    document.getElementById("btn-valider-texte").addEventListener("click", valider);
    champ.addEventListener("keydown", (evenement) => {
      if (evenement.key === "Enter") valider();
    });
    document.getElementById("btn-annuler-texte").addEventListener("click", () => {
      fermerModale();
      resoudre(null);
    });
  });
}

/* Avertissement de quasi-doublon (pas un blocage) : intitulé proche ou même
   lien d'offre qu'une candidature déjà en base. L'utilisateur tranche. */
function confirmerSimilaires(liste) {
  const lignes = liste
    .map(
      (r) => `
      <div class="ligne-similaire">
        <div><strong>${echapper(r.entreprise)}</strong> — ${echapper(r.poste)}
          <span class="cellule-secondaire">(${echapper(r.statut)})</span></div>
        <div>${r.raisons.map((raison) => `<span class="puce">${echapper(raison)}</span>`).join(" ")}</div>
      </div>`
    )
    .join("");
  return new Promise((resoudre) => {
    ouvrirModale(
      "Candidature(s) proche(s) trouvée(s)",
      `<p>Ça ressemble peut-être à une candidature déjà enregistrée :</p>
       <div class="liste-similaires">${lignes}</div>
       <p class="sous-titre">Ce n'est qu'un avertissement — si c'est bien une candidature différente, continue normalement.</p>`,
      `<button class="btn" id="btn-annuler-similaire">Modifier avant d'ajouter</button>
       <button class="btn btn-accent" id="btn-continuer-similaire">Créer quand même</button>`,
      true
    );
    document.getElementById("btn-annuler-similaire").addEventListener("click", () => {
      fermerModale();
      resoudre(false);
    });
    document.getElementById("btn-continuer-similaire").addEventListener("click", () => {
      fermerModale();
      resoudre(true);
    });
  });
}

/* Mini-rendu Markdown (structure connue de la fiche : titres, listes, gras, italique) */
function rendreMarkdown(texte) {
  const lignes = echapper(texte).split("\n");
  const sortie = [];
  let dansListe = false;
  const fermerListe = () => {
    if (dansListe) { sortie.push("</ul>"); dansListe = false; }
  };
  const enrichir = (ligne) =>
    ligne
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  for (const ligne of lignes) {
    if (ligne.startsWith("# ")) {
      fermerListe();
      sortie.push(`<h1>${enrichir(ligne.slice(2))}</h1>`);
    } else if (ligne.startsWith("## ")) {
      fermerListe();
      sortie.push(`<h2>${enrichir(ligne.slice(3))}</h2>`);
    } else if (ligne.startsWith("- ")) {
      if (!dansListe) { sortie.push("<ul>"); dansListe = true; }
      sortie.push(`<li>${enrichir(ligne.slice(2))}</li>`);
    } else if (ligne.trim() === "") {
      fermerListe();
    } else {
      fermerListe();
      sortie.push(`<p>${enrichir(ligne)}</p>`);
    }
  }
  fermerListe();
  return sortie.join("\n");
}

async function ouvrirFicheEntretien(numero) {
  try {
    const fiche = await api(`/api/entretien/${numero}`);
    ouvrirModale(
      "Fiche de préparation d'entretien",
      `<div class="fiche">${rendreMarkdown(fiche.markdown)}</div>`,
      `<a class="btn" href="/api/entretien/${numero}/telecharger">Télécharger en .md</a>
       <button class="btn btn-accent" onclick="fermerModale()">Fermer</button>`
    );
  } catch (erreur) {
    toast(erreur.message, true);
  }
}

/* ========================================================================
   Branchements globaux et démarrage
   ======================================================================== */

document.getElementById("btn-nouvelle").addEventListener("click", () => ouvrirFormCandidature());
document.getElementById("panneau-fermer").addEventListener("click", fermerPanneau);
document.getElementById("voile").addEventListener("click", fermerPanneau);
document.getElementById("modale-fermer").addEventListener("click", fermerModale);
document.getElementById("modale").addEventListener("click", (evenement) => {
  if (evenement.target === document.getElementById("modale")) fermerModale();
});
document.addEventListener("keydown", (evenement) => {
  if (evenement.key === "Escape") { fermerPanneau(); fermerModale(); }
  if ((evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "k") {
    evenement.preventDefault();
    etat.focusRecherche = true;
    if (location.hash === "#/recherche") rendre();
    else location.hash = "#/recherche";
  }
});
document.getElementById("btn-export").addEventListener("click", () => {
  window.location.href = "/api/export/excel";
  toast("Export Excel en cours de téléchargement…");
});
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("fichier-import").click();
});
document.getElementById("fichier-import").addEventListener("change", async (evenement) => {
  const fichier = evenement.target.files[0];
  evenement.target.value = "";
  if (!fichier) return;
  const formulaire = new FormData();
  formulaire.append("fichier", fichier);
  try {
    const reponse = await fetch("/api/import/excel", { method: "POST", body: formulaire });
    const rapport = await reponse.json();
    if (!reponse.ok) throw new Error(rapport.erreur || "Import impossible.");
    const morceaux = [
      `<p><strong>${rapport.candidatures_ajoutees}</strong> candidature(s), ` +
      `<strong>${rapport.contacts_ajoutes}</strong> contact(s) et ` +
      `<strong>${rapport.entreprises_ajoutees}</strong> entreprise(s) ajoutée(s).</p>`,
    ];
    if (rapport.ignores.length) {
      morceaux.push(
        `<p><strong>Doublons ignorés</strong> (déjà dans la base, rien n'a été écrasé) :</p>` +
        `<ul>${rapport.ignores.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>`
      );
    }
    if (rapport.erreurs.length) {
      morceaux.push(
        `<p><strong>Lignes non importées</strong> :</p>` +
        `<ul>${rapport.erreurs.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>`
      );
    }
    ouvrirModale(
      "Rapport d'import",
      morceaux.join(""),
      `<button class="btn btn-accent" onclick="fermerModale()">Fermer</button>`
    );
    rendre();
  } catch (erreur) {
    toast(erreur.message, true);
  }
});

/* Import CSV générique (LinkedIn, Indeed, ou tout autre export) : deux
   étapes — un aperçu des colonnes détectées, puis une correspondance
   colonne -> champ choisie par l'utilisateur avant d'importer. */
const LIBELLES_CHAMPS_CSV = {
  entreprise: "Entreprise *",
  poste: "Poste / intitulé *",
  statut: "Statut",
  date_envoi: "Date d'envoi",
  ville: "Ville",
  mode_travail: "Mode de travail",
  lien_offre: "Lien de l'offre",
  source: "Source",
  notes: "Notes",
};

document.getElementById("btn-import-csv").addEventListener("click", () => {
  document.getElementById("fichier-import-csv").click();
});

document.getElementById("fichier-import-csv").addEventListener("change", async (evenement) => {
  const fichier = evenement.target.files[0];
  evenement.target.value = "";
  if (!fichier) return;
  const formulaire = new FormData();
  formulaire.append("fichier", fichier);
  try {
    const reponse = await fetch("/api/import/csv/apercu", { method: "POST", body: formulaire });
    const apercu = await reponse.json();
    if (!reponse.ok) throw new Error(apercu.erreur || "Aperçu impossible.");
    ouvrirCorrespondanceCsv(apercu);
  } catch (erreur) {
    toast(erreur.message, true);
  }
});

function ouvrirCorrespondanceCsv(apercu) {
  const v = etat.valeurs;
  const optionsColonnes = (selection) => `
    <option value="">— non importé —</option>
    ${apercu.entetes.map((e) => `<option value="${echapperAttribut(e)}"${e === selection ? " selected" : ""}>${echapper(e)}</option>`).join("")}`;

  // Devine une correspondance de départ par ressemblance de nom, pour éviter
  // à l'utilisateur de tout choisir à la main sur un export classique.
  const deviner = (motsClefs) => apercu.entetes.find((e) => {
    const normalise = e.toLowerCase().replace(/[^a-z]/g, "");
    return motsClefs.some((mot) => normalise.includes(mot));
  }) || "";
  const suggestions = {
    entreprise: deviner(["company", "entreprise", "employer"]),
    poste: deviner(["title", "poste", "job", "role", "intitule"]),
    statut: deviner(["status", "statut", "state"]),
    date_envoi: deviner(["date", "applied", "envoi"]),
    ville: deviner(["location", "ville", "city"]),
    lien_offre: deviner(["url", "link", "lien"]),
  };

  const lignesApercu = apercu.lignes
    .map((ligne) => `<tr>${ligne.map((cellule) => `<td class="cellule-secondaire">${echapper(cellule)}</td>`).join("")}</tr>`)
    .join("");

  const corps = `
    <p class="sous-titre">Associe chaque champ à une colonne du fichier — les colonnes non associées sont ignorées.</p>
    <div class="enveloppe-tableau" style="margin-bottom:14px;max-height:160px;">
      <table class="tableau"><thead><tr>${apercu.entetes.map((e) => `<th>${echapper(e)}</th>`).join("")}</tr></thead>
      <tbody>${lignesApercu}</tbody></table>
    </div>
    <form id="form-correspondance-csv" class="grille-form" onsubmit="return false;">
      ${apercu.champs.map((champ) => `
        <div class="champ">
          <label for="csv-${champ}">${LIBELLES_CHAMPS_CSV[champ] || champ}</label>
          <select id="csv-${champ}" data-champ="${champ}">${optionsColonnes(suggestions[champ] || "")}</select>
        </div>`).join("")}
    </form>
    <div class="grille-form" style="margin-top:4px;">
      <div class="champ">
        <label for="csv-statut-defaut">Statut par défaut (si non associé ci-dessus)</label>
        <select id="csv-statut-defaut">${optionsSelect(v.statuts, "Envoyée", false)}</select>
      </div>
      <div class="champ">
        <label for="csv-source-fixe">Source (appliquée à toutes les lignes)</label>
        <select id="csv-source-fixe">${optionsSelect(v.sources_candidature, "LinkedIn")}</select>
      </div>
    </div>`;

  ouvrirModale(
    "Importer un CSV",
    corps,
    `<button class="btn" onclick="fermerModale()">Annuler</button>
     <button class="btn btn-accent" id="btn-confirmer-import-csv">Importer</button>`
  );

  document.getElementById("btn-confirmer-import-csv").addEventListener("click", async () => {
    const correspondance = {};
    document.querySelectorAll("#form-correspondance-csv [data-champ]").forEach((select) => {
      if (select.value) correspondance[select.dataset.champ] = select.value;
    });
    if (!correspondance.entreprise || !correspondance.poste) {
      toast("Associe au moins les colonnes Entreprise et Poste.", true);
      return;
    }
    try {
      const reponse = await fetch("/api/import/csv/confirmer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jeton: apercu.jeton,
          correspondance,
          statut_par_defaut: document.getElementById("csv-statut-defaut").value,
          source: document.getElementById("csv-source-fixe").value,
        }),
      });
      const rapport = await reponse.json();
      if (!reponse.ok) throw new Error(rapport.erreur || "Import impossible.");
      const morceaux = [`<p><strong>${rapport.candidatures_ajoutees}</strong> candidature(s) ajoutée(s).</p>`];
      if (rapport.ignores.length) {
        morceaux.push(
          `<p><strong>Doublons ignorés</strong> :</p><ul>${rapport.ignores.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>`
        );
      }
      if (rapport.erreurs.length) {
        morceaux.push(
          `<p><strong>Lignes non importées</strong> :</p><ul>${rapport.erreurs.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>`
        );
      }
      ouvrirModale(
        "Rapport d'import",
        morceaux.join(""),
        `<button class="btn btn-accent" onclick="fermerModale()">Fermer</button>`
      );
      rendre();
    } catch (erreur) {
      toast(erreur.message, true);
    }
  });
}

// Afficher / masquer les mots de passe (délégation : les formulaires sont re-rendus).
document.addEventListener("click", (evenement) => {
  const bouton = evenement.target.closest(".btn-oeil");
  if (!bouton) return;
  const champ = document.getElementById(bouton.dataset.cible);
  if (!champ) return;
  const masque = champ.type === "password";
  champ.type = masque ? "text" : "password";
  bouton.textContent = masque ? "Masquer" : "Afficher";
});

// Filet de sécurité : aucune erreur JS ne doit rester silencieuse.
window.addEventListener("error", () => {
  toast("Une erreur inattendue est survenue dans l'interface.", true);
});
window.addEventListener("unhandledrejection", (evenement) => {
  toast((evenement.reason && evenement.reason.message) || "Erreur inattendue.", true);
  evenement.preventDefault();
});

(async function demarrer() {
  try {
    etat.valeurs = await api("/api/valeurs");
    try { etat.ia = await api("/api/reglages"); } catch { etat.ia = null; }
    await rendre();
  } catch (erreur) {
    document.getElementById("vue").innerHTML =
      `<div class="etat-vide"><div class="titre">Le serveur ne répond pas</div><p>${echapper(erreur.message)}</p></div>`;
  }
})();
