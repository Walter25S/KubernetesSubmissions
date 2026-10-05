# Service mesh: Istio ambient mode

Exercises 5.2 and 5.3. A service mesh gives the pods of a cluster encrypted and authenticated connections (mTLS), traffic
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
| [greeter/](greeter/index.js) and [manifests/](manifests) | Log output with the `greeter` service in the mesh (5.3) |

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

## Exercise 5.3: Log app, the service mesh edition

The Log output app (the `writer` and `reader` containers) with its ping-pong (and the database it needs) is deployed in the namespace `mesh`, which is in the
ambient mesh, together with a new service, **`greeter`**, that answers a `GET` with a greeting. The `reader` calls it and shows the greeting
among the rest of the output (`GREETER_URL`, optional: without it the output is the one of the previous exercises):

```
$ curl localhost:8090/
file content: this text is from file
env variable: MESSAGE=hello world
2026-10-05T11:07:29.905Z: 98e253a8-469c-492d-b88c-871493834476.
Ping / Pongs: 0
Greetings: hola from greeter v2
```

| File | What it has |
| ---- | ----------- |
| [greeter/](greeter/index.js) | The service: `VERSION` and `GREETING` are environment variables, so one image is two versions |
| [manifests/mesh.yaml](manifests/mesh.yaml) | The namespace `mesh` (labels `istio.io/dataplane-mode: ambient` and `istio.io/use-waypoint: waypoint`), the **waypoint**, a Gateway of Istio (the way in from outside) and its routes |
| [manifests/greeter.yaml](manifests/greeter.yaml) | The two versions of the greeter, the **three Services** and the `HTTPRoute` that splits the traffic |
| [manifests/log-output.yaml](manifests/log-output.yaml) | Log output, ping-pong and its Postgres |

### The traffic split

As the tips of the exercise say, three Services are needed for the greeter:

| Service | Selects | What for |
| ------- | ------- | -------- |
| `greeter-svc` | the pods of **both** versions | The one the app calls (`http://greeter-svc.mesh.svc.cluster.local`, the full name as the tip says); the `HTTPRoute` is attached to it |
| `greeter-svc-1` | `version: v1` | destination of 75 % |
| `greeter-svc-2` | `version: v2` | destination of 25 % |

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: greeter, namespace: mesh}
spec:
  parentRefs:                      # the parent is a Service: it is the traffic inside the mesh that is split
    - {group: "", kind: Service, name: greeter-svc, port: 80}
  rules:
    - backendRefs:
        - {name: greeter-svc-1, port: 80, weight: 75}
        - {name: greeter-svc-2, port: 80, weight: 25}
```

The split is applied by the **waypoint** (layer 7): without it, ztunnel only sees TCP and the route is ignored. The namespace
label `istio.io/use-waypoint: waypoint` sends the traffic to the Services of the namespace through it (`ResolvedWaypoints=True` in the status of the route).

### Run it

```bash
./install-istio.sh                                   # the cluster and Istio (see 5.2), and Kiali as above
docker build -t wallas25/greeter:5.3 greeter
docker build -t wallas25/log-output-reader:5.3 ../log_output/reader
k3d image import wallas25/greeter:5.3 wallas25/log-output-reader:5.3 wallas25/log-output-writer:1.10 wallas25/ping-pong:4.1 -c mesh

kubectl apply -f manifests/mesh.yaml
kubectl -n mesh create secret generic postgres-secret --from-literal=POSTGRES_PASSWORD=<a password>
kubectl apply -f manifests/greeter.yaml -f manifests/log-output.yaml

kubectl -n mesh port-forward svc/mesh-gateway-istio 8090:80       # http://localhost:8090
```

### Tested

400 requests through the gateway (the greeting says which version answered):

```
    308 Greetings: hello from greeter v1        77 %
     92 Greetings: hola  from greeter v2        23 %
```

and **Kiali** (graph of the namespace `mesh`, last 10 minutes), measured on its own, from the metrics of the mesh:

```
log-output-dep      -> greeter-dep-v1     http  0.48 requests/s     (75 %)
log-output-dep      -> greeter-dep-v2     http  0.16 requests/s     (25 %)
log-output-dep      -> ping-pong-dep      http  0.99
mesh-gateway-istio  -> log-output-dep     http  0.52
ping-pong-dep       -> postgres-stset     tcp   (the connection to the database, also in the mesh)
```

The Kiali graph (http://localhost:20001/kiali, namespace `mesh`) shows the same as a picture: `gateway -> log-output -> (waypoint) -> greeter v1 | greeter v2`.
