# @mete/security

Policy engine, permissions, secret masking, audit log.

Modules: security

`policy.check@1` decides by the policy as it is at each check (ADR-073): it compares the size and modification time of `.mete/policy.yaml` and the global `settings.yaml` with the last read and, when either changed, reads both again. An edit that does not validate keeps the last valid policy and is logged.
