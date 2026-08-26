# Frelated Architecture

## Vue d'ensemble

Frelated est organise autour de trois blocs principaux :

1. `apps/web-editor-ui`
   Frontend React/Vite pour l'authentification, la gestion des projets, l'editeur LaTeX et l'integration de la collaboration temps reel.

2. `apps/projects-api`
   API Fastify responsable de l'authentification, de la persistance des projets, des regles d'autorisation et des endpoints de partage.

3. `apps/collab-server`
   Serveur WebSocket Yjs responsable de la synchronisation temps reel des modifications dans une room `projectId-fileId`.

## Principes

- Separation des responsabilites :
  le frontend ne connait que des contrats de services.
- Authentification centralisee :
  le backend emet un token signe et controle l'acces aux projets.
- Autorisation explicite :
  seuls le proprietaire ou les collaborateurs autorises peuvent lire/modifier un projet.
- Persistence unique :
  la source de verite des projets se trouve dans le backend, pas dans le navigateur.
- Collaboration isolee :
  le contenu temps reel est synchronise par room, tandis que la persistence longue duree reste dans l'API.

## Backend Projects API

### Couches

- `config/`
  resolution de l'environnement.
- `domain/`
  modeles metier.
- `repositories/`
  acces a MySQL et aux stockages techniques.
- `services/`
  logique metier auth/projets.
- `plugins/`
  concerns techniques Fastify comme CORS et auth.
- `routes/`
  endpoints HTTP fins, deleguant aux services.

### Authentification

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

Le token est signe cote serveur. Le frontend le stocke dans `localStorage` et l'envoie en `Bearer`.

### Projets

- `GET /projects`
- `POST /projects`
- `PATCH /projects/:projectId`
- `DELETE /projects/:projectId`
- `POST /projects/:projectId/open`
- `PUT /projects/:projectId/files`
- `PUT /projects/:projectId/collaborators`
- `GET /projects/shared/:ownerEmail/:projectId`

Le endpoint `shared` sert d'entree d'acces via lien partage. Lorsqu'un utilisateur authentifie ouvre ce lien, le backend l'ajoute comme collaborateur editeur si necessaire.

### Persistance

- Les donnees utilisateur et l'authentification sont sauvegardees dans MySQL via Prisma.
- Les projets, ACL, index de fichiers et contenus de fichiers sont sauvegardes dans MongoDB.
- Les contenus de fichiers sont chiffres cote application avant ecriture en base.
- Les champs sensibles du projet (`name`, `description`) sont aussi chiffres au repos.
- Les droits collaborateurs sont appliques par l'API :
  `viewer` = lecture seule, `editor` = lecture/ecriture, `owner` = controle complet.

Mode hybride securise :

- MySQL/Prisma reste la source de verite pour les utilisateurs et l'authentification.
- MongoDB est utilise uniquement pour les projets et les fichiers.
- Les contenus de fichiers sont chiffres cote application avant stockage en base MongoDB.
- Les champs sensibles du projet (`name`, `description`) sont aussi chiffres au repos.
- Le serveur peut imposer TLS vers MongoDB via `MONGODB_REQUIRE_TLS=true`.

## Frontend

Le frontend consomme un registre de services central dans `src/services/index.ts`.

Deux modes existent :

- `mock`
  implementation locale pour les iterations sans backend.
- `api`
  implementation HTTP reelle activee par `VITE_SERVICE_MODE=api` ou `VITE_PROJECTS_API_URL`.

Les hooks (`useProjects`, `useCompilation`) ne dependent que de ces contrats et pas des details d'implementation.

## Collaboration temps reel

- La room Yjs est calculee comme `project.id-file.id`.
- Tous les utilisateurs ouvrant le meme projet et le meme fichier rejoignent la meme room.
- Le `collab-server` valide maintenant le token utilisateur avant d'accepter une connexion WebSocket.
- Les rooms Yjs sont persistees dans MongoDB, elles aussi chiffrees avant stockage.
- Les modifications locales et distantes restent convergentes avec la persistance longue duree de l'API projets.

## Limites actuelles

- La compilation PDF reste mockee cote frontend.
- La verification fine des droits projet dans le `collab-server` peut encore etre renforcee avec un collab token scope par projet/fichier.

## Prochaines evolutions recommandees

1. Ajouter un collab token scope par projet/fichier.
2. Ajouter une vraie gestion des invitations/permissions de partage dans l'UI.
3. Deplacer la compilation LaTeX dans un service backend dedie.
4. Ajouter migrations SQL et observabilite backend.
