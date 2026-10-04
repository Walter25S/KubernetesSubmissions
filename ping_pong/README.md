# ping_pong

Counts requests and keeps the counter in a Postgres database (exercise 2.7),
so it survives restarts of the app and of the database pod.

| Method and path | Description |
| --------------- | ----------- |
| `GET /` | Responds `pong N` and then increments the counter `N`. |
| `GET /pings` | Responds with the number of requests received so far (used by `log_output` and by the health check). |

The app does not know where it is published. In the cluster it is reached at
`/pingpong`: the `HTTPRoute` of the Gateway rewrites that prefix to `/` (exercise 3.4).
Until exercise 3.3 the app itself answered at `/pingpong`, which forced the cluster URL
structure into the code.

On startup the app creates the table `pings` if needed and waits until the
database accepts connections, so the start order of the pods does not matter.
If the database goes away while running, requests answer `503` until it is back.

## Database

`manifests/statefulset.yaml` runs Postgres 16 as a **StatefulSet with one replica**
(`postgres-stset`) plus its **headless Service** (`postgres-svc`, `clusterIP: None`).
The data lives in a PersistentVolumeClaim created from `volumeClaimTemplates`
with the k3s `local-path` storage class, so it is kept when the pod is recreated
or even when the StatefulSet is deleted.

## Configuration

Nothing is hard coded. Non-secret values are in the ConfigMap `ping-pong-config`
(`manifests/configmap.yaml`); the password is in a Secret.

| Variable | Meaning | Source |
| -------- | ------- | ------ |
| `PORT` | Port the server listens on | ConfigMap |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Where and how to connect to Postgres | ConfigMap |
| `DB_RETRY_DELAY_MS` | Wait between connection attempts at startup | ConfigMap |
| `DB_PASSWORD` | Database password | Secret `postgres-secret`, key `POSTGRES_PASSWORD` |

### The Secret

The password is **not** stored in the repository. Create the Secret in the
cluster before the StatefulSet (it generates a random password and does not
print it; `secret.example.yaml` only shows the shape):

```bash
kubectl create namespace exercises   # or: kubectl apply -f ../namespaces/exercises.yaml
openssl rand -hex 16 | tr -d '
' > /tmp/pgpw
kubectl create secret generic postgres-secret -n exercises --from-file=POSTGRES_PASSWORD=/tmp/pgpw
rm /tmp/pgpw
```

If the cluster is recreated, create the Secret again. If the Secret is created
with a different password after the database was initialised, the database keeps
the old one: delete the volume (`kubectl delete pvc postgres-data-postgres-stset-0 -n exercises`)
to start from scratch.

## Run locally

```bash
npm install
PORT=3000 DB_HOST=localhost DB_PORT=5432 DB_NAME=pingpong DB_USER=pingpong DB_PASSWORD=... DB_RETRY_DELAY_MS=2000 node index.js
curl localhost:3000/        # pong 0, then pong 1, ...
curl localhost:3000/pings   # number of pongs so far
```

## Build and push the image

```bash
docker build -t wallas25/ping-pong:3.4 .
docker push wallas25/ping-pong:3.4
```

## Deploy to the cluster

```bash
kubectl apply -f ../namespaces/exercises.yaml
# create the Secret as described above, then:
kubectl apply -f manifests/
kubectl get statefulset,pods,pvc -n exercises
```

`manifests/service.yaml` is a `ClusterIP` Service (2346 -> 3000). The Ingress is
shared with `log_output` and lives in `../log_output/manifests/ingress.yaml`:
`/` goes to `log_output` and `/pingpong` goes to this app (this local Ingress does not
rewrite paths, so since exercise 3.4 `/pingpong` only works on the GKE Gateway; the
earlier releases work with it). Both live in the
`exercises` namespace; from another namespace it is `ping-pong-svc.exercises`.

Debug the database with a temporary pod:

```bash
kubectl run -it --rm --restart=Never -n exercises --image postgres:16-alpine psql-debug -- sh
# psql postgres://pingpong:<password>@postgres-svc:5432/pingpong
```

## Deploy to Google Kubernetes Engine (exercises 3.1 to 3.4)

The files that differ from the local k3d ones are in [gke/](gke/):

- `gke/statefulset.yaml`: the same Postgres as `manifests/statefulset.yaml` without
  `storageClassName: local-path` (that class only exists in k3s); GKE provisions a
  persistent disk with its default class.
- `gke/healthcheckpolicy.yaml` (exercise 3.3): tells the Gateway load balancer to
  health-check `/pings`. By default every backend is checked with `GET /` and ping-pong
  answers 404 there, so it would be `UNHEALTHY` and get no traffic. `/pings` answers 200
  and does not change the counter.

The images must be on a registry the cluster can reach (Docker Hub); images imported
with `k3d image import` do not exist in GKE.

```bash
# the cluster is created and kubectl points to it, see the course material
kubectl apply -f ../namespaces/exercises.yaml
# create the Secret as described above (Secret "postgres-secret" in namespace exercises)
kubectl apply -f manifests/configmap.yaml -f manifests/deployment.yaml -f manifests/service.yaml
kubectl apply -f gke/statefulset.yaml -f gke/healthcheckpolicy.yaml
```

How it is exposed changed along the exercises (each one has its own release):

- **3.1**: a `LoadBalancer` Service (external port 80), `http://<EXTERNAL-IP>/pingpong`.
- **3.2**: an Ingress shared with `log_output`, with `NodePort` Services and a `BackendConfig`
  for the health check.
- **3.3**: the Gateway API shared with `log_output`, see
  [../log_output/README.md](../log_output/README.md#deploy-to-google-kubernetes-engine-exercises-32-and-33).
- **3.4**: the same Gateway, but the `HTTPRoute` rewrites `/pingpong` to `/` and the app
  answers in `/` (`../log_output/gke/httproute.yaml`).

The load balancer and the cluster cost money (they consume the free credits). Delete
the cluster when it is not needed: `gcloud container clusters delete <name> --zone=<zone>`.

## Exercises

- 1.9, 1.11 (see the corresponding releases)
- 2.1 (HTTP endpoint `/pings` for `log_output`)
- 2.3 (moved to the `exercises` namespace)
- 2.7 (counter stored in Postgres, run as a StatefulSet)
- 3.1 (deployed to GKE and exposed with a `LoadBalancer` Service)
- 3.2 (exposed with the shared Ingress on GKE, `NodePort` Service and `BackendConfig`)
- 3.3 (exposed with the Gateway API, `HealthCheckPolicy`)
- 3.4 (answers in `/`; the `HTTPRoute` rewrites `/pingpong` to `/`)
