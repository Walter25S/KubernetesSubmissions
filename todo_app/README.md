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

`GET /` returns a simple HTML page.

## Access from outside the cluster (exercise 1.6)

`manifests/service.yaml` defines a `NodePort` Service: port `2345` inside the
cluster, `targetPort` 3000 (the container) and `nodePort` 30080 on the nodes.
The cluster must be created with the port published:

```bash
k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2
kubectl apply -f manifests/
```

Then open http://localhost:8082.

## Exercises

- 1.2
- 1.4
- 1.5
- 1.6
