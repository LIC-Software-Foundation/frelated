#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env.docker"
ENV_EXAMPLE_FILE="${ROOT_DIR}/.env.docker.example"

if [ ! -f "${ENV_FILE}" ]; then
  cp "${ENV_EXAMPLE_FILE}" "${ENV_FILE}"
  echo "Fichier ${ENV_FILE} cree depuis ${ENV_EXAMPLE_FILE}."
  echo "Pensez a ajuster les secrets avant un usage partage ou de production."
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  echo "Usage: ./run-docker.sh [up|down|restart|logs|ps] [--no-tools] [services...]"
  echo "Par defaut, MailHog et LanguageTool sont lances avec toute la stack."
  exit 0
fi

ACTION="${1:-up}"
if [ "$#" -gt 0 ]; then
  shift
fi

NO_TOOLS="false"
COMPOSE_ARGS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-tools)
      NO_TOOLS="true"
      shift
      ;;
    --help|-h)
      echo "Usage: ./run-docker.sh [up|down|restart|logs|ps] [--no-tools] [services...]"
      echo "Par defaut, MailHog et LanguageTool sont lances avec toute la stack."
      exit 0
      ;;
    *)
      COMPOSE_ARGS="${COMPOSE_ARGS} $(printf '%s' "$1")"
      shift
      ;;
  esac
done

compose() {
  docker compose --env-file "${ENV_FILE}" "$@"
}

CORE_SERVICES="redis compilation-worker compilation-autoscaler mysql mongodb projects-api collab-server web-editor-ui web-monitoring-ui"
UP_SERVICES="${COMPOSE_ARGS}"
if [ "${NO_TOOLS}" = "true" ] && [ -z "${COMPOSE_ARGS}" ]; then
  UP_SERVICES="${CORE_SERVICES}"
fi

case "${ACTION}" in
  up)
    # shellcheck disable=SC2086
    compose up --build -d ${UP_SERVICES}
    compose ps
    ;;
  down)
    # shellcheck disable=SC2086
    compose down ${COMPOSE_ARGS}
    ;;
  restart)
    compose down
    # shellcheck disable=SC2086
    compose up --build -d ${UP_SERVICES}
    compose ps
    ;;
  logs)
    # shellcheck disable=SC2086
    compose logs -f ${COMPOSE_ARGS}
    ;;
  ps)
    # shellcheck disable=SC2086
    compose ps ${COMPOSE_ARGS}
    ;;
  *)
    echo "Usage: ./run-docker.sh [up|down|restart|logs|ps] [--no-tools] [services...]"
    exit 1
    ;;
esac
