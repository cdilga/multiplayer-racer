#!/usr/bin/env bash
# Scripted loss/jitter for the P1-N08 receipts, on eris (run it there, not on the Mac):
#   tools/net/netem.sh up <iface> <delay_ms> <jitter_ms> <loss_pct>     e.g. up lo 40 15 3
#   tools/net/netem.sh down <iface>
#   tools/net/netem.sh show <iface>
# `lo` impairs two browsers talking to each other on one machine (what the harness does); any other interface impairs
# traffic through it. Needs passwordless sudo for `tc`. Always `down` afterwards: this affects the whole interface.
set -euo pipefail
cmd=${1:?up|down|show}
dev=${2:?interface}
case "$cmd" in
  up)
    delay=${3:?delay_ms}; jitter=${4:?jitter_ms}; loss=${5:?loss_pct}
    sudo -n tc qdisc replace dev "$dev" root netem delay "${delay}ms" "${jitter}ms" distribution normal loss "${loss}%"
    echo "netem on $dev: delay ${delay}ms +-${jitter}ms, loss ${loss}%"
    ;;
  down) sudo -n tc qdisc del dev "$dev" root 2>/dev/null || true; echo "netem off on $dev" ;;
  show) tc qdisc show dev "$dev" ;;
  *) echo "usage: netem.sh up|down|show <iface> ..." >&2; exit 2 ;;
esac
