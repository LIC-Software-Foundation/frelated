# Benchmark du flow de compilation

`scripts/compilation-benchmark.mjs` soumet de vraies compilations via les API,
observe la file et les workers, attend le drainage puis le retour au plancher,
et écrit des rapports HTML et PDF avec des exports CSV/JSON. Il utilise
uniquement les modules intégrés de Node.js, sans dépendance npm supplémentaire.
Chrome ou Chromium est utilisé en fin de test pour convertir le HTML en PDF ;
la génération de charge passe directement par les API.

## Lancer le benchmark

Depuis la racine, avec Node.js >= 22.11, Docker accessible et Chrome/Chromium installé :

```bash
node scripts/compilation-benchmark.mjs --start-stack
```

`--start-stack` exécute `bash run-docker.sh up` avec `.env.docker`. Sans ce flag,
le script utilise la stack déjà démarrée. Pour une première vérification courte :

```bash
node scripts/compilation-benchmark.mjs --quick
```

Équivalent : `pnpm benchmark:compilation --quick`. Le plan court injecte la
charge pendant 40 secondes, le plan normal pendant 210 secondes. La préparation,
le drainage et l’observation du retour au minimum s’ajoutent à ces durées.
Un test court peut finir trop vite pour montrer plusieurs actions de scaling.

Le script lit les ports, le jeton de métriques, le nom de file et le plancher
depuis `.env.docker`, sans exécuter ce fichier comme un script shell.
L’environnement du processus a priorité. Les identifiants par défaut sont
ceux de la démo locale (`regent@frelated.dev` / `frelated123`). Autres comptes :

```bash
BENCHMARK_EMAIL='test@example.com' \
BENCHMARK_PASSWORD='mot-de-passe' \
node scripts/compilation-benchmark.mjs

BENCHMARK_TOKEN='jeton-utilisateur' node scripts/compilation-benchmark.mjs
```

Les précontrôles vérifient l’authentification, les métriques, l’autoscaler,
Docker et la présence de workers. Une file déjà occupée est signalée : les
métriques globales incluent alors cette charge extérieure.

## Phases et charge

| Phase           | Durée | Charge offerte                             |
| --------------- | ----: | ------------------------------------------ |
| Échauffement    |  15 s | 1 compilation, exclue des agrégats globaux |
| Référence       |  30 s | 1 compilation toutes les 10 s              |
| Montée          |  45 s | 1 compilation toutes les 4 s               |
| Rafale          |  30 s | 12 compilations au début                   |
| Charge soutenue |  60 s | 1 compilation toutes les 2 s               |
| Baisse          |  30 s | 1 compilation toutes les 10 s              |

Le débit cible ne ralentit pas lorsque les réponses deviennent lentes.
La machine, le document et le nombre de workers déterminent si ce débit
surcharge effectivement la file. Pour personnaliser les phases, copier
`scripts/compilation-benchmark/plan.example.json`, puis :

```bash
node scripts/compilation-benchmark.mjs --plan /tmp/mon-plan.json
```

Chaque phase a un `name` unique, une `durationSeconds` > 0, un débit optionnel
`ratePerSecond` et/ou un `burst` entier. Les arrivées périodiques commencent
au début de la phase ; le burst s’y ajoute. `warmup: true` exclut cette cohorte
des agrégats globaux. Sans débit ni burst, la phase observe une période calme.
Les jobs encore actifs continuent lors des changements de phase.

Le script prépare au maximum 24 projets, réutilisés seulement après la fin
d’une compilation et la vérification du PDF. Un commentaire unique évite la
déduplication. Une soumission ambiguë ou un timeout retire le projet du pool
afin de ne pas remplacer un job qui serait encore actif.

Les arrivées dépassant le pool, le maximum de tentatives ou une fenêtre
d’ordonnancement trop ancienne sont comptées comme `skipped_capacity`,
`skipped_job_limit` ou `skipped_scheduler`. Elles sont distinctes des échecs
du compilateur et indiquent un débit qui n’a pas été entièrement injecté.
Augmenter la capacité du générateur ou adapter le plan avant de conclure sur
la capacité du service.

Le document par défaut contient une grille TikZ de 35 × 35 nœuds. Pour varier
le coût ou employer un document autonome :

```bash
node scripts/compilation-benchmark.mjs --grid-size 55
node scripts/compilation-benchmark.mjs --document /tmp/document.tex
```

Le fichier fourni devient `main.tex`, avec les réglages de compilation par
défaut. Les images et bibliographies externes ne sont pas importées. Un
document coûteux en CPU peut rester petit en octets et ne pas activer le
signal « payload lourd » de l’autoscaler.

```bash
node scripts/compilation-benchmark.mjs \
  --max-in-flight 48 --max-jobs 200 \
  --job-timeout-seconds 360 --recovery-seconds 360
```

Valeurs par défaut : 24 jobs simultanés, 120 tentatives, 300 secondes maximum
par job (préparation comprise), puis jusqu’à 180 secondes d’observation après
drainage. Deux collectes successives doivent montrer une file sans job actif
ni en attente et une flotte au plancher pour confirmer le retour au minimum.
Avec plusieurs workers et un cooldown de 30 secondes, 180 secondes peuvent
être insuffisantes. Les limites et timeouts des workers restent inchangés.

## Rapport et métriques

Le dossier de sortie est affiché dans le terminal :

```text
artifacts/compilation-benchmark/<date-UTC>/
  report.html
  report.pdf
  report.json
  summary.csv
  jobs.csv
  samples.csv
  jobs.jsonl
  samples.jsonl
  projects.json
```

Ouvrir `report.html` directement dans un navigateur ou consulter `report.pdf`,
généré automatiquement avec les mêmes statistiques et graphiques, en A4 paysage.
Le rapport contient les courbes
de file, de flotte, de durées, de CPU et de mémoire des workers, les résultats
par phase, les erreurs, le débit et les décisions de scaling observées.
Les secrets et les sources ne sont pas exportés.

Le bilan présente le nombre de demandes offertes, les tentatives, les POST
envoyés, les jobs acceptés (compilations lancées), les réussites, les échecs,
les demandes non soumises, le taux d’erreurs et le taux de réussite. Il distingue
l’exécution complète, l’échauffement et la mesure hors échauffement, avec des
compteurs et taux par phase. Les échecs sont répartis par type : compilation,
requête/protocole, timeout, révision remplacée et PDF.

Le taux d’erreurs est `échecs du parcours / tentatives × 100` ; le taux de
réussite est `réussites / tentatives × 100`. Les demandes non soumises sont
exclues de ces dénominateurs. Un échec avant acceptation du job reste un échec
de tentative ; les compteurs distinguent ces échecs de ceux après acceptation.
Un timeout indique un résultat non confirmé, sans prouver l’arrêt du worker.
`summary.csv` fournit ces compteurs et taux. Le JSON conserve les fractions
`errorRate` et `successRate` dans l’intervalle 0–1 ; les colonnes CSV correspondantes
sont en pourcentage. `summary.total` inclut l’échauffement, `summary.warmup`
le décrit séparément et les compteurs directement sous `summary` l’excluent.

| Mesure               | Définition                                                                      |
| -------------------- | ------------------------------------------------------------------------------- |
| `compileMs`          | `durationMs` du compilateur, hors attente                                       |
| `queueWaitMs`        | `processedOn - timestamp` dans BullMQ                                           |
| `workerProcessingMs` | `finishedOn - processedOn`, traitement worker complet                           |
| `endToEndMs`         | Début du POST de compilation → PDF téléchargé et signature `%PDF-` vérifiée     |
| `scheduleLagMs`      | Retard du générateur sur l’arrivée programmée                                   |
| Débit global         | Succès hors échauffement / fenêtre de charge hors échauffement, drainage inclus |
| Débit de phase       | PDF téléchargés pendant cette phase, quelle que soit leur cohorte               |

Les percentiles p50/p95/max portent sur les succès. Les erreurs sont comptées
séparément. Les latences par phase regroupent les jobs soumis pendant cette
phase, même s’ils finissent plus tard. Le temps PDF comprend l’incertitude du
polling (500 ms par défaut). La sauvegarde du source est chronométrée séparément.
Le script ne mesure pas le rendu navigateur ou la notification WebSocket.

Les exports contiennent aussi les statistiques des conteneurs Redis, API
projets, service de file et autoscaler, ainsi que les ressources de la machine
de collecte et les erreurs du sampler/autoscaler. Les ressources hôte concernent
la machine exécutant le script ; Docker peut être distant. À 100 % de CPU
Docker, un conteneur utilise approximativement un cœur.

Les collectes sont espacées de 2 secondes par défaut, sans chevauchement.
Les timestamps réels font foi si Docker prend plus longtemps. Les maxima sont
les maxima **observés**. Les données indisponibles restent vides. Le monitoring
et le polling ajoutent eux-mêmes une charge au système.

L’attente précise est obtenue en fin de test par lecture des seuls timestamps
des jobs via `docker compose --env-file .env.docker exec -T redis redis-cli`.
Les lectures sont groupées et ne récupèrent aucun payload. Les API et le
Compose local doivent appartenir à la même stack. BullMQ conserve au maximum
100 jobs terminés : certains timings peuvent déjà avoir été purgés. Leur
couverture est affichée ; aucune attente manquante n’est estimée par soustraction.
« Mesure d’attente disponible pour 60 compilations réussies sur 60 » signifie
que les 60 succès hors échauffement disposent d’un timing d’attente. Ce compteur
décrit la couverture des mesures, pas le taux de réussite des compilations.

## PDF et régénération d’un rapport

La commande habituelle génère automatiquement `report.html` et `report.pdf`.
Le navigateur est détecté parmi les installations Chrome/Chromium usuelles.
Pour préciser l’exécutable :

```bash
node scripts/compilation-benchmark.mjs --pdf-browser /usr/bin/google-chrome
```

`BENCHMARK_PDF_BROWSER` permet aussi de définir ce chemin. La conversion utilise
un profil temporaire isolé, supprimé ensuite ; elle n’ouvre pas le profil habituel
du navigateur. `--pdf-timeout-seconds` règle le délai maximum de conversion
(60 secondes par défaut). `--no-pdf` désactive explicitement cet export.
`--pdf-no-sandbox` est réservé aux environnements isolés qui ne permettent pas
la sandbox Chromium. Si le PDF échoue, les autres exports restent disponibles,
`exports.pdf` dans le JSON explique l’échec et le script retourne le code 1.

Pour enrichir un rapport existant sans relancer de compilations :

```bash
node scripts/compilation-benchmark.mjs \
  --report-only artifacts/compilation-benchmark/<date-UTC>/report.json
```

Les rapports et exports sont régénérés dans le même dossier. `--output` permet
de choisir un autre dossier. Ce mode lit uniquement les données enregistrées ;
il ne contacte ni les API, ni Redis, ni Docker, et n’exécute pas `--start-stack`.

## Configuration et interruptions

```bash
node scripts/compilation-benchmark.mjs \
  --env-file .env.docker \
  --api-url http://localhost:3000 \
  --queue-url http://localhost:3200 \
  --autoscaler-url http://localhost:3100 \
  --output /tmp/compilation-resultats
```

`BENCHMARK_AUTOSCALER_TOKEN` remplace le jeton métriques ; `--min-workers`
remplace le plancher attendu. `--no-queue-timings` désactive Redis.
`--no-docker` désactive également le comptage et les statistiques des conteneurs :
le script confirme alors seulement que la file est vide. Pour une stack distante,
adapter les URL et désactiver Redis si le Compose local ne lui correspond pas.
`--start-stack` utilise uniquement `.env.docker`, comme `run-docker.sh`.
`--help` liste toutes les options.

La stack reste démarrée. Seuls les projets créés par le script sont supprimés.
Ctrl+C arrête les soumissions, attend les résultats ou timeouts, écrit le
rapport et effectue le nettoyage. `projects.json` journalise les IDs créés ;
`cleanupFailures` dans le rapport liste les projets restant à supprimer.
Un timeout d’observation ne garantit pas l’arrêt du travail serveur correspondant.

Codes de sortie : 0 pour des jobs réussis sans arrivée perdue, 1 en cas d’échec
de précontrôle, de job, de nettoyage, d’export PDF ou d’arrivée non soumise, 130
sur interruption. En mode `--report-only`, le code décrit uniquement la
régénération des exports, indépendamment des résultats du benchmark enregistré.
Un retour au plancher non confirmé ou des métriques secondaires manquantes
produisent des avertissements, sans transformer les succès en échecs.

Comparer les essais avec le même document, la même machine et la même
configuration, en commençant avec une file vide et la flotte au minimum.
Répéter plusieurs fois. Une attente croissante avec une compilation stable
indique une capacité insuffisante ; une hausse des deux peut indiquer une
contention. Vérifier les raisons des refus de scale-up et les ressources.

## Vérification du script

```bash
node --test scripts/compilation-benchmark/benchmark.test.mjs
```

Les tests utilisent des serveurs HTTP locaux, un Docker et un navigateur simulés :
soumission, PDF compilé, export du rapport PDF, bilans et dénominateurs, régénération
sans API, exports, timings, saturation du générateur, erreurs, timeouts,
précontrôles et Ctrl+C. Ils ne remplacent pas un benchmark sur de vrais workers.
