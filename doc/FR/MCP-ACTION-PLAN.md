# Beacon MCP Bridge — Plan d'action

> Feuille de route pour la création du serveur MCP (Model Context Protocol) connectant une IA à l'application Beacon.

---

## Phase 1 — Mise en place du projet

**Objectif :** Avoir un serveur MCP vide qui tourne et répond à Claude Desktop.

**Durée estimée :** ½ journée

### Étapes

- [X] Créer le repo `beacon-mcp` (dossier séparé du repo Beacon)
- [X] Initialiser le projet Node.js : `npm init -y`
- [X] Installer les dépendances :
  ```
  @modelcontextprotocol/sdk
  axios
  typescript
  ts-node
  @types/node
  dotenv
  ```
- [X] Créer `tsconfig.json` + structure de dossiers :
  ```
  src/
  ├── index.ts          ← point d'entrée MCP (stdio transport)
  ├── auth/             ← OAuth2 device_code
  ├── api/              ← wrappers API REST
  ├── tools/            ← définitions des MCP tools
  └── connector/        ← client TCP (Phase 4)
  ```
- [X] Tester avec Claude Desktop via `claude_desktop_config.json`

---

## Phase 2 — Authentification OAuth 2.1 (device flow)

**Objectif :** Connecter l'utilisateur à Beacon via OAuth 2.1 device flow, sans browser intégré.

> API v4 (`https://api.usebeacon.app/v4`) — OAuth 2.1 + PKCE
> Client ID officiel Beacon : `12877547-7ad0-466f-a001-77815043c96b` (app publique, pas de secret)
> Tokens : access (~1h) + refresh (~30j), renouvellement automatique

**Durée estimée :** ½ journée

### Étapes

- [X] `src/auth/pkce.ts` — génération code_verifier + code_challenge (SHA-256 Base64URL)
- [X] `src/auth/tokens.ts` — stockage tokens dans `~/.beacon-mcp/tokens.json` + pending flow
- [X] `src/auth/oauth.ts` — `startDeviceFlow()`, `pollDeviceFlow()`, `refreshAccessToken()`
- [X] `src/api/client.ts` — client Axios Bearer token + refresh automatique
- [X] `src/tools/auth.ts` — 4 tools MCP : `beacon_login`, `beacon_login_check`, `beacon_auth_status`, `beacon_logout`
- [X] `.env.example` — sans credentials (auth via browser, tokens stockés localement)
- [X] Compilation TypeScript sans erreur

### Flow utilisateur

```
1. "Connecte-moi à Beacon"
   → beacon_login        : retourne un code court + URL
   → L'utilisateur ouvre usebeacon.app/device dans son navigateur

2. "C'est bon j'ai autorisé"
   → beacon_login_check  : échange le code contre les tokens, les sauvegarde

3. Utilisation normale
   → Tous les tools utilisent le Bearer token automatiquement
   → Refresh silencieux quand l'access token expire
```

### Aucune configuration requise

Zéro variable d'environnement obligatoire — l'auth se fait interactivement via `beacon_login`.

---

## Phase 3 — Tools REST essentiels

**Objectif :** Couvrir les 80% de cas d'usage courants.

**Durée estimée :** 1 à 2 jours

> Endpoints et structures validés contre le code source Beacon (`C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon`).

### Batch A — Projets & configs *(priorité haute)*

- [X] `beacon_list_projects()` — `GET /projects`
- [X] `beacon_get_project(projectId)` — `GET /projects/{id}`
- [X] `beacon_generate_game_ini(projectId, game, qualityScale?, difficultyValue?, mapMask?)` — `GET /{game}/projects/{id}/Game.ini`
- [X] `beacon_put_game_ini(projectId, game, content)` — `PUT /{game}/projects/{id}/Game.ini` (texte brut)
- [X] `beacon_get_config_options(game, filter?)` — `GET /{game}/configOptions` (lecture seule, affiche header/key/type/défaut/fichier)
- [X] `beacon_create_project(game, name, description?)` — construit le binaire `application/x-beacon-project` (8 bytes magic + TAR.GZ) côté client, fetch userId via `/users/me`, POST vers `/projects`

### Batch B — Données de jeu *(priorité moyenne)*

- [X] `beacon_list_blueprints(game, filter?, contentPackId?)` — `GET /{game}/blueprints`
- [X] `beacon_list_engrams(game, filter?, contentPackId?)` — `GET /{game}/engrams`
- [X] `beacon_list_loot_drops(game)` — `GET /{game}/lootDrops`
- [X] `beacon_search_mods(game, query?)` — `GET /contentPacks?gameId=Ark|ArkSA`

### Batch C — Sentinel *(priorité selon besoins)*

- [X] `beacon_list_players(serviceId)` — `GET /sentinel/players?serviceId=`
- [X] `beacon_ban_player(serviceId, playerId, reason?, expiration?)` — `POST /sentinel/serviceBans/{uuid}` (UUID généré côté client)
- [X] `beacon_unban_player(serviceId, playerId)` — `GET /sentinel/serviceBans?expired=false` + `DELETE /sentinel/serviceBans/{id}`
- [X] `beacon_send_chat(serviceId, message, senderName?, languageCode?)` — `POST /sentinel/chat` (204 No Content)
- [X] `beacon_run_rcon(serviceId, type, command|message, senderName?)` — `POST /sentinel/gameCommands` (types : `admin`, `broadcast`, `chat`)

---

## Phase 4 — Client Connector TCP *(optionnel)*

**Objectif :** Contrôle local du serveur (start / stop / status).

**Durée estimée :** 1 journée

> À faire en dernier — dépend de l'accès à une machine avec Connector installé pour tester.

### Étapes

- [X] Implémenter le socket TCP vers port `48962`
- [X] Handshake : réception + déchiffrement de la connectionKey (AES + clé pré-partagée)
- [X] Chiffrement AES-256-CBC avec IV aléatoire (`Node.js crypto` natif)
- [X] CRC32 (polynomial 0xEDB88320) sur le payload clair
- [X] Gestion du nonce incrémental
- [X] Préparation de la clé : hex 64 chars → decode, sinon → SHA-256
- [X] Tools :
  - [X] `beacon_start_server(host, key, port?)`
  - [X] `beacon_stop_server(host, key, port?, message?)`
  - [X] `beacon_get_server_status(host, key, port?)`
  - [X] `beacon_set_server_param(host, key, port?, param, value)`

> Protocole extrait du code source Xojo du Connector (ControlSocket, BeaconEncryption, SymmetricHeader).
> À tester avec un Connector en production — les endpoints ont été vérifiés contre le code source.

---

## Phase 5 — Tests & affinage *(en continu)*

- [ ] Tester chaque tool manuellement via Claude Desktop
- [ ] Rédiger des descriptions de tools précises (le LLM les lit pour choisir)
- [ ] Gérer les erreurs API proprement (`401`, `404`, rate limits)
- [ ] Documenter les prérequis (mod doit être indexé, Sentinel token requis, etc.)

---

## Ordre de priorité

| Ordre | Phase                    | Valeur                  | Effort |
| ----- | ------------------------ | ----------------------- | ------ |
| 1     | Setup projet + auth      | Fondation               | Facile |
| 2     | Tools projets/configs    | Cas d'usage principal   | Facile |
| 3     | Tools blueprints/engrams | Loot & recettes         | Facile |
| 4     | Tools Sentinel           | Gestion communauté     | Moyen  |
| 5     | Client Connector         | Contrôle serveur local | Moyen  |

---

## Questions ouvertes

1. ✅ **Hébergement du MCP** — **Stdio local**, lancé comme subprocess par Claude Desktop / Cursor.
   Beacon étant une app locale (.exe), aucun serveur distant n'est nécessaire.
   ChatGPT n'est pas compatible MCP (protocole différent — Actions/OpenAPI).
2. ✅ **Accès à l'API** — URL de production : `https://api.usebeacon.app/v4` (API v4, courante).
   Documentation : `https://help.usebeacon.app/api/v4/`
   Pas de staging documenté. L'URL est configurable via `BEACON_API_URL` dans `.env` pour pointer vers une instance locale si besoin.
3. ✅ **Multi-comptes** — Un seul compte à la fois. Token stocké dans `~/.beacon-mcp/tokens.json`. Multi-comptes possible plus tard via `beacon_switch_account` si besoin.
4. ✅ **Jeux prioritaires** — MVP : **ARK Survival Evolved** + **ARK Survival Ascended**. Palworld prévu en phase suivante.

---

*Document créé le 2026-03-30 — Basé sur l'analyse MCP-BRIDGE.md*
