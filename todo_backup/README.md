# todo_backup

CronJob that makes a backup of the todo database **once per 24 hours** and saves it in
**Google Cloud Storage** (exercise 3.10). It is deployed in production only (namespace `project`,
see [../project/production](../project/production/kustomization.yaml)); the environments of the
branches do not have it.

## How it works

[manifests/cronjob.yaml](manifests/cronjob.yaml) runs every day at 03:00 UTC. The pod has two steps
that share an `emptyDir` volume:

1. **`dump`** (init container, `postgres:16-alpine`): `pg_dump` of the database through the
   headless Service, compressed with `gzip` into `/backup/todos.sql.gz`. The connection data comes from
   the ConfigMap and the Secret of the backend (`PGHOST`, `PGDATABASE`, ... and `PGPASSWORD`).
2. **`upload`** (`google/cloud-sdk:alpine`): gets an access token with `gcloud auth print-access-token`
   and uploads the file to `gs://project-cbd387a3-todo-backups/todos-<date>.sql.gz` with the JSON
   API of Cloud Storage (`curl`). `gcloud storage cp` is not used on purpose: it also needs the
   permission to *read* objects (to check if the object exists), and the service account is
   only allowed to *create* them. This way a compromised backup pod can neither read nor delete
   the backups.

No custom image is needed: the Postgres 16 client matches the server and the Google image has
`gcloud`.

## How the pod is allowed to write to the bucket (no key is stored)

The recommended way: **Workload Identity**. The pod runs as a Kubernetes service account
(`todo-backup`) that is linked to a Google service account (`todo-backup-sa`); Google Cloud gives the
pod short-lived credentials for it. There is **no JSON key** anywhere, so there is nothing to leak,
rotate or keep out of GitHub.

The course also describes a simpler way (create a key for a service account and keep it in a
Secret). It was not possible here: new Google Cloud projects have the organization policy
`iam.disableServiceAccountKeyCreation` enforced, which forbids creating keys. It is the safer
default, and Workload Identity does not need to bypass it.

What was set up (project `PROJECT_ID`, cluster `dwk-cluster`, zone `us-central1-a`):

```bash
# 1. a private bucket; backups older than 30 days are deleted (storage costs money)
gcloud storage buckets create gs://BUCKET --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' > lifecycle.json
gcloud storage buckets update gs://BUCKET --lifecycle-file=lifecycle.json

# 2. the Google service account, allowed ONLY to create objects in THIS bucket
#    (it can not read, list or delete the backups)
gcloud iam service-accounts create todo-backup-sa --display-name="Todo database backup"
gcloud storage buckets add-iam-policy-binding gs://BUCKET \
  --member="serviceAccount:todo-backup-sa@PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/storage.objectCreator

# 3. Workload Identity in the cluster (once). The second command recreates the nodes one by one
gcloud container clusters update dwk-cluster --zone=us-central1-a \
  --workload-pool=PROJECT_ID.svc.id.goog
gcloud container node-pools update default-pool --cluster=dwk-cluster --zone=us-central1-a \
  --workload-metadata=GKE_METADATA

# 4. let the Kubernetes service account "todo-backup" of the namespace "project" act as it
gcloud iam service-accounts add-iam-policy-binding \
  todo-backup-sa@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:PROJECT_ID.svc.id.goog[project/todo-backup]"
```

The Kubernetes side is `manifests/serviceaccount.yaml`, whose annotation
`iam.gke.io/gcp-service-account` names the Google service account.

## Use it

```bash
kubectl apply -k ../project/production     # or: kubectl apply -k .   (only the backup)
kubectl get cronjob todo-backup -n project

# make a backup now instead of waiting for 03:00 and read the result
kubectl create job --from=cronjob/todo-backup backup-now -n project
kubectl logs -n project job/backup-now -c upload
kubectl delete job backup-now -n project

# see and download the backups (with your own Google account, which can read the bucket)
gcloud storage ls -l gs://BUCKET
gcloud storage cp gs://BUCKET/todos-<date>.sql.gz .
```

They can also be seen in the Google Cloud Console: *Cloud Storage -> Buckets -> the bucket*.

### Restoring a backup

```bash
gcloud storage cp gs://BUCKET/todos-<date>.sql.gz .
gunzip -c todos-<date>.sql.gz | kubectl exec -i -n project postgres-stset-0 -- \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

The dump is made with `--clean --if-exists`, so it replaces the tables it contains. A backup
that was never restored is not a backup: try this from time to time.

## Exercises

- 3.10
