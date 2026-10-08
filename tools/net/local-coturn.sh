#!/usr/bin/env bash
# A throwaway coturn for the P1-N08 "local coturn container" row (run on eris). Same REST-credential scheme as production:
# start jj-server with TURN_STATIC_AUTH_SECRET=<the secret printed by `up`> and JJ_TURN_URLS=turn:127.0.0.1:3479?transport=udp.
#   tools/net/local-coturn.sh up | down
set -euo pipefail
name=jj-local-coturn
case "${1:?up|down}" in
  up)
    secret=${LOCAL_COTURN_SECRET:-local-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')}
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" --network host coturn/coturn:4.7.0 \
      -n --log-file=stdout --use-auth-secret --static-auth-secret="$secret" --realm=jj.local \
      --listening-port=3479 --min-port=49400 --max-port=49499 --no-tls --no-dtls --no-cli --fingerprint \
      --listening-ip=127.0.0.1 --relay-ip=127.0.0.1 --allow-loopback-peers --no-multicast-peers >/dev/null
    echo "local coturn on udp 3479; TURN_STATIC_AUTH_SECRET=$secret"
    ;;
  down) docker rm -f "$name" >/dev/null 2>&1 || true; echo "local coturn removed" ;;
esac
