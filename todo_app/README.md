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
docker build -t wallas25/todo-app:1.5 .
docker push wallas25/todo-app:1.5
```

## Deploy to the cluster

```bash
kubectl apply -f manifests/deployment.yaml
kubectl logs -f deployment/todo-app-dep
```

`GET /` returns a simple HTML page. The port is not exposed outside the
cluster yet (that comes with Services/Ingress); to try it, forward it:

```bash
kubectl port-forward deployment/todo-app-dep 3003:3000
```

and open http://localhost:3003.

The deployment is declared in `manifests/deployment.yaml` (exercise 1.4),
including the `PORT` environment variable and CPU/memory requests and limits.
After editing it, re-apply with the same `kubectl apply -f` command.

## Exercises

- 1.2
- 1.4
- 1.5
