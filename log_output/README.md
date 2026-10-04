# log_output

Generates a random string (UUID) on startup, keeps it in memory and prints it
every 5 seconds with an ISO timestamp:

```
2026-10-04T16:58:15.747Z: 4599f857-8994-42cd-86d1-033e40874e2c
2026-10-04T16:58:20.765Z: 4599f857-8994-42cd-86d1-033e40874e2c
```

It also serves the current status over HTTP: `GET /` returns the current
timestamp and the same random string (port from `PORT`, default `3000`).

## Run locally

```bash
node index.js
```

## Build and push the image

The image is published under the Docker Hub user `wallas25`.

```bash
docker build -t wallas25/log-output:1.7 .
docker push wallas25/log-output:1.7
```

## Deploy to the cluster

```bash
k3d cluster create -a 2
kubectl apply -f manifests/
kubectl get pods
kubectl logs -f deployment/log-output-dep
```

## Access with Ingress (exercise 1.7)

`manifests/service.yaml` is a `ClusterIP` Service (2345 -> 3000) and
`manifests/ingress.yaml` routes `/` to it. With the cluster created as
`k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2`,
open http://localhost:8081.

## Declarative workflow

The deployment lives in `manifests/deployment.yaml`; no imperative
`kubectl create`/`scale`/`set image` commands are used. To change the app,
edit the manifest (for example bump the image tag) and re-apply it:

```bash
kubectl apply -f manifests/deployment.yaml
```

To restart from scratch and verify:

```bash
kubectl delete -f manifests/deployment.yaml
kubectl apply -f manifests/deployment.yaml
kubectl logs -f deployment/log-output-dep
```

## Exercises

- 1.1
- 1.3
- 1.7
