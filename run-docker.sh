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

ACTION="${1:-up}"
if [ "$#" -gt 0 ]; then
  shift
fi

compose() {
  docker compose --env-file "${ENV_FILE}" "$@"
}

case "${ACTION}" in
  up)
    compose up --build -d "$@"
    compose ps
    ;;
  down)
    compose down "$@"
    ;;
  restart)
    compose down
    compose up --build -d "$@"
    compose ps
    ;;
  logs)
    compose logs -f "$@"
    ;;
  ps)
    compose ps
    ;;
  *)
    echo "Usage: ./run-docker.sh [up|down|restart|logs|ps] [services...]"
    exit 1
    ;;
esac
