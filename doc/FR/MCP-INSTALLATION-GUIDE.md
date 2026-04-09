# Beacon MCP — Guide d'installation

> Guide d'installation utilisateur pour `Beacon-MCP`, couvrant l'installation actuelle par terminal, le runner d'installation `v1` pour les tests, et la future installation par exécutable Windows.

---

## Objectif

Ce guide explique comment installer `Beacon-MCP` en local selon trois modes :

- **mode actuel** : installation via terminal
- **mode intermédiaire** : runner d'installation pour développeurs
- **mode futur** : installation via exécutable Windows

Le but est de permettre à un utilisateur de choisir la méthode adaptée à son niveau technique.

---

## Quelle méthode choisir

### Méthode 1 — Installation via terminal

À utiliser si :

- tu es à l'aise avec le terminal
- tu veux tester la version actuelle du projet
- tu veux suivre le projet en cours de développement

### Méthode 2 — Runner d'installation `v1`

À utiliser si :

- tu veux tester la logique d'installation actuelle
- tu acceptes encore d'utiliser Node.js
- tu veux éviter une partie de la configuration manuelle

### Méthode 3 — Installation via `.exe` Windows

À utiliser si :

- tu ne veux pas utiliser le terminal
- tu veux une installation plus simple
- tu attends une version plus orientée grand public

Aujourd'hui :

- la méthode terminal est disponible
- le runner d'installation `v1` est disponible pour les tests
- la méthode `.exe` est en préparation

---

## Pré-requis généraux

Pour utiliser `Beacon-MCP`, il faut :

- un compte Beacon
- une connexion internet
- au moins un client MCP local :
  - Codex
  - Claude Desktop
  - Cursor

Selon les fonctions utilisées, il faut aussi :

- un projet Beacon
- éventuellement un service Sentinel
- éventuellement le Beacon Connector si tu veux piloter un serveur local

---

## Installation actuelle — Méthode terminal

### Pré-requis spécifiques

Il faut :

- Node.js 20 ou plus récent
- `git`

### Étapes

1. cloner le dépôt
2. installer les dépendances
3. compiler le projet

Commandes :

```bash
git clone https://github.com/ff14eternitalis-debug/Beacon-MCP.git
cd Beacon-MCP
npm install
npm run build
```

---

## Configuration des clients MCP en mode terminal

### Codex

Ajouter dans le fichier :

```text
C:\Users\<user>\.codex\config.toml
```

le bloc :

```toml
[mcp_servers.beacon]
command = "node"
args = ["C:\\path\\to\\Beacon-MCP\\dist\\index.js"]
```

### Claude Desktop

Ajouter dans le fichier de config Claude Desktop :

```json
{
  "mcpServers": {
    "beacon": {
      "command": "node",
      "args": ["C:/path/to/Beacon-MCP/dist/index.js"]
    }
  }
}
```

### Cursor

Ajouter une entrée `beacon` dans le fichier MCP Cursor.

---

## Première utilisation après installation terminal

1. redémarrer ton client MCP
2. demander :

```text
Appelle beacon_auth_status
```

3. si nécessaire, demander :

```text
Lance beacon_login
```

4. terminer la connexion dans le navigateur
5. demander ensuite :

```text
Appelle beacon_login_check
```

6. puis tester :

```text
Appelle beacon_list_projects
```

---

## Installation actuelle — Runner d'installation `v1`

Cette méthode est surtout destinée aux développeurs et testeurs qui veulent valider le flux d'installation local avant l'arrivée du `.exe`.

### Pré-requis spécifiques

Il faut :

- Node.js 20 ou plus récent
- le projet déjà récupéré localement

### Étapes

Depuis la racine de `Beacon-MCP` :

```bash
cd installer
npm run build
node dist/cli.js --detect
node dist/cli.js --check-node
node dist/cli.js --install-defaults
```

### Ce que fait ce runner

- détecte Codex, Claude Desktop et Cursor
- copie le runtime Beacon MCP dans un dossier local stable
- sauvegarde puis patch les configurations MCP supportées
- vérifie que le runtime démarre correctement

### Limite actuelle

Ce n'est pas encore l'expérience finale grand public.

Le `.exe` Windows reste la voie cible pour les utilisateurs non techniques.

---

## Installation future — Méthode `.exe`

Quand l'installeur Windows sera prêt, le flux recommandé sera :

1. télécharger `Beacon-MCP-Setup.exe`
2. double-cliquer
3. choisir les applications à configurer :
   - Codex
   - Claude Desktop
   - Cursor
4. cliquer sur `Installer`
5. redémarrer l'application IA
6. effectuer le premier test :

```text
Appelle beacon_auth_status
```

---

## Ce que fera l'installeur `.exe`

L'installeur Windows aura pour rôle de :

- installer localement `Beacon-MCP`
- détecter Codex, Claude Desktop et Cursor
- configurer automatiquement les fichiers MCP
- sauvegarder les configs existantes
- vérifier que le runtime Beacon-MCP démarre
- afficher un guide de premier test

---

## Différence entre la version terminal et la future version `.exe`

### Version terminal

Avantages :

- disponible maintenant
- idéale pour les tests et les développeurs
- donne un contrôle total

Inconvénients :

- plus technique
- demande Node.js
- demande une configuration manuelle ou semi-manuelle

### Version `.exe`

Avantages :

- plus simple pour les non-techs
- meilleure UX
- auto-configuration des clients MCP

Inconvénients :

- pas encore la voie finale livrée
- dépend encore actuellement du travail en cours sur l'installeur

---

## Que faire si tu ne veux pas toucher au terminal

Si tu ne veux pas utiliser le terminal :

- attends la version `.exe`
- ou fais installer la version actuelle par une personne technique

Le MCP reste ensuite utilisable normalement dans le client IA.

---

## Dépannage rapide

### Le MCP n'apparaît pas dans le client

Vérifier :

- que le client a été redémarré
- que le chemin vers `dist/index.js` est correct
- que la config client est valide

### `beacon_auth_status` ne marche pas

Vérifier :

- que le MCP est bien chargé
- que la connexion internet fonctionne

### Beacon demande une connexion

C'est normal au premier usage.

Lancer :

```text
Lance beacon_login
```

Puis terminer la connexion sur :

```text
https://usebeacon.app/device
```

---

## Documentation utile

Documents liés :

- [README](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\README.md)
- [Plan de tests v1](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\doc\FR\MCP-V1-TEST-PLAN.md)
- [Plan MVP installeur Windows](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\doc\FR\MCP-WINDOWS-INSTALLER-MVP-PLAN.md)
- [Plan de transition vers `.exe`](C:\Users\forgo\Documents\Code\Projet-Beacon\Beacon-MCP\doc\FR\MCP-EXE-RUNTIME-TRANSITION-PLAN.md)

---

## Recommandation finale

Aujourd'hui, la bonne méthode dépend du profil :

- **profil technique** : installation terminal
- **profil non technique** : attendre l'installeur `.exe`

Dans tous les cas, le premier vrai test à faire reste :

```text
Appelle beacon_auth_status
```
