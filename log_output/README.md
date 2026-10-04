# log_output

The app is split into two containers that run in the same pod and share an
`emptyDir` volume mounted at `/usr/src/app/files`:

| Container | Directory | What it does |
| --------- | --------- | ------------ |
| `writer`  | `writer/` | Generates a random string (UUID) on startup and appends a line `<ISO timestamp>: <string>` to `files/log.txt` every 5 seconds (it also prints it to stdout). |
| `reader`  | `reader/` | HTTP server (port from `PORT`, default `3000`). `GET /` returns the last line of `files/log.txt` and the number of pongs, which it asks the `ping_pong` app for with `GET http://ping-pong-svc:2346/pings` (`PINGPONG_URL`). |

Example response:

```
2026-10-04T18:35:54.288Z: f3c8419f-679e-4222-9199-e82509352b30.
Ping / Pongs: 3
```

If `ping_pong` cannot be reached, the second line says `Ping / Pongs: unavailable`.

## Run locally

```bash
FILE_PATH=/tmp/log.txt node writer/index.js &
FILE_PATH=/tmp/log.txt PINGPONG_URL=http://localhost:3001/pings PORT=3000 node reader/index.js &
curl localhost:3000/
```

## Build and push the images

```bash
docker build -t wallas25/log-output-writer:1.10 writer
docker build -t wallas25/log-output-reader:2.1 reader
docker push wallas25/log-output-writer:1.10
docker push wallas25/log-output-reader:2.1
```

## Deploy to the cluster

The app runs in the `exercises` namespace (exercise 2.3). The `ping_pong` app has to
be deployed too, in the same namespace (the reader calls its Service by name):

```bash
kubectl apply -f ../namespaces/exercises.yaml
kubectl apply -f ../ping_pong/manifests/
kubectl apply -f manifests/
kubectl logs -n exercises -f deployment/log-output-dep -c writer
```

`manifests/service.yaml` (`ClusterIP`, 2345 -> 3000) and `manifests/ingress.yaml`
expose the reader. The Ingress also routes `/pingpong` to the `ping_pong` app.
With the cluster created as
`k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2`,
open http://localhost:8081.

Note: `log.txt` lives on an `emptyDir`, so it is lost when the pod is
recreated.

## Exercises

- 1.1, 1.3, 1.7 (single-container version, see the corresponding releases)
- 1.10 (writer + reader in one pod)
- 1.11 (shared the ping-pong counter through a PersistentVolume, see its release)
- 2.1 (gets the ping-pong counter over HTTP instead)
- 2.3 (moved to the `exercises` namespace)
