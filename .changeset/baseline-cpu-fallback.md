---
"@bunny.net/cli": patch
---

fix(install): ship a baseline (non-AVX2) build for older x64 CPUs that crashed with "Illegal instruction" — the installer auto-selects it, and the npm wrapper falls back to it on SIGILL
