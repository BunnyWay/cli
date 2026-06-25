---
"@bunny.net/database-shell": patch
---

fix(bsql): fall back to a baseline (non-AVX2) binary on older x64 CPUs that crashed with "Illegal instruction"
