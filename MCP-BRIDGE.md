# Beacon MCP Bridge — Analyse de faisabilité

> Document d'analyse pour la création d'un serveur MCP (Model Context Protocol) servant de pont entre une IA (ex. Claude) et l'application Beacon.

---

## Qu'est-ce qu'un MCP ?

Le **Model Context Protocol (MCP)** est un protocole ouvert développé par Anthropic qui permet à un modèle d'IA de se connecter à des outils et sources de données externes via des "tools" structurés. Un serveur MCP expose des fonctions que l'IA peut appeler, comme elle appellerait une API.

---

## Points d'entrée disponibles dans Beacon

Beacon expose **trois interfaces exploitables** pour un serveur MCP.

---

### 1. L'API REST (v4) — Point d'entrée principal

L'API REST est la voie la plus riche et la mieux documentée. Elle est accessible via `Website/api/v4/` et couvre l'ensemble des fonctionnalités de Beacon.

#### Authentification
- OAuth2 avec les flows `authorization_code`, `device_code`, `refresh_token`
- Le flow `device_code` est idéal pour un MCP (pas d'interface browser requise)
- Endpoint : `POST /login`

#### Catégories d'endpoints disponibles

| Catégorie | Endpoints | Description |
|-----------|-----------|-------------|
| **Projets** | `GET/POST/DELETE /projects` | Lister, créer, supprimer des projets serveur |
| **Configs** | `GET/PUT /ark/projects/{id}/Game.ini` | Générer/modifier les fichiers INI |
| **Blueprints** | `ark/blueprints`, `arksa/blueprints` | CRUD sur les blueprints de jeu |
| **Créatures** | `ark/creatures`, `arksa/creatures` | Données des créatures |
| **Engrams** | `ark/engrams` | Items craftables |
| **Loot** | `ark/lootDrops` | Containers de loot |
| **Spawn Points** | `ark/spawnPoints` | Points d'apparition |
| **Variables** | `ark/gameVariables`, `ark/configOptions` | Paramètres de jeu |
| **Sentinel — Joueurs** | `sentinel/players`, `sentinel/characters` | Registre des joueurs |
| **Sentinel — Commandes** | `POST sentinel/gameCommands` | Exécution RCON |
| **Sentinel — Chat** | `POST sentinel/chat` | Chat in-game |
| **Sentinel — Bans** | `sentinel/services/{id}/bans.txt` | Gestion des bans |
| **Mods** | Content Packs via CurseForge/Steam | Accès au catalogue de mods |
| **Tokens** | `GET/POST/DELETE /tokens` | Gestion des tokens de service |

> Les mêmes endpoints existent pour chaque jeu supporté : `ark/`, `arksa/`, `palworld/`, `sdtd/`

---

### 2. Le Connector (démon local) — Contrôle du serveur

Le Connector est une application démon (daemon) Xojo qui tourne sur la machine hébergeant le serveur de jeu. Il expose un protocole TCP chiffré.

#### Protocole de communication

```
[Client MCP]
    ↓ TCP (port 48962 par défaut)
[Beacon Connector]
    1. Handshake : envoi d'une clé de connexion 32 bytes (AES-256)
    2. Échange de messages JSON chiffrés avec nonce séquentiel
    3. CRC32 pour l'intégrité de chaque message
```

#### Schéma de chiffrement
- **Version 2** (défaut) : AES-256-CBC avec IV aléatoire
- **Version 1** (legacy) : Blowfish-CBC
- Clé pré-partagée stockée dans `config.json`
- Nonce incrémental pour prévenir les attaques par rejeu

#### Configuration (`config.json`)

```json
{
  "Encryption Key": "<hex string 32 bytes>",
  "Port": 48962,
  "Config Folder": "/chemin/vers/configs",
  "Logs Folder": "/chemin/vers/logs",
  "Start Command": "commande de démarrage",
  "Stop Command": "commande d'arrêt (%message% substitution)",
  "Status Command": "commande de statut",
  "Set Parameter Command": "key=%key% value=%value%"
}
```

#### Opérations supportées
- Démarrer / arrêter le serveur
- Vérifier le statut du serveur
- Modifier des paramètres de configuration en live
- Accès aux logs

---

### 3. Fichiers locaux — Accès direct (mode hors-ligne)

Pour les cas sans connexion cloud, il est possible d'interagir directement avec les fichiers locaux.

| Format | Description |
|--------|-------------|
| `.beacon` | Fichier projet (binaire ou gzip + JSON sérialisé) |
| `Game.ini` | Config principale Ark/ArkSA/Palworld |
| `GameUserSettings.ini` | Config utilisateur du serveur |
| `PalWorldSettings.ini` | Config spécifique Palworld |
| SQLite (cache local) | Données de blueprints et content packs mis en cache |

---

## Tools MCP recommandés

Voici les outils que le serveur MCP pourrait exposer à une IA :

```
Gestion de projets :
├── list_projects()                        → lister les projets de l'utilisateur
├── get_project(projectId)                 → lire la config complète d'un projet
├── create_project(game, name)             → créer un nouveau projet
└── update_config(projectId, options)      → modifier des paramètres

Données de jeu :
├── list_blueprints(game, filter?)         → chercher créatures/items
├── get_blueprint(game, blueprintId)       → détail d'un blueprint
├── list_engrams(game, filter?)            → items craftables
├── list_loot_drops(game, filter?)         → containers de loot
└── search_mods(game, query)              → chercher des mods

Génération de configs :
├── generate_game_ini(projectId, game)     → produire le Game.ini final
└── get_config_options(game)              → lister tous les paramètres disponibles

Sentinel — Communauté :
├── list_players(serviceId)               → joueurs connectés/connus
├── get_player(serviceId, playerId)        → détail d'un joueur
├── ban_player(serviceId, playerId)        → bannir un joueur
├── unban_player(serviceId, playerId)      → lever un ban
├── list_characters(serviceId)            → personnages en jeu
└── send_chat(serviceId, message)         → envoyer un message in-game

Sentinel — Commandes serveur :
├── run_rcon(serviceId, command)           → exécuter une commande RCON
└── manage_scripts(serviceId)             → gérer les scripts d'automatisation

Connector — Contrôle local :
├── start_server(connectorConfig)          → démarrer le serveur
├── stop_server(connectorConfig, message?) → arrêter le serveur
├── get_server_status(connectorConfig)     → statut du serveur
└── set_server_param(connectorConfig, key, value) → modifier un param live
```

---

## Architecture recommandée

```
┌─────────────────────┐
│   Claude / AI       │
│  (ou tout LLM MCP)  │
└────────┬────────────┘
         │ MCP Protocol (stdio ou SSE)
         ▼
┌─────────────────────────────────┐
│       Serveur MCP               │
│   (Node.js + TypeScript)        │
│   SDK : @modelcontextprotocol   │
└──────────┬──────────────────────┘
           │                    │
    HTTP REST (OAuth2)     TCP chiffré (AES-256)
           │                    │
           ▼                    ▼
┌──────────────────┐   ┌─────────────────────┐
│  Beacon Cloud    │   │  Beacon Connector   │
│  API v4          │   │  (démon local)      │
└──────────┬───────┘   └──────────┬──────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐   ┌─────────────────────┐
│  PostgreSQL      │   │  Serveur de jeu     │
│  (Cloud)         │   │  (local)            │
└──────────────────┘   └─────────────────────┘
```

---

## Stack technique recommandée

| Composant | Technologie | Justification |
|-----------|-------------|---------------|
| Serveur MCP | **Node.js + TypeScript** | SDK MCP officiel Anthropic disponible |
| Auth OAuth2 | Flow `device_code` | Pas d'interface browser, idéal pour MCP |
| Client HTTP | `axios` ou `fetch` natif | Appels vers l'API REST Beacon |
| Connector client | Socket TCP custom | Implémentation AES-256-CBC (Node.js `crypto`) |
| Config | Fichier `.env` ou `config.json` | Clés API, URL, clé Connector |

---

## Estimation de complexité

| Composant | Difficulté | Notes |
|-----------|-----------|-------|
| Wrapper API REST | **Facile** | API bien structurée, OAuth2 standard |
| Tools CRUD projets/configs | **Facile** | Endpoints clairs et documentés |
| Génération de configs INI | **Facile** | Endpoint dédié existant |
| Sentinel (joueurs/RCON) | **Moyen** | Nécessite token Sentinel valide |
| Connector local (TCP) | **Moyen** | Protocole custom à implémenter (chiffrement AES) |
| Auth OAuth2 complète | **Moyen** | Flow `device_code` disponible, bien supporté |
| Support multi-jeux | **Facile** | Même structure pour Ark, ArkSA, Palworld, SDTD |

---

## Cas d'usage concrets

Avec ce MCP, une IA pourrait :

- *"Optimise les spawn points de mon serveur Ark pour augmenter la difficulté"*
- *"Génère un Game.ini équilibré pour 10 joueurs en PvP"*
- *"Liste les joueurs connectés et vérifie s'il y a des bans actifs"*
- *"Ajoute ce mod CurseForge à mon projet et régénère la config"*
- *"Redémarre le serveur avec le message 'Maintenance dans 5 min'"*
- *"Quels sont les engrams disponibles dans ce content pack ?"*

---

## Qualité des données : l'IA peut-elle se fier à Beacon ?

> Cette question a été soulevée par le créateur de Beacon : *"L'IA aura besoin de beaucoup de données d'entraînement spécifiques à la configuration d'Ark dans RAG. L'IA a tendance à interpréter les configurations de manière très erronée."*

### Ce que Beacon fournit déjà

L'API expose pour chaque option de configuration :

```
description    → texte explicatif de l'option (présent)
value_type     → Numeric / Boolean / Array / Structure / Text
default_value  → valeur par défaut officielle
file           → Game.ini ou GameUserSettings.ini
header         → section INI exacte
ui_group       → catégorie sémantique
constraints    → objet JSON de contraintes (champ présent dans le schéma)
```

La **structure syntaxique est complète** : l'IA sait *où* mettre quoi, sous quel format, et dispose d'une description textuelle pour chaque paramètre.

---

### Ce qui manque réellement

Le schéma de Beacon ne contient pas :

| Donnée absente | Conséquence pour l'IA |
|---------------|----------------------|
| Plages de valeurs recommandées | Peut proposer `XPMultiplier=500` sans savoir que c'est absurde |
| Interdépendances entre paramètres | Ex. : fort XP + taming rapide casse la progression |
| Seuils de performance serveur | Certaines valeurs provoquent des crashs |
| Contexte PvP vs PvE | Les valeurs "bonnes" sont radicalement différentes selon le mode |
| Fourchettes de stats créatures | Pas d'indication sur ce qui est considéré "abusif" |

Le champ `constraints` existe dans le schéma PostgreSQL mais est **quasi vide** dans les données actuelles.

---

### Trois approches pour résoudre le problème

#### Option A — MCP bien conçu (suffisant pour 80% des cas)

L'IA appelle `get_config_options()` **avant toute modification**. Elle reçoit les descriptions, types et valeurs par défaut. Les LLMs modernes ont déjà été entraînés sur des masses de données Ark (wikis, forums, Reddit, serveurs dédiés) et peuvent raisonner correctement dans ce contexte.

- **Avantage :** Rien à construire de plus, opérationnel immédiatement
- **Limite :** L'IA peut quand même proposer des valeurs déséquilibrées sur des cas rares

#### Option B — Enrichir les contraintes dans Beacon (approche recommandée)

Le champ `constraints` existe déjà. Il suffit de le peupler progressivement :

```json
{
  "min": 0.1,
  "max": 10.0,
  "recommended_min": 0.5,
  "recommended_max": 3.0,
  "warning": "Au-delà de 5.0, impact critique sur les performances serveur"
}
```

Le MCP expose ces contraintes enrichies → l'IA s'en sert comme garde-fous.

- **Avantage :** Données vérifiées par les développeurs Beacon, réutilisables dans l'UI aussi
- **Effort :** Modéré — enrichissement progressif des données existantes

#### Option C — RAG dédié (ce que propose le créateur)

Ingérer des docs Ark (wiki, patch notes, guides communautaires) dans une base vectorielle (pgvector, Pinecone) pour du retrieval contextuel à la volée.

- **Avantage :** Très riche, couvre les cas rares et les interactions complexes
- **Inconvénient :** Coût d'infrastructure, maintenance continue, risque de données obsolètes (Ark reçoit des mises à jour fréquentes)

---

### Verdict

> **Le créateur a raison sur le risque. Il a tort sur la solution obligatoire.**

| Approche | Effort | Couverture | Recommandée pour |
|----------|--------|------------|-----------------|
| A — MCP seul | Aucun | 80% des cas | Démarrage, MVP |
| B — Contraintes enrichies | Modéré | 95% des cas | Production |
| C — RAG dédié | Élevé | 99% des cas | Stratégies complexes |

La vraie protection contre les mauvaises configs reste que **l'API Beacon elle-même valide les inputs** : l'IA propose, Beacon refuse si c'est syntaxiquement invalide. L'enrichissement progressif des contraintes (Option B) est le meilleur investissement car il bénéficie à la fois au MCP et à l'interface utilisateur existante de Beacon.

---

## Loot personnalisé et recettes avec du contenu moddé

### Le problème fondamental : les blueprints de mods

Tout dans Beacon (loot, recettes) est référencé par un **chemin de blueprint UE4** exact :

```
Vanilla : /Game/PrimalEarth/Blueprints/Items/Armor/Helmet_Riot_C
Moddé   : /Game/Mods/12345678/Blueprints/MyItem_C
```

L'IA ne peut pas inventer ces chemins. Une seule lettre de différence = item introuvable par le jeu. Elle doit les obtenir depuis la base Beacon.

---

### Condition préalable : le mod doit être indexé dans Beacon

Avant toute chose, le mod doit exister dans `public.content_packs` avec ses items enregistrés dans `ark.engrams`. Si le mod n'est pas indexé, l'IA n'a aucun moyen de connaître les chemins de ses items.

```
GET /api/v4/ark/blueprints?contentPackId={uuid_du_mod}
→ renvoie tous les items indexés du mod avec leurs chemins
```

Si le résultat est vide → le mod n'est pas encore dans Beacon → importer via l'UI Beacon d'abord.

---

### La hiérarchie du loot (structure à 4 niveaux)

L'IA doit comprendre et construire cette hiérarchie complète :

```
LootSource   (le container : crate, beacon, coffre...)
  └── ItemSet     (groupe thématique, ex: "Armures")
        └── Entry     (un "slot" avec plage de qualité/quantité)
              └── Option  (les items possibles dans ce slot, avec poids)
                    └── Engram UUID  (l'item réel, référencé par son ID interne)
```

Chaque niveau possède ses propres paramètres probabilistes (poids, min/max, blueprint chance).

#### Paramètres clés par niveau

| Niveau | Paramètres importants |
|--------|-----------------------|
| **LootSource** | `minItemSets`, `maxItemSets`, `preventDuplicates`, `multiplierMin/Max` |
| **ItemSet** | `minEntries`, `maxEntries`, `weight`, `preventDuplicates` |
| **Entry** | `minQuantity`, `maxQuantity`, `minQuality`, `maxQuality`, `blueprintChance`, `weight`, `statClampMultiplier` |
| **Option** | `engramId` (UUID), `weight` |

**Tiers de qualité disponibles :** `Primitive → Ramshackle → Apprentice → Journeyman → Mastercraft → Ascendant → Tek`

---

### Ce que l'IA doit recevoir comme contexte

#### Pour créer un loot personnalisé avec du contenu moddé

| Donnée nécessaire | Source API | Disponible |
|------------------|-----------|-----------|
| UUID du content pack du mod | `GET /ark/blueprints?marketplace_id=STEAMID` | Oui, si indexé |
| Liste des engrams du mod (label + uuid) | `GET /ark/engrams?contentPackId=UUID` | Oui, si indexé |
| Liste des loot sources existants | `GET /ark/lootDrops` | Oui |
| Tiers de qualité | Enum fixe dans le schéma | Oui |

#### Pour modifier une recette de craft avec des items moddés

| Donnée nécessaire | Source API | Disponible |
|------------------|-----------|-----------|
| UUID de l'engram à modifier | `GET /ark/engrams?label=NomItem` | Oui |
| UUID de chaque ingrédient (vanilla ou moddé) | `GET /ark/engrams?contentPackId=UUID` | Oui, si indexé |
| Recette actuelle | `GET /ark/engrams/{id}` → champ `recipe` | Oui |

---

### Ce qui manque encore (le vrai gap)

Ces informations ne sont **pas dans Beacon** et l'IA devra s'appuyer sur sa connaissance générale d'Ark :

- Compatibilité entre mods (conflits de chemins)
- Équilibre des poids probabilistes (ex: 1.0 vs 3.0 = combien de % réels ?)
- Règles de qualité par type d'item (armure vs arme vs ressource)
- Quels loot sources sont "safe" à modifier vs vanilla sensibles
- Impact gameplay d'une `blueprintChance` élevée
- Mods non encore indexés dans Beacon

---

### Workflow fiable pour l'IA

```
1. Vérifier que le mod est indexé
   → GET /ark/blueprints?marketplace_id=STEAMID
   → Si vide : importer le mod via l'UI Beacon d'abord

2. Récupérer les items du mod
   → GET /ark/engrams?contentPackId={uuid}
   → L'IA travaille avec des UUIDs validés, jamais avec des chemins bruts

3. Construire la structure JSON hiérarchique
   → LootSource → ItemSets → Entries → Options (engram UUIDs)

4. Soumettre via l'API, Beacon valide
   → Si un UUID est invalide, l'API refuse automatiquement
```

> **Point clé :** l'IA ne manipule jamais les chemins de blueprints bruts — elle travaille uniquement avec des UUIDs déjà validés dans la base Beacon. Le risque d'erreur est concentré sur une seule question : **le mod est-il bien indexé ?**

---

## Prochaines étapes suggérées

1. **Initialiser le projet MCP** — `npm init` + SDK `@modelcontextprotocol/sdk`
2. **Implémenter l'auth OAuth2** — flow `device_code` vers `POST /login`
3. **Wrapper les endpoints REST prioritaires** — projets, configs, blueprints
4. **Ajouter les tools Sentinel** — joueurs, RCON, bans
5. **Implémenter le client Connector** (optionnel) — socket TCP + AES-256
6. **Tester avec Claude Desktop** — via `claude_desktop_config.json`

---

*Document généré le 2026-03-29 — Basé sur l'analyse du code source de Beacon (branch `master`, commit `9bde11585`)*
