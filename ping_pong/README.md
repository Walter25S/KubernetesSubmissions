# ping_pong

Counts requests in memory (it resets when the pod restarts). The port is
chosen with the `PORT` environment variable (default `3000`).

| Method and path | Description |
| --------------- | ----------- |
| `GET /pingpong` | Responds `pong N` and then increments the counter `N`. |
| `GET /pings` | Responds with the number of requests received so far (used by `log_output`). |

Until exercise 1.11 the counter was shared with `log_output` through a file in
a PersistentVolume; since exercise 2.1 `log_output` asks for it over HTTP
(`http://ping-pong-svc:2346/pings`) and the volume is no longer used here.

## Run locally

```bash
PORT=3000 node index.js
curl localhost:3000/pingpong   # pong 0, then pong 1, ...
curl localhost:3000/pings      # number of pongs so far
```

## Build and push the image

```bash
docker build -t wallas25/ping-pong:2.1 .
docker push wallas25/ping-pong:2.1
```

## Deploy to the cluster

The app runs in the `exercises` namespace (exercise 2.3), which has to exist
first:

```bash
kubectl apply -f ../namespaces/exercises.yaml
kubectl apply -f manifests/
kubectl get all -n exercises
```

`manifests/service.yaml` is a `ClusterIP` Service (2346 -> 3000). Both live in the
`exercises` namespace; from another namespace it is `ping-pong-svc.exercises`. The Ingress is
shared with `log_output` and lives in `../log_output/manifests/ingress.yaml`:
`/` goes to `log_output` and `/pingpong` goes to this app. With the cluster
created as
`k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2`,
open http://localhost:8081/pingpong.

## Exercises

- 1.9, 1.11 (see the corresponding releases)
- 2.1 (HTTP endpoint `/pings` for `log_output`)
- 2.3 (moved to the `exercises` namespace)
