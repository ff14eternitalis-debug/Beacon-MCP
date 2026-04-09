# Beacon MCP — Plan d'action V2

> Plan d'action concret pour faire évoluer Beacon-MCP depuis une base fonctionnelle vers une version plus complète, plus fiable et plus utile pour un agent IA.

---

## Objectif

La V2 ne doit pas chercher à exposer tout Beacon d'un coup.

L'objectif est de :

- stabiliser les fondations du serveur MCP ;
- améliorer la qualité d'usage pour un agent IA ;
- compléter les cas d'usage les plus utiles autour des projets, des configs et de Sentinel ;
- préparer une extension propre vers d'autres objets métier et d'autres jeux.

---

## État actuel

La base existante couvre déjà :

- authentification OAuth device flow ;
- gestion de projets Beacon ;
- lecture/écriture de `Game.ini` ;
- lecture des options de configuration ;
- recherche de blueprints, engrams, loot drops et mods ;
- actions Sentinel de base ;
- contrôle local via le Connector TCP.

La V2 doit maintenant réduire l'écart entre :

- ce que Beacon expose réellement via son API et son modèle de données ;
- ce que Beacon-MCP permet aujourd'hui à une IA de faire proprement.

---

## Principes de conception

- Prioriser les workflows réels plutôt que l'exposition brute de tous les endpoints.
- Conserver des tools simples à comprendre par un LLM.
- Renvoyer des sorties à la fois lisibles par un humain et structurées pour l'agent.
- Isoler clairement les domaines : auth, projects, config, gamedata, sentinel, connector.
- Éviter les tools trop génériques qui deviendraient ambigus pour le modèle.

---

## Priorités V2

### Priorité 1 — Stabiliser le socle

Objectif : rendre le MCP plus fiable et plus prévisible.

Statut : `Terminé`

Travail recommandé :

- uniformiser le format des réponses de tools ;
- conserver un champ texte synthétique, mais ajouter une structure de données cohérente ;
- homogénéiser les erreurs auth, API, Sentinel et Connector ;
- clarifier les descriptions de tools pour améliorer le tool selection côté LLM ;
- ajouter une convention de validation d'arguments partagée.

Livrables :

- helpers communs enrichis dans `src/tools/shared.ts` ;
- format de sortie standard documenté ;
- messages d'erreur normalisés.

Réalisé :

- format de sortie unifié avec structure `ok / message / data / error / meta` ;
- validation d'arguments mutualisée ;
- mapping d'erreurs API centralisé ;
- transport HTTP aligné sur le format structuré ;
- migration des tools existants vers ce socle.

---

### Priorité 2 — Compléter la gestion de configuration

Objectif : couvrir les besoins les plus fréquents de configuration serveur.

Statut : `Terminé`

Travail recommandé :

- ajouter la lecture de `GameUserSettings.ini` ;
- ajouter l'écriture de `GameUserSettings.ini` ;
- étudier ensuite les `CommandLineOption` et `CommandLineFlag` si l'API les expose proprement ;
- prévoir des tools de lecture avant écriture pour guider l'IA dans un workflow sûr.

Tools cibles :

- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`
- `beacon_list_command_line_options`
- `beacon_put_command_line_options`

Pourquoi cette priorité :

- c'est un complément naturel à `Game.ini` ;
- c'est immédiatement utile ;
- le gain fonctionnel est élevé pour un effort raisonnable.

Réalisé :

- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`
- `beacon_list_command_line_options`
- harmonisation du workflow lecture → modification → écriture avec `Game.ini`
- recherche croisée doc + code Beacon pour confirmer la surface API réelle

Reste à faire :

- si Beacon expose plus tard une route projet dédiée aux sorties de ligne de commande, ajouter les tools d'écriture associés.

Conclusion technique :

- `GameUserSettings.ini` dispose d'une route projet dédiée côté API v4 ;
- `CommandLineFlag` et `CommandLineOption` existent bien dans le modèle de données Beacon ;
- en revanche, le routeur API v4 local ne montre pas de route projet dédiée de type `.../CommandLine`, donc la V2 expose aujourd'hui cette partie en lecture via `configOptions`, sans inventer d'endpoint d'écriture non prouvé.

---

### Priorité 3 — Étendre les données de jeu utiles

Objectif : permettre à l'IA de raisonner avec plus de contexte métier.

Statut : `Terminé`

Travail recommandé :

- ajouter les créatures ;
- ajouter les spawn points ;
- ajouter les maps ;
- ajouter les game variables ;
- ajouter des tools de détail unitaire quand un simple listing ne suffit plus.

Tools cibles :

- `beacon_list_creatures`
- `beacon_get_creature`
- `beacon_list_spawn_points`
- `beacon_get_spawn_point`
- `beacon_list_maps`
- `beacon_list_game_variables`
- `beacon_get_blueprint`
- `beacon_get_engram`

Pourquoi cette priorité :

- ces objets existent déjà dans la structure Beacon ;
- ils sont utiles pour des tâches d'équilibrage, de diagnostic et de génération de config ;
- ils réduisent les hallucinations de l'IA en donnant des références exactes.

Réalisé :

- `beacon_get_blueprint`
- `beacon_get_engram`
- `beacon_list_creatures`
- `beacon_get_creature`
- `beacon_list_spawn_points`
- `beacon_get_spawn_point`
- `beacon_list_maps`
- `beacon_list_game_variables`

Notes :

- les routes ont été confirmées à partir du routeur API v4 local Beacon ;
- les tools de détail s'appuient sur les endpoints d'instance `GET /{game}/.../{id}` ;
- les outils existants de listing `blueprints`, `engrams`, `lootDrops` et `mods` ont été conservés et harmonisés dans le même fichier.

---

### Priorité 4 — Faire une vraie V2 Sentinel

Objectif : passer d'actions ponctuelles à une vraie visibilité sur l'écosystème Sentinel.

Statut : `Terminé`

Travail recommandé :

- lister les services Sentinel accessibles ;
- lire les détails d'un service ;
- exposer les groupes ;
- exposer les buckets ;
- exposer les scripts ;
- ajouter ensuite les personnages, dinos, notes ou logs selon les besoins.

Tools cibles :

- `beacon_list_sentinel_services`
- `beacon_get_sentinel_service`
- `beacon_list_sentinel_groups`
- `beacon_get_sentinel_group`
- `beacon_list_sentinel_buckets`
- `beacon_get_sentinel_bucket`
- `beacon_list_sentinel_scripts`
- `beacon_get_sentinel_script`

Pourquoi cette priorité :

- aujourd'hui le MCP sait agir sur Sentinel, mais sait encore mal le décrire ;
- un agent a besoin de découverte avant action ;
- c'est une zone à forte valeur produit.

Réalisé :

- `beacon_list_sentinel_services`
- `beacon_get_sentinel_service`
- `beacon_list_sentinel_groups`
- `beacon_get_sentinel_group`
- `beacon_list_sentinel_buckets`
- `beacon_get_sentinel_bucket`
- `beacon_list_sentinel_scripts`
- `beacon_get_sentinel_script`
- conservation des tools d'action existants (`players`, `ban`, `unban`, `chat`, `rcon`)
- harmonisation des sorties Sentinel sur le même socle structuré que le reste du MCP

Notes :

- les endpoints ont été confirmés dans le routeur API v4 local Beacon (`services`, `groups`, `buckets`, `scripts`) ;
- les listings Sentinel supportent maintenant la découverte avant action, avec filtres alignés sur les champs de recherche exposés par les classes Beacon ;
- les tools de détail s'appuient sur les endpoints d'instance `GET /sentinel/.../{id}` pour exposer les métadonnées complètes.

---

### Priorité 5 — Préparer l'ouverture multi-jeux

Objectif : sortir du périmètre strict Ark/ArkSA sans dégrader la qualité du MCP.

Statut : `Terminé`

Travail recommandé :

- généraliser les validations de jeux supportés ;
- identifier les endpoints réellement stables pour Palworld ;
- introduire le support Palworld d'abord sur les lectures ;
- garder SDTD en phase ultérieure si les cas d'usage sont secondaires.

Ordre recommandé :

1. Palworld lecture seule
2. Palworld config
3. SDTD lecture seule

Réalisé :

- élargissement du socle partagé aux jeux `palworld` et `7dtd`
- validation des jeux supportés paramétrable par tool au lieu d'un enum global implicite
- support de `palworld` dans `beacon_get_config_options`
- support de `7dtd` dans `beacon_get_config_options`
- support de `palworld` dans `beacon_list_game_variables`
- conservation des tools projets et génération INI sur `ark` / `arksa` uniquement, car ce sont les seules routes projet confirmées dans l'API v4 locale

Notes :

- l'API v4 locale expose `palworld/configOptions`, `palworld/gameVariables` et `7dtd/configOptions` ;
- aucune route projet équivalente à `.../projects/{id}/Game.ini` n'a été confirmée pour `palworld` ou `7dtd` dans le routeur local ;
- l'ouverture multi-jeux V2 reste donc volontairement prudente : lecture et découverte d'abord, workflows projet ensuite si Beacon étend officiellement cette surface.

---

## Approche orientée workflows

La V2 devrait introduire quelques tools orientés tâches, pas seulement des wrappers d'endpoints.

Exemples :

- `beacon_inspect_project_config`
- `beacon_prepare_config_change`
- `beacon_validate_config_change`
- `beacon_summarize_sentinel_service`

Ces tools peuvent :

- agréger plusieurs appels internes ;
- réduire la charge de raisonnement côté LLM ;
- rendre les résultats plus fiables ;
- mieux refléter les usages réels de Beacon.

---

## Découpage de mise en oeuvre

### Lot 1 — Fondations

- refactor de `shared.ts`
- format standard des réponses
- normalisation des erreurs
- revue des descriptions de tools

### Lot 2 — Config avancée

- `GameUserSettings.ini`
- options de ligne de commande
- tests manuels des workflows lecture → modification → écriture

### Lot 3 — Gamedata enrichi

- creatures
- spawn points
- maps
- game variables
- tools de détail

### Lot 4 — Sentinel découverte

- services
- groupes
- buckets
- scripts

### Lot 5 — Extension multi-jeux

- Palworld
- harmonisation des enums de jeux
- vérification de compatibilité des tools existants

---

## Critères de réussite

La V2 sera réussie si :

- un agent peut découvrir les objets disponibles avant d'agir ;
- les réponses MCP sont plus structurées et plus stables ;
- les erreurs sont compréhensibles et actionnables ;
- la couverture config ne se limite plus à `Game.ini` ;
- Sentinel devient explorable, pas seulement pilotable ;
- l'architecture reste simple à étendre.

---

## Risques à surveiller

- multiplier les tools trop vite et perdre en clarté ;
- mélanger sorties texte et données sans convention stable ;
- exposer des opérations d'écriture sans workflow de lecture/validation ;
- ajouter Palworld trop tôt alors que le socle Ark/ArkSA n'est pas encore stabilisé ;
- faire des wrappers très bas niveau là où un tool métier serait plus utile.

---

## Recommandation finale

L'ordre le plus rentable pour la suite est :

1. stabiliser les sorties et erreurs ;
2. ajouter `GameUserSettings.ini` ;
3. ajouter `sentinel_list_services` et la découverte Sentinel ;
4. enrichir les objets métier de jeu ;
5. ouvrir Palworld.

Si une seule étape doit être lancée immédiatement, le meilleur prochain lot est :

- `GameUserSettings.ini`
- `beacon_list_sentinel_services`
- standardisation des réponses

Ce trio apporte le meilleur ratio entre effort, utilité et qualité d'expérience pour un agent IA.
