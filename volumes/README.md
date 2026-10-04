# volumes

Cluster-level storage (exercise 1.11). It was first shared by `ping_pong` and
`log_output`; since exercise 2.1 those two talk over HTTP and only `todo_app`
uses it (to cache the picture, exercise 1.12).
It is kept apart from the applications because PersistentVolumes are usually
managed by cluster administrators, not by the app developers.

- `persistentvolume.yaml`: a `local` PV (1Gi) backed by `/tmp/kube` on the node
  `k3d-k3s-default-agent-0` (pinned there with `nodeAffinity`).
- `persistentvolumeclaim.yaml`: the claim `shared-claim`, in the `project` namespace
  (PVCs are namespaced; the PV is not).

Local PVs are tied to one node, so this is only for development.

## Setup

The directory has to exist on the node and be writable by the (non-root)
container users:

```bash
docker exec k3d-k3s-default-agent-0 sh -c "mkdir -p /tmp/kube && chmod 777 /tmp/kube"
kubectl apply -f volumes/
```

Apply this before the applications (and after `project/base/namespace.yaml`). If the
cluster is recreated, repeat both steps.

### Moving the claim to another namespace

A local PV that has been released is not bound again automatically. When the
claim is deleted (for example to move it to another namespace) the PV stays in
the `Released` state and the new claim stays `Pending`. Delete and recreate the
PV (the data on the node is kept):

```bash
kubectl delete pv shared-pv
kubectl apply -f volumes/
```
