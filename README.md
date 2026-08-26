<div align="center">
  <img src="docs/logo.png" width="120" alt="Logo Azimut" />

  # Azimut

  **Suivi de candidatures de stage — application de bureau locale, 100 % en français.**

  ![Plateforme](https://img.shields.io/badge/plateforme-macOS-3d8ff0)
  ![Python](https://img.shields.io/badge/python-3.10%2B-3d8ff0)
  ![Licence](https://img.shields.io/badge/licence-MIT-3d8ff0)
  ![Tests](https://img.shields.io/badge/tests-138%20passent-3d8ff0)

</div>

---

Azimut centralise toute une recherche de stage — candidatures, entreprises,
contacts, documents, entretiens — dans une vraie base de données locale,
derrière une interface soignée qui s'ouvre comme n'importe quelle application
Mac. Pensé au départ pour un M2 en systèmes agentiques, il ne fait aucune
hypothèse sur le domaine : il convient à n'importe quelle recherche de stage
ou d'alternance.

**Principe directeur : la base de données (`suivi_candidatures.db`) est la
seule source de vérité.** Toute écriture — depuis l'interface, la ligne de
commande, ou une IA — passe par des fonctions Python qui valident les valeurs
et détectent les doublons. Jamais de SQL écrit à la main. Les exports Excel ne
sont que des projections de cette base, régénérables à tout moment.

Tout tourne en local. Aucune donnée ne quitte la machine, sauf action
explicite (export, appel à un assistant IA si tu actives cette fonction).

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Partager l'appli à un ami](#partager-lappli-à-un-ami)
- [La ligne de commande](#la-ligne-de-commande)
- [Assistant IA — n'importe quel fournisseur](#assistant-ia--nimporte-quel-fournisseur)
- [Règles appliquées par le code](#règles-appliquées-par-le-code-pas-seulement-documentées)
- [API pour une IA (Claude Code ou autre)](#api-pour-une-ia-claude-code-ou-autre)
- [Structure du projet](#structure-du-projet)
- [Tests](#tests)
- [Licence](#licence)

## Fonctionnalités

**Suivi des candidatures**
- Pipeline **kanban** (glisser-déposer pour changer le statut) ou liste
  filtrable, avec panneau latéral d'ajout/édition/suppression.
- **Journal automatique** par candidature : création, changement de statut,
  relance, réponse, entretien planifié — horodaté sans rien faire.
- **Documents joints** : CV, lettre de motivation, offre en PDF ou tout autre
  fichier, attachables dès la création ou depuis la fiche, plusieurs à la fois.
- **Fiche d'entretien** et **mode entretien** (la fiche à gauche, une zone de
  notes à droite, sauvegardée automatiquement dans la candidature).
- **Accès aux portails de recrutement** : URL, identifiant et mot de passe par
  candidature (masqué dans l'interface, jamais exporté).

**Organisation**
- **Entreprises** avec contexte et actualités ; détection des doublons
  probables (« Mistral » / « Mistral AI ») et **fusion en un clic**.
- **Contacts** avec statut de prise de contact.
- **Recherche globale** (raccourci <kbd>⌘K</kbd>) qui fouille tout — postes,
  notes, textes d'offres, contacts — avec un code couleur par type de résultat.
- **Détection de quasi-doublons** à la création d'une candidature (intitulé
  proche, ou même lien d'offre une fois débarrassé du tracking) : un simple
  avertissement, jamais un blocage.

**Pilotage**
- **Tableau de bord** : compteurs, répartition par statut et sous-domaine,
  relances à faire, entretiens à venir.
- **Statistiques avancées** : entonnoir envoyées → réponses → entretiens →
  acceptées, délais moyens, taux de réponse par source.
- **Agenda** (vue mois ou 2 semaines) connectable à un vrai calendrier :
  abonnement `webcal://` en direct pour Calendrier (Mac), bouton
  « Ajouter à Google Agenda » par échéance, ou fichier `.ics` universel.

**Données et vie privée**
- **Export / import Excel** : sauvegarde lisible et restauration, doublons
  ignorés et jamais écrasés, rapport détaillé après import.
- **Sauvegarde automatique** de la base à chaque lancement (rotation sur 10).
- **Dossier de données configurable** : choisis où ranger documents et
  sauvegardes (utile pour les faire suivre par iCloud Drive ou Dropbox) —
  visible et mis à jour dans le Finder en temps réel, comme n'importe quel
  autre dossier.
- **Assistant IA optionnel**, avec la clé de n'importe quel fournisseur — voir
  plus bas.

## Installation

Azimut est fait pour macOS. Cloner ce dépôt, puis double-cliquer sur
**`Azimut.app`** : l'appli s'ouvre dans sa propre fenêtre. Au tout premier
lancement, l'environnement Python et les dépendances s'installent seuls
(connexion Internet nécessaire une seule fois) — ce premier démarrage peut
prendre une à deux minutes, les suivants sont immédiats. Fermer la fenêtre
quitte l'appli.

```bash
git clone https://github.com/thmsgo18/azimut.git
open azimut/Azimut.app
```

Si macOS bloque l'ouverture au premier lancement : clic droit sur `Azimut.app`
→ *Ouvrir* (une seule fois). En secours, `Azimut (terminal).command` lance la
même fenêtre depuis le Terminal avec les messages d'installation visibles.

Tout tourne en local dans un seul fichier : `suivi_candidatures.db`, créé à la
racine du projet au premier lancement.

Le code n'a pas d'étape de compilation : après toute modification, il suffit
de relancer l'appli (ou de recharger la page) pour voir les changements.

## Partager l'appli à un ami

Double-cliquer sur `Créer un zip à partager.command` : un zip est déposé sur
le Bureau, **sans données personnelles** (ni base, ni exports, ni
environnement Python). La personne dézippe, double-clique `Azimut.app`, et
démarre avec sa propre base vierge, entièrement en local chez elle.

## La ligne de commande

Toutes les fonctions restent pilotables en ligne de commande — pratique pour
scripter, ou pour qu'une IA (Claude Code ou autre) tienne la base à jour sans
ouvrir l'interface. `--help` fonctionne à chaque niveau.

```bash
./suivi candidatures ajouter --entreprise "AgentikCo" --poste "Stage agents IA" --statut Envoyée --date-envoi 26/08/2026
./suivi candidatures lister --statut Entretien --priorite Haute
./suivi candidatures modifier 12 --statut "Réponse reçue" --date-reponse 02/09/2026
```

<details>
<summary><strong>Détail des commandes</strong></summary>

### Candidatures

```bash
python cli.py candidatures ajouter --entreprise "AgentikCo" --poste "Stage agents IA" --statut Envoyée --date-envoi 26/08/2026
python cli.py candidatures lister
python cli.py candidatures lister --statut Entretien --priorite Haute
python cli.py candidatures modifier 12 --statut "Réponse reçue" --date-reponse 02/09/2026
python cli.py candidatures voir 12
```

Options d'ajout / modification : `--date-envoi`, `--sous-domaine`, `--lien-offre`,
`--texte-offre` (texte intégral de l'offre, archivé si l'annonce disparaît),
`--type`, `--priorite`, `--statut`, `--nb-relances`, `--date-relance-prevue`,
`--date-reponse`, `--date-entretien`, `--date-debut-souhaitee`, `--duree`,
`--gratification` (€/mois), `--ville`, `--mode-travail`, `--convention-envoyee`,
`--source`, `--notes`, `--portail-url`, `--portail-identifiant`, `--portail-mdp`.

Les dates s'écrivent `JJ/MM/AAAA` ou `AAAA-MM-JJ` (stockées en ISO).

À l'ajout, si une candidature existante a un intitulé proche ou le même lien
d'offre, un avertissement `⚠` (non bloquant) s'affiche avant la confirmation —
utile pour repérer une offre repostée ou une faute de frappe sans jamais
empêcher une vraie nouvelle candidature d'être créée.

### Entreprises

```bash
python cli.py entreprises ajouter --nom "AgentikCo" --site-web https://agentik.co
python cli.py entreprises lister
python cli.py entreprises modifier 3 --contexte-actus "Série A en 2026, équipe agents de 12 personnes."
python cli.py entreprises doublons                    # paires probablement en double
python cli.py entreprises fusionner 2 5               # garde n°2, fusionne n°5 dedans
```

`ajouter` ne crée jamais de doublon : si le nom existe déjà (comparaison
insensible à la casse et aux accents), l'entreprise existante est retrouvée et
seuls ses champs vides sont complétés. Si une valeur existante diffère, rien
n'est écrasé : une erreur `ConflitMiseAJour` l'explique — c'est `modifier` qui
écrase, explicitement.

`doublons` liste les paires au nom proche sans rien modifier ; `fusionner
<conserver> <supprimer>` déplace candidatures et contacts vers la première,
complète ses champs vides depuis la seconde, puis la supprime — irréversible,
à utiliser après avoir vérifié la paire.

### Contacts

```bash
python cli.py contacts ajouter --entreprise "AgentikCo" --nom "Marie Petit" --poste "Lead AI" --type Email --valeur marie@agentik.co
python cli.py contacts lister --entreprise "AgentikCo"
python cli.py contacts modifier 5 --statut Contacté --date-contact 27/08/2026
```

### Export / import Excel

```bash
python cli.py export excel --sortie suivi_candidatures.xlsx
python cli.py import excel --fichier suivi_candidatures.xlsx
```

L'export régénère le fichier complet depuis la base : 4 onglets (« Suivi
candidatures », « Entreprises », « Contacts », « Tableau de bord »), listes
déroulantes sur les colonnes à valeurs autorisées, couleurs conditionnelles
sur Statut et Priorité, liens `HYPERLINK` + `MATCH` entre onglets, compteurs
par formules (`COUNTIF`/`COUNTA`, aucune valeur codée en dur). Relançable à
tout moment sans perte.

L'import relit un tel fichier et réinjecte les données : les doublons sont
ignorés et signalés, les lignes invalides sont rapportées avec leur numéro
sans bloquer le reste — pratique comme sauvegarde lisible ou pour fusionner
deux bases.

**La sauvegarde intégrale**, c'est une copie du fichier `suivi_candidatures.db`
— l'Excel ne contient ni les mots de passe de portail, ni la clé API : ceux-ci
restent en clair dans la base locale, qui ne quitte jamais la machine.

### Fiche de préparation d'entretien

```bash
python cli.py entretien preparer 12                    # affiche dans le terminal
python cli.py entretien preparer 12 --sortie fiche.md  # enregistre en Markdown
```

Compile en une fiche : en-tête (entreprise, poste, date, lieu/mode), contexte
entreprise, texte ou lien de l'offre, contacts identifiés, historique (envoi,
relances, notes, journal complet).

</details>

## Assistant IA — n'importe quel fournisseur

Dans **Réglages**, une clé API active un formulaire « Nouvelle candidature »
qui se pré-remplit en collant le texte d'une offre : l'IA extrait poste,
ville, gratification, sous-domaine…, et propose un contexte entreprise
(recherche web). Rien n'est jamais écrit sans relecture et validation.

Deux fournisseurs :

| Fournisseur | Ce qu'il faut | Particularité |
|---|---|---|
| **Anthropic** (Claude) | Une clé sur [console.anthropic.com](https://console.anthropic.com) | Recherche web intégrée pour le contexte entreprise |
| **Compatible OpenAI** | Une clé + un nom de modèle, éventuellement une URL de base | Couvre OpenAI, Mistral, Groq, DeepSeek, Google Gemini (endpoint compatible), OpenRouter, ou un modèle local (Ollama, LM Studio…) |

La deuxième option est la voie générique : **toute IA qui parle le protocole
OpenAI fonctionne**, y compris un modèle tournant en local sur ta machine,
sans qu'aucune donnée ne parte alors chez un tiers.

Cette couche ne fait que proposer — jamais d'écriture directe en base, jamais
d'information inventée (un champ absent de l'offre reste vide).

**Sans clé du tout**, Azimut reste entièrement fonctionnel : une IA de type
Claude Code peut piloter la base directement via la ligne de commande ou les
fonctions Python documentées dans [`CLAUDE.md`](CLAUDE.md), sur ton abonnement
existant, sans clé API séparée.

## Règles appliquées par le code (pas seulement documentées)

Toute valeur hors liste est refusée avec un message clair listant les valeurs
possibles (voir `valeurs.py`). La casse et les accents sont tolérés en entrée
(`envoyee` → `Envoyée`).

| Champ | Valeurs |
|---|---|
| `sous_domaine` | Agents de codage, Orchestration multi-agents, RAG / Agents de recherche, Agents conversationnels, Robotique / Agents physiques, MLOps pour agents, Autre |
| `type_candidature` | Offre publiée, Candidature spontanée, Cooptation / Réseau |
| `priorite` | Haute, Moyenne, Basse |
| `statut` | À préparer, Envoyée, Relancée, Réponse reçue, Entretien, Refus, Accepté |
| `mode_travail` | Présentiel, Hybride, Full remote |
| `convention_envoyee` | Oui, Non, N/A |
| `source` (candidature) | LinkedIn, Indeed, Site entreprise, Welcome to the Jungle, Réseau, Forum / Salon, Autre |
| `type_contact` | Email, LinkedIn, Téléphone, Autre |
| `statut_contact` | À contacter, Contacté, Répondu, Pas de réponse |
| `source` (contact) | Site entreprise, Article / Presse, LinkedIn (recherche publique), Réseau, Autre |
| `type_document` | CV, Lettre de motivation, Offre (PDF), Portfolio, Autre |

- **Doublons exacts** : une candidature = (entreprise, poste) unique ; un
  contact = (entreprise, nom) unique ; une entreprise = nom unique — toujours
  en comparaison insensible à la casse et aux accents. Refusés net, avec le
  numéro de la ligne existante.
- **Quasi-doublons** (intitulé proche, même lien d'offre) : signalés, jamais
  bloqués — voir `doublons.py`.
- **Dates** : validées (le 31 février est refusé) et stockées en ISO
  `AAAA-MM-JJ`, affichées `JJ/MM/AAAA`.

## API pour une IA (Claude Code ou autre)

Aucune écriture SQL directe : toujours passer par ces fonctions, qui valident
les valeurs et gèrent les doublons. Toutes acceptent `chemin_db=` (défaut :
`suivi_candidatures.db` à la racine). Documentation complète et à jour dans
[`CLAUDE.md`](CLAUDE.md).

```python
# entreprises.py
ajouter_ou_recuperer_entreprise(nom, site_web=None, contexte_actus=None) -> id
modifier_entreprise(id, **champs)
supprimer_entreprise(id)                                # refusé si liens existants
fusionner_entreprises(id_conserver, id_supprimer) -> résumé
lister_entreprises() -> liste de dicts

# candidatures.py
verifier_doublon_candidature(entreprise_nom, poste) -> id ou None
ajouter_candidature(entreprise_nom, poste, **champs) -> id     # DoublonCandidature si doublon
modifier_candidature(id, **champs)
lister_candidatures(statut=None, sous_domaine=None, priorite=None) -> liste de dicts
recuperer_candidature(id) -> dict

# contacts.py
verifier_doublon_contact(entreprise_nom, nom_contact) -> id ou None
ajouter_contact(entreprise_nom, nom, **champs) -> id           # DoublonContact si doublon
modifier_contact(id, **champs)
lister_contacts(entreprise_nom=None) -> liste de dicts

# doublons.py — quasi-doublons (avertissement, jamais un blocage)
candidatures_similaires(entreprise, poste, lien_offre=None) -> [{id, score, raisons}, ...]
paires_entreprises_suspectes() -> [{a, b, score}, ...]

# documents.py — fichiers joints (CV, lettres, offres en PDF…)
ajouter_document(candidature_id, nom_fichier, contenu_bytes, type_document=None) -> id
lister_documents(candidature_id=None) / supprimer_document(id)

# export_excel.py / import_excel.py
exporter_excel(chemin_sortie) -> chemin du fichier généré
importer_excel(chemin_fichier) -> rapport (ajouts, doublons ignorés, erreurs)

# entretien.py / recherche.py / statistiques.py / agenda.py
generer_fiche_entretien(candidature_id) -> texte Markdown
rechercher(texte) / stats_avancees() / lister_echeances()
```

Exceptions (voir `exceptions.py`) : `ValeurNonAutorisee`, `ChampInconnu`,
`DoublonCandidature`, `DoublonContact`, `DoublonEntreprise`, `ConflitMiseAJour`,
`EntiteIntrouvable` — toutes héritent de `ErreurSuivi` et portent un message en
français.

## Structure du projet

```
azimut/
  Azimut.app                        # double-clic : l'application (fenêtre native)
  Azimut (terminal).command         # secours : même fenêtre, depuis le Terminal
  Créer un zip à partager.command   # double-clic : zip (sans données) sur le Bureau
  app_bureau.py     # fenêtre native (pywebview) autour du serveur interne
  serveur.py        # serveur interne (Flask) : API JSON + interface
  static/           # interface (index.html, style.css, app.js)
  db.py             # connexion SQLite, création des tables, migrations
  valeurs.py        # valeurs autorisées + validation des champs
  exceptions.py     # exceptions métier (messages en français)
  entreprises.py    # CRUD entreprises (anti-doublon, conflits, fusion)
  candidatures.py   # CRUD candidatures (anti-doublon)
  contacts.py       # CRUD contacts (anti-doublon)
  doublons.py       # quasi-doublons : intitulés proches, lien d'offre, fusion
  export_excel.py   # export .xlsx (4 onglets, style du fichier d'origine)
  import_excel.py   # import d'un export .xlsx (sauvegarde / restauration)
  evenements.py     # journal automatique des candidatures (timeline)
  documents.py      # fichiers joints (dossier configurable)
  recherche.py      # recherche globale multi-types
  statistiques.py   # entonnoir, délais, sources
  agenda.py         # échéances + export iCalendar (.ics)
  reglages.py       # réglages locaux (clé API masquée, fournisseur IA, dossier de données)
  sauvegarde.py     # copies datées de la base, rotation
  agent.py          # analyse d'offres — Anthropic ou tout fournisseur compatible OpenAI
  entretien.py      # fiche de préparation d'entretien (Markdown)
  cli.py            # interface en ligne de commande
  CLAUDE.md         # mode d'emploi du projet pour les IA (Claude Code…)
  suivi             # exécutable terminal (équivalent de python cli.py)
  tests/            # 138 tests — python -m unittest discover -s tests
  suivi_candidatures.db   # la base — seule source de vérité (non versionnée)
```

## Tests

```bash
./venv/bin/python -m unittest discover -s tests
```

## Licence

[MIT](LICENSE) — projet personnel, ouvert et librement réutilisable.
