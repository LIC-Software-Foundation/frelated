# Guide des migrations Prisma — projects-api

Ce guide explique comment configurer la base de données MySQL et exécuter les migrations Prisma pour le service `projects-api`, du premier démarrage jusqu'à la mise à jour du schéma.

---

## Prérequis

- **MySQL 8+** installé et démarré
- **Node.js 22+** et **pnpm** installés
- Être à la racine du monorepo ou dans `apps/projects-api/`

---

## 1. Créer la base de données et l'utilisateur MySQL

Se connecter à MySQL en tant que `root` :

```bash
mysql -u root -p
```

Puis exécuter :

```sql
-- Créer la base de données
CREATE DATABASE IF NOT EXISTS frelated
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Créer l'utilisateur applicatif
CREATE USER IF NOT EXISTS 'frelated'@'localhost' IDENTIFIED BY 'frelated';

-- Donner tous les droits sur la base frelated
GRANT ALL PRIVILEGES ON frelated.* TO 'frelated'@'localhost';

-- Donner le droit de créer des bases (requis par Prisma pour la shadow database)
GRANT CREATE ON *.* TO 'frelated'@'localhost';

FLUSH PRIVILEGES;
EXIT;
```

> **Pourquoi `GRANT CREATE ON *.*` ?**
> Prisma Migrate crée une base temporaire (`prisma_migrate_shadow_db_*`) pour comparer
> l'état actuel du schéma avec la migration cible. Sans ce droit, la commande
> `prisma migrate dev` échoue avec l'erreur `P3014`.

---

## 2. Configurer le fichier `.env`

Copier le fichier exemple et l'adapter :

```bash
cd apps/projects-api
cp .env.example .env
```

Contenu du `.env` :

```dotenv
DATABASE_URL=mysql://frelated:frelated@localhost:3306/frelated
MONGODB_URL=mongodb://frelated:frelated@localhost:27017/frelated
MONGODB_DB_NAME=frelated
DATA_ENCRYPTION_KEY=change-me-with-32-plus-random-bytes
AUTH_SECRET=change-me-in-production
FRONTEND_ORIGIN=http://localhost:5173
PRISMA_AUTO_MIGRATE=true
```

| Variable              | Rôle                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | URL de connexion MySQL au format `mysql://user:pass@host:port/dbname` pour les utilisateurs et l'authentification |
| `MONGODB_URL`         | URL de connexion MongoDB pour les projets, fichiers et etats Yjs                                                  |
| `MONGODB_DB_NAME`     | Nom de la base MongoDB cible                                                                                      |
| `DATA_ENCRYPTION_KEY` | Cle de chiffrement applicatif utilisee pour proteger les contenus et metadonnees sensibles au repos               |
| `AUTH_SECRET`         | Secret JWT — **changer en production**                                                                            |
| `PRISMA_AUTO_MIGRATE` | Si `true`, l'API applique `prisma db push` automatiquement au demarrage                                           |

---

## 3. Installer les dépendances

Depuis la racine du monorepo :

```bash
pnpm install
```

---

## 4. Générer le client Prisma

Le client TypeScript généré depuis le schéma est nécessaire avant toute utilisation :

```bash
cd apps/projects-api
pnpm prisma:generate
```

Ou depuis la racine :

```bash
pnpm --filter @frelated/projects-api prisma:generate
```

---

## 5. Appliquer les migrations (première fois)

### Option A — Migration versionnée (recommandée en production)

Crée un fichier de migration SQL versionné dans `prisma/migrations/` et l'applique :

```bash
cd apps/projects-api
DATABASE_URL="mysql://frelated:frelated@localhost:3306/frelated" \
  npx prisma migrate dev --name init
```

Résultat attendu :

```
Applying migration `20260322161847_init`
Your database is now in sync with your schema.
✔ Generated Prisma Client
```

Les tables créées sont :

- `users` — comptes utilisateurs
- `projects` — projets LaTeX
- `project_collaborators` — collaborateurs avec statut `PENDING` / `APPROVED`
- `_prisma_migrations` — historique des migrations

### Option B — Push direct (développement uniquement)

Synchronise le schéma sans créer de fichier de migration. **Ne pas utiliser en production.**

```bash
cd apps/projects-api
pnpm prisma:push
```

---

## 6. Vérifier les tables

```bash
mysql -u frelated -pfrelated -h localhost frelated -e "SHOW TABLES;"
```

Résultat attendu :

```
_prisma_migrations
project_collaborators
projects
users
```

---

## 7. Démarrer l'API

```bash
# Depuis la racine du monorepo
pnpm dev:projects-api

# Ou directement
cd apps/projects-api
pnpm dev
```

Avec `PRISMA_AUTO_MIGRATE=true` dans le `.env`, l'API exécute automatiquement
`prisma db push` à chaque démarrage pour appliquer les nouvelles colonnes ou tables
ajoutées au schéma.

---

## 8. Modifier le schéma (migrations suivantes)

### Modifier `prisma/schema.prisma`

Exemple — ajouter un champ `tags` sur `Project` :

```prisma
model Project {
  // ... champs existants ...
  tags String? @db.VarChar(500)
}
```

### Créer et appliquer la migration

```bash
cd apps/projects-api
DATABASE_URL="mysql://frelated:frelated@localhost:3306/frelated" \
  npx prisma migrate dev --name add_project_tags
```

Prisma génère automatiquement le SQL correspondant dans
`prisma/migrations/<timestamp>_add_project_tags/migration.sql`.

### Régénérer le client

```bash
pnpm prisma:generate
```

---

## 9. Appliquer les migrations en production

En production, ne jamais utiliser `migrate dev` (qui nécessite la shadow database).
Utiliser à la place :

```bash
DATABASE_URL="mysql://..." npx prisma migrate deploy
```

`migrate deploy` applique uniquement les migrations en attente, sans créer de shadow DB.

---

## Commandes de référence

| Commande                              | Description                                           |
| ------------------------------------- | ----------------------------------------------------- |
| `pnpm prisma:generate`                | Génère le client TypeScript depuis `schema.prisma`    |
| `pnpm prisma:push`                    | Synchronise le schéma sans migration (dev uniquement) |
| `npx prisma migrate dev --name <nom>` | Crée et applique une migration versionnée             |
| `npx prisma migrate deploy`           | Applique les migrations en attente (production)       |
| `npx prisma migrate status`           | Affiche l'état des migrations                         |
| `npx prisma studio`                   | Interface graphique pour explorer la base             |

---

## Résolution de problèmes

### `P3014` — Impossible de créer la shadow database

```
Error: P3014 — Prisma Migrate could not create the shadow database.
```

**Cause** : l'utilisateur MySQL n'a pas le droit `CREATE` global.
**Solution** :

```sql
GRANT CREATE ON *.* TO 'frelated'@'localhost';
FLUSH PRIVILEGES;
```

### `P1001` — Connexion refusée

```
Error: P1001 — Can't reach database server at localhost:3306
```

**Cause** : MySQL n'est pas démarré.
**Solution** :

```bash
sudo systemctl start mysql   # Ubuntu/Debian
sudo systemctl start mariadb # MariaDB
```

### `P1010` — Accès refusé

```
Error: P1010 — User was denied access on the database
```

**Cause** : mauvais utilisateur/mot de passe ou base inexistante.
**Solution** : vérifier le `DATABASE_URL` dans le `.env` et relancer les instructions MySQL de l'étape 1.

### Le stockage projet ne demarre pas

Si `MONGODB_URL` est vide, l'API refuse maintenant les operations sur les projets et
le serveur collaboratif ne demarre pas. Verifier la configuration MongoDB et la cle
`DATA_ENCRYPTION_KEY`.
