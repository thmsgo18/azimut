"""Statistiques avancées : entonnoir, délais moyens, performance par source."""

from datetime import date

from candidatures import lister_candidatures

STATUTS_AVEC_REPONSE = {"Réponse reçue", "Entretien", "Refus", "Accepté"}


def _jours_entre(debut, fin):
    try:
        ecart = (date.fromisoformat(fin) - date.fromisoformat(debut)).days
        return ecart if ecart >= 0 else None
    except (TypeError, ValueError):
        return None


def _a_recu_reponse(cand):
    return bool(cand["date_reponse"]) or cand["statut"] in STATUTS_AVEC_REPONSE


def stats_avancees(chemin_db=None):
    liste = lister_candidatures(chemin_db=chemin_db)

    envoyees = [c for c in liste if c["statut"] != "À préparer"]
    reponses = [c for c in envoyees if _a_recu_reponse(c)]
    entretiens = [
        c for c in liste if c["date_entretien"] or c["statut"] in ("Entretien", "Accepté")
    ]
    acceptees = [c for c in liste if c["statut"] == "Accepté"]

    def taux(partie, total):
        return round(len(partie) / len(total) * 100) if total else 0

    entonnoir = [
        {"etape": "Envoyées", "nombre": len(envoyees), "taux": 100 if envoyees else 0},
        {"etape": "Réponses", "nombre": len(reponses), "taux": taux(reponses, envoyees)},
        {"etape": "Entretiens", "nombre": len(entretiens), "taux": taux(entretiens, envoyees)},
        {"etape": "Acceptées", "nombre": len(acceptees), "taux": taux(acceptees, envoyees)},
    ]

    delais_reponse = [
        d for c in liste if (d := _jours_entre(c["date_envoi"], c["date_reponse"])) is not None
    ]
    delais_entretien = [
        d for c in liste if (d := _jours_entre(c["date_envoi"], c["date_entretien"])) is not None
    ]

    par_source = {}
    for cand in envoyees:
        source = cand["source"] or "Non renseignée"
        entree = par_source.setdefault(source, {"envoyees": 0, "reponses": 0})
        entree["envoyees"] += 1
        if _a_recu_reponse(cand):
            entree["reponses"] += 1
    sources = [
        {
            "source": source,
            "envoyees": valeurs["envoyees"],
            "reponses": valeurs["reponses"],
            "taux": round(valeurs["reponses"] / valeurs["envoyees"] * 100),
        }
        for source, valeurs in par_source.items()
    ]
    sources.sort(key=lambda s: (-s["taux"], -s["envoyees"]))

    return {
        "total": len(liste),
        "entonnoir": entonnoir,
        "delai_moyen_reponse": round(sum(delais_reponse) / len(delais_reponse), 1)
        if delais_reponse
        else None,
        "delai_moyen_entretien": round(sum(delais_entretien) / len(delais_entretien), 1)
        if delais_entretien
        else None,
        "nb_delais_reponse": len(delais_reponse),
        "par_source": sources,
    }
