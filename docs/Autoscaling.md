# Autoscaling des workers de compilation

## Rôle

`apps/compilation-autoscaler` est un service autonome dont l'unique responsabilité
est de surveiller la profondeur de la file de compilation et d'ajuster en
conséquence le nombre de conteneurs `compilation-worker` actifs, en les
créant/détruisant directement via le socket Docker de l'hôte. Déploiement
mono-machine via Docker Compose uniquement — aucune dépendance à Kubernetes ou
KEDA, ces options ayant été explicitement écartées.

## Architecture interne

Le service suit une inversion de dépendance stricte : la logique de décision ne
connaît jamais la technologie de file utilisée, ni Docker. Elle ne dépend que de
trois interfaces minimales définies dans `src/domain/ports.ts` :

- `QueueDepthProvider` — une seule méthode, `getQueueSnapshot()`, qui renvoie
  `{ waitingCount, heavyWaitingCount }`.
- `SystemResourceMonitor` — une seule méthode, `getResources()`.
- `WorkerOrchestrator` — la sortie (exécution) : `getActiveWorkerCount()`,
  `getAverageActiveWorkerCpuLoadFraction()`, `scaleUp()`, `scaleDown()`.

```
src/
├── domain/
│   ├── ports.ts            # Interfaces (QueueDepthProvider, SystemResourceMonitor, WorkerOrchestrator)
│   └── scalingPolicy.ts    # Décision pure — sans Docker, sans file réelle, sans vraie machine
├── adapters/
│   ├── bullMqQueueDepthProvider.ts    # Implémentation concrète contre BullMQ/Redis (la file réelle actuelle)
│   ├── hostSystemResourceMonitor.ts   # Lecture des ressources hôte via /proc (fallback os.* hors Linux)
│   └── dockerWorkerOrchestrator.ts    # Création/destruction de conteneurs via l'API Docker
├── services/
│   └── autoscalerService.ts # Boucle d'orchestration : relie les ports à la décision, gère le cooldown
├── http/
│   └── healthServer.ts      # /health et /status, utilisés par le healthcheck Docker
└── index.ts                  # Bootstrap
```

Remplacer BullMQ par une autre technologie de file un jour ne demanderait qu'un
nouvel adaptateur implémentant `QueueDepthProvider` — aucune ligne de
`scalingPolicy.ts` ni de `autoscalerService.ts` ne serait à modifier
(Open/Closed). N'importe quelle implémentation de `QueueDepthProvider` ou de
`SystemResourceMonitor` peut remplacer une autre sans changer le comportement
de la décision (Liskov).

## Règles de scaling

Implémentées dans `decideScalingAction` (`src/domain/scalingPolicy.ts`), dans
cet ordre de priorité :

1. **Filet de sécurité du plafond absolu** — si la flotte dépasse le plafond
   configuré (10 par défaut, voir plus bas), un scale-down correctif est
   déclenché immédiatement, y compris pendant le cooldown.
2. **Cooldown anti-flapping** — aucune action tant que le délai minimal depuis
   la dernière action de scaling n'est pas écoulé (30s par défaut,
   `SCALE_COOLDOWN_MS`).
3. **Restauration du plancher** — si la flotte est sous le minimum configuré (1
   par défaut), une remontée est proposée en priorité sur le signal de file,
   mais reste soumise à la vérification de ressources : la sécurité prime même
   pour restaurer le plancher.
4. **Scale-up, déclenché par l'un des trois signaux indépendants suivants**
   (n'importe lequel suffit), sous réserve du plafond absolu et de la
   vérification de ressources :
   - profondeur de file brute > seuil haut (3 par défaut) ;
   - au moins `HEAVY_JOB_COUNT_THRESHOLD` jobs « lourds » en attente (2 par
     défaut) — voir _Signal de taille des jobs_ ci-dessous ;
   - workers actifs en moyenne au-dessus de `BUSY_WORKER_CPU_LOAD_THRESHOLD`
     (80% par défaut) de leur propre allocation CPU, alors qu'au moins un job
     attend — voir _Signal de charge réelle_ ci-dessous.
5. **File d'attente < seuil bas (3 par défaut)** → candidat scale-down, sous
   réserve du plancher. (Le scale-down reste piloté uniquement par le
   comptage brut ; les deux signaux enrichis ci-dessus ne s'appliquent qu'au
   scale-up.)
6. Entre les deux seuils (égal à 3 par défaut) et sans signal enrichi actif :
   `hold`.

### Deux signaux complémentaires au simple comptage

Le comptage brut de jobs en attente ne distingue pas un document trivial d'un
document lourd (images, bibliographie, TikZ). Deux signaux indépendants
comblent ce point, sans jamais avoir besoin de déchiffrer le contenu d'un job
ni de toucher `apps/projects-api` :

**Signal de taille des jobs** (`bullMqQueueDepthProvider.ts`) — un job en
attente est considéré « lourd » si son payload, encore chiffré, dépasse
`HEAVY_JOB_PAYLOAD_THRESHOLD_MB` (3 Mo par défaut). La taille du contenu
chiffré est directement proportionnelle à la taille du contenu source
d'origine (le chiffrement AES-GCM ne change pas fondamentalement la taille,
l'encodage base64 ajoute environ 33%) — aucun déchiffrement n'est donc
nécessaire, seule la longueur de la chaîne déjà stockée dans Redis est lue.
**Limite assumée** : c'est un indice, pas une mesure précise. Un document
avec beaucoup d'images embarquées en base64 sera détecté ; un document petit
en taille mais avec un TikZ complexe (coûteux en CPU, pas en octets) ne le
sera pas — d'où le second signal, complémentaire.

**Signal de charge réelle** (`dockerWorkerOrchestrator.ts`,
`getAverageActiveWorkerCpuLoadFraction`) — plutôt que de deviner à partir du
contenu d'un job, ce signal observe si les workers _déjà actifs_ tournent
réellement à pleine charge, via l'API Docker déjà utilisée pour les
créer/détruire (`container.stats({ stream: false })`, formule CPU standard
de Docker). Chaque worker étant plafonné à exactement 1 CPU
(`NanoCpus`/`cpus: 1`), la fraction obtenue représente directement « à quel
point ce worker sature son propre quota ». La moyenne est calculée sur tous
les workers actifs : un seul worker occupé parmi plusieurs inactifs ne
déclenche pas ce signal (la moyenne le dilue), ce qui est le comportement
voulu — si d'autres workers sont libres, ils peuvent absorber la charge
eux-mêmes. Ce signal n'est pris en compte que si au moins un job attend :
des workers occupés avec une file vide ne justifient rien, ils font
simplement leur travail. Une lecture impossible (pas de worker actif, ou
échec de lecture des stats) renvoie `null`, traité comme « aucun signal »,
jamais comme « occupé » ou « inactif ».

### Vérification des ressources — la condition principale

Avant toute création de worker, `checkResourcesForOneMoreWorker` estime
l'empreinte probable d'un worker de plus et vérifie qu'il reste une marge
confortable, pas seulement que la machine n'est pas déjà à 100% :

- **Mémoire** : la mémoire disponible (`MemAvailable`, qui compte les caches
  récupérables comme disponibles — pas `MemFree`, qui sous-estime
  chroniquement sur un hôte avec un cache disque chaud) doit rester
  supérieure à `MIN_FREE_MEMORY_AFTER_SCALE_UP_MB` (768 Mo par défaut, dans la
  fourchette 500 Mo–1 Go demandée) **après** avoir soustrait l'empreinte
  estimée d'un worker de plus (`ESTIMATED_WORKER_MEMORY_MB`, 320 Mo par
  défaut — confortablement au-dessus du pic mesuré de ~150-265 Mo pour
  laisser de la marge aux documents plus complexes : images, bibliographie,
  TikZ).
- **CPU** : la charge projetée (charge normalisée actuelle + `1 / nombre de
cœurs`, pour modéliser l'ajout d'un worker qui sollicite ~1 cœur pendant sa
  compilation) doit rester sous `MAX_CPU_LOAD_FRACTION_AFTER_SCALE_UP` (85%
  par défaut). Cela évite le piège consistant à ne regarder que « la machine
  n'est pas à 100% » : sur une petite machine, un seul cœur supplémentaire
  sollicité peut suffire à saturer.

Si la marge est insuffisante, **aucun worker n'est créé**, même si la file le
justifierait — la raison précise (mémoire ou CPU) est loggée clairement au
lieu d'échouer silencieusement.

### Plafond et plancher

- **Plafond absolu : 10.** `ABSOLUTE_MAX_WORKERS_CEILING` dans
  `scalingPolicy.ts` est une constante de code, pas une simple valeur par
  défaut : `clampMaxWorkers()` écrase toute configuration `MAX_WORKERS` qui
  dépasserait 10, avant même que la vérification de ressources n'entre en
  jeu.
- **Plancher : 1** par défaut (`MIN_WORKERS`), configurable. Le plancher réel
  est garanti par deux mécanismes indépendants : le service compose
  `compilation-worker` déclaré avec `restart: unless-stopped` (actif même si
  l'autoscaler est arrêté), et la logique de restauration du plancher
  ci-dessus (utile si `MIN_WORKERS` est configuré au-delà de 1).

## Cohabitation avec le worker de base déclaré dans Docker Compose

`docker-compose.yml` déclare toujours un service `compilation-worker` unique
avec `restart: unless-stopped` — c'est ce qui garantit le plancher même si le
conteneur de l'autoscaler lui-même est arrêté ou en train de redémarrer.
L'autoscaler ne détruit **jamais** ce conteneur : `DockerWorkerOrchestrator`
ne supprime que les conteneurs qu'il a lui-même créés, identifiés par le label
`com.frelated.managed-by=compilation-autoscaler`. En revanche, le comptage
utilisé pour le plafond (`getActiveWorkerCount()`) additionne ce worker de
base (label `com.docker.compose.service=compilation-worker`, posé
automatiquement par Compose) et les workers créés par l'autoscaler, pour que
la limite de 10 porte sur la flotte réelle totale, y compris si quelqu'un a
manuellement fait `docker compose up --scale compilation-worker=N`.

Les conteneurs créés par l'autoscaler reprennent exactement les contraintes de
sécurité et de ressources du service `compilation-worker` déclaré dans
`docker-compose.yml` (mémoire 768 Mo, 1 CPU, 128 PIDs, `cap_drop: ALL` avec
seulement `SETUID`/`SETGID`/`CHOWN`/`DAC_OVERRIDE` ajoutés, rootfs en lecture
seule, `no-new-privileges`, `tmpfs` sur `/tmp`) — à maintenir synchronisé si
l'un des deux change. L'arrêt d'un worker géré par l'autoscaler envoie
`SIGTERM` avec un délai de grâce dérivé de `COMPILATION_TIMEOUT_MS` (+10s),
laissant le mécanisme de fermeture propre de BullMQ (`Worker#close()`, déjà
câblé dans `apps/projects-api/src/compilation/worker.ts`) terminer une
compilation en cours plutôt que de la perdre.

## Configuration

Toutes les variables ont une valeur par défaut raisonnable ; voir
`apps/compilation-autoscaler/.env.example` pour la liste complète.

| Variable                                      | Défaut                        | Rôle                                                                                       |
| --------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `REDIS_URL`                                   | `redis://localhost:6379`      | Connexion à la file de compilation                                                         |
| `COMPILATION_QUEUE_NAME`                      | `frelated-latex`              | Doit rester synchronisé avec `queueName` dans `apps/projects-api/src/compilation/queue.ts` |
| `DOCKER_SOCKET_PATH`                          | `/var/run/docker.sock`        | Socket Docker de l'hôte                                                                    |
| `COMPILATION_WORKER_IMAGE`                    | `frelated-compilation-worker` | Image déjà construite, jamais buildée à la volée                                           |
| `COMPILATION_WORKER_NETWORK`                  | `frelated-network`            | Réseau Docker auquel attacher les nouveaux workers                                         |
| `POLL_INTERVAL_MS`                            | `5000`                        | Cadence de la boucle de décision                                                           |
| `SCALE_UP_THRESHOLD` / `SCALE_DOWN_THRESHOLD` | `3` / `3`                     | Seuils de la file                                                                          |
| `MIN_WORKERS` / `MAX_WORKERS`                 | `1` / `10`                    | Plancher / plafond (plafond réellement borné à 10, voir plus haut)                         |
| `SCALE_COOLDOWN_MS`                           | `30000`                       | Anti-flapping                                                                              |
| `ESTIMATED_WORKER_MEMORY_MB`                  | `320`                         | Empreinte estimée d'un worker de plus                                                      |
| `MIN_FREE_MEMORY_AFTER_SCALE_UP_MB`           | `768`                         | Marge mémoire exigée après cette empreinte                                                 |
| `MAX_CPU_LOAD_FRACTION_AFTER_SCALE_UP`        | `0.85`                        | Marge CPU exigée après projection                                                          |
| `HEAVY_JOB_PAYLOAD_THRESHOLD_MB`              | `3`                           | Taille de payload chiffré à partir de laquelle un job est « lourd »                        |
| `HEAVY_JOB_COUNT_THRESHOLD`                   | `2`                           | Nombre de jobs lourds qui déclenche seul un scale-up                                       |
| `BUSY_WORKER_CPU_LOAD_THRESHOLD`              | `0.8`                         | Charge CPU moyenne des workers actifs qui déclenche seule un scale-up                      |

`AUTH_SECRET`, `DATA_ENCRYPTION_KEY` et `COMPILATION_TIMEOUT_MS` doivent avoir
les mêmes valeurs que le service `compilation-worker` : elles sont transmises
telles quelles aux conteneurs créés.

## Sécurité : accès au socket Docker

Le service monte `/var/run/docker.sock` en lecture-écriture — un accès
équivalent à root sur l'hôte, nécessaire pour créer/démarrer/arrêter des
conteneurs. Ce choix est cohérent avec le périmètre du projet (une seule
machine de confiance, sans cluster). Le conteneur lui-même tourne avec
`cap_drop: [ALL]`, `no-new-privileges` et un rootfs en lecture seule pour
limiter ce qu'un compromis du processus Node lui-même permettrait, mais
l'accès au socket reste le point de confiance central de ce service.

## Démarrage

```bash
bash run-docker.sh up
```

Le service `compilation-autoscaler` démarre avec le reste de la pile. Suivre
ses décisions :

```bash
bash run-docker.sh logs compilation-autoscaler
curl http://localhost:3100/status
```

## Tests

```bash
pnpm --filter @frelated/compilation-autoscaler test
```

Les tests unitaires (`src/domain/scalingPolicy.test.ts`,
`src/services/autoscalerService.test.ts`) couvrent la logique de décision et
la boucle d'orchestration sans dépendance réelle à Docker, à la file ou à la
machine (implémentations en mémoire des trois interfaces).

Le test de bout en bout (`tests/autoscaler.e2e.test.ts`) valide le cycle
complet contre la vraie file BullMQ/Redis et le vrai socket Docker : il monte
de faux jobs sur une file de test isolée (base Redis et nom de file dédiés,
pour ne jamais interférer avec la file de production ni avec les tests
d'intégration de `apps/projects-api`), vérifie qu'un conteneur
`compilation-worker` supplémentaire apparaît réellement, puis qu'il est
détruit une fois la file vidée. Il est ignoré par défaut :

```bash
bash run-docker.sh up  # construit l'image du worker et crée frelated-network
AUTOSCALER_E2E=1 pnpm --filter @frelated/compilation-autoscaler test:e2e
```

## Démo visuelle en direct

Pour voir le système réagir en vrai — un vrai navigateur, de vrais clics dans
l'éditeur, et de vrais conteneurs qui apparaissent/disparaissent dans
`docker ps` — un script Playwright autonome pilote l'interface réelle :
[`apps/web-editor-ui/e2e/autoscaler-live-demo.mjs`](../apps/web-editor-ui/e2e/autoscaler-live-demo.mjs).

Il se connecte avec le compte de démonstration (`regent@frelated.dev`), crée
plusieurs vrais projets via le bouton « Nouveau projet », tape un vrai
document LaTeX volontairement coûteux à compiler (beaucoup de nœuds TikZ,
pour rester lent même une fois le worker « chauffé ») dans plusieurs onglets,
puis sauvegarde partout presque en même temps (Ctrl+S soumet la
compilation). Un flux séparé dans le même terminal affiche en direct la
flotte Docker réelle et la décision courante de l'autoscaler, pour corréler
ce qu'on voit dans le navigateur avec ce qui se passe sur l'hôte. Des
captures d'écran et une vidéo de chaque onglet sont enregistrées dans
`apps/web-editor-ui/e2e/autoscaler-demo-output/` (ignoré par git) — preuve
consultable après coup, pas seulement pendant l'exécution.

Prérequis : la pile complète et l'autoscaler démarrés (`bash run-docker.sh up`
puis `docker compose up -d compilation-autoscaler`, ou juste
`bash run-docker.sh up` si `compilation-autoscaler` est dans les services par
défaut de ta configuration).

```bash
cd apps/web-editor-ui
pnpm demo:autoscaler
```

Variables d'environnement optionnelles : `WEB_EDITOR_URL`, `PROJECTS_API_URL`,
`AUTOSCALER_URL`, `DEMO_EMAIL`, `DEMO_PASSWORD`, `DEMO_PROJECT_COUNT`,
`DEMO_SLOWMO_MS`, `DEMO_HEADLESS=true` (pour l'exécuter sans fenêtre
visible). Le script nettoie les projets de démo qu'il crée à la fin, même en
cas d'erreur.
