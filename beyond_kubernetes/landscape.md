# Exercise 5.8: Landscape

Looking at the [CNCF Cloud Native Landscape](https://landscape.cncf.io/), the products I **used** (I knew I was using
them) and the ones that something I used **depended on** (indirectly).

### Used directly

1. **Kubernetes**: everything in the course; **Kustomize** in 3.5 and in the GitOps chapter (4.7 to 4.10).
2. **Helm**: to install Loki and Grafana (2.10), Prometheus (4.3), NATS (4.6) and Argo Rollouts.
3. **Prometheus**: queried in 4.3 and used by the analysis of the canary release in 4.4.
4. **Grafana Loki** (with Grafana): the logs of the backend in 2.10.
5. **Argo CD**: GitOps of the project in 4.7 to 4.10. **Argo Rollouts**: canary release in 4.4.
6. **NATS**: messages between the backend and the broadcaster in 4.6.
7. **k3d / k3s**: the local cluster of the whole course (k3d is a Rancher project; k3s is in the CNCF sandbox).
8. **Traefik**: the Ingress controller of k3s, used in every exercise with an Ingress; **Gateway API** in 3.3 (GKE).
9. **Istio** (ambient mode) and **Kiali**: service mesh in 5.2 and 5.3.
10. **Knative** (Serving) with Kourier: serverless in 5.6 and 5.7.
11. **Google Kubernetes Engine** with the Gateway API, Artifact Registry and Cloud Logging: chapter 3 (GKE is a
    certified Kubernetes platform; the other two are not in the CNCF but are in the landscape as products).
12. **GitHub Actions**: the deployment pipelines of 3.6 to 3.8, and the CI of the GitOps exercises.
13. **Docker / Docker Hub**: the images of every exercise.
14. **PostgreSQL**: the database of the project (outside the CNCF, but in the landscape).

### Used indirectly (something I used depended on it)

1. **containerd** and **runc**: they run the containers in k3s and in GKE; I only called `docker`.
2. **CoreDNS**: the DNS of the cluster, behind every `http://service.namespace.svc.cluster.local` call.
3. **Flannel**: the network between the nodes of k3s, so k3d pods can talk to each other.
4. **etcd** (in k3s, **kine** over SQLite instead; GKE runs its own): where Kubernetes keeps the state that ArgoCD and the controllers read.
5. **metrics-server**: behind `kubectl top` and the CPU of the canary analysis in 4.4.
6. **Envoy**: the proxy inside Kourier (Knative) and behind the Istio gateway.
7. **ztunnel** and **waypoint**: the pieces of Istio ambient that carry the traffic in 5.2 and 5.3.

### Outside of the course

- I have not used **Rancher**, **OpenShift** or **Cilium** in practice: only read about them (5.5).

The exercise also asks to circle the logos on the picture of the landscape (one colour for what was used, another for what was only
depended on). The list above is what goes on that picture.
