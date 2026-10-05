#!/usr/bin/env bash
# Creates a k3d cluster for Knative and installs Knative Serving with Kourier (exercise 5.6).
#
#   ./install-knative.sh          # cluster "knative", context k3d-knative
#
# Knative needs a cluster without Traefik (Kourier is the network layer) and Kubernetes 1.34 (what this version needs).
# Magic DNS (sslip.io) gives every Knative Service a name like hello.default.<ip>.sslip.io, that resolves to <ip>.
set -euo pipefail
export MSYS_NO_PATHCONV=1

CLUSTER=${CLUSTER:-knative}
CTX=k3d-$CLUSTER
VERSION=${KNATIVE_VERSION:-knative-v1.23.0}
SERVING=https://github.com/knative/serving/releases/download/$VERSION
KOURIER=https://github.com/knative-extensions/net-kourier/releases/download/$VERSION

if ! k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
  k3d cluster create "$CLUSTER" --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2 \
    --k3s-arg "--disable=traefik@server:0" --image rancher/k3s:v1.34.1-k3s1
fi
kubectl --context "$CTX" wait --for=condition=Ready nodes --all --timeout=180s

k() { kubectl --context "$CTX" "$@"; }

k apply -f "$SERVING/serving-crds.yaml"
k apply -f "$SERVING/serving-core.yaml"
k apply -f "$KOURIER/kourier.yaml"
k patch configmap/config-network -n knative-serving --type merge \
  --patch '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}'
k apply -f "$SERVING/serving-default-domain.yaml"

k -n knative-serving get pods
