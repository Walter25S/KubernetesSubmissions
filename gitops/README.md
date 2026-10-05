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

> **Two repositories (exercise 4.10).** In exercises 4.7 to 4.9 the code and the configuration were in this repository
> (`log_output/kustomization.yaml`, `gitops/base`, `gitops/overlays`, `argocd/`). In 4.10 the configuration moved to its own
> repository, [`KubernetesSubmissions-config`](https://github.com/Walter25S/KubernetesSubmissions-config), whose files are in
> the folder [../config-repo](../config-repo/README.md) until it is published, and the files that were in this repository were
> removed so that there is only one source of truth. The sections of 4.7, 4.8 and 4.9 below describe how it works and what was
> tested; read the paths in them as being in the configuration repository, and see the section of 4.10 for the final layout.
> The releases `4.7`, `4.8` and `4.9` keep the layout of their time.

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

## Exercise 4.8: the project with GitOps

The same idea for the project (`todo_app`, `todo_backend`, `todo_cronjob`, the database and the `broadcaster`):

| File | What it is |
| ---- | ---------- |
| [../project/k3d/kustomization.yaml](../project/k3d/kustomization.yaml) | What ArgoCD deploys: the local environment of the project ([../project/README.md](../project/README.md)). Its `images:` block holds the tags of the four images that run. |
| [../argocd/project.yaml](../argocd/project.yaml) | The `Application`: watches `project/k3d` in the **main branch** and keeps the namespace `project` of the local cluster equal to it (automatic sync, `prune`, `selfHeal`). |
| [../.github/workflows/project-gitops.yaml](../.github/workflows/project-gitops.yaml) | The CI: when the code of one of the four images changes on `main`, it builds the four images with the commit SHA as tag, pushes them to Docker Hub, runs `kustomize edit set image` and commits `project/k3d/kustomization.yaml`. |

The old workflow that pushed to GKE ([../.github/workflows/project.yaml](../.github/workflows/project.yaml), exercises 3.6
and 3.7) now only runs by hand (*Run workflow* in the Actions tab), so a push of code is deployed one way, GitOps, and
not two. It is still there for the GKE cluster, which is not managed by ArgoCD.

**The Secrets are not in Git.** The password of the database (`postgres-secret`) and the URL of the chat service
(`broadcaster-webhook`) are created in the cluster by hand ([../broadcaster/README.md](../broadcaster/README.md)); ArgoCD does
not know them, so it neither creates nor deletes them. Everything it does not manage is left alone by `prune`
too (for example the `webhook-receiver` that was started for testing).

Tested in the k3d cluster with the test Git server (below): the `Application` took over the namespace `project`,
which had been deployed by hand, and it was `Synced` / `Healthy`. Then a commit that changes the four tags (what the CI
does) replaced the four workloads with the new images, and the `broadcaster`, which had been scaled by hand to 6
replicas, went back to the 1 of Git (`selfHeal`).

## Exercise 4.9: staging and production

Two environments of the project, each in its own namespace of the local cluster (`staging` and `production`), built
from the same base with an overlay each:

```
gitops/
  base/                   the project for one namespace (reuses project/base, broadcaster, ...) + volume + Ingress
  overlays/
    staging/              namespace staging,    host staging.localhost
    production/           namespace production, host production.localhost, + the daily backup
../argocd/
  project-staging.yaml        follows the branch main
  project-production.yaml     follows the branch production
```

| | staging | production |
| --- | --- | --- |
| Namespace / address | `staging` / http://staging.localhost:8081 | `production` / http://production.localhost:8081 |
| Deployed when | **every commit to `main`** | **a tagged commit** (`v*`) |
| ArgoCD follows | the branch `main` | the branch `production` |
| Broadcaster | **only logs** the messages (`MESSAGE_FORMAT: log`), it does not forward them | forwards them to the chat service (`generic`; the URL is in the Secret `broadcaster-webhook`) |
| Database backup | **none** | a CronJob every 24 h ([../todo_backup/local](../todo_backup/local/)) that saves a `pg_dump` in a volume, keeping 7 days |
| NATS subject | `todos.staging` | `todos.production` |

The NATS subject is different so that a todo created in staging never reaches the broadcaster of production
(both environments use the same NATS server). Hosts: the Ingress of each environment has its own name, so both share the
port 8081 of k3d (the browser and `curl` resolve `*.localhost` to the own machine).

**How the two deployments are triggered.** Neither workflow deploys anything: they write the image tags in Git.

- [../.github/workflows/gitops-staging.yaml](../.github/workflows/gitops-staging.yaml): on a push to `main` that changes code,
  builds the four images tagged with the commit SHA, runs `kustomize edit set image` in `overlays/staging` and commits it to
  `main`. ArgoCD follows `main`, so it deploys it. A commit that only changes manifests needs no workflow: ArgoCD sees it.
- [../.github/workflows/gitops-production.yaml](../.github/workflows/gitops-production.yaml): when a tag `v*` is pushed
  (`git tag v1.0.0 && git push origin v1.0.0`), builds the four images from the tagged commit tagged `v1.0.0`, and then sets the
  branch **`production`** to *the tagged commit + one commit* that writes those tags in `overlays/production`. ArgoCD follows that branch.

**Why a `production` branch.** If production followed `main`, a commit without a tag that changes a manifest (replicas, a
ConfigMap) would reach production at once, which is exactly what the exercise forbids. With a separate branch that only the
tag workflow moves, production changes **only on a tag**, and it gets the manifests of the tagged commit, not those of `main`.
The branch is rebuilt in every release, so it is pushed with `--force`. Create it once before the first tag:
`git push origin main:refs/heads/production`.

**Secrets (outside ArgoCD, as the exercise allows).** Before ArgoCD syncs an environment, its namespace must have the
Secrets; ArgoCD creates the namespace by itself, but creating it first lets you put the Secrets in it:

```bash
for ns in staging production; do
  kubectl create namespace $ns
  kubectl create secret generic postgres-secret -n $ns --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 16)"
done
# production only: where the broadcaster sends the messages (a Discord/Slack webhook, or the fake chat service
# of ../broadcaster/test-receiver started in the namespace production)
kubectl create secret generic broadcaster-webhook -n production --from-literal=WEBHOOK_URL='https://discord.com/api/webhooks/<id>/<token>'
```

Then:

```bash
kubectl apply -n argocd --server-side --force-conflicts -f argocd/argocd-cm-pvc-health.yaml   # see below, once
kubectl apply -n argocd -f argocd/project-staging.yaml -f argocd/project-production.yaml
```

**A volume that stays `Pending` is normal here.** The claim of the backup of production is used only by the CronJob, once a
day, and the storage of k3s (`local-path`) creates the volume when a pod first uses it. ArgoCD reads a `Pending` claim as
"not ready" and the application would stay `Progressing` for ever.
[../argocd/argocd-cm-pvc-health.yaml](../argocd/argocd-cm-pvc-health.yaml) teaches ArgoCD that `Pending` is fine for claims.
(Applying it also showed that the file must keep the labels of `argocd-cm`, or the controller fails with "configmap
argocd-cm not found"; they are in the file.)

### Tested

In the k3d cluster with the test Git server (below), simulating what the workflows do:

| Check | Result |
| ----- | ------ |
| Both applications | `Synced` / `Healthy`, each in its namespace, with its own database and volume |
| Todo created in staging | the broadcaster of staging only logged `Message (not forwarded)`; the chat of production got nothing |
| Todo created in production | the chat got `{"user":"bot","message":"A todo was created: ..."}`; staging saw nothing |
| Backup | only production has the `todo-backup` CronJob and its volume; a run saved a dump with the todo of production |
| Names | `staging.localhost` and `production.localhost` show their own todos |
| **A commit to `main`** (new tags for staging and the backend with 2 replicas in the manifests) | staging took the new images and the 2 replicas; **production did not change** (`production` at its old commit) |
| **The tag** (the `production` branch moved to the tagged commit + the tags) | production took the images `v1.0.0` and the 2 replicas of the tagged commit |

## Exercise 4.10: code and configuration in different repositories

| Repository | What it has | Who writes to it |
| ---------- | ----------- | ---------------- |
| **[KubernetesSubmissions](https://github.com/Walter25S/KubernetesSubmissions)** (code) | the source of the applications, their Dockerfiles, the CI workflows | people |
| **[KubernetesSubmissions-config](https://github.com/Walter25S/KubernetesSubmissions-config)** (configuration) | the manifests, the overlays of staging and production, the ArgoCD `Application`s | people (to change the configuration) and the CI (the image tags) |

The files of the configuration repository are in [../config-repo](../config-repo/README.md) (create the repository in GitHub and
publish that folder as its root, the steps are in its README). ArgoCD follows **that** repository:

```
 code repository                                    configuration repository                cluster
 push to main  -> gitops-staging.yaml      ->       commit in overlays/staging (main)   ->  ArgoCD -> staging
 tag v1.0.0    -> gitops-production.yaml   ->       branch production = main + tags     ->  ArgoCD -> production
 push (log_output) -> log-output.yaml      ->       commit in log-output (main)         ->  ArgoCD -> exercises
```

What changed in the three workflows of this repository ([gitops-staging](../.github/workflows/gitops-staging.yaml),
[gitops-production](../.github/workflows/gitops-production.yaml), [log-output](../.github/workflows/log-output.yaml)):

- they only **read** this repository (`permissions: contents: read`): they no longer commit to it;
- after building and publishing the images they check out the **configuration repository** with the token `CONFIG_REPO_TOKEN`,
  run `kustomize edit set image` in the overlay and commit there (`main` for staging and Log output, the branch `production`
  for a tag). `GITHUB_TOKEN` only reaches the repository of the workflow, so a token for the other one is needed.
  A commit pushed with a personal token **does** start the workflows of the other repository, but that one has none, so there
  is no loop.

Moved to the configuration repository and removed from this one: `gitops/base`, `gitops/overlays`, `argocd/`,
`log_output/kustomization.yaml` and `todo_backup/local` (the version of the backup for a cluster that is not GKE). The manifests of
each application are still in its own folder here (for local use, the GKE pipeline and the history of the exercises), but what
**ArgoCD deploys** is in the configuration repository.

### What you have to do (manual, once)

1. Create the repository `KubernetesSubmissions-config` in GitHub and publish [../config-repo](../config-repo/README.md) in it
   (also the branch `production`).
2. Create a fine-grained token with *Contents: Read and write* on **that repository only** and save it in **this** repository as
   the secret `CONFIG_REPO_TOKEN`. (Together with `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, see above.)
3. Point ArgoCD to it: `kubectl apply -n argocd -f config-repo/argocd/project-staging.yaml -f config-repo/argocd/project-production.yaml -f config-repo/argocd/log-output.yaml`.

### Tested

In the k3d cluster with the test Git server, which has two repositories, `code` and `config` (the configuration repository
was created from [../config-repo](../config-repo/) as an independent repository with its own history):

| Check | Result |
| ----- | ------ |
| What is deployed from the configuration repository, compared with what the single repository deployed | the manifests rendered with `kustomize` are **identical** (staging, production and Log output) |
| The three ArgoCD applications re-pointed to the configuration repository | `Synced` / `Healthy` with no change in the cluster |
| The CI of the code repository releases to staging (a commit in the configuration repository, branch `main`) | staging changed its images; **production did not** |
| The CI of the code repository releases a tag (the branch `production` of the configuration repository) | production changed its images |
| The code repository during all that | **no commit**: its head did not move |

## Test Git server

[test-git-server](test-git-server/) is a Git server (nginx + `git-http-backend`, no authentication, only for
tests) that runs in the cluster. It lets you try GitOps without pushing to GitHub: ArgoCD pulls from it and you
play the role of the CI by committing to it.

```bash
docker build -t wallas25/git-server:test gitops/test-git-server && k3d image import wallas25/git-server:test
kubectl apply -f gitops/test-git-server/deployment.yaml          # creates the repositories "code" and "config"
kubectl port-forward -n gitserver svc/git-server 8090:8080 &
git push http://localhost:8090/git/config.git main:main          # your branch becomes its main
# an Application whose repoURL is http://git-server.gitserver.svc.cluster.local:8080/git/config.git
```

After a push, `kubectl annotate application <name> -n argocd argocd.argoproj.io/refresh=hard --overwrite`
makes ArgoCD look at Git right away instead of waiting for the next poll.

## Exercises

- 4.7
- 4.8 (first version, only `main`; replaced by the two environments of 4.9)
- 4.9
- 4.10
