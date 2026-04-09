# Beacon MCP — Plan de transition vers un runtime `.exe` autonome

> Plan technique pour faire évoluer `Beacon-MCP` depuis un runtime local basé sur `node dist/index.js` vers un exécutable Windows autonome de type `Beacon-MCP.exe`.

---

## Objectif

L'objectif est de supprimer, à terme, la dépendance utilisateur à Node.js pour l'installation locale de `Beacon-MCP`.

Le résultat cible est :

- un exécutable Windows autonome
- une configuration client MCP plus simple
- une meilleure UX pour les utilisateurs non techniques
- un installeur Windows qui n'a plus besoin de vérifier Node.js

---

## Pourquoi passer à un `.exe`

Le runtime actuel `v1` fonctionne, mais il impose encore :

- la présence de Node.js
- une vérification de version
- un risque de conflit de runtime local
- une complexité supplémentaire dans l'installeur

Un `.exe` autonome apporte :

- aucune dépendance Node.js côté utilisateur
- un chemin cible unique
- une meilleure fiabilité du lancement
- une UX plus simple à expliquer

---

## État actuel

Aujourd'hui, le runtime local repose sur :

- `dist/index.js`
- `node_modules/`
- la commande :

```text
node C:\Users\<user>\AppData\Local\BeaconMCP\dist\index.js
```

L'installeur `v1` :

- copie le runtime
- vérifie Node.js
- configure les clients MCP avec `command = "node"`
- passe le chemin de `dist/index.js` en argument

---

## Cible v2

La cible `v2` est :

```text
C:\Users\<user>\AppData\Local\BeaconMCP\Beacon-MCP.exe
```

Et côté clients MCP :

### Codex

```toml
[mcp_servers.beacon]
command = "C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\Beacon-MCP.exe"
args = []
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "beacon": {
      "command": "C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\Beacon-MCP.exe",
      "args": []
    }
  }
}
```

---

## Contraintes importantes

La transition vers `.exe` doit préserver :

- le mode `stdio`
- le comportement MCP existant
- la compatibilité avec Codex / Claude Desktop / Cursor
- le stockage local des tokens Beacon
- la possibilité d'utiliser encore le mode HTTP si souhaité plus tard

Elle ne doit pas :

- casser les tools existants
- changer les noms des tools
- modifier le workflow d'authentification Beacon

---

## Options techniques possibles

### Option 1 — Packager Node.js avec le projet

Principe :

- embarquer le runtime Node avec l'app
- fournir un lanceur `.exe` ou `.bat`

Avantages :

- facile à mettre en place
- peu de refactor

Inconvénients :

- pas un vrai runtime autonome
- payload lourd
- moins propre à maintenir

Verdict :

- acceptable comme étape intermédiaire
- pas idéal comme cible finale

### Option 2 — Générer un exécutable autonome depuis le projet Node

Principe :

- compiler ou empaqueter le serveur TypeScript/Node en `.exe`

Outils possibles :

- `pkg`
- `nexe`
- bundling + runtime packagé

Avantages :

- meilleure UX
- distribution simple
- plus proche de la cible produit

Inconvénients :

- packaging parfois sensible selon les dépendances
- besoin de valider le comportement runtime MCP

Verdict :

- meilleure direction pour `v2`

---

## Recommandation

La meilleure trajectoire est :

1. garder `v1` sur Node
2. préparer le code pour fonctionner avec un chemin de runtime abstrait
3. produire un premier `.exe` packagé
4. adapter les patchers de config pour écrire `command = <exe>`
5. retirer ensuite la dépendance Node.js de l'installeur

---

## Préparation du code avant packaging

Avant de générer un `.exe`, il faut rendre le système plus abstrait.

Il faut notamment :

- séparer la notion de runtime Node et runtime `.exe`
- centraliser la génération du `command` et des `args`
- éviter d'avoir du code qui suppose forcément `node dist/index.js`

Aujourd'hui, cela se fait surtout dans :

- [install-path.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\payload\install-path.ts)
- [codex-config.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\config-patch\codex-config.ts)
- [claude-config.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\config-patch\claude-config.ts)
- [cursor-config.ts](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\installer\src\config-patch\cursor-config.ts)

---

## Refactor recommandé

Introduire une notion de :

```ts
type RuntimeMode = "node" | "exe";
```

Puis une fabrique centralisée :

```ts
getRuntimeCommandConfig(mode)
```

Qui retourne :

- `command`
- `args`
- `entryPath`
- `runtimeLabel`

Exemple :

### Mode `node`

- `command = "node"`
- `args = ["C:\\...\\dist\\index.js"]`

### Mode `exe`

- `command = "C:\\...\\Beacon-MCP.exe"`
- `args = []`

Cela évite de disperser la logique dans chaque patcher.

---

## Choix recommandé pour le packaging `.exe`

### Candidat principal : `pkg`

Pourquoi :

- connu pour empaqueter des apps Node en exécutable
- simple pour un MVP technique
- adapté aux apps CLI/stdio

Points à valider :

- compatibilité avec `@modelcontextprotocol/sdk`
- résolution correcte des imports CommonJS
- présence correcte des assets si besoin

### Alternative : `nexe`

Pourquoi :

- autre solution pour construire un exécutable Node

Inconvénient :

- souvent plus coûteux à régler

### Recommandation pratique

Tester d'abord :

1. build TypeScript propre
2. exécution locale `node dist/index.js`
3. packaging prototype avec `pkg`
4. test dans Codex / Claude / Cursor

---

## Impacts côté installateur

Quand le `.exe` sera prêt, l'installeur devra évoluer.

### Ce qui disparaît

- la vérification Node.js
- le besoin de copier `node_modules/`
- le besoin d'écrire `command = "node"`

### Ce qui change

- copie de `Beacon-MCP.exe`
- configs MCP qui pointent vers le `.exe`
- validation runtime qui lance directement l'exécutable

### Ce qui reste

- détection des apps
- sauvegarde/patch des configs
- validation post-install
- guide de premier test

---

## Impacts côté distribution

### v1

Payload distribué :

- `dist/`
- `node_modules/`
- scripts installateur

### v2

Payload distribué :

- `Beacon-MCP.exe`
- scripts installateur
- docs éventuelles

Résultat :

- installation plus légère
- moins de fichiers
- maintenance simplifiée

---

## Impacts côté patchers de config

Les patchers devront cesser d'écrire :

```text
command = "node"
args = ["...\\dist\\index.js"]
```

Et écrire :

```text
command = "C:\\...\\Beacon-MCP.exe"
args = []
```

Cela implique :

- une abstraction commune
- un mode configuré par l'installeur
- la possibilité de supporter temporairement `node` et `.exe`

---

## Stratégie de migration recommandée

### Étape 1 — Préparer l'abstraction runtime

But :

- supporter `node` et `.exe` avec la même couche de config

Livrable :

- helpers centralisés runtime

### Étape 2 — Produire un prototype `.exe`

But :

- vérifier qu'un runtime autonome démarre bien en `stdio`

Livrable :

- premier `Beacon-MCP.exe`

### Étape 3 — Tester la compatibilité MCP locale

But :

- valider Codex
- valider Claude Desktop
- valider Cursor

Livrable :

- matrice de compatibilité

### Étape 4 — Adapter les patchers

But :

- écrire les configs client en mode `.exe`

Livrable :

- patchers compatibles runtime autonome

### Étape 5 — Adapter l'installeur

But :

- supprimer la dépendance à Node

Livrable :

- installeur `v2`

### Étape 6 — Retirer progressivement la voie `node`

But :

- simplifier le produit final

Livrable :

- distribution centrée sur `.exe`

---

## Points de test critiques

Avant d'adopter définitivement le runtime `.exe`, il faut tester :

- démarrage `stdio`
- chargement MCP dans Codex
- chargement MCP dans Claude Desktop
- chargement MCP dans Cursor
- auth Beacon
- lecture projet
- lecture gamedata
- Sentinel
- comportement sur fermeture / redémarrage

---

## Risques à surveiller

- runtime `.exe` qui ne se comporte pas exactement comme `node dist/index.js`
- dépendances packagées incomplètement
- différence de comportement sur les chemins Windows
- antivirus / SmartScreen
- difficulté de debug une fois packagé

---

## Livrables recommandés

Cette phase devrait produire :

- doc de stratégie `.exe`
- abstraction runtime dans `installer/`
- prototype de build `.exe`
- test local Codex / Claude / Cursor
- adaptation progressive de l'installeur

---

## Recommandation finale

La bonne stratégie n'est pas de remplacer brutalement `node dist/index.js`, mais de :

- abstraire d'abord le runtime
- prouver ensuite le `.exe`
- migrer les patchers
- simplifier enfin l'installeur

En résumé :

> `v1` stabilise l'installation locale avec Node, puis `v2` remplace proprement le runtime par `Beacon-MCP.exe`.
