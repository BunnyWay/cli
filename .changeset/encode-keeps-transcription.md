---
"@bunny.net/cli": minor
---

fix(stream): `videos encode` no longer claims a re-encode transcribes the video again. A re-encode keeps the existing transcription and only transcribes again when the library's transcribing languages changed; the warning, the `videos transcribe` double-billing notice and the README now say so. The JSON field `transcriptionQueued` is renamed `transcribingEnabled`, since a transcription is not necessarily queued; scripts reading the old field need to switch.
