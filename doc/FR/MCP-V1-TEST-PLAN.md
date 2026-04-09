# Beacon MCP — Plan de tests complet et structuré pour la v1

> Plan de tests pour valider le MCP lui-même, le flux d'installation local `v1`, et le comportement dans les clients MCP ciblés avant toute transition vers un runtime `.exe`.

---

## Objectif

Avant d'engager la transition vers un runtime `.exe`, il faut valider que la `v1` actuelle fonctionne de bout en bout.

Ce plan sert à vérifier :

- que le MCP fonctionne correctement
- que les tools principaux répondent bien
- que l'auth Beacon fonctionne
- que l'installateur `v1` fait bien son travail
- que Codex, Claude Desktop et Cursor peuvent charger la configuration attendue

---

## Pourquoi tester avant le `.exe`

La `v1` actuelle est la base fonctionnelle.

Si elle n'est pas stabilisée, passer trop tôt au `.exe` va :

- compliquer le debug
- cacher certains bugs derrière le packaging
- rendre les retours de tests moins exploitables

La bonne stratégie est donc :

1. valider la `v1`
2. corriger les bugs restants
3. seulement ensuite préparer le runtime autonome

---

## Portée du plan

Le plan couvre :

- tests du serveur MCP
- tests des tools Beacon
- tests d'authentification
- tests multi-jeux
- tests Sentinel
- tests Connector
- tests de l'installeur `v1`
- tests de configuration client MCP

---

## Environnements à prévoir

### Environnement A — Dev local

But :

- vérifier rapidement le comportement sur la machine de développement

### Environnement B — Utilisateur propre

But :

- simuler une installation plus proche d'un vrai utilisateur

Idéalement :

- une autre session Windows
- ou une machine virtuelle
- ou un PC test

### Environnement C — Client par client

But :

- valider chaque client séparément :
  - Codex
  - Claude Desktop
  - Cursor

---

## Pré-requis de test

Il faut disposer de :

- un compte Beacon valide
- l'accès à `https://api.usebeacon.app/v4`
- un projet Beacon de test si possible
- au moins un client MCP installé
- éventuellement un service Sentinel de test
- éventuellement un Connector de test si la couche Connector doit être validée

---

## Axe 1 — Tests du serveur MCP

### Test 1.1 — Build du projet principal

But :

- vérifier que `Beacon-MCP` compile

Résultat attendu :

- `npm run build` passe

### Test 1.2 — Démarrage stdio

But :

- vérifier que le serveur démarre localement en `stdio`

Résultat attendu :

- lancement sans crash
- message de démarrage valide

### Test 1.3 — Démarrage HTTP

But :

- vérifier que le serveur démarre en mode HTTP/SSE

Résultat attendu :

- `/health` répond
- `/openapi.json` répond
- `/mcp/sse` est exposé

---

## Axe 2 — Tests d'authentification Beacon

### Test 2.1 — État sans connexion

Tool :

- `beacon_auth_status`

Résultat attendu :

- réponse claire indiquant l'absence de connexion

### Test 2.2 — Login device flow

Tools :

- `beacon_login`
- `beacon_login_check`

Résultat attendu :

- génération d'un code
- connexion finalisable dans le navigateur
- tokens stockés localement

### Test 2.3 — Statut après connexion

Tool :

- `beacon_auth_status`

Résultat attendu :

- présence de `userId`
- expirations de tokens cohérentes

### Test 2.4 — Logout

Tool :

- `beacon_logout`

Résultat attendu :

- suppression de session locale

---

## Axe 3 — Tests Projects et configuration

### Test 3.1 — Liste des projets

Tool :

- `beacon_list_projects`

Résultat attendu :

- liste propre ou retour vide propre

### Test 3.2 — Détail d'un projet

Tool :

- `beacon_get_project`

Résultat attendu :

- métadonnées projet lisibles

### Test 3.3 — Lecture `Game.ini`

Tool :

- `beacon_generate_game_ini`

Résultat attendu :

- contenu INI lisible

### Test 3.4 — Écriture `Game.ini`

Tool :

- `beacon_put_game_ini`

Résultat attendu :

- réponse de succès
- pas de corruption du fichier

### Test 3.5 — Lecture `GameUserSettings.ini`

Tool :

- `beacon_generate_game_user_settings_ini`

Résultat attendu :

- contenu lisible

### Test 3.6 — Écriture `GameUserSettings.ini`

Tool :

- `beacon_put_game_user_settings_ini`

Résultat attendu :

- mise à jour acceptée

### Test 3.7 — Liste des config options

Tool :

- `beacon_get_config_options`

Résultat attendu :

- options listées sans erreur

---

## Axe 4 — Tests Gamedata

### Test 4.1 — Liste des blueprints

Tool :

- `beacon_list_blueprints`

### Test 4.2 — Détail blueprint

Tool :

- `beacon_get_blueprint`

### Test 4.3 — Liste des engrams

Tool :

- `beacon_list_engrams`

### Test 4.4 — Détail engram

Tool :

- `beacon_get_engram`

### Test 4.5 — Liste des creatures

Tool :

- `beacon_list_creatures`

### Test 4.6 — Détail creature

Tool :

- `beacon_get_creature`

### Test 4.7 — Liste des spawn points

Tool :

- `beacon_list_spawn_points`

### Test 4.8 — Détail spawn point

Tool :

- `beacon_get_spawn_point`

### Test 4.9 — Liste des maps

Tool :

- `beacon_list_maps`

### Test 4.10 — Variables de jeu

Tool :

- `beacon_list_game_variables`

Résultat attendu pour tous :

- pas de crash MCP
- paramètres correctement validés
- réponses structurées cohérentes

---

## Axe 5 — Tests multi-jeux

### Test 5.1 — Palworld config options

Tool :

- `beacon_get_config_options`

Paramètres :

- `game = palworld`

Résultat attendu :

- accepté
- réponse utile

### Test 5.2 — 7DTD config options

Tool :

- `beacon_get_config_options`

Paramètres :

- `game = 7dtd`

Résultat attendu :

- accepté

### Test 5.3 — Palworld game variables

Tool :

- `beacon_list_game_variables`

Paramètres :

- `game = palworld`

Résultat attendu :

- accepté

### Test 5.4 — Projet hors périmètre multi-jeux

Tester que les tools projet ne prétendent pas supporter `palworld` ou `7dtd`.

Résultat attendu :

- rejet propre ou validation bloquée

---

## Axe 6 — Tests Sentinel

### Test 6.1 — Liste des services

- `beacon_list_sentinel_services`

### Test 6.2 — Détail service

- `beacon_get_sentinel_service`

### Test 6.3 — Liste des groupes

- `beacon_list_sentinel_groups`

### Test 6.4 — Détail groupe

- `beacon_get_sentinel_group`

### Test 6.5 — Liste des buckets

- `beacon_list_sentinel_buckets`

### Test 6.6 — Détail bucket

- `beacon_get_sentinel_bucket`

### Test 6.7 — Liste des scripts

- `beacon_list_sentinel_scripts`

### Test 6.8 — Détail script

- `beacon_get_sentinel_script`

### Test 6.9 — Liste des joueurs

- `beacon_list_players`

### Test 6.10 — Chat / RCON

- `beacon_send_chat`
- `beacon_run_rcon`

Résultat attendu :

- soit succès
- soit erreur Sentinel explicite et propre

---

## Axe 7 — Tests Connector

À faire seulement si un Connector de test est disponible.

### Test 7.1 — Status

- `beacon_get_server_status`

### Test 7.2 — Start

- `beacon_start_server`

### Test 7.3 — Stop

- `beacon_stop_server`

### Test 7.4 — Param live

- `beacon_set_server_param`

Résultat attendu :

- comportement cohérent
- erreurs réseau ou timeout correctement mappées

---

## Axe 8 — Tests installateur v1

### Test 8.1 — Détection Node.js

Commande :

- `node dist/cli.js --check-node`

Résultat attendu :

- Node détecté si présent
- message clair sinon

### Test 8.2 — Détection des apps

Commande :

- `node dist/cli.js --detect`

Résultat attendu :

- statut de Codex
- statut de Claude
- statut de Cursor

### Test 8.3 — Installation par défaut

Commande :

- `node dist/cli.js --install-defaults --json-file ...`

Résultat attendu :

- runtime copié
- configs patchées
- JSON résultat écrit

### Test 8.4 — Sauvegardes

Résultat attendu :

- création des `.bak`

### Test 8.5 — Idempotence

Relancer l'installation.

Résultat attendu :

- pas de duplication
- `already configured` si déjà en place

### Test 8.6 — Validation post-install

Résultat attendu :

- `installRootExists = yes`
- `runtimeEntryExists = yes`
- `runtimeStartupOk = yes`

---

## Axe 9 — Tests client par client

### Codex

Vérifier :

- chargement du MCP
- usage de `beacon_auth_status`
- usage de `beacon_list_projects`

### Claude Desktop

Vérifier :

- chargement de la config MCP
- accès à `beacon_auth_status`
- login Beacon

### Cursor

Vérifier :

- chargement de la config écrite
- pas de conflit avec config existante
- usage d'au moins un tool Beacon

---

## Axe 10 — Tests de non-régression

Il faut garder une liste minimale de non-régression :

- pas de duplication dans `config.toml`
- pas de corruption JSON Claude / Cursor
- pas d'écrasement d'autres MCP existants
- pas de crash au démarrage du MCP
- pas d'erreur de validation sur les tools simples

---

## Axe 11 — Tests de messages d'erreur

Il faut vérifier que les erreurs sont compréhensibles quand :

- Beacon n'est pas connecté
- Sentinel refuse l'accès
- Node est absent
- le Connector est indisponible
- un client n'est pas installé
- un fichier de config n'est pas inscriptible

---

## Ordre recommandé d'exécution

1. build MCP
2. build `installer/`
3. test `--check-node`
4. test `--detect`
5. test `--install-defaults`
6. test Codex
7. test Claude Desktop
8. test Cursor
9. test auth Beacon
10. test projects/config
11. test gamedata
12. test multi-jeux
13. test Sentinel
14. test Connector si dispo

---

## Critères de validation avant passage au `.exe`

On peut passer au travail `.exe` seulement si :

- le MCP démarre proprement
- l'auth fonctionne
- les tools critiques répondent
- les patchers de config sont stables
- l'installateur `v1` est idempotent
- Codex / Claude / Cursor sont validés au moins une fois

---

## Livrable recommandé de cette phase

Cette phase devrait produire :

- une checklist de tests cochée
- une liste de bugs restants
- une liste de blocages packaging potentiels
- une décision claire : `v1 stable` ou `v1 encore à corriger`

---

## Recommandation finale

Avant toute transition vers `Beacon-MCP.exe`, il faut traiter la `v1` comme la base de référence produit.

En pratique :

> d'abord valider le MCP et l'installateur `v1`, ensuite seulement lancer la transition vers le runtime autonome.
