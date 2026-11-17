import type { AnyTool } from '../tool';
import { financeTools } from './finance';
import { householdTools } from './household';
import { plannerTools } from './planner';
import { savingsTools } from './savings';

/** Every MCP tool, by module. A token sees only the tools of its scopes. */
export const TOOLS: readonly AnyTool[] = [
  ...financeTools,
  ...plannerTools,
  ...savingsTools,
  ...householdTools,
];
