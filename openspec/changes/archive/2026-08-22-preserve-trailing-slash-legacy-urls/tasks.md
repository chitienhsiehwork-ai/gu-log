## 1. Exact optional-slash routing

- [x] 1.1 Generate one exact Vercel optional-trailing-slash source pattern per manifest-backed article alias while keeping literal canonical destinations.
- [x] 1.2 Add regressions proving both exact pathname forms match, deeper／extra-slash paths do not match, and route count stays within the existing budget.

## 2. Deployment verification coverage

- [x] 2.1 Extend the bounded production verifier to materialize and audit both pathname forms for every manifest-backed article rule.
- [x] 2.2 Preserve the finite listing-route audit and fail closed on any redirect source shape the verifier cannot safely materialize.

## 3. Gates and spec sync

- [x] 3.1 Pass targeted route tests, static checks, full relevant regression, production build, and OpenSpec strict validation.
- [x] 3.2 Sync the completed `brand-taxonomy` delta into the stable spec before archive.
