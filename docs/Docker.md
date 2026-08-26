# Docker local

## Services

- `mysql` : base Prisma pour les utilisateurs, projets SQL et collaborateurs
- `mongodb` : stockage des projets et fichiers chiffrés
- `projects-api` : API Fastify sur le port `3000`
- `collab-server` : WebSocket Yjs sur le port `8080`
- `web-editor-ui` : frontend React servi par `nginx` sur le port `5173`
- `web-monitoring-ui` : dashboard React servi par `nginx` sur le port `5174`

Tous les conteneurs sont attaches au reseau Docker `frelated-network`.
La communication inter-conteneurs utilise les noms de services `mysql`, `mongodb`, `projects-api` et `collab-server`.

## Lancement

```bash
./run-docker.sh up
```

Le script crée `.env.docker` depuis `.env.docker.example` s'il est absent.
Par defaut, les ports publies ont ete decales pour eviter les conflits locaux:

- MySQL : `3307` sur l'hote vers `3306` dans le conteneur
- MongoDB : `27018` sur l'hote vers `27017` dans le conteneur

## Commandes utiles

```bash
./run-docker.sh ps
./run-docker.sh logs
./run-docker.sh logs projects-api
./run-docker.sh down
```

## URLs locales

- Éditeur : `http://localhost:5173`
- Monitoring : `http://localhost:5174`
- API : `http://localhost:3000`
- Swagger : `http://localhost:3000/docs`
- Collaboration : `ws://localhost:8080`
