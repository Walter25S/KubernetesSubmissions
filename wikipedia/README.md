# Wikipedia with an init container and a sidecar

Exercise 5.4. A pod that serves Wikipedia pages, with three containers that share a directory:

| Container | Kind | What it does |
| --------- | ---- | ------------ |
| `init-kubernetes-page` | **init container** (`curlimages/curl`) | Runs once, to the end, **before** the other containers start: downloads `https://en.wikipedia.org/wiki/Kubernetes` and saves it as `index.html` in the shared directory |
| `nginx` | main container | Serves whatever is in that directory (`/usr/share/nginx/html`, mounted read-only) |
| `random-page-sidecar` | **sidecar** (`curlimages/curl`) | Runs next to nginx for as long as the pod lives: waits a random time between **5 and 15 minutes**, downloads a random page (`https://en.wikipedia.org/wiki/Special:Random`) and saves it in the same directory |

```
          pod
 ┌────────────────────────────────────────────────────────────┐
 │  init: curl Kubernetes ──┐                                  │
 │   (finishes first)       ├─> emptyDir "www" ──> nginx :80 ──┼─> Service ─> Ingress  wikipedia.localhost
 │  sidecar: wait 5-15 min ─┘    (index.html)                  │
 │   curl Special:Random, forever                               │
 └────────────────────────────────────────────────────────────┘
```

Everything is in [manifests/wikipedia.yaml](manifests/wikipedia.yaml): the namespace `wikipedia`, a ConfigMap with the two
small scripts, the Deployment, the Service and an Ingress for the host `wikipedia.localhost`.

## How it works

- **The shared directory is an `emptyDir`** volume: it lives as long as the pod. The init container and the sidecar mount it
  read-write and nginx read-only, so nginx never changes what it serves.
- **The init container guarantees the first page.** Kubernetes does not start `nginx` and the sidecar until it ends
  successfully, so the pod is never ready without a page (and if the download fails, the init container is retried and the
  pod stays in `Init:Error`).
- **The sidecar is a second container in the same pod**, so it shares the lifecycle and the volume of the main one.
  (Kubernetes 1.29+ also has *native* sidecars: an init container with `restartPolicy: Always`. A regular container is
  used here because it works in every version and that is what the course describes.)
- **The page is written to a temporary file and then moved** (`mv` is atomic in the same directory), so a request never gets
  a half-written page. If a download fails, the previous page stays.
- **A `<base href>` tag** with the final URL is added to the page (the random page is a redirect), so the styles and images,
  which Wikipedia links with relative paths, are loaded from Wikipedia.
- **The random time** is computed in the script with `/dev/urandom`: `MIN_SECONDS + random % (MAX_SECONDS - MIN_SECONDS + 1)`;
  the values are environment variables (`300` and `900`).

## Run it

```bash
kubectl apply -f manifests/wikipedia.yaml
kubectl -n wikipedia get pods                         # 0/2 Init:0/1, then 2/2 Running
kubectl -n wikipedia logs deploy/wikipedia-dep -c init-kubernetes-page
kubectl -n wikipedia logs deploy/wikipedia-dep -c random-page-sidecar -f
curl -H "Host: wikipedia.localhost" http://localhost:8081/       # or open http://wikipedia.localhost:8081
```

## Tested (k3d)

```
$ kubectl -n wikipedia get pods
0/2   Init:0/1        <- the init container is downloading
2/2   Running         <- it ended; nginx and the sidecar started

$ kubectl -n wikipedia logs deploy/wikipedia-dep -c init-kubernetes-page
saved https://en.wikipedia.org/wiki/Kubernetes (598668 bytes)

$ kubectl -n wikipedia logs deploy/wikipedia-dep -c random-page-sidecar
next random page in 700 seconds                      <- between 300 and 900
```

Served through the Ingress, the first page is `<title>Kubernetes - Wikipedia</title>`.

To see the sidecar working without waiting minutes, the wait was set to 10 to 20 seconds
(`kubectl -n wikipedia set env deploy/wikipedia-dep -c random-page-sidecar MIN_SECONDS=10 MAX_SECONDS=20`):

```
saved https://en.wikipedia.org/wiki/201_Elizabeth_Street (109405 bytes)
next random page in 13 seconds
saved https://en.wikipedia.org/wiki/Vaskiluoto_railway_station (127439 bytes)
next random page in 15 seconds
saved https://en.wikipedia.org/wiki/Loch_Beag (83602 bytes)
```

and the Ingress then served `<title>Loch Beag - Wikipedia</title>`: the page of the pod changed by itself, with no restart of nginx.
The manifest keeps the real values (5 to 15 minutes).
