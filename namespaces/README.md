# namespaces

Namespaces used to keep the resources of the course separated (exercise 2.3).

| Namespace | Used for |
| --------- | -------- |
| `exercises` | `log_output` and `ping_pong`, and the rest of the exercises that are not the project. |

```bash
kubectl apply -f namespaces/exercises.yaml
```

Apply it before the applications. Resources of a namespace are listed with
`-n exercises`, for example `kubectl get all -n exercises`.
