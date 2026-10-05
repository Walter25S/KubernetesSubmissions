# KubernetesSubmissions-config

The **configuration** of the DevOps with Kubernetes project: what runs in the cluster. The **code** (the
applications, their Dockerfiles and the CI workflows) is in another repository,
[KubernetesSubmissions](https://github.com/Walter25S/KubernetesSubmissions) (exercise 4.10).

Why two repositories:

- **Who can change what.** The code needs reviews and tests; a change of the configuration (replicas, a limit, an
  address) should not need a new image, and a new image should not need to touch the configuration.
- **No loop of commits.** In one repository, the CI commits the new image tag next to the code, and that commit has to be
  told apart from a change of the code. Here the CI only writes to this repository.
- **The cluster follows only this repository**, so what ArgoCD reads is exactly what is deployed, with a clean history of
  who changed what and when (`git log` here is the history of the cluster).

```
base/                  the project for one namespace: the manifests of the four applications, the volume and the Ingress
  backup-local/        the daily backup of the database (only production uses it)
overlays/
  staging/             namespace staging,    host staging.localhost
  production/          namespace production, host production.localhost, + the backup
log-output/            the "Log output" application (namespace exercises)
argocd/                the ArgoCD Applications that point to this repository
```

## How it works

```
 code repository                                  this repository                        cluster
 ---------------                                  ---------------                        -------
 push to main  -> workflow gitops-staging    ->    commit in overlays/staging (main)  ->  ArgoCD -> staging
 tag v1.0.0    -> workflow gitops-production ->    branch "production" (main + tags)  ->  ArgoCD -> production
 push (log_output) -> workflow log-output    ->    commit in log-output (main)        ->  ArgoCD -> exercises
```

The workflows of the code repository build the images, publish them to Docker Hub and write the new tags in this repository with
`kustomize edit set image`. Nobody commits to the overlays by hand except to change something other than the images.

- **staging** follows the branch `main`: every commit to it is deployed. The broadcaster only logs the messages
  and there is no database backup.
- **production** follows the branch **`production`**, which only the tag workflow moves: it is `main` at that moment plus
  one commit with the image tags (so production gets the manifests that were tested in staging, and only when a tag is
  pushed). The branch is rebuilt in every release (pushed with `--force`).

## Set it up (once)

1. **Create this repository** in GitHub (`Walter25S/KubernetesSubmissions-config`, public, empty) and publish this folder as its
   root, with the branch `production` too:

   ```bash
   cd config-repo                       # the folder of the code repository that has these files
   git init -b main && git add -A && git commit -m "Initial configuration of the project"
   git remote add origin https://github.com/Walter25S/KubernetesSubmissions-config.git
   git push -u origin main
   git push origin main:refs/heads/production
   ```

2. **Let the code repository write here.** The `GITHUB_TOKEN` of a workflow only reaches its own repository, so a token for this
   one is needed: create a *fine-grained personal access token* (GitHub -> Settings -> Developer settings -> Personal access
   tokens -> Fine-grained tokens) that belongs to `Walter25S`, with access to **only this repository** and the permission
   *Contents: Read and write*. Save it in the **code** repository as the secret `CONFIG_REPO_TOKEN`
   (*Settings -> Secrets and variables -> Actions*). The secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are needed there too.

3. **The Secrets of the cluster are not in either repository** (the password of the database, the URL of the chat service):
   they are created by hand, see the code repository, `gitops/README.md`.

4. **Tell ArgoCD** to follow this repository (the ArgoCD of the local cluster, see the code repository):

   ```bash
   kubectl apply -n argocd --server-side --force-conflicts -f argocd/argocd-cm-pvc-health.yaml   # once
   kubectl apply -n argocd -f argocd/project-staging.yaml -f argocd/project-production.yaml -f argocd/log-output.yaml
   ```

## Changing the configuration

Edit a manifest in `base/` (it reaches **staging** at once and **production** with the next tag) or an overlay (only that environment),
commit and push: ArgoCD applies it. To undo a change, `git revert` it.

To see what an environment will be, without applying anything: `kubectl kustomize overlays/staging`.
