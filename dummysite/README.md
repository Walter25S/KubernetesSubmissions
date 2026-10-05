# DummySite: a CRD and its controller

Exercise 5.1. A **`DummySite`** resource has one property, `website_url`. When one is created, its controller
downloads that page and serves a copy of it inside the cluster.

```yaml
apiVersion: stable.dwk/v1
kind: DummySite
metadata:
  name: example
spec:
  website_url: https://example.com/
```

```
$ kubectl get dummysites        # or: kubectl get dsite
NAME        URL                                        PHASE   BYTES    AGE
example     https://example.com/                       Ready   611      27s
wikipedia   https://en.wikipedia.org/wiki/Kubernetes   Ready   598560   26s
```

## What is in it

| File | What it is |
| ---- | ---------- |
| [manifests/crd.yaml](manifests/crd.yaml) | The `CustomResourceDefinition`: group `stable.dwk`, kind `DummySite`, `spec.website_url` (required, must be `http(s)://...`), a `status` subresource and the columns of `kubectl get` |
| [manifests/rbac.yaml](manifests/rbac.yaml) | Namespace `dummysite`, the `ServiceAccount`, the `ClusterRole` and the `ClusterRoleBinding` of the controller |
| [manifests/deployment.yaml](manifests/deployment.yaml) | The controller |
| [manifests/dummysite.yaml](manifests/dummysite.yaml) | Two examples: `https://example.com/` and the page of Kubernetes in Wikipedia |
| [controller/](controller/index.js) | The controller (Node.js, no libraries): about 200 lines |

## What the controller does

It uses the REST API of Kubernetes directly (the same as the example of the course for JavaScript): a **list and a
watch** of `/apis/stable.dwk/v1/dummysites`, and for every DummySite that is new or changed:

```
DummySite ──> download website_url
          ──> ConfigMap  "<name>-html"   index.html = the page
          ──> Deployment "<name>"        nginx, serving the ConfigMap
          ──> Service    "<name>"        ClusterIP, port 80
          ──> .status    phase Ready / Failed, bytes, observedGeneration
```

- **Idempotent**: the three objects are written with *server-side apply*, so creating and updating are the same
  call and applying twice changes nothing.
- **Owned by the DummySite** (`ownerReferences`): deleting a DummySite deletes its ConfigMap, Deployment and Service,
  with no code in the controller for it.
- **The copy of the page** is its HTML, with a `<base href="...">` added so the styles and images, which pages
  link with relative paths, are loaded from the original site. It is not a complete mirror (that is what the
  exercise accepts: *the CSS styles can be broken*). A ConfigMap holds at most 1 MiB, so a bigger page fails.
- **A new URL** is served at once: the pod template has the hash of the page, so the Deployment rolls out. (A mounted
  ConfigMap alone would take up to a minute to be refreshed by the kubelet.)
- **Errors** (a page that answers 404, a name that does not resolve) are written in `.status` and retried every 30
  seconds, with a single pending retry for each DummySite.
- **Least privilege**: the `ClusterRole` can only read DummySites, patch their status and create or patch the
  three kinds of objects it makes. It can not delete anything, read pods or touch Secrets.

## Run it

The workflow of the exercise: role, account and binding; the deployment; the DummySite.

```bash
# the image, in a local k3d cluster
docker build -t wallas25/dummysite-controller:5.1 controller
k3d image import wallas25/dummysite-controller:5.1 -c k3s-default     # or: docker push wallas25/dummysite-controller:5.1

kubectl apply -f manifests/crd.yaml
kubectl apply -f manifests/rbac.yaml                  # 1. role, account and binding
kubectl apply -f manifests/deployment.yaml            # 2. the controller
kubectl apply -f manifests/dummysite.yaml             # 3. the DummySites

kubectl get dummysites
kubectl port-forward svc/example 8080:80              # http://localhost:8080
kubectl port-forward svc/wikipedia 8081:80            # http://localhost:8081
```

## Tested (k3d, Kubernetes 1.35)

| Check | Result |
| ----- | ------ |
| `example.com` | `Ready`, 611 bytes; the page served by the new Deployment is the same (`<title>Example Domain</title>`) |
| The Wikipedia page of Kubernetes (the example of the exercise) | `Ready`, 598560 bytes; served with `<title>Kubernetes - Wikipedia</title>` |
| Change `website_url` to another page | `Ready` with the new size; the pod is replaced and serves `Example Domains` (IANA) |
| A page that answers 404 | `Failed`, with the message `... answered 404` in the status; no Deployment is created; retried every 30 s (4 attempts in 2 minutes, not more) |
| `website_url: not-a-url` | rejected by the API (`should match '^https?://.+'`), the controller never sees it |
| Delete the DummySites | their ConfigMaps, Deployments and Services disappear |
| What the ServiceAccount can do | can create Deployments; can **not** delete them, read Pods or create Secrets |

Two things the tests found, now fixed in the code:

- The short name `ds` of the CRD is also the one of `daemonsets`; the CRD uses `dsite`.
- A page that failed was retried by more and more timers (every pass created another one); there is now one pending
  retry for each DummySite, and an event that is only the controller's own write to the status is ignored.
