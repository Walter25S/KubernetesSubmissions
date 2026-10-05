#!/usr/bin/env bash
# Creates a k3d cluster for the service mesh exercises (5.2 and 5.3) and installs Istio in ambient mode with Helm.
#
#   ./install-istio.sh            # cluster "mesh", context k3d-mesh
#
# What is specific to k3d / k3s (see https://istio.io/latest/docs/ambient/install/platform-prerequisites/):
#   - the cluster is created without Traefik and with Kubernetes 1.34
#   - the CNI plugin of Istio has to be put where this k3s looks for them: /var/lib/rancher/k3s/data/cni
#     (the profile "k3d" of the chart uses /bin, which is not where this version of k3s looks)
set -euo pipefail
export MSYS_NO_PATHCONV=1    # Git Bash on Windows would turn the paths below into C:/Program Files/Git/...

CLUSTER=${CLUSTER:-mesh}
CTX=k3d-$CLUSTER
GATEWAY_API=${GATEWAY_API:-v1.6.0}

if ! k3d cluster list "$CLUSTER" >/dev/null 2>&1; then
  k3d cluster create "$CLUSTER" --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2 \
    --k3s-arg "--disable=traefik@server:0" --image rancher/k3s:v1.34.1-k3s1
fi

kubectl --context "$CTX" wait --for=condition=Ready nodes --all --timeout=180s

helm repo add istio https://blob.istio.io/istio-release/charts >/dev/null 2>&1 || true
helm repo update >/dev/null || echo "helm repo update failed, using the cached index"

# the Gateway API (not in k3s)
kubectl --context "$CTX" get crd gateways.gateway.networking.k8s.io >/dev/null 2>&1 ||
  kubectl --context "$CTX" apply --server-side \
    -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/$GATEWAY_API/experimental-install.yaml"

helm --kube-context "$CTX" upgrade --install istio-base istio/base -n istio-system --create-namespace --wait
helm --kube-context "$CTX" upgrade --install istiod istio/istiod -n istio-system --set profile=ambient --wait
helm --kube-context "$CTX" upgrade --install istio-cni istio/cni -n istio-system --set profile=ambient \
  --set cniConfDir=/var/lib/rancher/k3s/agent/etc/cni/net.d --set cniBinDir=/var/lib/rancher/k3s/data/cni --wait
helm --kube-context "$CTX" upgrade --install ztunnel istio/ztunnel -n istio-system --wait

kubectl --context "$CTX" -n istio-system get pods
