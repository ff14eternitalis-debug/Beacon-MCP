# Connecter une IA à Beacon — Explication simple

> Ce document explique, sans jargon technique, comment une intelligence artificielle pourrait être connectée à Beacon pour t'aider à gérer ton serveur de jeu.

---

## C'est quoi l'idée en deux mots ?

Imagine que tu puisses écrire à une IA (comme ChatGPT ou Claude) :

> *"Crée-moi un loot personnalisé pour mon serveur Ark avec les items du mod Primal Fear"*

...et que l'IA le fasse directement dans Beacon, sans que tu aies à toucher à quoi que ce soit.

C'est exactement ce que permettrait ce pont entre l'IA et Beacon.

---

## Comment ça marcherait concrètement ?

Pense à ça comme un **traducteur** entre toi, l'IA, et Beacon.

```
Toi  →  tu parles à l'IA en français normal
 ↓
L'IA  →  elle comprend ce que tu veux faire
 ↓
Le pont  →  il traduit ça en actions dans Beacon
 ↓
Beacon  →  il applique les changements sur ton serveur
```

Tu n'as jamais besoin de comprendre comment Beacon fonctionne en interne. Tu parles, l'IA s'occupe du reste.

---

## Ce que l'IA pourrait faire pour toi

### Gérer ton serveur
- Démarrer ou arrêter le serveur à distance
- Vérifier si le serveur tourne
- Changer un paramètre de config sans ouvrir Beacon

### Personnaliser le jeu
- Créer des loots sur-mesure dans les caisses, coffres et supply drops
- Modifier les recettes de craft d'un item
- Ajouter des items de mods dans des loots existants
- Générer un fichier de configuration complet selon tes besoins

### Gérer la communauté
- Voir qui est connecté sur le serveur
- Bannir ou débannir un joueur
- Envoyer un message dans le chat du jeu
- Gérer les scripts d'automatisation

---

## Par où l'IA peut-elle entrer dans Beacon ?

Il y a **trois portes d'entrée** possibles :

### Porte 1 — Via le site Beacon (la principale)
Beacon a déjà un site web avec toutes les fonctions disponibles. L'IA peut s'y connecter avec ton compte et faire exactement ce que toi tu ferais manuellement. C'est la porte la plus complète.

### Porte 2 — Via le Connector (pour le serveur local)
Le Connector est un petit programme qui tourne sur la machine où est hébergé le serveur. Il permet à l'IA de démarrer/arrêter le serveur et de modifier des réglages en temps réel, même sans passer par internet.

### Porte 3 — Via les fichiers (mode hors-ligne)
Si tout le reste est indisponible, l'IA peut lire et écrire directement les fichiers de configuration du serveur sur le disque.

---

## Est-ce que l'IA est assez intelligente pour faire ça correctement ?

C'est **la vraie question**, et le créateur de Beacon s'en inquiète aussi. Voici la réponse honnête.

### Ce que Beacon donne déjà à l'IA

Pour chaque paramètre de configuration, Beacon sait déjà :
- Ce que le paramètre fait (une description en texte)
- Quel type de valeur il attend (un nombre, un texte, vrai/faux...)
- Quelle est sa valeur par défaut
- Dans quel fichier il doit aller

Ça, c'est déjà suffisant pour que l'IA ne fasse pas d'erreurs de base.

### Ce que Beacon ne sait pas encore

Beacon n'a pas (encore) d'information sur :
- Les valeurs qui sont "raisonnables" vs "abusées" (ex: un multiplicateur d'XP à 500, c'est ridicule)
- Les paramètres qui interagissent entre eux (ex: XP rapide + apprivoisement rapide = progression cassée)
- La différence entre un réglage PvP et un réglage PvE
- Les valeurs qui font planter le serveur si elles sont trop élevées

### Les trois façons de combler ce manque

**Option 1 — Laisser l'IA se débrouiller avec ce qu'elle sait**
Les IA modernes ont déjà été formées sur des tonnes de données sur Ark (wikis, forums, guides). Dans 80% des cas, elles s'en sortent correctement. C'est la solution la plus simple pour démarrer.

**Option 2 — Enrichir Beacon progressivement (recommandée)**
Beacon a déjà des cases prévues pour stocker des valeurs recommandées, mais elles sont vides. Il suffirait de les remplir progressivement avec des indications comme *"entre 0.5 et 3.0 c'est raisonnable, au-delà le serveur peut avoir des problèmes"*. L'IA utiliserait ces infos comme garde-fous.

**Option 3 — Créer une bibliothèque de docs dédiée (ce que propose le créateur)**
Rassembler tous les guides, wikis et notes sur Ark dans une base de données que l'IA consulte avant de répondre. C'est la solution la plus robuste mais aussi la plus lourde à maintenir, car Ark se met souvent à jour.

### En résumé

> L'IA peut se tromper sur des valeurs d'équilibre, mais elle ne peut pas créer des données corrompues — Beacon vérifie tout avant d'appliquer. Le pire qui peut arriver, c'est un serveur mal équilibré, pas un serveur cassé.

---

## Le cas particulier des mods

C'est là que ça se complique un peu. Voici pourquoi.

### Chaque item d'un mod a une adresse unique

Dans Ark, chaque objet (qu'il soit vanilla ou moddé) a une adresse précise dans les fichiers du jeu, un peu comme un chemin de dossier sur ton ordinateur. Par exemple :

```
Item vanilla  :  /Game/PrimalEarth/Blueprints/Items/Armor/Helmet_Riot_C
Item moddé    :  /Game/Mods/12345678/Blueprints/MonCasque_C
```

L'IA **ne peut pas inventer** ces adresses. Si elle se trompe d'une lettre, l'item n'existe pas pour le jeu.

### La règle d'or : le mod doit d'abord être dans Beacon

Pour que l'IA puisse travailler avec un mod, ce mod doit avoir été importé dans Beacon au préalable. Une fois qu'il est là, Beacon connaît l'adresse exacte de tous ses items, et l'IA n'a qu'à les demander.

Si le mod n'est pas encore dans Beacon → l'IA ne peut rien faire → il faut d'abord l'importer via l'interface de Beacon.

### Comment marche un loot personnalisé ?

Un loot dans Ark c'est comme une **poupée russe à 4 niveaux** :

```
Le container (la caisse, le beacon, le coffre...)
  └── Un groupe d'items (ex: "Armures")
        └── Un emplacement (ex: "1 à 2 pièces d'armure")
              └── Les items possibles (ex: casque OU plastron OU jambières)
```

Chaque niveau a ses propres réglages : combien d'items minimum, combien maximum, quelle qualité, quelle chance d'avoir un blueprint plutôt qu'un item crafté, etc.

L'IA doit comprendre et construire cette structure complète. C'est faisable, mais elle a besoin que le mod soit bien référencé dans Beacon pour connaître les items disponibles.

### Ce que l'IA ne peut pas savoir sur les mods

Même avec le mod importé dans Beacon, il reste des choses que l'IA devra deviner :
- Est-ce que ce mod est compatible avec tel autre mod ?
- Quel poids donner à chaque item pour que ça soit équilibré ?
- Quelles caisses sont "safe" à modifier sans casser le jeu vanilla ?

Pour ces points, l'IA s'appuie sur sa connaissance générale d'Ark et sur ce que tu lui précises.

---

## Ce qu'il faudrait pour lancer ça

En partant de rien jusqu'à quelque chose qui marche :

**1. S'assurer que les mods sont bien dans Beacon**
Importer les mods avec lesquels tu veux travailler via l'interface Beacon normale.

**2. Créer le pont entre l'IA et Beacon**
C'est le travail de développement principal. Ça représente quelques semaines de travail pour un développeur.

**3. Connecter l'IA à ce pont**
Une fois le pont créé, n'importe quelle IA compatible (Claude, ChatGPT, etc.) peut l'utiliser.

**4. Tester et affiner**
Tester les cas concrets (loot, recettes, gestion de joueurs) et corriger ce qui ne marche pas bien.

| Ce qu'on veut faire | Facilité | Remarque |
|--------------------|---------|---------|
| Gérer les projets et configs | Facile | Tout est déjà là dans Beacon |
| Créer/modifier des loots | Moyen | Faisable si le mod est importé |
| Modifier des recettes de craft | Moyen | Idem |
| Gérer les joueurs et bans | Moyen | Nécessite un accès Sentinel |
| Démarrer/arrêter le serveur | Moyen | Nécessite le Connector installé |

---

## Ce qu'on retient

- C'est **faisable** et Beacon est bien structuré pour ça
- Le risque d'erreur de l'IA est **contenu** : Beacon valide tout, l'IA ne peut pas corrompre les données
- Le vrai prérequis pour les mods : **ils doivent être importés dans Beacon avant**
- On n'a **pas besoin** d'une grosse bibliothèque de données spécialisée pour commencer — les LLMs modernes s'en sortent sur les 80% de cas courants
- L'enrichissement des valeurs recommandées dans Beacon est la meilleure évolution à long terme

---

*Document rédigé le 2026-03-29 — Version accessible de MCP-BRIDGE.md*
