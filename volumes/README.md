# volumes

Cluster-level storage (exercise 1.11). It was first shared by `ping_pong` and
`log_output`; since exercise 2.1 those two talk over HTTP and only `todo_app`
uses it (to cache the picture, exercise 1.12).
It is kept apart from the applications because PersistentVolumes are usually
managed by cluster administrators, not by the app developers.

- `persistentvolume.yaml`: a `local` PV (1Gi) backed by `/tmp/kube` on the node
  `k3d-k3s-default-agent-0` (pinned there with `nodeAffinity`).
- `persistentvolumeclaim.yaml`: the claim `shared-claim`.

Local PVs are tied to one node, so this is only for development.

## Setup

The directory has to exist on the node and be writable by the (non-root)
container users:

```bash
docker exec k3d-k3s-default-agent-0 sh -c "mkdir -p /tmp/kube && chmod 777 /tmp/kube"
kubectl apply -f volumes/
```

Apply this before the applications. If the cluster is recreated, repeat both
steps.
