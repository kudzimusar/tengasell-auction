// policies.ts — combined v1.0 policy catalogue (all 8 bilingual policies).

import { POLICIES_PART1, POLICY_VERSION, POLICY_EFFECTIVE_FROM, type PolicyContent } from "./policies-part1";
import { POLICIES_PART2 } from "./policies-part2";

export { POLICY_VERSION, POLICY_EFFECTIVE_FROM };
export type { PolicyContent };

export const ALL_POLICIES: PolicyContent[] = [...POLICIES_PART1, ...POLICIES_PART2];
