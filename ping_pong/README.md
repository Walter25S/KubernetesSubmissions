# ping_pong

Responds with `pong N` to `GET /pingpong`, where `N` is a counter kept in
the number of requests received so far. Since exercise 1.11 the counter is
saved to `pingpong.txt` in a PersistentVolume (`COUNTER_FILE`, default
`/usr/src/app/files/pingpong.txt`) and restored on startup, so it survives pod
restarts. The port is chosen with the `PORT` environment variable (default `3000`).

## Run locally

```bash
PORT=3000 node index.js
curl localhost:3000/pingpong   # pong 0, then pong 1, ...
```

## Build and push the image

```bash
docker build -t wallas25/ping-pong:1.11 .
docker push wallas25/ping-pong:1.11
```

## Deploy to the cluster

The shared volume must exist first, see [../volumes](../volumes/README.md):

```bash
kubectl apply -f ../volumes/
kubectl apply -f manifests/
```

The Ingress is shared with `log_output` and lives in
`../log_output/manifests/ingress.yaml`: `/` goes to `log_output` and
`/pingpong` goes to this app. With the cluster created as
`k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2`,
open http://localhost:8081/pingpong.

## Exercises

- 1.9
- 1.11
