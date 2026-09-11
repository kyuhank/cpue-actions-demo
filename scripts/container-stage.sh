#!/bin/sh
set -eu
case "${1:-}" in extract|cpue|assessment|report) ;; *) echo 'Choose extract, cpue, assessment or report.' >&2; exit 2;; esac
export TOY_CONTAINER_IMAGE=ghcr.io/pacificcommunity/cpue-workshop@sha256:17b03d6e06da229b17524997d8a3fc8eb5f8f25233894b5ab99f89109b3890c5
export TOY_CODE_COMMIT="$(git rev-parse HEAD)"
export TOY_DATA_COMMIT="${TOY_DATA_COMMIT:-$TOY_CODE_COMMIT}"
docker run --rm --pull always --network none --user "$(id -u):$(id -g)" \
  --volume "$PWD:/work" --workdir /work \
  --env TOY_CODE_COMMIT --env TOY_DATA_COMMIT --env TOY_CONTAINER_IMAGE \
  --env TOY_DATA_REPOSITORY --env TOY_SOURCE_DATABASE \
  --env GITHUB_RUN_ID --env GITHUB_RUN_ATTEMPT --env ImageVersion \
  "$TOY_CONTAINER_IMAGE" python "pipeline/$1.py"
