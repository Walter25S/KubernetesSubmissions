# project

The course project (`todo_app`, `todo_backend`, its Postgres database and
`todo_cronjob`) deployed with [Kustomize](https://kustomize.io/) (exercise 3.5).
Kustomize is part of `kubectl`: instead of applying many files one by one, one command
applies everything in the right order (the Namespace first).

```
project/
  base/        what is the same everywhere: the namespace and the four parts
  gke/         Google Kubernetes Engine = base + what GKE needs
  k3d/         local k3d cluster       = base + what k3d needs
../todo_app/kustomization.yaml       # each part has its own kustomization.yaml
../todo_backend/kustomization.yaml
../todo_cronjob/kustomization.yaml
../volumes/kustomization.yaml        # local PersistentVolume (k3d only)
```

A kustomization cannot use a file outside of its own folder, but it can use another
folder that has its own `kustomization.yaml`; that is why the parts are used as folders.

## What changes between environments

| | k3d (local) | GKE |
| --- | --- | --- |
| Picture cache volume | `volumes/`: a `local` PersistentVolume pinned to a node, and its claim | `gke/pvc.yaml`: only the claim, GKE creates the disk |
| Postgres disk | storage class `local-path` (k3s) | the class is removed with a patch, GKE uses its default (`standard-rwo`), 1Gi |
| Volume permissions | not needed | `gke/todo-app-volume-permissions.yaml`: `fsGroup: 1000`, because the image runs as the non-root user `node` and a GKE disk belongs to root |
| Access from outside | `k3d/ingress.yaml` (Traefik) | `gke/gateway.yaml` + `gke/httproute.yaml` (Gateway API) |
| Images | the tags of the Deployments | the `images:` block of `gke/kustomization.yaml` |

## Images

The tags that are deployed are set in the `images:` block of the kustomization
(`kustomize edit set image` changes it). This is the line a deployment pipeline edits to roll
out a new version without touching the Deployments.

## Use it

See what Kustomize generates without applying anything:

```bash
kubectl kustomize project/gke
```

### GKE

The cluster has to exist, `kubectl` has to point to it and the Gateway API has to be
enabled (see [../log_output/README.md](../log_output/README.md)). The images must be on Docker
Hub. The database password is **not** in the repository: create the Secret before the
database starts (it generates a random password and does not print it):

```bash
kubectl apply -f project/base/namespace.yaml
openssl rand -hex 16 | tr -d '\n' > /tmp/pgpw
kubectl create secret generic postgres-secret -n project --from-file=POSTGRES_PASSWORD=/tmp/pgpw
rm /tmp/pgpw

kubectl apply -k project/gke
kubectl get pods,pvc,gateway -n project     # the Gateway needs a few minutes to get its ADDRESS
```

Open `http://<ADDRESS>/` (the first minutes can answer 404/502 while the load balancer is
created).

### k3d

```bash
kubectl apply -k project/k3d      # after creating the Secret and the directory on the node, see ../volumes/README.md
```

## Remove it

```bash
kubectl delete -k project/gke
```

The Secret and the disks of the StatefulSet are not part of the kustomization:
`kubectl delete secret postgres-secret -n project` and
`kubectl delete pvc --all -n project`.

## Exercises

- 3.5
