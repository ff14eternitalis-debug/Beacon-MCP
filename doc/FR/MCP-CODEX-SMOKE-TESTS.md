# Beacon MCP — Smoke Tests Codex

> Vérifications rapides pour confirmer que `Beacon-MCP` est bien chargé dans Codex et que les tools principaux répondent correctement.

---

## Objectif

Ce document sert à valider 4 points :

- Codex voit bien le serveur MCP `beacon`
- le serveur démarre sans crash
- l'auth Beacon fonctionne
- les tools les plus importants répondent correctement

---

## Pré-requis

- Codex a été redémarré après ajout du serveur MCP dans [config.toml](C:\Users\forgo\.codex\config.toml)
- le build existe dans [dist\index.js](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\dist\index.js)
- la connexion internet fonctionne pour joindre `https://api.usebeacon.app/v4`

---

## Test 1 — Détection du MCP

Dans Codex, demander :

```text
Vérifie si le MCP Beacon est disponible et liste ses tools d'authentification.
```

Résultat attendu :

- Codex utilise bien des tools `beacon_*`
- au minimum les tools suivants sont visibles ou utilisables :
  - `beacon_login`
  - `beacon_login_check`
  - `beacon_auth_status`
  - `beacon_logout`

Échec typique :

- Codex ne voit aucun tool `beacon_*`

Interprétation :

- soit le serveur MCP n'a pas été rechargé
- soit le chemin dans [config.toml](C:\Users\forgo\.codex\config.toml) est incorrect

---

## Test 2 — État d'authentification

Dans Codex, demander :

```text
Appelle beacon_auth_status et dis-moi si Beacon est déjà connecté.
```

Résultat attendu :

- réponse structurée
- pas de crash MCP
- si connecté : présence d'un `userId` et des expirations de tokens
- si non connecté : état clair indiquant qu'une connexion est nécessaire

Échec typique :

- erreur MCP globale
- outil introuvable
- plantage du serveur

---

## Test 3 — Login interactif

Si le test 2 indique que tu n'es pas connecté, dans Codex demander :

```text
Lance beacon_login puis aide-moi à finir la connexion Beacon.
```

Ensuite :

1. récupérer le code court renvoyé
2. ouvrir `https://usebeacon.app/device`
3. saisir le code
4. revenir dans Codex et demander :

```text
Appelle beacon_login_check.
```

Résultat attendu :

- connexion terminée
- tokens enregistrés localement
- `beacon_auth_status` passe ensuite en mode connecté

---

## Test 4 — Lecture simple projet

Dans Codex, demander :

```text
Appelle beacon_list_projects et résume le résultat.
```

Résultat attendu :

- liste de projets ou réponse vide propre
- aucun crash
- sortie texte + structure de données

Échec typique :

- `401`
- erreur d'authentification

Interprétation :

- refaire les tests de login

---

## Test 5 — Lecture simple gamedata

Dans Codex, demander :

```text
Appelle beacon_list_maps pour arksa.
```

Résultat attendu :

- retour d'une liste de maps ArkSA
- paramètres validés correctement
- pas d'erreur de schéma tool

Ce test valide que :

- les outils MCP sont bien enregistrés
- les enums d'arguments fonctionnent
- les appels API standard passent

---

## Test 6 — Lecture simple Sentinel

Dans Codex, demander :

```text
Appelle beacon_list_sentinel_services et résume le résultat.
```

Résultat attendu :

- soit une liste de services
- soit un message propre indiquant un problème d'accès Sentinel

Ce test est utile pour vérifier :

- la couche Sentinel
- le mapping d'erreurs `403`
- le format structuré des réponses

---

## Test 7 — Config options multi-jeux

Dans Codex, demander :

```text
Appelle beacon_get_config_options pour palworld avec un filtre sur server.
```

Résultat attendu :

- réponse valide
- pas de rejet sur la valeur de `game`
- preuve que l'ouverture multi-jeux est bien prise en compte

---

## Séquence minimale recommandée

Si tu veux aller vite, fais seulement :

1. `beacon_auth_status`
2. `beacon_list_projects`
3. `beacon_list_maps` avec `arksa`
4. `beacon_get_config_options` avec `palworld`

Si ces 4 tests passent, le MCP est globalement bon pour Codex.

---

## Symptômes à surveiller

- aucun tool `beacon_*` visible
- erreur au démarrage du serveur MCP
- erreur de validation d'arguments sur des appels simples
- `401` systématique après login
- `403` Sentinel sur des tools non-Sentinel

---

## Conclusion

Le smoke test est validé si :

- Codex appelle bien les tools Beacon
- `beacon_auth_status` fonctionne
- au moins un tool `projects`, un tool `gamedata`, et un tool multi-jeux répondent correctement
- aucune erreur de chargement MCP n'apparaît pendant la session
