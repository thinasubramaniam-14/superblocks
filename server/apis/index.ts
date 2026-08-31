/**
 * API Registry - Central export for all APIs.
 *
 * This file is the single source of truth for API definitions.
 * Add new APIs here to get full TypeScript support in the frontend.
 *
 * IMPORTANT: Use .js extension for imports (required for ESM compatibility)
 */

import AnalyseEscalation from "./escalation/analyse-escalation.js";
import ResolveAccount from "./escalation/resolve-account.js";

const apis = { AnalyseEscalation, ResolveAccount } as const;

export default apis;

/** Type for useApi inference - exported for client type-only imports */
export type ApiRegistry = typeof apis;
