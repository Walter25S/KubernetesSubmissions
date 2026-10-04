# ping_pong

Counts requests and keeps the counter in a Postgres database (exercise 2.7),
so it survives restarts of the app and of the database pod.

| Method and path | Description |
| --------------- | ----------- |
| `GET /pingpong` | Responds `pong N` and then increments the counter `N`. |
| `GET /pings` | Responds with the number of requests received so far (used by `log_output`). |

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
```

## Build and push the image

```bash
docker build -t wallas25/ping-pong:2.7 .
docker push wallas25/ping-pong:2.7
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
`/` goes to `log_output` and `/pingpong` goes to this app. Both live in the
`exercises` namespace; from another namespace it is `ping-pong-svc.exercises`.

Debug the database with a temporary pod:

```bash
kubectl run -it --rm --restart=Never -n exercises --image postgres:16-alpine psql-debug -- sh
# psql postgres://pingpong:<password>@postgres-svc:5432/pingpong
```

## Exercises

- 1.9, 1.11 (see the corresponding releases)
- 2.1 (HTTP endpoint `/pings` for `log_output`)
- 2.3 (moved to the `exercises` namespace)
- 2.7 (counter stored in Postgres, run as a StatefulSet)
