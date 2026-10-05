# Service mesh: Istio ambient mode

Exercise 5.2. A service mesh gives the pods of a cluster encrypted and authenticated connections (mTLS), traffic
management (splitting, retries, fault injection) and metrics, **without changing the applications**. Istio has two modes: the classic
one with a *sidecar* proxy in every pod, and the **ambient** mode used here, with no sidecars:

```
 ztunnel (one per node)   layer 4: mTLS between pods with HBONE (port 15008), identity of each pod, L4 policies, TCP metrics
 waypoint (one per namespace, optional)   layer 7: HTTP routing (splitting), L7 policies (methods, paths), HTTP metrics
```

| File | What it is |
| ---- | ---------- |
| [install-istio.sh](install-istio.sh) | Creates the k3d cluster `mesh` and installs Istio ambient with Helm |
| [addons/kiali.yaml](addons/kiali.yaml) | Kiali (the graph of the mesh), with the URL of the Prometheus of the exercise |
| [bookinfo/policies.yaml](bookinfo/policies.yaml) | Policies, waypoint and traffic split of the Istio sample app (5.2) |

## Exercise 5.2: Getting started with Istio ambient

### Set up

k3d needs a cluster **without Traefik** (Istio brings its own gateways) and Kubernetes 1.34. Everything is in
[install-istio.sh](install-istio.sh):

```bash
./install-istio.sh            # creates the cluster "mesh" (context k3d-mesh) and installs the four Helm charts
```

It installs the Gateway API CRDs (k3s does not have them) and the charts `base`, `istiod`, `cni` and `ztunnel` with `profile=ambient`.
Instead of the Istio CLI of the guide, Helm is used (the guide has both paths; the result is the same).

> **A problem with k3d.** The guide says to use `--set global.platform=k3d` for the `cni` chart. With k3s 1.34 that makes the CNI agent copy its plugin
> to `/bin`, but this k3s looks for the plugins in `/var/lib/rancher/k3s/data/cni`, so **every new pod failed**
> (`failed to find plugin "istio-cni" in path [/var/lib/rancher/k3s/data/cni]`, the `ztunnel` pods stayed in `ContainerCreating`).
> The script sets the two paths of the node explicitly (`cniConfDir`, `cniBinDir`) instead of the platform. (On Git Bash for Windows
> the script exports `MSYS_NO_PATHCONV=1`, or the paths become `C:/Program Files/Git/...`.)

Then Prometheus (the guide needs it for Kiali) and Kiali:

```bash
helm upgrade --install prom prometheus-community/prometheus -n monitoring --create-namespace \
  -f ../monitoring/prometheus-values.yaml --set prometheus-node-exporter.enabled=false
kubectl apply -f addons/kiali.yaml           # prometheus.url = http://prom-prometheus-server.monitoring:80
```

### The sample app (Bookinfo) and what was tried

Following *Deploy the sample application* of the guide: Bookinfo, its Gateway (Gateway API, `gatewayClassName: istio`) and a `curl` pod,
and the namespace is put in the mesh with `kubectl label namespace default istio.io/dataplane-mode=ambient`. No pod is restarted
or changed: they only get the annotation `ambient.istio.io/redirection: enabled`.

| Step of the guide | What was seen |
| ----------------- | ------------- |
| The app through the Istio gateway | `HTTP 200`, `<title>Simple Bookstore App</title>` |
| mTLS without changing the app | the `ztunnel` logs show the connections between pods through `dst.addr=...:15008` (HBONE), with the identity of each side, e.g. `src.identity="spiffe://cluster.local/ns/default/sa/bookinfo-reviews"` calling `ratings` |
| **Layer 4 policy**: only the gateway may call `productpage` | the `curl` pod is cut off (`curl` exit code 56), the call through the gateway still gives `200` |
| **Waypoint** and a **layer 7 policy** (only `GET`, from the gateway and from `curl`) | `GET` from the `curl` pod: `200`; `POST` and `DELETE`: **`403 RBAC: access denied`** (answered by the waypoint) |
| **Traffic split** of `reviews` (`HTTPRoute`, 90 % `v1` / 10 % `v2`) | 200 calls: **179** answered by `v1` and **21** by `v2` |
| **Kiali** | connected to Prometheus (3.15.0); the graph shows `gateway -> productpage -> waypoint -> reviews-v1 / reviews-v2 / details` and `reviews -> ratings`, with HTTP and TCP traffic |

The policies, the waypoint and the split are in [bookinfo/policies.yaml](bookinfo/policies.yaml) (applied one step at a time, as in the guide;
the layer 4 policy is replaced by the layer 7 one when the waypoint is in place).

To look at it: `kubectl -n istio-system port-forward svc/kiali 20001:20001` and open http://localhost:20001/kiali (Graph, namespace `default`, *Workload graph*).
