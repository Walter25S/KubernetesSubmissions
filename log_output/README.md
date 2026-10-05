# log_output

The app is split into two containers that run in the same pod and share an
`emptyDir` volume mounted at `/usr/src/app/files`:

| Container | Directory | What it does |
| --------- | --------- | ------------ |
| `writer`  | `writer/` | Generates a random string (UUID) on startup and appends a line `<ISO timestamp>: <string>` to `files/log.txt` every 5 seconds (it also prints it to stdout). |
| `reader`  | `reader/` | HTTP server (port from `PORT`, default `3000`). `GET /` returns the last line of `files/log.txt` and the number of pongs, which it asks the `ping_pong` app for with `GET http://ping-pong-svc:2346/pings` (`PINGPONG_URL`). |

Example response:

```
file content: this text is from file
env variable: MESSAGE=hello world
2026-10-04T18:47:01.532Z: 9f4ff83c-8635-4f71-ab56-12895be5a823.
Ping / Pongs: 3
```

The first two lines come from a ConfigMap (exercise 2.5), see below.

If `ping_pong` cannot be reached, the second line says `Ping / Pongs: unavailable`.

## Readiness probe (exercise 4.1)

The `reader` container has a `readinessProbe` on `GET /healthz`: it is **ready only when it can receive
data from `ping_pong`** (the endpoint answers `200` if `GET http://ping-pong-svc:2346/pings` works, `503`
if not). The `writer` has no probe, so while ping-pong is not available the pod shows **`1/2 Running`**
(one container ready out of two); when ping-pong is ready it becomes `2/2`. Since ping-pong is only
ready when it has the database, taking the database away makes both pods lose their readiness:

```
NAME                             READY   STATUS
log-output-dep-57bcb75f97-xvbtl  1/2     Running
ping-pong-dep-679bc44d5d-s9t77   0/1     Running
```

and adding the database brings them back to `2/2` and `1/1` without any other action.

## Run locally

```bash
FILE_PATH=/tmp/log.txt node writer/index.js &
echo 'this text is from file' > /tmp/information.txt
FILE_PATH=/tmp/log.txt PINGPONG_URL=http://localhost:3001/pings INFO_FILE=/tmp/information.txt MESSAGE='hello world' PORT=3000 node reader/index.js &
curl localhost:3000/
```

## Build and push the images

```bash
docker build -t wallas25/log-output-writer:1.10 writer
docker build -t wallas25/log-output-reader:4.1 reader
docker push wallas25/log-output-writer:1.10
docker push wallas25/log-output-reader:4.1
```

## Deploy to the cluster

The app runs in the `exercises` namespace (exercise 2.3). The `ping_pong` app has to
be deployed too, in the same namespace (the reader calls its Service by name):

```bash
kubectl apply -f ../namespaces/exercises.yaml
kubectl apply -f ../ping_pong/manifests/
kubectl apply -f manifests/
kubectl logs -n exercises -f deployment/log-output-dep -c writer
```

`manifests/service.yaml` (`ClusterIP`, 2345 -> 3000) and `manifests/ingress.yaml`
expose the reader. The Ingress also routes `/pingpong` to the `ping_pong` app.
With the cluster created as
`k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2`,
open http://localhost:8081.

Note: `log.txt` lives on an `emptyDir`, so it is lost when the pod is
recreated.

## Configuration with a ConfigMap (exercise 2.5)

`manifests/configmap.yaml` defines the ConfigMap `log-output-config` with:

- the file `information.txt` (`this text is from file`), mounted as a volume at
  `/usr/src/app/config` in the reader container (`INFO_FILE` points to it), and
- the key `MESSAGE` (`hello world`), passed to the reader as the environment
  variable `MESSAGE` with `configMapKeyRef`.

```bash
kubectl apply -f manifests/configmap.yaml
kubectl get configmap -n exercises
```

Changing the text in the ConfigMap and applying it again updates the file in the
running pod after a short delay (the environment variable only changes when the
pod is recreated).

## Deploy to Google Kubernetes Engine (exercises 3.2 and 3.3)

On GKE the apps are exposed with the **Gateway API**, shared with `ping_pong`, in the
`exercises` namespace. The files are in [gke/](gke/):

- `gke/gateway.yaml`: the `Gateway` `exercises-gateway`, class
  `gke-l7-global-external-managed` (a Google Cloud HTTP load balancer), listening on port 80.
- `gke/httproute.yaml`: the `HTTPRoute` with the rules: `/pingpong` goes to `ping-pong-svc`
  and `/` goes to `log-output-svc`. The more specific path wins. Since exercise 3.4 the
  `/pingpong` rule has a `URLRewrite` filter (`ReplacePrefixMatch: /`), so `ping_pong`
  receives the request in `/` and does not need to know the cluster URL structure.

The Services are the `ClusterIP` ones in `manifests/service.yaml` (no `NodePort` is needed
with a Gateway). The health check policy of `ping_pong` is in
[../ping_pong/gke/healthcheckpolicy.yaml](../ping_pong/gke/healthcheckpolicy.yaml).
The images must be on Docker Hub.

Before using it the Gateway API has to be enabled once in the cluster
(`gcloud container clusters update <cluster> --zone=<zone> --gateway-api=standard`,
takes several minutes).

```bash
# ping_pong with its database first, see ../ping_pong/README.md (the Secret, gke/ ...)
kubectl apply -f manifests/configmap.yaml -f manifests/deployment.yaml -f manifests/service.yaml
kubectl apply -f ../ping_pong/gke/healthcheckpolicy.yaml -f gke/
kubectl get gateway -n exercises        # wait for ADDRESS and PROGRAMMED=True
```

Then open `http://<ADDRESS>/` and `http://<ADDRESS>/pingpong`. The first minutes the load
balancer can answer 404/502 or reset the connection while it is being created and the
backends are checked: retry. `kubectl describe gateway exercises-gateway -n exercises` and
`kubectl describe httproute exercises-route -n exercises` show what is wrong if it does not work.

Exercise 3.2 used an Ingress (`manifests/ingress.yaml`, with `NodePort` Services and a
`BackendConfig` for the health check); the Gateway replaces it in exercise 3.3. The Ingress
file is still used by the local k3d cluster (Traefik).

## GitOps (exercises 4.7 and 4.10)

The application is deployed by **ArgoCD**, which follows the folder `log-output` of the configuration repository
([KubernetesSubmissions-config](../config-repo/README.md); in exercise 4.7 it was `kustomization.yaml` in this folder). A CI workflow
([../.github/workflows/log-output.yaml](../.github/workflows/log-output.yaml)) builds the images of `writer` and `reader` when their
code changes, and commits the new tags to that repository for ArgoCD to apply. The manifests in [manifests/](manifests/) are the same
ones, for running it by hand. See [../gitops/README.md](../gitops/README.md).

## Exercises

- 1.1, 1.3, 1.7 (single-container version, see the corresponding releases)
- 1.10 (writer + reader in one pod)
- 1.11 (shared the ping-pong counter through a PersistentVolume, see its release)
- 2.1 (gets the ping-pong counter over HTTP instead)
- 2.3 (moved to the `exercises` namespace)
- 2.5 (configuration from a ConfigMap)
- 3.2 (deployed to GKE and exposed with an Ingress)
- 3.3 (the Ingress replaced by the Gateway API)
- 3.4 (the route rewrites `/pingpong` to `/` for `ping_pong`)
- 4.1 (readiness probe of the reader: ready when ping-pong answers)
- 4.7 (deployed by ArgoCD, GitOps)
- 4.10 (its configuration lives in the configuration repository)
