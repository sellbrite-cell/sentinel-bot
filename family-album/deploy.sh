#!/usr/bin/env bash
# PC(Git Bash)에서 실행: 코드를 NAS 로 보내고 컨테이너를 다시 띄움
# 사용법:  ./deploy.sh        (ssh 별칭 'nas' 사용)
set -euo pipefail
cd "$(dirname "$0")"
NAS_DIR=/volume1/docker/family-album
DOCKER="sudo /usr/local/bin/docker"

tar -cf - Dockerfile .dockerignore package.json package-lock.json server.js lib public \
  | ssh nas "mkdir -p $NAS_DIR/data && cd $NAS_DIR && tar -xf - \
    && ( [ -f config.env ] || { echo 'config.env 가 없어요. config.env.example 참고해서 먼저 만들어 주세요.'; exit 1; } ) \
    && $DOCKER build --network host -q -t family-album . \
    && ($DOCKER stop family-album >/dev/null 2>&1 || true) \
    && ($DOCKER rm family-album >/dev/null 2>&1 || true) \
    && $DOCKER run -d --name family-album --restart unless-stopped --network host \
         -v $NAS_DIR/data:/data --env-file $NAS_DIR/config.env family-album >/dev/null \
    && sleep 2 && curl -s -o /dev/null -w '상태: %{http_code}\n' http://127.0.0.1:8092/ \
    && $DOCKER logs --tail 8 family-album"
