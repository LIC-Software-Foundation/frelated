# Frelated — Éditeur LaTeX collaboratif en ligne

Éditeur LaTeX en ligne inspiré d'Overleaf, avec collaboration temps réel, chiffrement des données et gestion de projets.

---

## Architecture

Monorepo **pnpm workspaces** composé de 4 applications :

| App                      | Port   | Rôle                                             |
| ------------------------ | ------ | ------------------------------------------------ |
| `apps/projects-api`      | `3000` | API REST Fastify — projets, auth, fichiers       |
| `apps/collab-server`     | `8080` | Serveur WebSocket Yjs — collaboration temps réel |
| `apps/web-editor-ui`     | `5173` | Interface React — éditeur LaTeX                  |
| `apps/web-monitoring-ui` | `5174` | Dashboard de monitoring                          |

---

## Prérequis

- **Node.js** ≥ 20
- **pnpm** ≥ 10 — `npm install -g pnpm`
- **MongoDB** ≥ 6 (driver par défaut)
- **MySQL** ≥ 8 (requis pour les utilisateurs et l'authentification)

---

## Installation

```bash
# Cloner le dépôt
git clone <url-du-repo> && cd frelated

# Installer toutes les dépendances
pnpm install
```

---

## Configuration

### 1. API projets — `apps/projects-api/src/.env`

Copier l'exemple et l'adapter :

```bash
cp apps/projects-api/src/.env.example apps/projects-api/src/.env
```

| Variable              | Valeur par défaut                                   | Description                                              |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `PERSISTENCE_DRIVER`  | `mongodb`                                           | Driver de persistance : `mongodb` ou `prisma`            |
| `MONGODB_URL`         | `mongodb://localhost:27017/frelated`                | URI de connexion MongoDB                                 |
| `MONGODB_DB_NAME`     | `frelated`                                          | Nom de la base MongoDB                                   |
| `MONGODB_REQUIRE_TLS` | `false`                                             | Activer TLS pour MongoDB (prod : `true`)                 |
| `MONGODB_TLS_CA_FILE` | _(vide)_                                            | Chemin vers le certificat CA TLS                         |
| `DATABASE_URL`        | `mysql://frelated:frelated@localhost:3306/frelated` | URI MySQL pour Prisma (utilisateurs / auth)              |
| `AUTH_SECRET`         | `change-me`                                         | **Secret de signature des tokens JWT** — changer en prod |
| `DATA_ENCRYPTION_KEY` | `change-me-with-a-long-random-secret`               | **Clé de chiffrement AES-256** — changer en prod         |
| `COLLAB_STORE_ROOT`   | `/var/lib/frelated/collab-store`                    | Répertoire de persistance Yjs locale                     |
| `FRONTEND_ORIGIN`     | `http://localhost:5173`                             | Origine CORS autorisée                                   |

> **Sécurité** : `AUTH_SECRET` et `DATA_ENCRYPTION_KEY` doivent être des chaînes longues et aléatoires en production.
> Générer avec : `openssl rand -base64 48`

### 2. Interface web — `apps/web-editor-ui/.env`

```bash
cp apps/web-editor-ui/.env.example apps/web-editor-ui/.env
```

| Variable                         | Valeur par défaut       | Description                               |
| -------------------------------- | ----------------------- | ----------------------------------------- |
| `VITE_SERVICE_MODE`              | `api`                   | Mode de service                           |
| `VITE_PROJECTS_API_URL`          | `/api`                  | Chemin de l'API (proxyfié par Vite)       |
| `VITE_PROJECTS_API_PROXY_TARGET` | `http://localhost:3000` | Cible du proxy Vite vers l'API            |
| `VITE_COLLAB_SERVER_URL`         | `ws://localhost:8080`   | URL WebSocket du serveur de collaboration |

### 3. Serveur de collaboration — `apps/collab-server/src/.env`

Le collab-server lit automatiquement les variables de `apps/projects-api/src/.env`. Aucun fichier `.env` séparé n'est requis en développement. En production, créer `apps/collab-server/src/.env` :

```bash
AUTH_SECRET=<même valeur que projects-api>
DATA_ENCRYPTION_KEY=<même valeur que projects-api>
PROJECTS_API_URL=http://localhost:3000
FRONTEND_ORIGIN=http://localhost:5173
COLLAB_STORE_ROOT=/var/lib/frelated/collab-store
PORT=8080
```

---

## Bases de données

### MongoDB (stockage des projets et fichiers)

MongoDB est le driver par défaut. Il stocke les projets, les fichiers (contenu chiffré) et les collaborateurs.

**Démarrage local avec Docker :**

```bash
docker run -d --name frelated-mongo \
  -p 27017:27017 \
  mongo:6
```

**Sans Docker :** installer MongoDB Community Edition et démarrer `mongod`.

Aucune migration n'est nécessaire — les collections sont créées automatiquement au premier démarrage.

### MySQL (authentification et utilisateurs)

MySQL est requis uniquement pour les tables `users`, `projects` et `project_collaborators` gérées par Prisma.

**Démarrage local avec Docker :**

```bash
docker run -d --name frelated-mysql \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=frelated \
  -e MYSQL_USER=frelated \
  -e MYSQL_PASSWORD=frelated \
  mysql:8
```

**Appliquer le schéma Prisma :**

```bash
cd apps/projects-api
pnpm prisma:push       # Créer/mettre à jour les tables
pnpm prisma:generate   # Générer le client Prisma
```

> Le schéma Prisma se trouve dans `apps/projects-api/prisma/schema.prisma`.

---

## Lancement en développement

Depuis la racine du monorepo, lancer chaque service dans un terminal séparé :

```bash
# Terminal 1 — API projets (port 3000)
pnpm --filter @frelated/projects-api dev

# Terminal 2 — Serveur de collaboration (port 8080)
pnpm --filter @frelated/collab-server dev

# Terminal 3 — Interface web (port 5173)
pnpm --filter @frelated/web-editor-ui dev
```

L'application est accessible sur [http://localhost:5173](http://localhost:5173).

---

## Build de production

```bash
# Builder tous les packages et applications
pnpm -r build

# Lancer l'API en production
pnpm --filter @frelated/projects-api start

# Lancer le serveur de collaboration en production
pnpm --filter @frelated/collab-server start
```

---

## Tests

```bash
# Tous les tests
pnpm -r test

# Tests de l'API uniquement
pnpm --filter @frelated/projects-api test
```

---

## Fonctionnalités

- **Éditeur LaTeX** avec coloration syntaxique (CodeMirror 6)
- **Collaboration temps réel** — curseurs nommés et synchronisation CRDT via Yjs + WebSocket
- **Chiffrement AES-256-GCM** du contenu des fichiers et des métadonnées au repos
- **Gestion de projets** — créer, renommer, supprimer, importer depuis un ZIP
- **Export ZIP** des sources du projet
- **Partage de projets** — inviter des collaborateurs (viewer / editor)
- **Compilation LaTeX** — voir le PDF généré directement dans l'interface
- **Authentification** — inscription et connexion par email/mot de passe

---

## Structure du monorepo

```
frelated/
├── apps/
│   ├── projects-api/          # API REST Fastify
│   │   ├── prisma/            # Schéma et migrations MySQL
│   │   ├── src/
│   │   │   ├── config/        # Variables d'environnement
│   │   │   ├── domain/        # Modèles TypeScript
│   │   │   ├── repositories/  # mongoStore / prismaStore
│   │   │   ├── routes/        # Endpoints REST
│   │   │   └── services/      # Logique métier, chiffrement
│   │   └── tests/
│   ├── collab-server/         # WebSocket Yjs
│   │   └── src/index.ts
│   ├── web-editor-ui/         # Interface React
│   │   └── src/
│   │       ├── components/    # ProjectEditor, Dashboard, …
│   │       ├── hooks/         # useProjects, useCompilation
│   │       └── services/      # API clients
│   └── web-monitoring-ui/     # Dashboard monitoring
└── packages/
    ├── types/                 # Types TypeScript partagés
    ├── auth-api-client/       # Client auth
    ├── projects-api-client/   # Client projets (généré OpenAPI)
    └── utils/                 # Utilitaires communs
```
