# OpenTop Risks

## High-Risk Areas

- Provider execution that can modify the working tree.
- Command allowlist enforcement.
- Git branch creation and cleanup.
- Pull request creation.
- Auth and security related tickets.
- Migration and multi-tenant related tickets.
- Secret handling.

## MVP Risk Controls

- Use isolated branches.
- Require approval for high-risk profiles.
- Keep command allowlists explicit.
- Capture logs and changed files.
- Prefer draft pull requests.
- Avoid direct default-branch pushes.

## Future Risk Controls

- Stronger sandboxing.
- Policy checks before provider execution.
- Configurable approval gates.
- Execution timeouts.
- Redaction for logs.
- Structured review reports.
