# Beacon MCP — Conception technique de l'installeur Windows

> Document technique pour cadrer la mise en oeuvre du MVP d'installeur Windows local : structure du projet, scripts de patch de configuration, format de distribution, et choix du framework d'installation.

---

## Objectif

Ce document précise comment construire le MVP d'installation locale de `Beacon-MCP` pour un public non technique.

Le périmètre couvert ici est :

- structure du projet installeur
- scripts de patch de configuration
- format de distribution
- choix du framework d'installeur Windows

---

## Résultat attendu

À l'issue de cette phase, l'équipe doit pouvoir :

- produire un payload installable localement
- détecter Codex, Claude Desktop et Cursor
- modifier leurs configs MCP proprement
- livrer un installateur Windows simple
- préparer une évolution future vers un `.exe` autonome

---

## 1. Structure recommandée du projet installeur

L'installeur doit être isolé du coeur MCP, tout en restant dans le même repo.

Structure recommandée :

```text
Beacon-MCP/
├── dist/
├── src/
├── doc/
├── installer/
│   ├── assets/
│   ├── scripts/
│   ├── templates/
│   ├── build/
│   ├── output/
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
└── README.md
```

### Rôle de chaque dossier

#### `installer/assets/`

Contient :

- icônes
- image de bannière
- logos
- textes intégrés à l'UI

#### `installer/scripts/`

Contient :

- détection des clients installés
- sauvegarde des fichiers de config
- patch des fichiers de config
- copie des fichiers Beacon-MCP
- validation post-install
- désinstallation

#### `installer/templates/`

Contient :

- exemples de fragments de config
- modèles JSON
- modèles TOML
- messages finaux

#### `installer/build/`

Contient :

- scripts de build de l'installeur
- génération des payloads
- assemblage final

#### `installer/output/`

Contient :

- les artefacts générés
- `.exe`
- `.zip`
- manifestes éventuels

---

## 2. Sous-structure technique recommandée

Une organisation plus détaillée peut être :

```text
installer/
├── src/
│   ├── app-detection/
│   │   ├── codex.ts
│   │   ├── claude.ts
│   │   └── cursor.ts
│   ├── config-patch/
│   │   ├── codex-config.ts
│   │   ├── claude-config.ts
│   │   ├── cursor-config.ts
│   │   └── backup.ts
│   ├── payload/
│   │   ├── install-path.ts
│   │   ├── copy-runtime.ts
│   │   └── runtime-check.ts
│   ├── post-install/
│   │   ├── validation.ts
│   │   └── first-test.ts
│   ├── uninstall/
│   │   └── remove.ts
│   ├── types/
│   └── index.ts
├── assets/
├── templates/
├── build/
└── output/
```

Cette structure sépare bien :

- détection
- patch de config
- installation runtime
- validation
- désinstallation

---

## 3. Scripts de patch de configuration

Les scripts de patch sont une partie critique du MVP.

Ils doivent être :

- sûrs
- idempotents
- non destructifs
- testables indépendamment de l'installeur UI

---

## 4. Règles générales de patch

Chaque patch de config doit :

1. localiser le fichier cible
2. vérifier qu'il est lisible
3. créer une sauvegarde
4. parser le contenu existant
5. détecter si l'entrée `beacon` existe déjà
6. fusionner ou mettre à jour l'entrée `beacon`
7. écrire le résultat
8. relire le fichier pour vérifier l'écriture

Il ne faut jamais :

- écraser tout le fichier sans parsing
- supprimer d'autres serveurs MCP
- supposer que la config est vide

---

## 5. Patch de config Codex

### Fichier cible

```text
C:\Users\<user>\.codex\config.toml
```

### Bloc attendu

```toml
[mcp_servers.beacon]
command = "node"
args = ["C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\dist\\index.js"]
```

### Contraintes

- conserver toutes les autres sections du fichier
- ne modifier que `mcp_servers.beacon`
- garder le TOML valide

### Recommandation

Utiliser un parseur TOML fiable au lieu d'un remplacement texte naïf.

---

## 6. Patch de config Claude Desktop

### Fichier cible

- fichier de configuration Claude Desktop Windows

### Structure attendue

Ajouter une entrée `beacon` dans l'objet `mcpServers`.

Exemple :

```json
{
  "mcpServers": {
    "beacon": {
      "command": "node",
      "args": [
        "C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\dist\\index.js"
      ]
    }
  }
}
```

### Contraintes

- ne pas supprimer d'autres serveurs MCP
- conserver le JSON valide
- formater proprement après écriture

---

## 7. Patch de config Cursor

### Fichier cible

- fichier MCP Cursor usuel

### Structure attendue

Ajouter une entrée `beacon` dans `mcpServers`.

### Contraintes

- préserver le JSON existant
- ne pas casser les autres MCP

---

## 8. Sauvegarde des configs

Avant toute modification, créer une sauvegarde.

Format recommandé :

```text
<fichier>.bak
```

ou

```text
<fichier>.YYYYMMDD-HHMMSS.bak
```

Minimum attendu :

- une sauvegarde par fichier modifié
- restauration possible en cas d'échec

---

## 9. Détection des applications

Chaque client doit avoir un module de détection dédié.

Chaque module doit retourner :

- `detected`
- `configPath`
- `isWritable`
- `isRunning`
- `recommendedAction`

Exemple de type interne :

```ts
type ClientDetectionResult = {
  client: "codex" | "claude" | "cursor";
  detected: boolean;
  configPath?: string;
  isWritable?: boolean;
  isRunning?: boolean;
  recommendedAction?: "configure" | "restart_recommended" | "not_found" | "read_only";
};
```

---

## 10. Validation post-install

Le module de validation doit vérifier :

- que le runtime a bien été copié
- que le chemin cible existe
- que le runtime Beacon-MCP démarre
- que la config a bien été écrite pour les clients sélectionnés

Tests recommandés :

- existence du chemin d'installation
- existence du runtime
- exécution locale du runtime avec timeout court
- relecture des fichiers de config patchés

---

## 11. Format de distribution recommandé

Pour le MVP, il faut séparer :

- format interne de build
- format externe de distribution utilisateur

### Format interne

Le payload de build peut être :

- un dossier `runtime/`
- un dossier `installer/output/`
- un manifest simple avec version

### Format externe

Le MVP devrait distribuer :

1. un `.exe` d'installation
2. éventuellement un `.zip` portable pour support ou debug

### Recommandation

Distribution principale :

- `Beacon-MCP-Setup.exe`

Distribution secondaire :

- `Beacon-MCP-Portable.zip`

Pourquoi :

- le `.exe` simplifie l'expérience
- le `.zip` aide le support technique

---

## 12. Payload v1 recommandé

Pour `v1`, le payload embarqué dans l'installeur peut contenir :

- `dist/`
- `node_modules/`
- `.env.example`
- guide de démarrage
- éventuellement un script de test

But :

- éviter à l'utilisateur `npm install`
- éviter à l'utilisateur `npm run build`

---

## 13. Payload v2 recommandé

Pour `v2`, remplacer le runtime Node par :

- `Beacon-MCP.exe`

Avantages :

- aucune dépendance à Node.js
- config client plus simple
- meilleure fiabilité côté utilisateur

---

## 14. Choix du framework d'installeur Windows

Il faut distinguer :

- la logique de préparation et patch
- le framework de packaging/install

---

## 15. Options possibles

### Option A — Inno Setup

Avantages :

- mature
- très utilisé sur Windows
- bon pour faire un vrai installeur `.exe`
- bon support des raccourcis, désinstallation, écriture de fichiers

Inconvénients :

- logique UI plus classique
- scripting moins agréable que TypeScript pour les parties complexes

Verdict :

- excellent candidat pour l'installeur final

### Option B — NSIS

Avantages :

- très léger
- très classique

Inconvénients :

- moins agréable à maintenir
- scripting moins confortable

Verdict :

- possible, mais moins attractif

### Option C — Electron / Tauri pour une UI d'installeur

Avantages :

- UI moderne
- plus flexible pour guider l'utilisateur

Inconvénients :

- plus lourd
- coûteux pour un MVP

Verdict :

- intéressant plus tard, pas nécessaire pour le MVP

### Option D — PowerShell + UI minimale

Avantages :

- rapide à prototyper
- facile pour scripts système

Inconvénients :

- UX inférieure
- moins rassurant pour le grand public

Verdict :

- très bon pour un prototype interne
- moins bon pour la distribution publique

---

## 16. Recommandation de framework

Pour le MVP :

- logique métier en TypeScript ou Node dans `installer/`
- packaging et install Windows avec **Inno Setup**

Cette combinaison donne :

- logique testable
- patch config maintenable
- vrai `.exe` Windows
- désinstallation standard

---

## 17. Répartition des responsabilités

### Scripts Node / TypeScript

Responsables de :

- détecter les apps
- sauvegarder les configs
- parser et patcher les configs
- valider l'installation
- générer les fichiers à embarquer

### Framework d'installeur Windows

Responsable de :

- copier les fichiers
- créer les raccourcis
- gérer l'installation/désinstallation
- lancer éventuellement les scripts de post-install
- afficher les écrans utilisateur

---

## 18. Décision recommandée pour le MVP

Choix conseillé :

- runtime : bundle local Node
- logique d'installation : TypeScript/Node
- installeur Windows : Inno Setup
- distribution : `Beacon-MCP-Setup.exe`

Cette solution est le meilleur compromis entre :

- rapidité de livraison
- robustesse
- maintenabilité
- expérience utilisateur

---

## 19. Livrables techniques attendus

La phase technique devrait produire :

- arborescence `installer/`
- module de détection Codex
- module de détection Claude Desktop
- module de détection Cursor
- patch TOML Codex
- patch JSON Claude
- patch JSON Cursor
- système de sauvegarde/restauration
- validation post-install
- packaging runtime
- script Inno Setup

---

## 20. Ordre de mise en oeuvre recommandé

1. créer la structure `installer/`
2. implémenter la détection des clients
3. implémenter les sauvegardes
4. implémenter les patchs de config
5. implémenter le test de démarrage Beacon-MCP
6. générer le payload local installable
7. écrire le script Inno Setup
8. tester l'installation complète sur une machine Windows propre

---

## Recommandation finale

Pour réussir vite et proprement :

- séparer la logique d'installation de la logique MCP
- écrire des patchers robustes et testables
- utiliser un chemin d'installation stable
- distribuer un vrai installeur Windows
- garder `v1` simple avec Node embarqué ou bundle local
- réserver le `.exe` autonome à `v2`

La décision la plus rentable à ce stade est :

> `installer/` en TypeScript + packaging Windows avec Inno Setup.
