---
name: amiga-secrets
description: Set up profile-based config and secrets layout in an Inditex AMIGA artifact (mic-/bat-/wsc-). Use when creating a new artifact, adding secrets or per-environment config, wiring a service to run locally against DES/PRE, or when the user mentions AMIGA profiles, application-secret files, configmap-local, or CyberArk refs in paas.
---

# AMIGA config & secrets layout

The canonical pattern (reference implementation: `mic-moninaicompanion`). One profile selector set in a single point, one secret file per environment, a local configmap for local-run needs, and a fallback profile chain to fill the gaps.

## The model

**Profile selection has exactly one in-repo point:** `amiga.profiles` in the base `code/resources/application-configmap.yml`:

```yaml
amiga:
  profiles: local;pre
```

The `AMIGA_PROFILE` env var overrides it (framework reads `${oc.env:AMIGA_PROFILE}` first, YAML second). Never scatter profile logic anywhere else — to switch what you're running against, edit that one line (or export `AMIGA_PROFILE`) before raising the app.

**Precedence** (verified in `fwk_amigapython` `omega_config.py` — earlier-loaded source wins):

1. Framework first-config (env var bindings)
2. PaaS-mounted `config_paas` files (cluster only, hot-reloadable)
3. Profile resource files, **in listed order — first profile wins**
4. Base `application-configmap.yml`, then base `application-secret.yml`
5. Global `application.yml`
6. Framework defaults

So `profiles: local;pre` means: `local` values win, `pre` fills in anything local doesn't define (creds, gateway URLs — things local can't have), base fills the rest. **List order = priority order, first wins** — equivalently you can read it as "pre is laid down as the base, then local overlays it"; both descriptions give the same merged result. The flow is always `local;<env>`: if it were last-wins you'd have to write `pre;local`, but it isn't — `local` goes first. That fallback chain is the point: `application-configmap-local.yml` stays minimal (debug flags, localhost endpoints) and a real environment supplies everything else.

**The engine:** this is AMIGA in-house code, not Spring. `fwk_amigapython`'s `amiga/common/configuration/internal/omega_config.py` (`OmegaConfigMap`) owns profile resolution, the source list, and precedence; it only delegates the raw YAML deep-merge to the [OmegaConf](https://omegaconf.readthedocs.io/) library (`OmegaConf.merge`, `${oc.env:...}` interpolation). Java AMIGA artifacts get the analogous behavior from Spring profiles instead.

## File layout

All under `code/resources/`:

| File | Committed? | Contents |
|------|-----------|----------|
| `application-configmap.yml` | yes | Base config + `amiga.profiles` selector (line 2 by convention) |
| `application-configmap-local.yml` | yes | Local-only runtime config: localhost endpoints, debug flags, observability content capture. Nothing secret. |
| `application-configmap-{des,pre,pro}.yml` | yes | Per-env URLs, resource IDs, gateway prefixes — non-secret env deltas |
| `application-secret.yml` | yes | **Placeholders only** (`<--client_id-->`) — documents the full shape of required secrets, with a header comment explaining the profile mechanism |
| `application-secret-{local,des,pre,pro}.yml` | **no — gitignored** | Real credentials, one file per environment, header comment `# DES environment secrets — activate with AMIGA_PROFILE=des` |

`.gitignore` must cover both separator variants (people typo them):

```gitignore
code/resources/application-secret-local.yml
code/resources/application-secret-des.yml
code/resources/application-secret-pre.yml
code/resources/application-secret-pro.yml
code/resources/application-secret_des.yml
code/resources/application-secret_pre.yml
code/resources/application-secret_pro.yml
```

## PaaS side (`paas/config_paas/`)

Deployed environments never use the gitignored files (they're not in the image). Instead `secret_{des,pre,pro}.yml` hold **CyberArk references**, resolved by the platform at deploy time — committed safely, no plaintext:

```yaml
amiga:
  agents:
    providers:
      kaia_provider:
        client_id: cyberark.<SAFE>_<account>-id
        client_secret: cyberark.<SAFE>_<account>-secret
```

Mirror the same YAML paths as the resource secret files so the shape is identical local↔cluster.

## Setting up a new artifact

1. Create the base `application-configmap.yml` with `amiga.profiles: local;pre` near the top.
2. Create `application-configmap-local.yml` (debug/local endpoints) and one configmap per env with the non-secret deltas.
3. Create `application-secret.yml` with placeholders for every credential the app needs — this is the contract; keep it in sync when adding clients.
4. Create the per-env secret files locally (copy the placeholder file, fill in real values), add the gitignore block **before** the first commit.
5. Mirror secrets as CyberArk refs in `paas/config_paas/secret_{env}.yml`.
6. **Override the profile selector in PaaS** — set `amiga.profiles: ""` in `paas/config_paas/configmap.yml` (or the matching env name per `configmap_<env>.yml` if you want the resource per-env files active in cluster). This is mandatory, not optional — see Gotchas.
7. Put a warning comment on the `amiga.profiles` line in the base resource configmap so nobody edits it thinking it's local-only.
8. Verify with `git ls-files code/resources/ | grep secret` — only the placeholder base file should appear.

## Local-run workflow

- Default dev posture: `profiles: local;pre` — local debug config, PRE credentials/endpoints filling the gaps.
- Need DES instead: `AMIGA_PROFILE=local;des` (env var, no file edit) or flip the line.
- Profile order matters: put `local` first or its overrides lose.

## Gotchas

- **The platform never sets `AMIGA_PROFILE`, so the committed selector is also read in cluster.** Without an override, `local;pre` stays active in DES/PRE/PRO and every `application-configmap-local.yml` key applies in production unless the PaaS-mounted configmap happens to shadow it. **PaaS MUST override it**: `amiga.profiles: ""` in `paas/config_paas/configmap.yml` neutralizes the in-repo selector (the framework strips empty entries → no resource profile files load; cluster config comes solely from PaaS-mounted files + base resources). Before flipping this on an existing service, diff the resource `configmap-<env>`/`configmap-local` files against the PaaS configmaps — any key the cluster was silently inheriting from them must be moved into PaaS first.
- detect-secrets CI will flag real credentials anywhere committed — the placeholder convention exists so the base file passes scanning.
- When adding a new credentialed client: add it to the placeholder base file AND every env secret file AND the CyberArk paas files in the same change, or another dev's local run breaks silently with placeholder creds.
