# Security policy

## Supported versions

Security fixes go into the latest release. Please update before reporting.

| Version | Supported |
| --- | --- |
| 0.2.x (latest) | Yes |
| older | No |

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** in this repository
(https://github.com/Hakubisual/open-notion-acard/security/advisories/new). Do not open a public issue or pull request for a security problem.

Include what you found, how to reproduce it, the version, and the impact you expect. You will get a reply within a
few days. Once a fix is released we credit you in the release notes, unless you prefer not to be named.

## What is in scope

- The self-hosted server (`local/`, `gate/`, `features/`, `agents/`): sign-in, host allow-list, sharing links,
  access to pages and files, the MCP and REST APIs.
- The Acard Local desktop app (`desktop/`).
- Backup archives (`gate/archive.ts`): for example, an archive leaking secrets or restoring access it should not.

## Hardening tips for self-hosters

- Keep the server on a LAN or VPN. Do not expose port 47811 to the internet without a reverse proxy and HTTPS.
- Use a long `ACARD_PASSWORD` and keep `ACARD_ALLOWED_HOSTS` to the names you actually use.
- Back up the data folder regularly and keep backups somewhere only you can read.
