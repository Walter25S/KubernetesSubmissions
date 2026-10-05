# Exercise 5.5: Platform comparison

**Rancher** against **OpenShift**. The one I argue for is **Rancher**.

Answer of the form (under 150 words):

- **Rancher is Kubernetes with a management layer on top, OpenShift is a different product around it.** Rancher
  manages any cluster (k3s, RKE2, EKS, GKE) and does not change what the cluster is. OpenShift needs its own distribution.
- **Cost and weight.** Rancher and k3s are open source and run in a few hundred MB, which is why the course cluster is k3d.
  OpenShift needs a Red Hat subscription for support and a big cluster to run.
- **No lock-in.** A manifest that works in Rancher works in any Kubernetes. OpenShift adds its own resources (Routes,
  BuildConfigs, SCCs) and stricter defaults (containers can not run as root), so manifests have to be adapted.
- **Where OpenShift wins**: built-in CI, registry and support contract. That is a big reason for a company, not for a
  platform that must stay portable.

