# Compilation LaTeX distribuée

## Utilisation

- **Ctrl + S** (Cmd + S sur macOS) sauvegarde les modifications puis soumet une compilation.
- **Compiler** sauvegarde, soumet une compilation et ouvre le mode Split.
- **PDF** ouvre le rendu seul et compile si les sources ou les paramètres diffèrent du dernier PDF réussi, ou si aucun PDF n'existe.
- **Split** affiche uniquement le dernier PDF disponible, sans compilation automatique.
- Le dernier PDF réussi reste visible pendant une compilation et après un échec. Les erreurs apparaissent dans les logs.
- Le fichier principal (`main.tex` par défaut) et le moteur sont sélectionnables dans la barre de l'éditeur. Ces paramètres sont partagés par projet.
- Tous les collaborateurs autorisés reçoivent les actualisations, y compris les lecteurs. Seuls les propriétaires et éditeurs peuvent soumettre une compilation ou changer les paramètres.

## Services et données

L'API crée un instantané des sources sauvegardées du projet après acquittement des sauvegardes REST. Elle soumet un job BullMQ à Redis et répond immédiatement avec HTTP 202 et un identifiant. Un worker séparé exécute latexmk dans un répertoire temporaire, avec pdfLaTeX, XeLaTeX ou LuaLaTeX. Latexmk lance les passes nécessaires, BibTeX ou Biber selon le document.

Les workers publient les résultats dans Redis ; chaque instance de l'API relaie les changements aux navigateurs par WebSocket. Le navigateur s'authentifie dans le premier message (le token n'est pas placé dans l'URL). Une vérification périodique rétablit l'état après une notification manquée et revalide l'accès.

Les instantanés, logs, paramètres et PDF sont chiffrés avec `DATA_ENCRYPTION_KEY`, selon le mécanisme AES-GCM existant. Redis doit rester privé et utilise un volume persistant avec AOF. Le dernier PDF et les paramètres sont conservés par projet (cache de 30 jours après soumission) et retirés lors de sa suppression ; les jobs terminés sont purgés selon leur durée de rétention. Les résultats PDF ne constituent pas une sauvegarde des sources, qui restent dans MongoDB.

Une empreinte porte sur les sources et paramètres. Une révision croissante et une publication atomique empêchent un job ancien de remplacer un résultat plus récent. Les fichiers temporaires sont retirés en fin de compilation.

## Démarrage Docker

```bash
bash run-docker.sh up
```

Cela ajoute `redis` et `compilation-worker` aux services existants. Prévoir plusieurs Go disponibles pour la première construction de TeX Live et les couches de build.

Pour augmenter le nombre de workers sur la même machine :

```bash
docker compose --env-file .env.docker up -d --no-build --scale compilation-worker=2
```

Chaque worker traite un job à la fois. Aucune surveillance de dossier partagé n'est nécessaire : les instantanés transitent par Redis.

Ce scaling manuel n'est plus nécessaire en usage normal : `apps/compilation-autoscaler` ajuste automatiquement le nombre de workers selon la profondeur de la file et les ressources disponibles. Voir [Autoscaling](Autoscaling.md).

```bash
bash run-docker.sh logs compilation-worker
bash run-docker.sh logs redis
```

## Configuration

- API et worker : `REDIS_URL` (en Compose : `redis://redis:6379`).
- API et worker : mêmes `AUTH_SECRET` et `DATA_ENCRYPTION_KEY`.
- API : `COLLAB_SERVER_URL` pointe vers le serveur Yjs.
- Worker : `COMPILATION_TIMEOUT_MS`, 120000 par défaut.
- En développement, le proxy Vite `/api` accepte HTTP et WebSocket. Un reverse proxy de production doit aussi transmettre les upgrades WebSocket sur `/projects/:projectId/compilation/events`.

## API

Toutes les routes HTTP nécessitent un token Bearer et un accès au projet.

- `POST /projects/:projectId/compilation` : `{ "onlyIfChanged": false }`.
- `GET /projects/:projectId/compilation` : état courant, paramètres et identifiant du PDF disponible.
- `PUT /projects/:projectId/compilation/settings` : `{ "mainFile": "main.tex", "engine": "pdflatex" }`.
- `GET /projects/:projectId/compilation/pdf` : dernier PDF réussi, récupéré avec authentification puis affiché via une URL blob locale.
- WebSocket `/projects/:projectId/compilation/events` : premier message `{ "token": "…" }`, puis états envoyés par le serveur.

## Limites opérationnelles

500 fichiers et 20 Mo de sources par compilation, PDF limité à 20 Mo. Le dossier `output` est réservé. Les noms de fichiers acceptent lettres, chiffres, espaces, points, tirets et underscores. Les images doivent avoir un contenu data URL base64 (format utilisé par l'import d'images de l'éditeur). L'ancien import ZIP qui remplace les images par un texte indicatif ne permet pas de récupérer leurs octets : réimporter les images concernées.

Le worker désactive shell-escape et les fichiers latexmkrc des projets. Les processus TeX reçoivent un environnement sans secrets et s'exécutent sous un utilisateur sans privilèges dans le conteneur. Compose borne CPU, mémoire, processus et stockage temporaire. Cette isolation de conteneur est destinée au déploiement local ; pour un service public accueillant du code non fiable, prévoir une sandbox par job avec isolation réseau et système de fichiers renforcée.

Le worker utilise l’image complète [Island of TeX](https://github.com/islandoftex/texlive), avec tous les packages de TeX Live mais sans documentation ni sources. Son empreinte multiarchitecture est figée dans `apps/compilation-worker/Dockerfile` ; une mise à jour nécessite de remplacer cette empreinte, reconstruire et relancer les tests. Node.js 22 est copié depuis une étape de construction séparée. Liberation et DejaVu complètent les polices TeX Live. Les polices personnalisées ou propriétaires ne sont pas toutes incluses. Sélectionner XeLaTeX pour les documents utilisant `fontspec` : les restrictions `--safer` du worker LuaLaTeX empêchent actuellement le chargement des polices par `luaotfload`.

Prévoir plusieurs gigaoctets disponibles pour télécharger, extraire et construire l’image complète. Le démarrage du worker n’installe aucun package : tous les workers utilisent la même image préconstruite.

## Validation

```bash
pnpm --filter @frelated/projects-api exec vitest run tests/compilation.test.ts
```

Les tests d'intégration nécessitent l'image du worker et Redis. La base Redis 15 doit être réservée aux tests pour éviter que les workers de l’application consomment leurs jobs. Ils créent un projet à identifiant unique avec un service de projets de test et vérifient la vraie file, les moteurs TeX, le PDF et les notifications :

```bash
docker run --rm --network frelated-network \
  -e REDIS_URL=redis://redis:6379/15 -e COMPILATION_INTEGRATION=1 \
  -v "$PWD:/workspace" -w /workspace/apps/projects-api \
  frelated-compilation-worker \
  ./node_modules/.bin/vitest run tests/compilation.integration.test.ts \
  --pool=forks --poolOptions.forks.singleFork
```

## Mode de développement économe en reconstructions

Lorsque les images applicatives existent déjà et que les bases ont été initialisées :

```bash
pnpm install
pnpm --filter @frelated/projects-api exec prisma generate --schema prisma/schema.prisma
docker compose --env-file .env.docker -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build
```

L’API et Yjs utilisent les sources locales ; Vite sert l’éditeur avec rechargement à chaud sur le même port 5173. Le worker reste une image construite séparément. L’override désactive les migrations automatiques : les appliquer explicitement si le schéma SQL change. Revenir au déploiement normal avec `bash run-docker.sh up`. Ne pas utiliser `--build` avec cet override, dont l’interface réutilise l’image Node de l’API.

Tests de l’éditeur et parcours réel Chrome (services démarrés) :

```bash
pnpm --filter @frelated/web-editor-ui test
pnpm --filter @frelated/web-editor-ui test:e2e
```

Le parcours Chrome utilise le compte de démonstration du dépôt, crée un projet temporaire et le supprime à la fin. `CHROME_PATH` permet de choisir le binaire Chrome. Les tests unitaires couvrent les sauvegardes échouées, les modes d’affichage, les résultats obsolètes et le changement de projet pendant le chargement d’un PDF.

Les rooms Yjs transitoires ne remplacent pas le contenu sauvegardé au moment de compiler. Leur fermeture ne réécrit pas MongoDB ; les sauvegardes explicites et automatiques de l’éditeur assurent cette persistance.
