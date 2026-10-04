# Canary release of ping-pong (exercise 4.4)

A **canary release** gives a new version to a few pods first, watches how the system behaves, and only
then gives it to the rest. [Argo Rollouts](https://argo-rollouts.readthedocs.io/) adds a resource,
`Rollout`, that replaces the `Deployment` and has this strategy built in, and `AnalysisTemplate`, which
defines the test that decides if the new version is good.

| File | What it is |
| ---- | ---------- |
| [rollout.yaml](rollout.yaml) | The `Rollout` of ping-pong. It **replaces** `../manifests/deployment.yaml` (the pod template is the same): do not apply both. 4 replicas. |
| [analysistemplate.yaml](analysistemplate.yaml) | The `AnalysisTemplate` `namespace-cpu`: asks Prometheus for the CPU used by all the containers of the namespace. |

## How the release goes

When the image of the `Rollout` changes:

1. `setWeight: 25`: one of the four pods (25%) runs the new version, the other three the old one.
2. `pause: 30s`.
3. **analysis `namespace-cpu`**: 10 measurements, one every 30 s, so **5 minutes**. Each one asks Prometheus:

   ```
   scalar(sum(rate(container_cpu_usage_seconds_total{namespace="exercises", container!=""}[5m])))
   ```

   that is, the CPU rate summed over **every container of the namespace** (ping-pong, log-output and the
   database), averaged over 5 minutes. The measurement is good while `result < max-cpu-cores`.
   `failureLimit: 0`: **one measurement above the limit fails the analysis**.
4. If it passed: `setWeight: 50`, `pause: 30s`, and then all the pods are updated.
5. If it failed: the rollout is **aborted**, the new pods are removed and the pods that were running the old
   version stay as they are: **the application is not updated**.

## The limit

`max-cpu-cores` is an argument of the template, **0.05 cores (50 millicores)**. It was chosen by measuring:
with the query above, the namespace uses about **0.007 cores** when idle (ping-pong 0.0015, postgres 0.0036,
reader 0.0024, writer 0.00004). 0.05 is 7 times that: enough for the start of the new pods, but a version
that makes the CPU go up (a loop, a leak, a heavy query) would cross it. A limit too low blocks every
release, as the first test shows.

## What was tested

The new version is the same code built with another tag (`4.1` -> `4.4`): what is being tested is the
mechanism of the release, not the code. Both tests started from the 4 pods running `4.1`.

**A. A limit that is too low (0.001 cores, below the 0.007 of an idle namespace)**: the release does not go
through.

```
t+12s  phase=Progressing
t+23s  phase=Paused
t+49s  phase=Degraded   analysisrun ... Failed
RolloutAborted: Rollout aborted update to revision 2: Step-based analysis phase error/failed:
  Metric "namespace-cpu-usage" assessed Failed due to failed (1) > failureLimit (0)
```

and afterwards the 4 pods still run `wallas25/ping-pong:4.1`: no pod has the new version.

**B. The real limit (0.05 cores)**: the release goes through.

```
t+13s   Paused        pods: 4x 4.1, 1x 4.4        (25%)
t+38s   Progressing   pods: 3x 4.1, 1x 4.4        analysis Running (about 4.5 minutes)
t+310s  Progressing   pods: 3x 4.1, 2x 4.4        analysis Successful
t+349s  Progressing   pods: 2x 4.1 (stopping), 4x 4.4
t+361s  Healthy       all the pods on 4.4
```

## Install and use

Prometheus has to be there first, see [../../monitoring/README.md](../../monitoring/README.md#prometheus-exercises-43-and-44)
(the address in the template is the Service `prom-prometheus-server` of the namespace `prometheus`).
Argo Rollouts, version `v1.10.0`; its CRDs are big, so it is applied server side:

```bash
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts --server-side \
  -f https://github.com/argoproj/argo-rollouts/releases/download/v1.10.0/install.yaml
```

Then replace the Deployment by the Rollout:

```bash
kubectl apply -f analysistemplate.yaml -f rollout.yaml
kubectl delete deployment ping-pong-dep -n exercises     # once the rollout is Healthy
```

Release a new version by changing `image:` in `rollout.yaml` and applying it, and follow it:

```bash
kubectl get rollout ping-pong-dep -n exercises -w
kubectl get analysisrun -n exercises
kubectl get po -n exercises -l app=ping-pong -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image -w
```

(The `kubectl argo rollouts` plugin shows the same in a nicer way, but it is not needed.)

To try the failing case, add to the analysis step of the rollout an argument with a limit that is too low:

```yaml
        - analysis:
            templates:
              - templateName: namespace-cpu
            args:
              - name: max-cpu-cores
                value: "0.001"
```

An aborted rollout stays aborted for that version: to try again, go back to the previous image first
(or use `kubectl argo rollouts retry`).

## Exercises

- 4.4
