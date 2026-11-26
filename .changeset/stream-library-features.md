---
"@bunny.net/cli": minor
---

feat(stream): `stream libraries create` and the new-library path of `stream import` now ask for library features (premium encoding plan and codecs, transcribing languages and smart generate) after the replication regions, showing what each paid feature costs, with `--encoding-plan 1080p|4k` and `--no-features` as flag equivalents. `libraries update --encoding-plan` always sends the output codecs (H.264 unless `--codecs` names others).
