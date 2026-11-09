## What and why

<!-- One or two sentences. Link the issue: Closes #… -->

## How it was tested

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:rules && pnpm build`
- [ ] New maths has tests with known expected values
- [ ] Rules changes have matching tests in `firebase/tests/`

## Safety checklist

- [ ] No real financial data, PAN, email, account/folio numbers or screenshots with real values
- [ ] No secrets or tokens in code, logs or fixtures
- [ ] No broker passwords handled; integrations stay read-only
- [ ] Admin code does not expose personal or financial fields
- [ ] ADR added or updated if this changes a design decision
