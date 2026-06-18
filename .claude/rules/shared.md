---
paths:
  - 'packages/shared/**/*'
---

## Folder Structure: Feature-based structure

```txt
src/
  validations/
    <feature>.validation.ts
  errors/                     # constant error message so frontend and backend can share
    <feature>.error.ts        # contain all errors for a feature
  index.ts                     # entry point, export everything here
```
