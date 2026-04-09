# Beacon MCP — Plan d'action MVP pour un installeur Windows local

> Plan d'action détaillé pour livrer un MVP réellement utilisable par des personnes non techniques, avec installation locale de Beacon-MCP, configuration automatique des clients MCP, et premier test guidé.

---

## Objectif

Le MVP visé est :

- `Beacon-MCP` packagé localement
- un installeur Windows simple
- auto-configuration de Codex, Claude Desktop et Cursor
- un guide de premier test immédiatement exploitable

Le but n'est pas seulement de "fournir le MCP", mais de permettre à une personne qui ne code pas de l'installer et de l'utiliser en local avec le moins de friction possible.

---

## Résultat attendu

Une personne non technique doit pouvoir :

1. télécharger `Beacon-MCP-Setup.exe`
2. double-cliquer
3. choisir les applications à configurer
4. cliquer sur `Installer`
5. redémarrer son client IA
6. taper un premier test simple :

```text
Appelle beacon_auth_status
```

---

## MVP recommandé

Le meilleur MVP à court terme est :

- un bundle local `Beacon-MCP` prêt à lancer
- un installeur Windows
- une configuration automatique des clients MCP
- un écran final avec test guidé

Trajectoire recommandée :

- `v1` : installeur + bundle local Node
- `v2` : installeur + exécutable autonome `.exe`

---

## Architecture cible

### 1. Payload local

Le payload local doit contenir :

- `Beacon-MCP` prébuildé
- soit un bundle Node prêt à lancer
- soit, plus tard, un exécutable Windows autonome
- les fichiers nécessaires au support local
- un guide de démarrage

Chemin d'installation recommandé :

```text
C:\Users\<user>\AppData\Local\BeaconMCP\
```

Exemples de cible runtime :

- `C:\Users\<user>\AppData\Local\BeaconMCP\dist\index.js`
- `C:\Users\<user>\AppData\Local\BeaconMCP\Beacon-MCP.exe`

### 2. Installeur Windows

L'installeur doit être un assistant graphique simple qui :

- détecte Codex, Claude Desktop et Cursor
- propose quelles applications configurer
- écrit automatiquement les fichiers de configuration MCP
- ajoute un raccourci ou un outil `Tester Beacon MCP`
- affiche les prochaines étapes après installation

### 3. Validation post-install

Après installation, le système doit :

- vérifier que le binaire ou script Beacon-MCP démarre
- vérifier que les fichiers de config client ont bien été écrits
- indiquer qu'un redémarrage des applications est nécessaire
- afficher une commande de test simple :

```text
Appelle beacon_auth_status
```

---

## Expérience utilisateur idéale

Parcours cible :

1. Télécharger `Beacon-MCP-Setup.exe`
2. Double-cliquer
3. Choisir :
   - `Configurer Codex`
   - `Configurer Claude Desktop`
   - `Configurer Cursor`
4. Cliquer `Installer`
5. Lire l'écran final :
   - `Beacon MCP a été installé`
   - `Codex configuré`
   - `Claude configuré`
   - `Redémarrez vos applications`
   - `Premier test : demandez "Appelle beacon_auth_status"`

Le parcours doit éviter :

- le terminal
- `git`
- `npm`
- l'édition manuelle de JSON ou TOML
- les chemins à copier-coller

---

## Détection des applications

L'installeur doit chercher au minimum :

### Codex

Fichier attendu :

```text
C:\Users\<user>\.codex\config.toml
```

### Claude Desktop

Fichier attendu :

- fichier de config Claude Desktop Windows

### Cursor

Fichier attendu :

- fichier MCP Cursor usuel

---

## États à gérer pour chaque application

Pour chaque client détecté, il faut gérer 3 cas :

1. application détectée + config écrivable
2. application détectée mais fermeture/redémarrage recommandé
3. application non détectée

Chaque cas doit être expliqué clairement dans l'installeur.

---

## Mode d'exécution Beacon-MCP

### Option 1 — Node embarqué ou bundle JS

Avantages :

- plus rapide à mettre en place
- faible coût initial
- compatible avec l'architecture actuelle du projet

Inconvénients :

- nécessite Node.js si non embarqué
- moins transparent pour le grand public

Mode de fonctionnement :

- l'installeur copie les fichiers
- le client MCP lance `node dist/index.js`

### Option 2 — Exécutable autonome `.exe`

Avantages :

- meilleure UX
- pas besoin de Node.js
- meilleur pour un public non technique

Inconvénients :

- plus complexe à produire et maintenir
- gestion de packaging plus exigeante

### Recommandation

Pour le projet :

- `v1` : installeur + bundle local
- `v2` : installeur + `.exe` autonome

---

## Configuration automatique par client

L'installeur doit modifier automatiquement les configs clients.

### Codex

Ajouter une section :

```toml
[mcp_servers.beacon]
command = "node"
args = ["C:\\Users\\<user>\\AppData\\Local\\BeaconMCP\\dist\\index.js"]
```

### Claude Desktop

Ajouter une entrée `beacon` dans `claude_desktop_config.json`.

### Cursor

Ajouter une entrée `beacon` dans le fichier MCP Cursor.

### Règles importantes

Il ne faut jamais :

- écraser la config existante
- supprimer les autres serveurs MCP
- remplacer le fichier entier si une fusion suffit

Il faut toujours :

- faire une sauvegarde avant modification
- fusionner proprement l'entrée `beacon`
- conserver le reste de la configuration intact

---

## Chemin recommandé

Chemin stable recommandé :

```text
C:\Users\<user>\AppData\Local\BeaconMCP\
```

Les clients MCP doivent pointer vers un chemin stable et prévisible.

Exemples :

- `C:\Users\<user>\AppData\Local\BeaconMCP\dist\index.js`
- `C:\Users\<user>\AppData\Local\BeaconMCP\Beacon-MCP.exe`

Ce chemin doit rester le même entre les mises à jour.

---

## Fonctions minimales de l'installeur

L'installeur doit au minimum :

- copier les fichiers Beacon-MCP
- sauvegarder les configs existantes
- modifier les configs MCP
- tester le démarrage du serveur
- afficher un résumé final
- proposer `Ouvrir le guide de démarrage`

Fonctions très souhaitables :

- détecter si les apps sont ouvertes
- afficher les clients détectés
- proposer une installation sélective par client
- signaler les erreurs de permission d'écriture

---

## Écran final recommandé

L'écran final devrait afficher :

- `Installation terminée`
- `Beacon MCP est prêt pour : Codex, Claude Desktop`
- `Cursor non détecté`
- `Étape suivante : redémarrez vos applications`
- `Premier test conseillé : Appelle beacon_auth_status`

Boutons ou actions utiles :

- `Ouvrir le guide de démarrage`
- `Ouvrir le dossier d'installation`
- `Fermer`

---

## Guide de premier test

L'installeur doit fournir un mini guide de premier test.

Contenu recommandé :

1. ouvrir Codex, Claude Desktop, ou Cursor
2. demander :

```text
Appelle beacon_auth_status
```

3. si non connecté, demander :

```text
Lance beacon_login
```

4. finir la connexion Beacon dans le navigateur
5. relancer :

```text
Appelle beacon_login_check
```

6. puis tester :

```text
Appelle beacon_list_projects
```

---

## Points d'attention

Le MVP doit anticiper :

- la gestion des mises à jour
- la sauvegarde et restauration des configs
- une désinstallation propre
- la coexistence avec d'autres serveurs MCP
- l'emplacement des tokens OAuth Beacon
- la détection d'un runtime Node absent si `v1` dépend encore de Node
- les permissions d'écriture dans les fichiers de config des clients

---

## Stratégie de mise à jour

Le MVP doit déjà poser les bases d'une mise à jour propre :

- conserver un dossier d'installation fixe
- versionner le payload installé
- conserver une sauvegarde des configs client
- pouvoir remplacer les fichiers Beacon-MCP sans casser la config MCP existante

---

## Désinstallation

Même si elle est simple au départ, la désinstallation doit être prévue.

Elle devrait :

- supprimer les fichiers installés
- proposer de retirer l'entrée `beacon` des configs client
- conserver ou supprimer les sauvegardes selon choix utilisateur
- expliquer que les tokens Beacon locaux peuvent rester si souhaité

---

## Livrables du MVP

Le MVP devrait produire :

- un dossier d'installation local standard
- un runtime Beacon-MCP prébuildé
- un installeur Windows
- un script ou module de détection des apps
- un module de patch de config Codex
- un module de patch de config Claude Desktop
- un module de patch de config Cursor
- un test de démarrage du serveur
- un guide de premier test utilisateur

---

## Roadmap concrète

### Étape 1 — Créer un dossier d'installation standard

But :

- définir le chemin d'installation
- fixer la structure de fichiers locale

Livrable :

- arborescence d'installation stable dans `AppData\Local\BeaconMCP`

### Étape 2 — Stabiliser le mode de lancement local

But :

- garantir que Beacon-MCP démarre toujours localement depuis le payload installé

Livrable :

- commande de lancement fiable
- test de démarrage local automatisable

### Étape 3 — Écrire un script de configuration automatique

But :

- détecter les clients installés
- patcher leurs fichiers de config sans les casser

Livrable :

- modules de lecture / sauvegarde / fusion / écriture

### Étape 4 — Créer l'installeur Windows

But :

- fournir un assistant non technique

Livrable :

- `Beacon-MCP-Setup.exe`

### Étape 5 — Ajouter un écran de validation post-install

But :

- rassurer l'utilisateur
- confirmer que l'installation fonctionne

Livrable :

- écran final avec statut par application et premier test conseillé

### Étape 6 — Ajouter un désinstalleur

But :

- garantir une suppression propre

Livrable :

- routine de désinstallation

### Étape 7 — Passer ensuite à un `.exe` autonome

But :

- supprimer la dépendance potentielle à Node.js
- améliorer l'expérience grand public

Livrable :

- Beacon-MCP packagé en exécutable autonome

---

## Décisions recommandées pour le MVP

Pour éviter de disperser l'effort, il est recommandé de fixer ces décisions :

- cible principale : Windows
- cible client principale : Codex + Claude Desktop + Cursor
- distribution initiale : installeur local
- runtime initial : bundle local Node
- chemin d'installation : `AppData\Local\BeaconMCP`
- stratégie d'UX : détection automatique + configuration auto + redémarrage + premier test guidé

---

## Recommandation finale

Le meilleur MVP Beacon-MCP pour un public non technique est :

- un runtime local prébuildé
- un installeur Windows graphique
- une auto-configuration des clients MCP
- une validation post-install
- un guide de premier test centré sur `beacon_auth_status`

L'idée clé est simple :

> l'utilisateur ne doit ni coder, ni éditer de config, ni comprendre MCP pour commencer à utiliser Beacon-MCP en local.
