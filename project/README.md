# project

The course project (`todo_app`, `todo_backend`, its Postgres database and
`todo_cronjob`) deployed with [Kustomize](https://kustomize.io/) (exercise 3.5).
Kustomize is part of `kubectl`: instead of applying many files one by one, one command
applies everything in the right order (the Namespace first).

```
project/
  base/        what is the same everywhere: the namespace and the four parts
  gke/         Google Kubernetes Engine = base + what GKE needs (also used for the branches)
  production/  GKE + the daily database backup, used for the main branch (namespace "project")
  k3d/         local k3d cluster       = base + what k3d needs
../todo_app/kustomization.yaml       # each part has its own kustomization.yaml
../todo_backend/kustomization.yaml
../todo_cronjob/kustomization.yaml
../todo_backup/kustomization.yaml    # daily backup of the database to Cloud Storage (production only)
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

kubectl apply -k project/production        # production = project/gke + the database backup
kubectl get pods,pvc,gateway -n project     # the Gateway needs a few minutes to get its ADDRESS
```

Open `http://<ADDRESS>/` (the first minutes can answer 404/502 while the load balancer is
created).

### k3d

```bash
kubectl apply -k project/k3d      # after creating the Secret and the directory on the node, see ../volumes/README.md
```

## Resource requests and limits (exercise 3.11)

Every container of the project has `requests` and `limits`:

- the **request** is what the scheduler reserves for the container on a node: a pod only starts on a
  node that has that much free. It should be about what the container normally uses;
- the **limit** is the most it can use: above the CPU limit the container is slowed down, above the
  memory limit it is killed (`OOMKilled`). It should leave room for peaks.

The values were not guessed: they come from `kubectl top pods -n project` at rest and after sending
traffic to the page and the form:

| Container | Measured (CPU / memory) | Requests | Limits |
| --------- | ----------------------- | -------- | ------ |
| `todo-app` | 2-10m / 22-26Mi | 10m / 32Mi | 200m / 128Mi |
| `todo-backend` | 1-4m / 12Mi | 10m / 24Mi | 200m / 96Mi |
| `postgres` | 2-4m / 29Mi | 25m / 64Mi | 500m / 256Mi |
| `todo-cronjob` (the Wikipedia todo) | a few seconds a day | 5m / 24Mi | 100m / 96Mi |
| `todo-backup`: `dump` (`pg_dump`) | a few seconds a day | 10m / 32Mi | 200m / 256Mi |
| `todo-backup`: `upload` (`gcloud`) | a few seconds a day | 20m / 96Mi | 500m / 384Mi |

Why it matters here: the nodes are `e2-small` (about 940m of CPU and 1.3GiB of memory available to
pods) and GKE's own pods already use a large part of them (`kubectl describe node` showed 69-95% of
the CPU and 77-93% of the memory *requested*). The first values (50m/64Mi and 100m/128Mi for each
container) were 2 to 5 times above the real use, so a new environment barely fitted. With the measured
values an environment requests about 100m of CPU and 200Mi of memory.

Two namespace-level objects complete it ([base](base/)):

- **`LimitRange` `default-resources`**: a container that does not set its own values (a pod started
  with `kubectl run`, for example) gets `10m/32Mi` as request and `200m/128Mi` as limit.
- **`ResourceQuota` `environment-quota`**: the most one environment can ask for (250m CPU and 512Mi
  of memory in requests, 2 CPU and 1.5Gi in limits, 20 pods), so that the environment of a branch
  cannot take the whole cluster. It is about 3 times the normal use, which leaves room for the rolling
  update of the backend and for the backup job. If a deployment fails with `exceeded quota`, this is
  why: look at `kubectl describe resourcequota -n <namespace>`.

To measure again (needs the metrics server, which GKE has):

```bash
kubectl top pods -n project
kubectl describe resourcequota environment-quota -n project   # used / hard
kubectl describe node <node> | grep -A8 "Allocated resources"
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

### The database backup (exercise 3.10)

Production (`main`) also has [../todo_backup](../todo_backup/README.md): a CronJob that saves a
`pg_dump` of the database in Google Cloud Storage every 24 hours, authenticated with Workload
Identity (no key). The pipeline deploys `project/production` for `main` and `project/gke` for the
other branches, whose environments do not have the backup.

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

The branch named `project` is rejected, because its environment would be the one of `main`.

Every environment costs money (load balancer, two disks, a database), so they are deleted
automatically when the branch is deleted (exercise 3.8, below).

### Deleting a branch deletes its environment (exercise 3.8)

[../.github/workflows/delete-environment.yaml](../.github/workflows/delete-environment.yaml) runs
when a branch is deleted (the `delete` event) and removes the namespace of that branch with
everything in it: pods, database, disks and the Gateway with its load balancer.

```bash
git push origin --delete feature-x        # or "Delete branch" in GitHub after merging a pull request
```

Things to know:

- **Only namespaces created by the pipeline are deleted.** The pipeline puts the label
  `app.kubernetes.io/managed-by=project-pipeline` on every namespace it creates, and the delete
  workflow refuses to touch a namespace without it. Without this check, deleting a branch called
  `exercises`, `default` or `kube-system` would destroy those namespaces. A namespace created by
  an older version of the pipeline has no label: label it by hand to let the workflow delete it,
  or delete it with `kubectl delete namespace <name>`.
- **`main` / `project` is never deleted** by the workflow.
- GitHub runs the workflows of the `delete` event from the **default branch** (the deleted branch
  does not exist any more), so the file has to be in `main` to work.
- The images in Artifact Registry are not deleted (the pipeline's service account can write but
  not delete images). Clean them from time to time, see the end of the pipeline section.
- The `delete` event is also sent for tags; the job only runs for branches.

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

## DBaaS vs DIY: Cloud SQL or our own Postgres? (exercise 3.9)

The todos need a database. There are two ways to run Postgres on Google Cloud:

- **DBaaS (Database as a Service)**: *Cloud SQL for PostgreSQL*. Google runs the database and we
  only use it.
- **DIY (do it yourself)**: what this project does: a Postgres container in a StatefulSet in the
  cluster, with a PersistentVolumeClaim; GKE creates the disk (see `project/gke/`).

### Comparison

| | DBaaS (Cloud SQL) | DIY (StatefulSet + PVC) |
| --- | --- | --- |
| **Work to start** | Create the instance (one command or a few clicks), create the database and the user, and decide how the pods connect: private IP (VPC peering / Private Service Connect) or the *Cloud SQL Auth Proxy* as a sidecar, which also needs an IAM service account. Little YAML, but cloud networking and IAM to learn. | Already done here: a StatefulSet, a headless Service and a Secret (~80 lines of YAML), no cloud-specific setup. Needs care with the details: `fsGroup`/permissions of the disk, storage class, an init/readiness strategy and a good password handling. |
| **Cost to start** | A running instance from the first minute. Published prices (us-central1, order of magnitude): `db-f1-micro` about $7.7/month, `db-g1-small` about $25.6/month, SSD storage about $0.17/GB-month, and **high availability doubles** instance and storage. Realistic minimum: ~$9/month, ~$18+/month with HA. Backup storage is billed apart. | Almost free: a 1Gi disk costs cents per month and the CPU/memory (`100m` / `128Mi` requested) comes out of nodes that are already paid for. But it is *not* zero: if the database needs more memory, it is the nodes that grow. |
| **Maintenance** | Google applies minor-version and OS patches in a maintenance window, monitors the instance, replaces failed hardware and can fail over automatically with HA. Major-version upgrades are a guided operation. The team does not need Postgres operations skills. | All on us: choosing and updating the image (`postgres:16-alpine`), minor and major upgrades (a major upgrade means dump/restore or `pg_upgrade`), tuning (`shared_buffers`, connections), disk resizing, monitoring and alerts. Without an operator there is **no automatic failover**: one replica, and if the node dies the pod waits to be rescheduled (minutes of downtime). |
| **High availability** | A checkbox (regional instance, standby in another zone, automatic failover in about a minute). | Possible but hard: replication, failover, split-brain. In practice needs a Postgres operator (CloudNativePG, Zalando, Crunchy) which is one more thing to maintain. |
| **Backups** | Automated daily backups with retention, **point-in-time recovery** (restore to any second in the window) and on-demand backups, included in the product. | Not included: we build it. Exercise 3.10 does a `pg_dump` every 24 h to Cloud Storage: a *logical* backup, ok for small data but with up to 24 h of data loss (RPO) and the dump gets slower as the data grows. Point-in-time recovery needs WAL archiving (pgBackRest, WAL-G, an operator). Disk snapshots (`VolumeSnapshot`) are an alternative, crash-consistent only. |
| **Restoring** | Console or `gcloud sql backups restore`: restore in place or to a new instance. Rehearsed by the provider. | Manual: download the dump and `psql < dump.sql` into a fresh database. Simple, but it is on us to write it down and **test it** from time to time; an untested backup is not a backup. |
| **Scaling** | Change the machine type (a short restart) and add read replicas with a command; storage grows automatically if enabled. | Vertical scaling means editing requests/limits and the PVC (online expansion depends on the storage class); reads replicas need replication set up by hand. |
| **Security** | Encryption at rest and in transit by default, IAM-based access, automatic OS patching, audit logs; the database is not in the same blast radius as the application. | We secure it: Secret handling, NetworkPolicies, encryption of the disk is on by default in GKE, but patching the image is on us. The database runs on the same nodes as the application. |
| **Portability** | Postgres-compatible, but the surroundings (Auth Proxy, IAM, backups, flags) are Google-specific: leaving costs a migration. | Runs the same on k3d, GKE or any cluster; what we develop locally is what runs in production. |
| **Performance / control** | Some superuser features and extensions are restricted; the instance is a separate machine reached over the network. | Full control (any extension, any setting) and the lowest latency (same cluster), but the database competes with the apps for the resources of the node. |

### Conclusion

- For a **course project, a prototype or a small internal tool** with data that can be rebuilt, DIY is
  the sensible choice: it is cheap, simple, portable and teaches how storage works in Kubernetes.
  That is why this project uses it.
- For a **production service where the data matters** (the todos of real users), I would choose
  Cloud SQL: what we would pay for is mostly *not having to do* backups with point-in-time recovery,
  patching and failover, and that costs less than the engineer-hours needed to do it well and to be
  woken up when it breaks. If we stay with DIY in production, the minimum is: tested restores,
  more frequent backups than daily, a second replica or an operator, and alerts.
- The deciding factors are the value of the data, how much data loss and downtime are acceptable
  (RPO/RTO), and whether the team has Postgres operations skills.

Prices change: check the [Cloud SQL pricing](https://cloud.google.com/sql/docs/postgres/pricing)
page and the [pricing calculator](https://cloud.google.com/products/calculator) before deciding.
The figures above are the published list prices for us-central1 when this was written
(Cloud SQL `db-f1-micro` $0.0105/hour, `db-g1-small` $0.035/hour, SSD storage $0.000232877 per
GiB-hour; HA doubles them), and do not include network, backup storage or discounts. The
shared-core machine types are not covered by the Cloud SQL SLA.

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
- 3.8 (deleting a branch deletes its environment)
- 3.9 (DBaaS vs DIY comparison)
- 3.10 (database backup, see ../todo_backup)
- 3.11 (resource requests and limits, LimitRange and ResourceQuota)
