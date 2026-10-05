# GitOps with ArgoCD (exercises 4.7 to 4.10)

In the *push* deployment of chapter 4 (`.github/workflows/project.yaml`) the CI service builds the image and
then **pushes** the change to the cluster, so it needs access to it. In **GitOps** it is reversed: the state
of the cluster is described in Git, and a tool that runs **in the cluster**, [ArgoCD](https://argo-cd.readthedocs.io/),
**pulls** it from there and makes the cluster equal to it. The CI service only builds and publishes the image and
commits the new image tag; nobody, not even the CI, needs access to the cluster.

```
git push (code) -> CI workflow -> image in Docker Hub + commit with the new tag -> ArgoCD pulls and deploys
```

What this gives: changes are version controlled and reviewable, the cluster can be rebuilt from the
repository, and **a bad release is undone with `git revert`**.

## Where it runs

ArgoCD runs in the **local k3d cluster**, not in GKE: the nodes of the GKE cluster have no free memory for it
(they are `e2-small` and almost full) and adding nodes is a change of infrastructure and cost that was not
asked for. A cluster running on your own machine is also the case that motivates GitOps: it cannot be reached
from GitHub, so a CI cannot push to it, but it can pull from GitHub.

The images are published to **Docker Hub** (public), because the k3d nodes can pull from there. (The
images of the GKE pipeline are in a private Artifact Registry that only GKE can read.)

## Install ArgoCD

Version `v3.5.3`. The manifest is the official one; it was downloaded and read before applying it. The
`--server-side` apply is needed because some CRDs are big.

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.3/manifests/install.yaml

# optional, to save memory: these three are not needed here (login with Dex, notifications, ApplicationSets)
kubectl scale deployment -n argocd argocd-dex-server argocd-notifications-controller \
  argocd-applicationset-controller --replicas=0
```

The user interface (user `admin`; the password is generated at the installation and is **not** in the
repository):

```bash
kubectl port-forward svc/argocd-server -n argocd 8443:443        # https://localhost:8443
kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 -d
```

(In PowerShell: `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}")))`.)

ArgoCD is told what to deploy with an `Application` resource. The ones of this repository are in
[../argocd](../argocd/). `syncPolicy.automated` makes ArgoCD apply the changes by itself; ArgoCD looks at Git
every 3 minutes by default.

```bash
kubectl apply -n argocd -f argocd/log-output.yaml
kubectl get applications -n argocd
```

## What the CI needs (manual setup, once)

The workflows publish to Docker Hub and commit to the repository. In GitHub (*Settings -> Secrets and
variables -> Actions -> New repository secret*):

| Secret | Value |
| ------ | ----- |
| `DOCKERHUB_USERNAME` | `wallas25` |
| `DOCKERHUB_TOKEN` | an access token of Docker Hub with *Read & Write* permission (Docker Hub -> Account settings -> Personal access tokens). Not your password. |

The workflows ask for `permissions: contents: write`, which is what lets them commit. If the commit is refused,
check *Settings -> Actions -> General -> Workflow permissions -> Read and write permissions*.
The commit is made with the token of the workflow, and **a commit made with that token does not start another
workflow run**, so the release commit does not trigger a loop.

## Exercise 4.7: "Log output" with GitOps

| File | What it is |
| ---- | ---------- |
| [../log_output/kustomization.yaml](../log_output/kustomization.yaml) | What ArgoCD deploys: the manifests and, in `images:`, the tags of the two images that are running. |
| [../argocd/log-output.yaml](../argocd/log-output.yaml) | The `Application`: watches the folder `log_output` and keeps the namespace `exercises` equal to it. Automatic sync with `prune` and `selfHeal`. |
| [../.github/workflows/log-output.yaml](../.github/workflows/log-output.yaml) | The CI: when the code of `log_output/writer` or `log_output/reader` changes on `main`, it builds both images tagged with the commit SHA, pushes them, runs `kustomize edit set image` and commits `kustomization.yaml`. |

So **committing to the repository updates the application**: a change of the code runs the workflow, which
commits the new tags and ArgoCD applies them; a change of the manifests (replicas, a ConfigMap...) is applied by
ArgoCD directly.

### Tested

Not with GitHub (the workflow only runs there), but with the whole loop in the k3d cluster using a small Git
server that runs in it ([test-git-server](test-git-server/)), where ArgoCD pulled from and where the commit
of the CI was simulated:

| Step | Result |
| ---- | ------ |
| `Application` created | ArgoCD took over the resources that already existed: `Synced` / `Healthy` |
| a commit changes the two image tags (what the CI does) | in **13 seconds** the new pod ran the new images, with no `kubectl` |
| someone runs `kubectl scale ... --replicas=3` by hand | **3 seconds** later ArgoCD set it back to 1 (`selfHeal`) |
| `git revert` of the release commit | the cluster went back to the previous images in 13 seconds |

## Test Git server

[test-git-server](test-git-server/) is a Git server (nginx + `git-http-backend`, no authentication, only for
tests) that runs in the cluster. It lets you try GitOps without pushing to GitHub: ArgoCD pulls from it and you
play the role of the CI by committing to it.

```bash
docker build -t wallas25/git-server:test gitops/test-git-server && k3d image import wallas25/git-server:test
kubectl apply -f gitops/test-git-server/deployment.yaml          # creates the repository "config"
kubectl port-forward -n gitserver svc/git-server 8090:8080 &
git push http://localhost:8090/git/config.git main:main          # your branch becomes its main
# an Application whose repoURL is http://git-server.gitserver.svc.cluster.local:8080/git/config.git
```

After a push, `kubectl annotate application <name> -n argocd argocd.argoproj.io/refresh=hard --overwrite`
makes ArgoCD look at Git right away instead of waiting for the next poll.

## Exercises

- 4.7
