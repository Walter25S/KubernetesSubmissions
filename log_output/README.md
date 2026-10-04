# log_output

The app is split into two containers that run in the same pod and share an
`emptyDir` volume mounted at `/usr/src/app/files`:

| Container | Directory | What it does |
| --------- | --------- | ------------ |
| `writer`  | `writer/` | Generates a random string (UUID) on startup and appends a line `<ISO timestamp>: <string>` to `files/log.txt` every 5 seconds (it also prints it to stdout). |
| `reader`  | `reader/` | HTTP server (port from `PORT`, default `3000`). `GET /` returns the content of `files/log.txt`. |

Both containers use the file path from `FILE_PATH` (default `/usr/src/app/files/log.txt`).

## Run locally

```bash
FILE_PATH=/tmp/log.txt node writer/index.js &
FILE_PATH=/tmp/log.txt PORT=3000 node reader/index.js &
curl localhost:3000/
```

## Build and push the images

```bash
docker build -t wallas25/log-output-writer:1.10 writer
docker build -t wallas25/log-output-reader:1.10 reader
docker push wallas25/log-output-writer:1.10
docker push wallas25/log-output-reader:1.10
```

## Deploy to the cluster

```bash
kubectl apply -f manifests/
kubectl logs -f deployment/log-output-dep -c writer
```

`manifests/service.yaml` (`ClusterIP`, 2345 -> 3000) and `manifests/ingress.yaml`
expose the reader. The Ingress also routes `/pingpong` to the `ping_pong` app.
With the cluster created as
`k3d cluster create --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2`,
open http://localhost:8081.

Note: the volume is an `emptyDir`, so the file is lost when the pod is
recreated.

## Exercises

- 1.1, 1.3, 1.7 (single-container version, see the corresponding releases)
- 1.10 (writer + reader in one pod)
