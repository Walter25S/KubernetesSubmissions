# log_output

The app is split into two containers that run in the same pod and share an
`emptyDir` volume mounted at `/usr/src/app/files`:

| Container | Directory | What it does |
| --------- | --------- | ------------ |
| `writer`  | `writer/` | Generates a random string (UUID) on startup and appends a line `<ISO timestamp>: <string>` to `files/log.txt` every 5 seconds (it also prints it to stdout). |
| `reader`  | `reader/` | HTTP server (port from `PORT`, default `3000`). `GET /` returns the last line of `files/log.txt` and the number of pongs, which it asks the `ping_pong` app for with `GET http://ping-pong-svc:2346/pings` (`PINGPONG_URL`). |

Example response:

```
file content: this text is from file
env variable: MESSAGE=hello world
2026-10-04T18:47:01.532Z: 9f4ff83c-8635-4f71-ab56-12895be5a823.
Ping / Pongs: 3
```

The first two lines come from a ConfigMap (exercise 2.5), see below.

If `ping_pong` cannot be reached, the second line says `Ping / Pongs: unavailable`.

## Run locally

```bash
FILE_PATH=/tmp/log.txt node writer/index.js &
echo 'this text is from file' > /tmp/information.txt
FILE_PATH=/tmp/log.txt PINGPONG_URL=http://localhost:3001/pings INFO_FILE=/tmp/information.txt MESSAGE='hello world' PORT=3000 node reader/index.js &
curl localhost:3000/
```

## Build and push the images

```bash
docker build -t wallas25/log-output-writer:1.10 writer
docker build -t wallas25/log-output-reader:2.5 reader
docker push wallas25/log-output-writer:1.10
docker push wallas25/log-output-reader:2.5
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

## Configuration with a ConfigMap (exercise 2.5)

`manifests/configmap.yaml` defines the ConfigMap `log-output-config` with:

- the file `information.txt` (`this text is from file`), mounted as a volume at
  `/usr/src/app/config` in the reader container (`INFO_FILE` points to it), and
- the key `MESSAGE` (`hello world`), passed to the reader as the environment
  variable `MESSAGE` with `configMapKeyRef`.

```bash
kubectl apply -f manifests/configmap.yaml
kubectl get configmap -n exercises
```

Changing the text in the ConfigMap and applying it again updates the file in the
running pod after a short delay (the environment variable only changes when the
pod is recreated).

## Deploy to Google Kubernetes Engine (exercise 3.2)

`log_output` and `ping_pong` are exposed together with one Ingress in the `exercises`
namespace (`manifests/ingress.yaml`: `/` to `log_output`, `/pingpong` to `ping_pong`).
On GKE the Ingress needs `NodePort` Services, so the ones in [gke/](gke/) are used
instead of `manifests/service.yaml`. The images must be on Docker Hub.

```bash
# ping_pong with its database first, see ../ping_pong/README.md (the Secret, gke/ ...)
kubectl apply -f manifests/configmap.yaml -f manifests/deployment.yaml -f gke/ -f manifests/ingress.yaml
kubectl get ingress -n exercises        # wait for ADDRESS; the backends need a few minutes to be HEALTHY
```

Then open `http://<ADDRESS>/` and `http://<ADDRESS>/pingpong`. While the load balancer
is being created the requests can fail (404/502, or the connection is reset).
The health of the backends can be seen with
`kubectl get ingress log-output-ingress -n exercises -o jsonpath='{.metadata.annotations.ingress\.kubernetes\.io/backends}'`.

## Exercises

- 1.1, 1.3, 1.7 (single-container version, see the corresponding releases)
- 1.10 (writer + reader in one pod)
- 1.11 (shared the ping-pong counter through a PersistentVolume, see its release)
- 2.1 (gets the ping-pong counter over HTTP instead)
- 2.3 (moved to the `exercises` namespace)
- 2.5 (configuration from a ConfigMap)
- 3.2 (deployed to GKE and exposed with an Ingress)
