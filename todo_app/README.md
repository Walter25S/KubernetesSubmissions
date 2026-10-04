# todo_app

Web server for the course project. On startup it prints
`Server started in port NNNN`. The port is chosen with the `PORT`
environment variable (default `3000`).

## Endpoints

| Method and path | Description |
| --------------- | ----------- |
| `GET /` | HTML page with the picture, the todo form (max 140 characters) and the list of todos, rendered on the server with the todos it gets from `todo_backend`. |
| `POST /todos` | Receives the form (`todo=...`), validates it and forwards it to `todo_backend`, then redirects (`303`) to `/`. |
| `GET /image` | The cached random picture (JPEG). |
| `POST /shutdown` | Stops the process (only when `ENABLE_SHUTDOWN=true`); used to test that the picture survives a container crash. |

## Todos (exercise 2.2)

The todos are not stored here: they are kept by the
[todo_backend](../todo_backend/README.md) service, which this app reaches at
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

```bash
PORT=3000 IMAGE_DIR=/tmp/todo-images node index.js
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
kubectl apply -f ../volumes/
kubectl apply -f ../todo_backend/manifests/
kubectl apply -f manifests/
```

## Access

Exercise 1.8 exposes the app with an Ingress: `manifests/service.yaml` is a
`ClusterIP` Service (2345 -> 3000) and `manifests/ingress.yaml` routes `/` to
it. Open http://localhost:8081.

The `log_output` Ingress also uses `/`, so only one of the two can be applied
at a time until the apps get their own routes.

## Exercises

- 1.2, 1.4, 1.5, 1.6, 1.8 (see the corresponding releases)
- 1.12 (picture cached in a PersistentVolume)
- 1.13 (todo input, Send button and hardcoded todo list)
- 2.2 (todos created and listed through `todo_backend`)
