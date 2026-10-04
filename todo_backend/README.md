# todo_backend

Service that stores the todos of the project in a Postgres database
(exercise 2.8). The todos survive restarts of the backend and of the database
pod.

| Method and path | Description |
| --------------- | ----------- |
| `GET /todos` | Returns the list of todos as JSON: `[{"id": 1, "todo": "Buy milk", "done": false}]`. |
| `GET /healthz` | Readiness probe (exercise 4.2): `200` when the backend is connected to the database, `503` when it is not. |
| `GET /livez` | Liveness probe (exercise 4.2): `200` as long as the process answers. It does not look at the database. |
| `PUT /todos/<id>` | Marks a todo as done or not done with the JSON body `{"done": true}` or `{"done": false}` (exercise 4.5) and returns the todo. `404` if the todo does not exist, `400` if `done` is not a boolean or the body is not valid JSON, `405` for any other method on that path. |
| `POST /todos` | Creates a todo from the JSON body `{"todo": "Buy milk"}` and returns it with status `201`. A todo must have 1-`MAX_TODO_LENGTH` characters, otherwise the response is `400`. |

If the database is not reachable the endpoints answer `503`. On startup the app
creates the table `todos` if needed and keeps trying until the database accepts
connections, so the start order of the pods does not matter.

It is only reachable inside the cluster, through the Service `todo-backend-svc`
(`http://todo-backend-svc:2345` from the `project` namespace, or
`todo-backend-svc.project` from another one); `todo_app` talks to it.

## The "done" field (exercise 4.5)

Every todo has a `done` field (`false` when it is created). `PUT /todos/<id>` changes it:

```bash
curl -X PUT -H 'Content-Type: application/json' -d '{"done": true}' http://todo-backend-svc:2345/todos/1
# {"id":1,"todo":"Save todos in Postgres","done":true}
```

The table gets a column `done BOOLEAN NOT NULL DEFAULT false`. A database that was created before this
exercise already has the table, so the backend adds the column on startup if it is missing
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`): the existing todos are kept and are not done.
The change is logged like the other requests: `PUT /todos/1 200 3ms updated todo 1: done=true`.

## Messages to NATS (exercise 4.6)

When a todo is created or updated, after it was saved, the backend publishes a message to NATS (subject
`NATS_SUBJECT`): `{"event": "created" | "updated", "todo": {"id": 1, "todo": "...", "done": false}}`.
The [broadcaster](../broadcaster/README.md) listens to it and sends it to a chat service.

It is **optional**: if `NATS_URL` is not set the backend does not try to connect and logs
`Messaging is off`. Publishing never makes a request fail and never waits for NATS: if NATS is down the
message is lost, which is acceptable here, and the backend reconnects by itself when NATS is back.

## Probes (exercise 4.2)

- **`readinessProbe` -> `/healthz`**: ready only when connected to the database (`SELECT 1`). Without the
  database the pod is `0/1`, it leaves the Service and `todo_app` reports it as not ready too.
- **`livenessProbe` -> `/livez`**: restarts the container only if the process itself stops answering.
  It does not check the database on purpose: restarting the backend would not bring the database back and
  would only cause restart loops.

The server starts at once and does not wait for the database. The probes are called every few seconds
and are **not written to the log**, to keep it readable.

## Request logging (exercise 2.10)

Every request is written to stdout when its response is sent:
`<method> <url> <status> <duration>`, plus the todo for `POST /todos`. The todo is
printed as a JSON string, so it always stays on one line.

```
GET /todos 200 2ms
POST /todos 201 7ms created todo 5: "Buy milk"
POST /todos 400 2ms rejected todo (141 characters, limit 140): "yyyy..."
POST /todos 400 1ms rejected todo (0 characters, limit 140): ""
```

The 140-character limit (`MAX_TODO_LENGTH`) is enforced by the backend itself, not
only by the form: a todo that is empty or longer than the limit is answered with
`400` and logged as `rejected todo`. To try it without the form:

```bash
curl -X POST -H 'Content-Type: application/json' -d "{\"todo\":\"$(printf 'y%.0s' $(seq 141))\"}" http://todo-backend-svc:2345/todos
kubectl logs -n project deployment/todo-backend-dep | grep rejected
```

The logs are collected by the monitoring stack and can be searched in Grafana
with the Loki query `{namespace="project"} |= "rejected todo"`.

## Database

`manifests/statefulset.yaml` runs Postgres 16 as a **StatefulSet with one replica**
(`postgres-stset`) plus its **headless Service** (`postgres-svc`, `clusterIP: None`).
The data lives in a PersistentVolumeClaim created from `volumeClaimTemplates`
with the k3s `local-path` storage class, so it is kept when the pod is recreated
or even when the StatefulSet is deleted.

## Configuration

Nothing is hard coded. Non-secret values are in the ConfigMap
`todo-backend-config` ([manifests/configmap.yaml](manifests/configmap.yaml)) and
the password is in a Secret. A missing variable stops the app on startup with a
message.

| Variable | Meaning | Source |
| -------- | ------- | ------ |
| `PORT` | Port the server listens on | ConfigMap |
| `MAX_TODO_LENGTH` | Maximum length of a todo | ConfigMap |
| `MAX_BODY_BYTES` | Maximum size of a request body | ConfigMap |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Where and how to connect to Postgres | ConfigMap |
| `DB_RETRY_DELAY_MS` | Wait between connection attempts at startup | ConfigMap |
| `NATS_URL` | Optional. The NATS server to publish to; without it the messaging is off | ConfigMap, only in the local cluster (`project/k3d`) |
| `NATS_SUBJECT` | The subject to publish to; required when `NATS_URL` is set | ConfigMap, only in the local cluster |
| `DB_CONNECT_TIMEOUT_MS` | How long to wait for a connection before giving up, so that a health check never hangs | ConfigMap |
| `DB_PASSWORD` | Database password | Secret `postgres-secret`, key `POSTGRES_PASSWORD` |

The Postgres container reads `POSTGRES_DB`/`POSTGRES_USER` from the same ConfigMap
(`DB_NAME`, `DB_USER`) and `POSTGRES_PASSWORD` from the same Secret.

### The Secret

The password is **not** stored in the repository. Create the Secret in the
cluster before the StatefulSet (it generates a random password and does not
print it; `secret.example.yaml` only shows the shape):

```bash
kubectl apply -f ../project/base/namespace.yaml
openssl rand -hex 16 | tr -d '
' > /tmp/pgpw
kubectl create secret generic postgres-secret -n project --from-file=POSTGRES_PASSWORD=/tmp/pgpw
rm /tmp/pgpw
```

If the cluster is recreated, create the Secret again. If the Secret is created
with a different password after the database was initialised, the database keeps
the old one: delete the volume (`kubectl delete pvc postgres-data-postgres-stset-0 -n project`)
to start from scratch.

## Run locally

```bash
npm install
PORT=3001 MAX_TODO_LENGTH=140 MAX_BODY_BYTES=10240 DB_HOST=localhost DB_PORT=5432 DB_NAME=todos DB_USER=todos DB_PASSWORD=... DB_RETRY_DELAY_MS=2000 DB_CONNECT_TIMEOUT_MS=3000 node index.js
curl -X POST -H 'Content-Type: application/json' -d '{"todo":"Buy milk"}' localhost:3001/todos
curl localhost:3001/todos
```

## Build and push the image

```bash
docker build -t wallas25/todo-backend:4.6 .
docker push wallas25/todo-backend:4.6
```

## Deploy to the cluster

The app runs in the `project` namespace (exercise 2.4):

```bash
kubectl apply -f ../project/base/namespace.yaml
# create the Secret as described above, then:
kubectl apply -f manifests/
kubectl get statefulset,pods,pvc -n project
```

## Exercises

- 2.2 (first version, todos in memory)
- 2.4 (moved to the `project` namespace)
- 2.6 (configuration in a ConfigMap, nothing hard coded)
- 2.8 (todos stored in Postgres, run as a StatefulSet)
- 2.10 (request logging and the 140-character limit in the backend)
- 4.2 (readiness and liveness probes)
- 4.5 (the `done` field and `PUT /todos/<id>`)
- 4.6 (publishes a message to NATS when a todo is created or updated)
