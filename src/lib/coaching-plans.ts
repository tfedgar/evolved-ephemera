export type CoachingPlanId = 'three-month' | 'six-month' | 'twelve-month';

export type CoachingPlan = Readonly<{
  id: CoachingPlanId;
  months: number;
  monthlyUsd: number;
  name: string;
}>;

// Browser-safe offer data. Stripe credentials and price IDs belong on the server.
export const COACHING_PLANS: readonly CoachingPlan[] = Object.freeze([
  Object.freeze({ id: 'three-month', months: 3, monthlyUsd: 500, name: '3 months' }),
  Object.freeze({ id: 'six-month', months: 6, monthlyUsd: 450, name: '6 months' }),
  Object.freeze({ id: 'twelve-month', months: 12, monthlyUsd: 400, name: '12 months' }),
]);
