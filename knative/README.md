# Knative: serverless on Kubernetes

Exercises 5.6 and 5.7. **Knative Serving** turns a container image into a *Service* that has HTTP routing, a revision history, traffic
splitting and an autoscaler that goes **from zero to many pods and back to zero**. One object (`serving.knative.dev/v1 Service`)
replaces the Deployment, the Service and the Ingress of a normal app.

| File | What it is |
| ---- | ---------- |
| [install-knative.sh](install-knative.sh) | Creates the k3d cluster `knative` and installs Knative Serving 1.23 with Kourier and Magic DNS |
| [manifests/hello.yaml](manifests/hello.yaml) | The first service of the guide |
| [manifests/hello-split.yaml](manifests/hello-split.yaml) | A new revision and the 50 / 50 traffic split |
| [manifests/autoscale-go.yaml](manifests/autoscale-go.yaml) | The autoscaling example |
| [manifests/ping-pong-ksvc.yaml](manifests/ping-pong-ksvc.yaml) and [manifests/exercises.yaml](manifests/exercises.yaml) | Ping-pong as a Knative Service, and the Log output app that uses it (5.7) |

## Install

As the exercise says, the cluster is created **without Traefik** (Kourier is the network layer of Knative) and with Kubernetes 1.34:

```bash
./install-knative.sh
# which is, in short:
k3d cluster create knative --port 8082:30080@agent:0 -p 8081:80@loadbalancer --agents 2 \
   --k3s-arg "--disable=traefik@server:0" --image rancher/k3s:v1.34.1-k3s1
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.23.0/serving-crds.yaml
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.23.0/serving-core.yaml
kubectl apply -f https://github.com/knative-extensions/net-kourier/releases/download/knative-v1.23.0/kourier.yaml
kubectl patch configmap/config-network -n knative-serving --type merge \
   --patch '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev"}}'
kubectl apply -f https://github.com/knative/serving/releases/download/knative-v1.23.0/serving-default-domain.yaml   # Magic DNS
```

Magic DNS (sslip.io) names the services `<service>.<namespace>.<ip>.sslip.io`, and that name resolves to `<ip>`. Here the IP is the one of
Kourier in the k3d network (`kubectl -n kourier-system get svc kourier`), which gave the domain **`172.19.0.2.sslip.io`**. From the host the cluster
is reached through the port 8081, so the requests are sent with the `Host` header of the service, as the exercise says:

```bash
curl -H "Host: hello.default.172.19.0.2.sslip.io" http://localhost:8081
```

> The exercise warns that the pods of `knative-serving` may end up in `CrashLoopBackOff` and that the logs say how to fix it. It did **not** happen
> in this installation (Docker Desktop with WSL 2, k3s 1.34.1 and Knative 1.23): the `activator` was `0/1` for a few seconds while it started, and
> the Job `default-domain` failed once because the webhook was not ready and was retried by itself, completing in the second pod.

## What was tried (the three examples of the guide)

**Deploying a Knative Service** ([hello.yaml](manifests/hello.yaml)):

```
$ kubectl get ksvc
NAME    URL                                        LATESTCREATED   LATESTREADY   READY
hello   http://hello.default.172.19.0.2.sslip.io   hello-00001     hello-00001   True

$ curl -H "Host: hello.default.172.19.0.2.sslip.io" http://localhost:8081
Hello World!
```

Knative created, from that one object, the *Revision* `hello-00001`, its Deployment and the pod, which has **two** containers (`2/2`): the application and
the `queue-proxy` of Knative, which counts the concurrent requests for the autoscaler.

**Scale to zero**: with no requests the pod of `hello` disappeared after **88 seconds** (`0` pods; the service is still there). The first request after that
wakes it up, the activator holds the request while the pod starts:

```
first request:  HTTP 200 in 3.198 s     <- cold start
second request: HTTP 200 in 0.018 s
```

**Traffic splitting** ([hello-split.yaml](manifests/hello-split.yaml)): changing `TARGET` creates the revision `hello-00002`; `traffic:` splits between both:

```
$ kubectl get ksvc hello -o jsonpath='{.status.traffic[*]}'      hello-00001 = 50 %   hello-00002 = 50 %
100 requests:   58 Hello World!    42 Hello Knative!
```

**Autoscaling** ([autoscale-go.yaml](manifests/autoscale-go.yaml), target of 10 concurrent requests for each pod, at most 6): 40 requests at the same time, each one lasting a second:

```
no load        : 1 pod
under the load : 3 pods      (the autoscaler adds pods when there are more than 10 requests in flight for each one)
load stopped   : 3 pods for about 60 seconds, then 0
```

## Exercise 5.7: Deploy to serverless

The ping-pong service of the Log output app runs as a **Knative Service** ([ping-pong-ksvc.yaml](manifests/ping-pong-ksvc.yaml)): the Deployment, the Service and the
(Ingress) of the app are replaced by that one object, and Knative scales it. The app is stateless (the counter is in Postgres), which is what Knative asks of an app.

```
Log output (Deployment) --http://ping-pong.exercises.svc.cluster.local/pings--> ping-pong (Knative Service, 0..3 pods) --> Postgres (StatefulSet)
```

| File | What it has |
| ---- | ----------- |
| [manifests/exercises.yaml](manifests/exercises.yaml) | The namespace `exercises`, the database, and Log output (writer + reader) |
| [manifests/ping-pong-ksvc.yaml](manifests/ping-pong-ksvc.yaml) | The Knative Service: `max-scale: 3`, and scale to zero (the default) |

Things that are different from a normal Deployment:

- **The address.** A Knative Service `ping-pong` in the namespace `exercises` is reached inside the cluster as `http://ping-pong.exercises.svc.cluster.local`
  (the **fully qualified** name, as the tip of the exercise says; the port is the 80, not the 2346 of the old Service) and from outside as
  `ping-pong.exercises.172.19.0.2.sslip.io`. Log output only changed its `PINGPONG_URL`.
- **No readiness probe in Log output.** The one of the exercise 4.1 calls ping-pong every 5 seconds, which would keep it awake and it would never scale to zero.
- **The image.** Knative turns the tag of an image into a digest by asking its registry, which a local image does not have. The name `dev.local/ping-pong:4.1`
  is one that Knative does not try to resolve, so the image of 4.1 is tagged with it and imported into the cluster
  (`docker tag wallas25/ping-pong:4.1 dev.local/ping-pong:4.1` and `k3d image import ... -c knative`). With the image in a registry, use its real name.

```bash
kubectl apply -f manifests/exercises.yaml
kubectl -n exercises create secret generic postgres-secret --from-literal=POSTGRES_PASSWORD=<a password>
kubectl apply -f manifests/ping-pong-ksvc.yaml
kubectl -n exercises get ksvc
kubectl -n exercises port-forward svc/log-output-svc 8095:2345          # http://localhost:8095
curl -H "Host: ping-pong.exercises.172.19.0.2.sslip.io" http://localhost:8081/      # ping-pong from outside, through Kourier
```

### Tested

```
$ kubectl -n exercises get ksvc
NAME        URL                                              LATESTCREATED     LATESTREADY       READY
ping-pong   http://ping-pong.exercises.172.19.0.2.sslip.io   ping-pong-00001   ping-pong-00001   True

$ curl -H "Host: ping-pong.exercises.172.19.0.2.sslip.io" http://localhost:8081/        # three times
pong 0   pong 1   pong 2

$ curl localhost:8095/                                         # Log output, calling ping-pong by its cluster name
file content: this text is from file
env variable: MESSAGE=hello world
2026-10-05T11:32:48.940Z: 8bbacf03-95ad-4fcb-820b-65f9401fecb1.
Ping / Pongs: 3
```

**Scale to zero and back**: with nobody calling it, the pod of ping-pong went away (about three minutes: the window of the autoscaler plus the time the pod takes to stop;
Log output and Postgres kept running). Opening the page of Log output, which calls it, woke it up: the answer took **3.1 s** (cold start), and the counter was
still `3`, because it is in the database and not in the pod.
