# todo_app

Web server for the course project. On startup it prints
`Server started in port NNNN`. The port is chosen with the `PORT`
environment variable (default `3000`).

## Run locally

```bash
PORT=3000 node index.js
```

## Build and push the image

```bash
docker build -t wallas25/todo-app:1.2 .
docker push wallas25/todo-app:1.2
```

## Deploy to the cluster

```bash
kubectl apply -f manifests/deployment.yaml
kubectl logs -f deployment/todo-app-dep
```

The port is not reachable from outside the cluster yet; networking is
configured in later exercises.

The deployment is declared in `manifests/deployment.yaml` (exercise 1.4),
including the `PORT` environment variable and CPU/memory requests and limits.
After editing it, re-apply with the same `kubectl apply -f` command.

## Exercises

- 1.2
- 1.4
