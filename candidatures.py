"""Gestion des candidatures : ajout avec détection de doublon, modification,
listing — chaque étape marquante alimente automatiquement le journal (evenements)."""

import db
import documents
import evenements
from entreprises import _trouver_par_nom, ajouter_ou_recuperer_entreprise
from exceptions import DoublonCandidature, EntiteIntrouvable, ValeurNonAutorisee
from valeurs import normaliser, valider_champs


def _date_fr(iso):
    try:
        annee, mois, jour = str(iso).split("-")
        return f"{jour}/{mois}/{annee}"
    except (ValueError, AttributeError):
        return str(iso)


def _journaliser_modifications(conn, id_candidature, avant, champs):
    """Événements automatiques déduits d'une modification (statut, relance, dates)."""
    if "statut" in champs and champs["statut"] != avant["statut"]:
        evenements.enregistrer(
            conn, id_candidature, "statut",
            f"Statut : {avant['statut']} → {champs['statut']}",
        )
    if "nb_relances" in champs and (champs["nb_relances"] or 0) > (avant["nb_relances"] or 0):
        evenements.enregistrer(
            conn, id_candidature, "relance",
            f"Relance effectuée (n°{champs['nb_relances']})",
        )
    if (
        "date_reponse" in champs
        and champs["date_reponse"]
        and champs["date_reponse"] != avant["date_reponse"]
    ):
        evenements.enregistrer(
            conn, id_candidature, "reponse",
            f"Réponse reçue le {_date_fr(champs['date_reponse'])}",
        )
    if (
        "date_entretien" in champs
        and champs["date_entretien"]
        and champs["date_entretien"] != avant["date_entretien"]
    ):
        evenements.enregistrer(
            conn, id_candidature, "entretien",
            f"Entretien planifié le {_date_fr(champs['date_entretien'])}",
        )


def verifier_doublon_candidature(entreprise_nom, poste, chemin_db=None):
    """Retourne l'id d'une candidature existante pour (entreprise, poste), sinon None.

    Comparaison insensible à la casse et aux accents, sur le nom d'entreprise
    comme sur l'intitulé du poste.
    """
    conn = db.ouvrir(chemin_db)
    try:
        entreprise = _trouver_par_nom(conn, entreprise_nom)
        if entreprise is None:
            return None
        cible = normaliser(poste)
        for ligne in conn.execute(
            "SELECT id, poste FROM candidatures WHERE entreprise_id = ?", (entreprise["id"],)
        ):
            if normaliser(ligne["poste"]) == cible:
                return ligne["id"]
        return None
    finally:
        conn.close()


def ajouter_candidature(entreprise_nom, poste, chemin_db=None, **champs):
    """Ajoute une candidature et retourne son id.

    - Crée l'entreprise si elle n'existe pas encore (sans doublon).
    - Lève DoublonCandidature si une candidature (entreprise, poste) existe déjà.
    - Valide tous les champs optionnels (valeurs autorisées, dates, entiers).
    """
    if not poste or not str(poste).strip():
        raise ValeurNonAutorisee("L'intitulé du poste est obligatoire.")
    poste = str(poste).strip()
    doublon = verifier_doublon_candidature(entreprise_nom, poste, chemin_db=chemin_db)
    if doublon is not None:
        raise DoublonCandidature(
            f"Doublon : une candidature « {poste} » chez « {entreprise_nom} » existe déjà "
            f"(candidature n°{doublon}). Utiliser modifier_candidature pour la mettre à jour."
        )
    champs.pop("poste", None)
    valides = valider_champs("candidatures", champs)
    # Les champs vides sont omis pour laisser jouer les défauts de la base
    # (statut « À préparer », priorité « Moyenne », etc.).
    valides = {c: v for c, v in valides.items() if v is not None}
    entreprise_id = ajouter_ou_recuperer_entreprise(entreprise_nom, chemin_db=chemin_db)
    valides["entreprise_id"] = entreprise_id
    valides["poste"] = poste
    conn = db.ouvrir(chemin_db)
    try:
        colonnes = ", ".join(valides)
        jokers = ", ".join("?" for _ in valides)
        curseur = conn.execute(
            f"INSERT INTO candidatures ({colonnes}) VALUES ({jokers})", tuple(valides.values())
        )
        evenements.enregistrer(
            conn, curseur.lastrowid, "creation",
            f"Candidature créée — statut « {valides.get('statut', 'À préparer')} »",
        )
        conn.commit()
        return curseur.lastrowid
    finally:
        conn.close()


def modifier_candidature(id_candidature, chemin_db=None, **champs):
    """Modifie une candidature existante. Champs modifiables : ceux du modèle
    (statut, priorite, date_entretien, notes, ...) — jamais id ni entreprise_id."""
    valides = valider_champs("candidatures", champs)
    if not valides:
        raise ValeurNonAutorisee("Aucun champ à modifier n'a été fourni.")
    if "poste" in valides and not valides["poste"]:
        raise ValeurNonAutorisee("L'intitulé du poste ne peut pas être vidé.")
    if "statut" in valides and valides["statut"] is None:
        raise ValeurNonAutorisee("Le statut ne peut pas être vidé — choisir une valeur.")
    conn = db.ouvrir(chemin_db)
    try:
        actuelle = conn.execute(
            "SELECT * FROM candidatures WHERE id = ?", (id_candidature,)
        ).fetchone()
        if actuelle is None:
            raise EntiteIntrouvable(f"Aucune candidature avec l'id {id_candidature}.")
        colonnes = ", ".join(f"{c} = ?" for c in valides)
        conn.execute(
            f"UPDATE candidatures SET {colonnes} WHERE id = ?",
            (*valides.values(), id_candidature),
        )
        _journaliser_modifications(conn, id_candidature, actuelle, valides)
        conn.commit()
        return id_candidature
    finally:
        conn.close()


def lister_candidatures(statut=None, sous_domaine=None, priorite=None, chemin_db=None):
    """Retourne les candidatures (liste de dicts, avec le nom d'entreprise),
    filtrées par statut / sous-domaine / priorité si fournis."""
    filtres = valider_champs(
        "candidatures",
        {
            c: v
            for c, v in (
                ("statut", statut),
                ("sous_domaine", sous_domaine),
                ("priorite", priorite),
            )
            if v is not None
        },
    )
    conn = db.ouvrir(chemin_db)
    try:
        requete = (
            "SELECT c.*, e.nom AS entreprise FROM candidatures c "
            "JOIN entreprises e ON e.id = c.entreprise_id"
        )
        conditions, parametres = [], []
        for champ, valeur in filtres.items():
            conditions.append(f"c.{champ} = ?")
            parametres.append(valeur)
        if conditions:
            requete += " WHERE " + " AND ".join(conditions)
        requete += " ORDER BY c.date_envoi IS NULL, c.date_envoi DESC, c.id DESC"
        return [dict(l) for l in conn.execute(requete, parametres)]
    finally:
        conn.close()


def supprimer_candidature(id_candidature, chemin_db=None):
    """Supprime une candidature, son journal et ses documents
    (l'entreprise et ses contacts sont conservés)."""
    conn = db.ouvrir(chemin_db)
    try:
        actuelle = conn.execute(
            "SELECT id FROM candidatures WHERE id = ?", (id_candidature,)
        ).fetchone()
        if actuelle is None:
            raise EntiteIntrouvable(f"Aucune candidature avec l'id {id_candidature}.")
        conn.execute("DELETE FROM evenements WHERE candidature_id = ?", (id_candidature,))
        documents.supprimer_pour_candidature(conn, id_candidature)
        conn.execute("DELETE FROM candidatures WHERE id = ?", (id_candidature,))
        conn.commit()
    finally:
        conn.close()


def recuperer_candidature(id_candidature, chemin_db=None):
    """Retourne une candidature (dict, avec le nom et les infos de l'entreprise)."""
    conn = db.ouvrir(chemin_db)
    try:
        ligne = conn.execute(
            "SELECT c.*, e.nom AS entreprise, e.site_web, e.contexte_actus, e.derniere_recherche "
            "FROM candidatures c JOIN entreprises e ON e.id = c.entreprise_id WHERE c.id = ?",
            (id_candidature,),
        ).fetchone()
        if ligne is None:
            raise EntiteIntrouvable(f"Aucune candidature avec l'id {id_candidature}.")
        return dict(ligne)
    finally:
        conn.close()
