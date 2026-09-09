import type { Tool } from "../define-tool.ts";
import { registriesTools } from "./registries/index.ts";

export type {
  ContainerRegistryModel,
  DeletedRegistry,
  Registry,
  RegistryType,
} from "./registries/index.ts";
export {
  DeletedRegistrySchema,
  fetchRegistries,
  fetchRegistry,
  registriesCreate,
  registriesDelete,
  registriesGet,
  registriesList,
  registriesUpdate,
  RegistrySchema,
  registryTypeForServer,
  toRegistry,
} from "./registries/index.ts";

export const appsTools: Tool[] = [...registriesTools];
