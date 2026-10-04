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

## Deployment pipeline (exercise 3.6)

[../.github/workflows/project.yaml](../.github/workflows/project.yaml) deploys the project
to GKE every time something of the project is pushed to `main` (`todo_app/`,
`todo_backend/`, `todo_cronjob/`, `project/` or the workflow itself). The job:

1. authenticates to Google Cloud,
2. builds the three images and publishes them to **Google Artifact Registry**, tagged
   `<branch>-<commit sha>`:
   `us-central1-docker.pkg.dev/<project>/my-repository/<image>:main-<sha>`,
3. points the `images:` block of `project/gke/kustomization.yaml` to those images
   (`kustomize edit set image`) and applies it with `kustomize build | kubectl apply`,
4. waits for the rollouts of the database, the backend and the app.

`todo_app` has the deployment strategy `Recreate`: its volume is `ReadWriteOnce`, so only one
node can mount it, and the default `RollingUpdate` would start the new pod before the old one
released the disk (a Multi-Attach error on GKE).

### One environment per branch (exercise 3.7)

The pipeline runs for **every branch** (when something of the project changes) and deploys it
to its own environment, a namespace:

| Branch | Namespace |
| ------ | --------- |
| `main` | `project` |
| any other, for example `feature-x` | `feature-x` |

The branch names are assumed to be valid namespace names (lowercase letters, digits and `-`, at
most 63 characters). The job stops with an error message if the name is not valid, for example
`Feature_X` or `feat/x`.

What the job does for a branch that has no environment yet:

1. creates the namespace (`kustomize edit set namespace <name>` also moves every resource of the
   kustomization there, including the Gateway, the disks and the database);
2. creates the Secret `postgres-secret` with a **random password** generated in the job, never
   printed (`::add-mask::`) and never replaced afterwards, because the database was initialised
   with it;
3. deploys the images of that branch, tagged `<branch>-<commit sha>`;
4. waits for the rollout and prints the address of the new environment, also in the summary of
   the run: each environment has its **own Gateway, that is its own load balancer and IP**.

Pushes to the same branch are deployed one after the other (`concurrency`), never at the same time.

Every environment costs money (load balancer, two disks, a database): delete the ones that are
not needed, for example `kubectl delete namespace feature-x` (this removes everything inside,
including the disks).

To try it: create a branch, change something visible in `todo_app` and push it:

```bash
git switch -c feature-x
# edit todo_app/index.js ...
git commit -am "Try the environment of a branch" && git push -u origin feature-x
kubectl get all,gateway -n feature-x
```

### How the pipeline logs in (no keys are stored)

It uses **Workload Identity Federation**: the job asks GitHub for a short-lived token, Google
Cloud checks it and exchanges it for the credentials of a service account. Only this repository
is trusted. What was created in Google Cloud (project `PROJECT_ID`, number `PROJECT_NUMBER`):

```bash
# APIs and the Docker repository for the images (same region as the cluster)
gcloud services enable artifactregistry.googleapis.com iamcredentials.googleapis.com   sts.googleapis.com cloudresourcemanager.googleapis.com
gcloud artifacts repositories create my-repository --repository-format=docker --location=us-central1

# the identity the pipeline acts as, with the least permissions it needs:
# push images, and work with the objects inside the cluster (not manage the cluster)
gcloud iam service-accounts create github-actions-sa --display-name="GitHub Actions SA"
gcloud projects add-iam-policy-binding PROJECT_ID --role=roles/artifactregistry.writer   --member="serviceAccount:github-actions-sa@PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding PROJECT_ID --role=roles/container.developer   --member="serviceAccount:github-actions-sa@PROJECT_ID.iam.gserviceaccount.com"

# trust GitHub tokens, but only the ones of this repository
gcloud iam workload-identity-pools create github-pool --location=global
gcloud iam workload-identity-pools providers create-oidc github-provider --location=global   --workload-identity-pool=github-pool   --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository"   --attribute-condition="assertion.repository=='Walter25S/KubernetesSubmissions'"   --issuer-uri="https://token.actions.githubusercontent.com"

# allow that repository to act as the service account
gcloud iam service-accounts add-iam-policy-binding github-actions-sa@PROJECT_ID.iam.gserviceaccount.com   --role=roles/iam.workloadIdentityUser   --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/Walter25S/KubernetesSubmissions"
```

The pipeline pushes the images, but **the nodes of the cluster are the ones that pull them**,
and they run as the default Compute Engine service account, which in a new project has no
access to Artifact Registry. Without this the pods stay in `ImagePullBackOff` with
`403 Forbidden` in the events of the pod (`kubectl describe pod`). Give the nodes read-only
access to the repository (only that repository, not the whole project):

```bash
gcloud artifacts repositories add-iam-policy-binding my-repository --location=us-central1   --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com"   --role=roles/artifactregistry.reader
```

### GitHub secrets

In the repository: *Settings -> Secrets and variables -> Actions -> New repository secret*.
They are identifiers, not passwords, but the course keeps them as secrets:

| Secret | Value |
| ------ | ----- |
| `GKE_PROJECT` | the Google Cloud project ID |
| `SERVICE_ACCOUNT` | `github-actions-sa@PROJECT_ID.iam.gserviceaccount.com` |
| `WORKLOAD_IDENTITY_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |

The cluster name and zone (`dwk-cluster`, `us-central1-a`) are in the `env:` of the workflow;
change them if the cluster is created with other values. The cluster has to exist and the
database Secret has to be created by hand once (see above): the pipeline does not touch it.

Artifact Registry is not free: delete old images (`gcloud artifacts docker images delete ...`)
or the whole repository (`gcloud artifacts repositories delete my-repository --location=us-central1`)
when it is not needed.

## Remove it

```bash
kubectl delete -k project/gke
```

The Secret and the disks of the StatefulSet are not part of the kustomization:
`kubectl delete secret postgres-secret -n project` and
`kubectl delete pvc --all -n project`.

## Exercises

- 3.5 (Kustomize)
- 3.6 (deployment pipeline with GitHub Actions)
- 3.7 (one environment per branch)
