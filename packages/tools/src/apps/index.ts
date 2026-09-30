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
  RegistrySchema,
  registriesCreate,
  registriesDelete,
  registriesGet,
  registriesList,
  registriesUpdate,
  registryTypeForServer,
  toRegistry,
} from "./registries/index.ts";

export const appsTools: Tool[] = [...registriesTools];
