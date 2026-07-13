import { defineNamespace } from "../../core/define-namespace.ts";
import { sandboxCpCommand } from "./cp.ts";
import { sandboxCreateCommand } from "./create.ts";
import { sandboxDeleteCommand } from "./delete.ts";
import { sandboxEnvNamespace } from "./env/index.ts";
import { sandboxExecCommand } from "./exec.ts";
import { sandboxFilesNamespace } from "./files/index.ts";
import { sandboxListCommand } from "./list.ts";
import { sandboxSshCommand } from "./ssh.ts";
import { sandboxUrlNamespace } from "./url/index.ts";

export const sandboxNamespace = defineNamespace(
  "sandbox",
  "Manage sandboxes.",
  [
    sandboxCreateCommand,
    sandboxListCommand,
    sandboxDeleteCommand,
    sandboxExecCommand,
    sandboxCpCommand,
    sandboxFilesNamespace,
    sandboxSshCommand,
    sandboxUrlNamespace,
    sandboxEnvNamespace,
  ],
);
