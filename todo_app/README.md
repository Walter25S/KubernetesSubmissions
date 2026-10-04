# todo_app

Web server for the course project. On startup it prints
`Server started in port NNNN`.

## Configuration (exercise 2.6)

There are no ports, URLs or limits in the source code: everything comes from
environment variables, which in the cluster are defined in the ConfigMap
`todo-app-config` ([manifests/configmap.yaml](manifests/configmap.yaml)) and
loaded with `envFrom`. A missing variable stops the app on startup with a
message.

| Variable | Meaning | Value in the ConfigMap |
| -------- | ------- | ---------------------- |
| `PORT` | Port the server listens on | `3000` |
| `IMAGE_DIR` | Directory (inside the volume) where the picture is cached | `/usr/src/app/files/todo` |
| `IMAGE_URL` | Where to download the random picture | `https://picsum.photos/1200` |
| `IMAGE_TTL_MS` | How long the picture stays the same | `600000` (10 minutes) |
| `TODO_BACKEND_URL` | Base URL of `todo_backend` | `http://todo-backend-svc:2345` |
| `REQUEST_TIMEOUT_MS` | Timeout of the requests to the backend | `3000` |
| `MAX_TODO_LENGTH` | Maximum length of a todo | `140` |
| `MAX_BODY_BYTES` | Maximum size of a submitted form | `10240` |
| `ENABLE_SHUTDOWN` | Optional, `true` enables `POST /shutdown` (testing only) | `true` |
| `ENABLE_BREAK_BUTTON` | Optional, `true` shows the "Break the app" button and enables `POST /break` (exercise 4.2) | `true` |

To change a value, edit the ConfigMap, apply it and restart the pods
(`kubectl rollout restart deployment/todo-app-dep -n project`); the image does
not need to be rebuilt.

## Endpoints

| Method and path | Description |
| --------------- | ----------- |
| `GET /` | HTML page with the picture, the todo form (max 140 characters) and the list of todos, rendered on the server with the todos it gets from `todo_backend`. |
| `POST /todos` | Receives the form (`todo=...`), validates it and forwards it to `todo_backend`, then redirects (`303`) to `/`. |
| `GET /image` | The cached random picture (JPEG). |
| `GET /healthz` | Liveness probe (exercise 4.2): `200` while the app is healthy, `500` after the "Break the app" button was pressed. |
| `GET /readyz` | Readiness probe (exercise 4.2): `200` when the app is healthy **and the backend is connected to the database**; `503` otherwise. |
| `POST /break` | Only with `ENABLE_BREAK_BUTTON=true`: the "Break the app" button. From then on `/healthz` answers `500` and every other page answers `503`. |
| `POST /shutdown` | Stops the process (only when `ENABLE_SHUTDOWN=true`); used to test that the picture survives a container crash. |

## Probes and the "Break the app" button (exercise 4.2)

The Deployment has two probes:

- **`readinessProbe` -> `/readyz`**: the pod receives traffic only when the app is healthy and the
  backend, which owns the database, answers its own health check. If the database is down the pod is
  `0/1`, but it is **not restarted** (a restart would not help).
- **`livenessProbe` -> `/healthz`**: if it fails 3 times in a row (checked every 5 s) Kubernetes
  **restarts the container**.

To see it work, the page has a **"Break the app"** button. Pressing it sets a flag in memory: `/healthz`
starts to answer `500` and the app stops working (every page answers `503` "The app is broken").
Kubernetes notices the failed liveness probe, restarts the container and the app starts again healthy,
because the flag lives only in memory:

```bash
kubectl get po -n project -w         # after pressing the button: READY goes to 0/1 and then RESTARTS goes to 1
kubectl describe pod -n project -l app=todo-app | grep -i liveness
# Warning  Unhealthy  Liveness probe failed: HTTP probe failed with statuscode: 500
# Normal   Killing    Container todo-app failed liveness probe, will be restarted
```

In a test it took about 45 seconds from pressing the button to the new container being healthy (the
minimum is 15 s: 3 failed checks, 5 s apart). The container is restarted, not the pod: the pod keeps
its name and its `RESTARTS` counter goes up.

The button lets anyone who can open the page break the app, which is fine for the course; set
`ENABLE_BREAK_BUTTON` to `"false"` in the ConfigMap to remove the button and the endpoint.

## Todos (exercise 2.2)

The todos are not stored here: they are kept by the
[todo_backend](../todo_backend/README.md) service (in a Postgres database since
exercise 2.8), which this app reaches at
`TODO_BACKEND_URL` (default `http://todo-backend-svc:2345`). The backend is not
exposed outside the cluster; the browser only talks to this app. If the backend
is down the page still loads and shows a message.

## The hourly picture (exercise 1.12)

The picture comes from https://picsum.photos/1200 and is cached as
`image.jpg` in a PersistentVolume (`IMAGE_DIR`, default
`/usr/src/app/files/todo`), so it is not downloaded again when the container
crashes or the pod is recreated.

- The picture stays the same for 10 minutes (`IMAGE_TTL_MS`, default `600000`).
- After that, the old picture is served one more time and a new one is fetched
  in the background, so the next request gets the new picture.

The Deployment mounts the claim `shared-claim` defined in
[../volumes](../volumes/README.md), which has to be applied first.

## Run locally

All the variables above are required:

```bash
PORT=3000 IMAGE_DIR=/tmp/todo-images IMAGE_URL=https://picsum.photos/1200 IMAGE_TTL_MS=600000 TODO_BACKEND_URL=http://localhost:3001 REQUEST_TIMEOUT_MS=3000 MAX_TODO_LENGTH=140 MAX_BODY_BYTES=10240 node index.js
```

## Build and push the image

```bash
docker build -t wallas25/todo-app:2.2 .
docker push wallas25/todo-app:2.2
```

## Deploy to the cluster

```bash
k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2
docker exec k3d-k3s-default-agent-0 sh -c "mkdir -p /tmp/kube && chmod 777 /tmp/kube"
kubectl apply -f ../project/base/namespace.yaml
kubectl apply -f ../volumes/
# the backend needs its database Secret first, see ../todo_backend/README.md
kubectl apply -f ../todo_backend/manifests/
kubectl apply -f manifests/        # the ConfigMap, Deployment, Service and Ingress
kubectl get all -n project
```

## Access

Exercise 1.8 exposed the app with an Ingress (a `ClusterIP` Service in
`manifests/service.yaml` plus an Ingress). Since exercise 3.5 the Ingress lives in
[../project/k3d/ingress.yaml](../project/k3d/ingress.yaml), because how the app is
exposed depends on the environment (k3d uses Ingress, GKE uses the Gateway API). Open
http://localhost:8081 in the local cluster.

The app runs in the `project` namespace (exercise 2.4). The `log_output` Ingress
(namespace `exercises`) also uses `/`, so only one of the two can be applied at a
time in the local cluster.

The whole project is deployed with Kustomize, see [../project/README.md](../project/README.md);
this folder has its own `kustomization.yaml`.

## Exercises

- 1.2, 1.4, 1.5, 1.6, 1.8 (see the corresponding releases)
- 1.12 (picture cached in a PersistentVolume)
- 1.13 (todo input, Send button and hardcoded todo list)
- 2.2 (todos created and listed through `todo_backend`)
- 2.4 (moved to the `project` namespace)
- 2.6 (configuration in a ConfigMap, nothing hard coded)
- 3.5 (deployed with Kustomize to GKE, see ../project)
- 4.2 (readiness and liveness probes, "Break the app" button)
