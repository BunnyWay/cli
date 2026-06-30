---
"@bunny.net/cli": patch
---

fix(dns): label the bunny-specific record types with bunny's canonical codes (Pull Zone as PZ, Redirect as RDR, Script as SCR) across listings and pickers, group them under "Bunny" in the interactive type picker, and accept those codes (plus the spelled-out names) when parsing a record type
