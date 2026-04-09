# Beacon MCP — Guide d'utilisation

> Guide pratique pour utiliser `Beacon-MCP` dans Codex, Claude Desktop ou Cursor sans avoir à manipuler directement l'interface Beacon pour les tâches courantes.

---

## Objectif

`Beacon-MCP` permet d'utiliser Beacon depuis un assistant IA local pour :

- se connecter à Beacon
- retrouver ses projets
- créer ou modifier un projet
- activer des mods
- modifier des engrams
- inspecter ou copier des structures de loot
- exporter le code utile d'un projet

Le but est simple :

- parler naturellement à l'assistant
- laisser le MCP faire les recherches Beacon
- ne passer par Beacon Desktop que lorsque c'est réellement nécessaire

---

## Avant de commencer

Pour utiliser ce guide, il faut :

- avoir installé `Beacon-MCP` localement
- avoir configuré Codex, Claude Desktop ou Cursor avec le serveur MCP Beacon
- avoir un compte Beacon
- avoir Beacon Desktop installé si tu veux aussi vérifier visuellement certains projets

Si ce n'est pas encore fait :

- voir [MCP-INSTALLATION-GUIDE.md](/C:/Users/forgo/Documents/Code/Projet-Beacon/Beacon-MCP/doc/FR/MCP-INSTALLATION-GUIDE.md)

---

## Premier démarrage

Après installation :

1. redémarre ton application IA
2. demande :

```text
Appelle beacon_auth_status
```

3. si tu n'es pas connecté :

```text
Appelle beacon_login
```

4. termine la connexion dans ton navigateur
5. puis demande :

```text
Appelle beacon_login_check
```

6. enfin vérifie que tout fonctionne :

```text
Appelle beacon_list_projects
```

---

## Comment parler au MCP

Tu peux utiliser deux styles.

### Style simple

Tu parles normalement, par exemple :

```text
Crée un projet ArkSA pour débloquer la Tek Forge niveau 180.
```

```text
Active le mod Cybers Structures QoL+ dans mon projet test tek forge 180.
```

```text
Exporte le code utile de mon projet test tek forge 180.
```

### Style direct

Tu demandes explicitement un appel de tool :

```text
Appelle beacon_find_project query="test tek forge" game="arksa"
```

```text
Appelle beacon_export_project_code projectName="test tek forge 180" game="arksa" format="overrides_only"
```

Les deux approches sont valides. Pour un utilisateur non technique, le style simple est le meilleur.

---

## Cibler un projet sans UUID

Tu n'as généralement plus besoin de connaître `projectId`.

Le MCP sait maintenant :

- utiliser `projectName`
- rechercher un projet par nom partiel avec `beacon_find_project`
- demander une clarification si plusieurs projets se ressemblent

Exemples :

```text
Inspecte mon projet loot Astraeos.
```

```text
Appelle beacon_find_project query="loot Astraeos" game="arksa"
```

Si plusieurs projets proches existent, l'assistant doit te proposer les noms trouvés avant d'écrire quoi que ce soit.

---

## Cas d'usage les plus utiles

### 1. Créer un projet puis activer un mod

Exemple de demande naturelle :

```text
Crée un projet ArkSA nommé test tek forge 180 pour The Center, Scorched Earth, Ragnarok, Valguero et Astraeos.
Puis active le mod Cybers Structures QoL+.
```

Ce que l'assistant doit faire :

- confirmer le jeu
- confirmer la ou les maps
- rechercher le mod si nécessaire
- créer le projet
- activer le bon content pack
- relire le projet pour confirmer

---

### 2. Débloquer un engram à un niveau précis

Exemple :

```text
Dans mon projet test tek forge 180, débloque automatiquement la CS Tek Forge au niveau 180.
```

Le MCP doit alors :

- retrouver le projet
- vérifier le jeu
- vérifier l'engram
- vérifier que le mod requis est actif, ou le proposer
- appliquer l'override d'engram
- relire le projet

Résultat attendu dans un export utile :

```ini
OverrideNamedEngramEntries=(EngramClassName="EngramEntry_TekForge_CS_C",EngramLevelRequirement=180,EngramPointsCost=0)
```

---

### 3. Lire ou exporter le code d'un projet

Pour un petit résultat :

```text
Donne-moi la ligne utile de mon projet test tek forge 180.
```

Ou :

```text
Appelle beacon_export_project_code projectName="test tek forge 180" game="arksa" format="overrides_only"
```

Pour un gros résultat :

```text
Exporte tout le code de mon projet test tek forge 180 dans un fichier local.
```

Ou :

```text
Appelle beacon_export_project_file projectName="test tek forge 180" game="arksa" file="all"
```

Pour laisser le MCP choisir :

```text
Appelle beacon_export_project_smart projectName="test tek forge 180" game="arksa" format="overrides_only"
```

Comportement attendu :

- petit rendu : réponse directe dans le chat
- gros rendu : export automatique dans `~/.beacon-mcp/exports/`

---

### 4. Lire ou modifier directement `Game.ini`

Lecture :

```text
Appelle beacon_generate_game_ini projectName="test tek forge 180" game="arksa"
```

Écriture :

```text
Appelle beacon_put_game_ini projectName="test tek forge 180" game="arksa" content="..."
```

Même logique pour `GameUserSettings.ini` :

- `beacon_generate_game_user_settings_ini`
- `beacon_put_game_user_settings_ini`

---

### 5. Inspecter un projet loot Beacon natif

Exemple :

```text
Inspecte mon projet [ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT].
```

Ou :

```text
Appelle beacon_inspect_loot_project projectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" game="arksa"
```

Ce tool sert à résumer :

- le nombre d'overrides
- les familles réutilisées
- les sets
- les pools d'items
- les content packs utilisés

---

### 6. Copier une famille de loot d'un projet à un autre

Exemple :

```text
Copie la famille Astraeos Blue depuis mon projet archive loot Astraeos vers mon projet My Astraeos Loot Test.
```

Ou :

```text
Appelle beacon_copy_loot_family sourceProjectName="[ARCHIVE] LOOTS /// RILINDRA Loot Aérien Astraeos [EXTRAIT]" targetProjectName="My Astraeos Loot Test" game="arksa" family="Astraeos Blue"
```

Le MCP doit :

- lire le projet source
- trouver la famille demandée
- fusionner les content packs requis dans le projet cible
- sauvegarder le projet cible
- relire le projet après écriture

---

## Garde-fous importants

Les écritures projet actuellement prévues dans le MCP essayent d'être sûres :

- vérification que le projet appartient bien à l'utilisateur connecté
- vérification du jeu ciblé
- sauvegarde locale `.beacon` avant écriture
- relecture après écriture
- fusion des mods au lieu d'écraser les sélections existantes
- clarification si un mod ou un projet est ambigu

Backups locaux :

```text
~/.beacon-mcp/backups/
```

Exports locaux :

```text
~/.beacon-mcp/exports/
```

---

## Bonnes pratiques utilisateur

- donne toujours le jeu quand c'est important : `Ark` ou `ArkSA`
- donne le nom du projet le plus précisément possible
- indique la map ou les maps lors de la création d'un projet
- précise le nom du mod si un item dépend d'un content pack
- demande une confirmation avant écriture si l'action touche un vrai projet de production

Exemples de bonnes demandes :

```text
Crée un projet ArkSA nommé Boss Test pour The Island et active Cybers Structures QoL+.
```

```text
Inspecte mon projet loot Astraeos et résume-moi les familles de crates réutilisées.
```

```text
Donne-moi uniquement les lignes utiles d'override de mon projet test tek forge 180.
```

---

## Limites actuelles

- certaines opérations Sentinel nécessitent un service Sentinel configuré
- certains gros projets peuvent nécessiter un export fichier au lieu d'un affichage dans le chat
- certains flux Beacon très spécifiques peuvent encore demander une vérification visuelle dans Beacon Desktop
- le futur installeur `.exe` n'est pas encore le mode d'installation principal

---

## Dépannage rapide

### Le MCP ne répond pas

Vérifie :

- que l'application IA a été redémarrée
- que le serveur Beacon MCP est bien configuré
- que le build a été généré si tu utilises le mode terminal

### Beacon dit que tu n'es pas connecté

Relance :

```text
Appelle beacon_auth_status
Appelle beacon_login
Appelle beacon_login_check
```

### Le MCP ne trouve pas le bon projet

Demande :

```text
Appelle beacon_find_project query="nom partiel du projet" game="arksa"
```

Puis choisis le bon nom retourné.

### Il y a plusieurs mods possibles

L'assistant doit te montrer les choix trouvés et confirmer le bon mod avant écriture.

---

## Résumé

La meilleure manière d'utiliser `Beacon-MCP` aujourd'hui est :

- parler naturellement à ton assistant
- laisser le MCP retrouver le bon projet
- valider les actions d'écriture importantes
- utiliser l'export direct dans le chat pour les petits résultats
- utiliser l'export fichier pour les gros projets

Si le projet est bien configuré, tu peux déjà couvrir une grande partie des workflows Beacon sans naviguer manuellement dans Beacon Desktop.
