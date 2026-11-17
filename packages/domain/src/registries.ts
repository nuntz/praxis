import { conversationTools } from "./conversation.ts";
import { deploymentTools } from "./deployment.ts";
import { tools } from "./tools.ts";

/**
 * Every set of tools Praxis has, by name. The guards in `lint/` read their tools from here, so a
 * new set is guarded the day it is added: add it here.
 */
export const registries = {
  context: tools,
  deployment: deploymentTools,
  conversation: conversationTools,
} as const;

export type RegistryName = keyof typeof registries;
