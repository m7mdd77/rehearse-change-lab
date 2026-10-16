export const POLICY = Object.freeze({ version: 1, maxRoots: 5, maxDependents: 24, previewMs: 180000 });
export const TEAMS = ['all', 'delivery', 'billing', 'platform'];
export class DomainError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireValue(condition, code, message) { if (!condition) throw new DomainError(code, message); }
export function exactKeys(object, keys) {
  requireValue(object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).sort().join('|') === [...keys].sort().join('|'), 'invalid_input', 'Unexpected request fields.');
}
export function validatePlan(plan) {
  exactKeys(plan, ['team', 'closedBefore', 'excludeHeld', 'status']);
  requireValue(TEAMS.includes(plan.team) && plan.status === 'resolved' && plan.excludeHeld === true, 'invalid_plan', 'Only resolved tickets without a retention hold can be deleted.');
  requireValue(typeof plan.closedBefore === 'string' && /^2026-\d{2}-\d{2}$/.test(plan.closedBefore) && !Number.isNaN(Date.parse(plan.closedBefore)) && new Date(plan.closedBefore).toISOString().slice(0,10) === plan.closedBefore && plan.closedBefore >= '2026-01-01' && plan.closedBefore <= '2026-10-16', 'invalid_plan', 'Choose a valid date between January 1 and October 16, 2026.');
  return { team: plan.team, closedBefore: plan.closedBefore, excludeHeld: true, status: 'resolved' };
}
export function validateCommand(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'invalid_input', 'Invalid request.');
  const keys = { state: ['op'], propose: ['op','intent'], simulate: ['op','plan'], execute: ['op','previewId'], rollback: ['op','runId'], fault: ['op','enabled'] };
  requireValue(Object.hasOwn(keys, input.op), 'invalid_input', 'Unknown operation.'); exactKeys(input, keys[input.op]);
  if (input.op === 'propose') requireValue(typeof input.intent === 'string' && input.intent.trim().length >= 12 && input.intent.length <= 1200, 'invalid_input', 'Describe the cleanup in 12–1200 characters.');
  if (input.op === 'simulate') validatePlan(input.plan);
  for (const key of ['previewId','runId']) if (key in input) requireValue(typeof input[key] === 'string' && /^[a-f0-9-]{36}$/.test(input[key]), 'invalid_input', 'Invalid receipt reference.');
  if (input.op === 'fault') requireValue(typeof input.enabled === 'boolean', 'invalid_input', 'Invalid failure scenario.');
  return input;
}
