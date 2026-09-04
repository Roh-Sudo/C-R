import { createHmac, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Plans, features and entitlements. This is the single source of truth for
// plan-shaped decisions; application code must call canUse()/getLimit()
// instead of checking `plan === 'BUSINESS'` directly.
// ---------------------------------------------------------------------------

export type PlanId = 'FREE' | 'TEAM' | 'BUSINESS' | 'ENTERPRISE';
export type NumericCapability = 'repositories' | 'users' | 'monthlyScans' | 'scanHistoryDays' | 'auditRetentionDays' | 'apiRequestsPerMonth';
export type FeatureCapability = 'aiInventory' | 'shadowAI' | 'frameworkMappings' | 'continuousEvidence' | 'advancedReports' | 'apiAccess' | 'customPolicies' | 'sso' | 'prioritySupport';
export type Capability = NumericCapability | FeatureCapability;
export const UNLIMITED = Number.POSITIVE_INFINITY;

export type PlanDefinition = {
 id: PlanId;
 name: string;
 tagline: string;
 priceMonthlyUsd: number | null; // null means "contact sales" / negotiated
 selfServiceCheckout: boolean;
 limits: Record<NumericCapability, number>;
 features: Record<FeatureCapability, boolean>;
};

export const PLANS: Record<PlanId, PlanDefinition> = {
 FREE: {
  id: 'FREE', name: 'Free', tagline: 'Local scanning for a single project.', priceMonthlyUsd: 0, selfServiceCheckout: true,
  limits: { repositories: 1, users: 3, monthlyScans: 25, scanHistoryDays: 30, auditRetentionDays: 30, apiRequestsPerMonth: 0 },
  features: { aiInventory: true, shadowAI: false, frameworkMappings: false, continuousEvidence: false, advancedReports: false, apiAccess: false, customPolicies: false, sso: false, prioritySupport: false }
 },
 TEAM: {
  id: 'TEAM', name: 'Team', tagline: 'CI/CD scanning and AI inventory for a growing team.', priceMonthlyUsd: 29, selfServiceCheckout: true,
  limits: { repositories: 10, users: 15, monthlyScans: 500, scanHistoryDays: 90, auditRetentionDays: 90, apiRequestsPerMonth: 5_000 },
  features: { aiInventory: true, shadowAI: true, frameworkMappings: true, continuousEvidence: false, advancedReports: false, apiAccess: true, customPolicies: false, sso: false, prioritySupport: false }
 },
 BUSINESS: {
  id: 'BUSINESS', name: 'Business', tagline: 'Continuous evidence and custom policies across the org.', priceMonthlyUsd: 99, selfServiceCheckout: true,
  limits: { repositories: 50, users: 100, monthlyScans: 5_000, scanHistoryDays: 365, auditRetentionDays: 365, apiRequestsPerMonth: 50_000 },
  features: { aiInventory: true, shadowAI: true, frameworkMappings: true, continuousEvidence: true, advancedReports: true, apiAccess: true, customPolicies: true, sso: false, prioritySupport: true }
 },
 ENTERPRISE: {
  id: 'ENTERPRISE', name: 'Enterprise', tagline: 'Negotiated limits, SSO and priority support.', priceMonthlyUsd: null, selfServiceCheckout: false,
  limits: { repositories: UNLIMITED, users: UNLIMITED, monthlyScans: UNLIMITED, scanHistoryDays: UNLIMITED, auditRetentionDays: UNLIMITED, apiRequestsPerMonth: UNLIMITED },
  features: { aiInventory: true, shadowAI: true, frameworkMappings: true, continuousEvidence: true, advancedReports: true, apiAccess: true, customPolicies: true, sso: true, prioritySupport: true }
 }
};

/** Negotiated per-organization overrides, e.g. Enterprise contract limits. Only numeric limits may be overridden. */
export type LimitOverrides = Partial<Record<NumericCapability, number>>;

export function getLimit(planId: PlanId, capability: NumericCapability, overrides?: LimitOverrides): number {
 return overrides?.[capability] ?? PLANS[planId].limits[capability];
}

export function canUse(planId: PlanId, capability: FeatureCapability): boolean {
 return PLANS[planId].features[capability];
}

export function listPlans(): PlanDefinition[] {
 return Object.values(PLANS);
}

// ---------------------------------------------------------------------------
// Billing periods. Monthly, UTC-based, with no ad-hoc calendar math scattered
// through business logic.
// ---------------------------------------------------------------------------

/** Returns the current billing period key, e.g. "2026-09", in UTC. */
export function currentPeriod(now: Date = new Date()): string {
 return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodStart(period: string): Date {
 const [year, month] = period.split('-').map(Number);
 return new Date(Date.UTC(year, month - 1, 1));
}

export function periodEnd(period: string): Date {
 const [year, month] = period.split('-').map(Number);
 return new Date(Date.UTC(year, month, 1));
}

// ---------------------------------------------------------------------------
// Usage metering. Records must never include source code, secrets or
// sensitive evidence - only counts.
// ---------------------------------------------------------------------------

export type UsageMetric = 'repositoriesConnected' | 'activeRepositories' | 'scansCompleted' | 'prScans' | 'filesScanned' | 'aiSystemsTracked' | 'members' | 'apiRequests';
export type UsageRecord = { id: string; organizationId: string; metric: UsageMetric; quantity: number; period: string; timestamp: string };

export function recordUsage(organizationId: string, metric: UsageMetric, quantity: number, now: Date = new Date()): UsageRecord {
 return { id: `usage_${randomBytes(6).toString('hex')}`, organizationId, metric, quantity, period: currentPeriod(now), timestamp: now.toISOString() };
}

export function usageForPeriod(records: UsageRecord[], organizationId: string, metric: UsageMetric, period: string): number {
 return records.filter(record => record.organizationId === organizationId && record.metric === metric && record.period === period).reduce((total, record) => total + record.quantity, 0);
}

export function remainingAllowance(used: number, limit: number): number {
 return limit === UNLIMITED ? UNLIMITED : Math.max(0, limit - used);
}

// ---------------------------------------------------------------------------
// Limit enforcement (soft vs hard limits). Callers decide whether a hard
// limit blocks an action (e.g. connecting a repository) or is communicated
// without discarding already-submitted data (e.g. a scan upload).
// ---------------------------------------------------------------------------

export type LimitLevel = 'OK' | 'SOFT_LIMIT' | 'HARD_LIMIT';
export type LimitCheck = { capability: NumericCapability; used: number; limit: number; remaining: number; level: LimitLevel; percentUsed: number };

export const DEFAULT_SOFT_LIMIT_PERCENT = 80;

export function checkLimit(capability: NumericCapability, used: number, limit: number, softThresholdPercent: number = DEFAULT_SOFT_LIMIT_PERCENT): LimitCheck {
 if (limit === UNLIMITED) return { capability, used, limit, remaining: UNLIMITED, level: 'OK', percentUsed: 0 };
 const percentUsed = limit === 0 ? 100 : Math.round((used / limit) * 100);
 const level: LimitLevel = used >= limit ? 'HARD_LIMIT' : percentUsed >= softThresholdPercent ? 'SOFT_LIMIT' : 'OK';
 return { capability, used, limit, remaining: remainingAllowance(used, limit), level, percentUsed };
}

/** Thrown when an action is blocked by a hard limit. Carries structured data so callers can build a clear error response instead of a generic 4xx. */
export class EntitlementError extends Error {
 readonly code = 'LIMIT_REACHED' as const;
 constructor(readonly capability: NumericCapability, readonly used: number, readonly limit: number) {
  super(`${capability} limit reached (${used}/${limit === UNLIMITED ? 'unlimited' : limit})`);
  this.name = 'EntitlementError';
 }
}

/** Blocks the action if the hard limit is already reached; used for actions that create no data loss risk (new repository, new member invite). */
export function enforceHardLimit(capability: NumericCapability, used: number, limit: number): void {
 if (limit !== UNLIMITED && used >= limit) throw new EntitlementError(capability, used, limit);
}

// ---------------------------------------------------------------------------
// Trial lifecycle.
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';

export type Subscription = {
 id: string;
 organizationId: string;
 planId: PlanId;
 status: SubscriptionStatus;
 trialStartedAt?: string;
 trialEndsAt?: string;
 currentPeriodStart: string;
 currentPeriodEnd: string;
 cancelAtPeriodEnd: boolean;
 cancelledAt?: string;
 limitOverrides?: LimitOverrides;
 externalCustomerId?: string;
 externalSubscriptionId?: string;
 createdAt: string;
 updatedAt: string;
};

export const DEFAULT_TRIAL_DAYS = 14;

export function startTrial(organizationId: string, planId: PlanId = 'TEAM', now: Date = new Date(), trialDays: number = DEFAULT_TRIAL_DAYS): Subscription {
 const trialEndsAt = new Date(now.getTime() + trialDays * 86_400_000);
 return {
  id: `sub_${randomBytes(8).toString('hex')}`, organizationId, planId, status: 'TRIALING',
  trialStartedAt: now.toISOString(), trialEndsAt: trialEndsAt.toISOString(),
  currentPeriodStart: now.toISOString(), currentPeriodEnd: trialEndsAt.toISOString(),
  cancelAtPeriodEnd: false, createdAt: now.toISOString(), updatedAt: now.toISOString()
 };
}

export function trialDaysRemaining(subscription: Subscription, now: Date = new Date()): number {
 if (!subscription.trialEndsAt) return 0;
 return Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - now.getTime()) / 86_400_000));
}

export function isTrialExpired(subscription: Subscription, now: Date = new Date()): boolean {
 return subscription.status === 'TRIALING' && Boolean(subscription.trialEndsAt) && now.getTime() >= new Date(subscription.trialEndsAt!).getTime();
}

/** Trial expiration never deletes data; it only restricts the plan to FREE-equivalent limits until the org upgrades. */
export function expireTrial(subscription: Subscription, now: Date = new Date()): Subscription {
 return { ...subscription, status: 'EXPIRED', planId: 'FREE', updatedAt: now.toISOString() };
}

export function changePlan(subscription: Subscription, planId: PlanId, now: Date = new Date()): Subscription {
 return { ...subscription, planId, status: subscription.status === 'TRIALING' ? subscription.status : 'ACTIVE', updatedAt: now.toISOString() };
}

/** Cancellation stops future billing but never deletes organization data; it is distinct from deleting an organization. */
export function cancelSubscription(subscription: Subscription, now: Date = new Date(), immediate = false): Subscription {
 if (immediate) return { ...subscription, status: 'CANCELLED', cancelAtPeriodEnd: false, cancelledAt: now.toISOString(), updatedAt: now.toISOString() };
 return { ...subscription, cancelAtPeriodEnd: true, cancelledAt: now.toISOString(), updatedAt: now.toISOString() };
}

/** Applies a downgrade: lowers the plan but never truncates existing history; enforcement of new limits happens at the point of future use. */
export function downgradePlan(subscription: Subscription, planId: PlanId, now: Date = new Date()): Subscription {
 return changePlan(subscription, planId, now);
}

// ---------------------------------------------------------------------------
// Billing provider abstraction. Domain logic never talks to a vendor SDK
// directly - only through this interface.
// ---------------------------------------------------------------------------

export type CheckoutSession = { sessionId: string; url: string; organizationId: string; planId: PlanId };
export type PortalSession = { url: string };
export type BillingWebhookEvent = { id: string; type: 'checkout.completed' | 'subscription.updated' | 'subscription.cancelled'; organizationId: string; planId?: PlanId; subscriptionId?: string; receivedAt: string };

export interface BillingProvider {
 createCustomer(organizationId: string, email: string): Promise<{ customerId: string }>;
 createCheckoutSession(organizationId: string, planId: PlanId): Promise<CheckoutSession>;
 createSubscription(organizationId: string, planId: PlanId): Promise<Subscription>;
 cancelSubscription(subscriptionId: string): Promise<{ subscriptionId: string; cancelled: boolean }>;
 changePlan(subscriptionId: string, planId: PlanId): Promise<{ subscriptionId: string; planId: PlanId }>;
 getSubscription(subscriptionId: string): Promise<Subscription | undefined>;
 createPortalSession(customerId: string): Promise<PortalSession>;
 /** Verifies and parses a provider webhook payload. Must reject unsigned/invalid payloads. */
 processWebhook(payload: string, signature: string | undefined): Promise<BillingWebhookEvent>;
}

/**
 * Local/test billing provider. Simulates the full commercial lifecycle
 * (checkout, activation, plan change, cancellation, expiration) without any
 * real payment information or network calls. Signatures use a shared local
 * secret so the same idempotency/verification code path used for a real
 * provider can be exercised in tests.
 */
export class LocalBillingProvider implements BillingProvider {
 private readonly subscriptions = new Map<string, Subscription>();
 private readonly customers = new Map<string, string>();
 constructor(private readonly secret: string = 'local-test-billing-secret') {}

 async createCustomer(organizationId: string, email: string): Promise<{ customerId: string }> {
  const customerId = `cus_local_${randomBytes(6).toString('hex')}`;
  this.customers.set(customerId, `${organizationId}:${email}`);
  return { customerId };
 }

 async createCheckoutSession(organizationId: string, planId: PlanId): Promise<CheckoutSession> {
  const sessionId = `cs_local_${randomBytes(8).toString('hex')}`;
  return { sessionId, url: `local-billing://checkout/${sessionId}`, organizationId, planId };
 }

 async createSubscription(organizationId: string, planId: PlanId): Promise<Subscription> {
  const now = new Date();
  const periodEndDate = new Date(now.getTime() + 30 * 86_400_000);
  const subscription: Subscription = {
   id: `sub_local_${randomBytes(8).toString('hex')}`, organizationId, planId, status: 'ACTIVE',
   currentPeriodStart: now.toISOString(), currentPeriodEnd: periodEndDate.toISOString(),
   cancelAtPeriodEnd: false, externalSubscriptionId: `sub_local_${randomBytes(8).toString('hex')}`,
   createdAt: now.toISOString(), updatedAt: now.toISOString()
  };
  this.subscriptions.set(subscription.id, subscription);
  return subscription;
 }

 async cancelSubscription(subscriptionId: string): Promise<{ subscriptionId: string; cancelled: boolean }> {
  const subscription = this.subscriptions.get(subscriptionId);
  if (!subscription) return { subscriptionId, cancelled: false };
  this.subscriptions.set(subscriptionId, cancelSubscription(subscription, new Date(), true));
  return { subscriptionId, cancelled: true };
 }

 async changePlan(subscriptionId: string, planId: PlanId): Promise<{ subscriptionId: string; planId: PlanId }> {
  const subscription = this.subscriptions.get(subscriptionId);
  if (subscription) this.subscriptions.set(subscriptionId, changePlan(subscription, planId));
  return { subscriptionId, planId };
 }

 async getSubscription(subscriptionId: string): Promise<Subscription | undefined> {
  return this.subscriptions.get(subscriptionId);
 }

 async createPortalSession(customerId: string): Promise<PortalSession> {
  return { url: `local-billing://portal/${customerId}` };
 }

 async processWebhook(payload: string, signature: string | undefined): Promise<BillingWebhookEvent> {
  const expected = this.sign(payload);
  if (signature !== expected) throw new Error('invalid local billing webhook signature');
  const event = JSON.parse(payload) as Omit<BillingWebhookEvent, 'receivedAt'>;
  return { ...event, receivedAt: new Date().toISOString() };
 }

 /** Test helper: signs a payload the same way a real provider would, for use only by the local provider. */
 sign(payload: string): string {
  return createHmac('sha256', this.secret).update(payload).digest('hex');
 }
}

// ---------------------------------------------------------------------------
// Billing audit events. Never store card data or raw provider payloads.
// ---------------------------------------------------------------------------

export type BillingAuditEventType = 'TRIAL_STARTED' | 'TRIAL_EXPIRED' | 'SUBSCRIPTION_STARTED' | 'PLAN_CHANGED' | 'SUBSCRIPTION_CANCELLED';
export type BillingAuditEvent = { id: string; organizationId: string; type: BillingAuditEventType; timestamp: string; metadata?: Record<string, string> };

export function createBillingAuditEvent(organizationId: string, type: BillingAuditEventType, metadata?: Record<string, string>, now: Date = new Date()): BillingAuditEvent {
 return { id: `billing_audit_${randomBytes(6).toString('hex')}`, organizationId, type, timestamp: now.toISOString(), metadata };
}

// ---------------------------------------------------------------------------
// Commercial event model. Product adoption signals; no source code or PII
// beyond an account identifier.
// ---------------------------------------------------------------------------

export type CommercialEventType = 'ORGANIZATION_CREATED' | 'PROJECT_CREATED' | 'REPOSITORY_CONNECTED' | 'FIRST_SCAN_COMPLETED' | 'FIRST_FINDING_DETECTED' | 'FIRST_FINDING_RESOLVED' | 'AI_SYSTEM_DISCOVERED' | 'SHADOW_AI_DETECTED' | 'PILOT_STARTED' | 'PILOT_COMPLETED' | 'TRIAL_STARTED' | 'SUBSCRIPTION_STARTED';
export type CommercialEvent = { id: string; organizationId: string; type: CommercialEventType; timestamp: string; metadata?: Record<string, string> };

export function createCommercialEvent(organizationId: string, type: CommercialEventType, metadata?: Record<string, string>, now: Date = new Date()): CommercialEvent {
 return { id: `event_${randomBytes(6).toString('hex')}`, organizationId, type, timestamp: now.toISOString(), metadata };
}

// ---------------------------------------------------------------------------
// Activation and time-to-first-value.
// ---------------------------------------------------------------------------

/** An organization is activated when it has connected at least one repository AND completed at least one successful scan. Nothing else counts. */
export function isActivated(hasRepository: boolean, hasSuccessfulScan: boolean): boolean {
 return hasRepository && hasSuccessfulScan;
}

export function hoursBetween(fromIso: string, toIso: string): number {
 return Math.max(0, (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000);
}

export const MIN_SAMPLE_SIZE_FOR_PERCENTILE = 5;

/** Nearest-rank percentile; requires a minimum sample size to avoid misleading statistics from tiny samples. */
export function percentile(sortedValues: number[], p: number): number | undefined {
 if (sortedValues.length < MIN_SAMPLE_SIZE_FOR_PERCENTILE) return undefined;
 const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
 return sortedValues[Math.max(0, index)];
}

export type TimeToValueSummary = { sampleSize: number; p50?: number; p95?: number; note?: string };

export function summarizeTimeToValue(hoursSamples: number[]): TimeToValueSummary {
 const sorted = [...hoursSamples].sort((a, b) => a - b);
 if (sorted.length < MIN_SAMPLE_SIZE_FOR_PERCENTILE) return { sampleSize: sorted.length, note: `sample size ${sorted.length} is below the minimum of ${MIN_SAMPLE_SIZE_FOR_PERCENTILE} required for a meaningful percentile` };
 return { sampleSize: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

// ---------------------------------------------------------------------------
// Sales-assisted lead model (minimal, not a CRM).
// ---------------------------------------------------------------------------

export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'PILOT' | 'CUSTOMER' | 'CLOSED';
export type LeadUseCase = 'Compliance-as-Code' | 'AI Governance' | 'Shadow AI' | 'Continuous Evidence' | 'Developer Security';
export type Lead = {
 id: string; name: string; workEmail: string; company: string; role: string;
 companySize: string; repositoriesExpected: number; useCase: LeadUseCase;
 status: LeadStatus; createdAt: string; updatedAt: string;
};

export type LeadInput = { name: string; workEmail: string; company: string; role: string; companySize: string; repositoriesExpected: number; useCase: LeadUseCase };
const LEAD_USE_CASES: LeadUseCase[] = ['Compliance-as-Code', 'AI Governance', 'Shadow AI', 'Continuous Evidence', 'Developer Security'];
const FREE_EMAIL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com']);

export function validateLeadInput(input: Partial<LeadInput>): string[] {
 const errors: string[] = [];
 if (typeof input.name !== 'string' || input.name.trim().length < 2) errors.push('name is required');
 if (typeof input.workEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.workEmail)) errors.push('a valid work email is required');
 else if (FREE_EMAIL_DOMAINS.has(input.workEmail.split('@')[1]?.toLowerCase())) errors.push('a work email address is required, not a personal email provider');
 if (typeof input.company !== 'string' || input.company.trim().length < 2) errors.push('company is required');
 if (typeof input.role !== 'string' || input.role.trim().length < 2) errors.push('role is required');
 if (typeof input.companySize !== 'string' || input.companySize.trim().length === 0) errors.push('company size is required');
 if (typeof input.repositoriesExpected !== 'number' || !Number.isFinite(input.repositoriesExpected) || input.repositoriesExpected < 0) errors.push('repositoriesExpected must be a non-negative number');
 if (typeof input.useCase !== 'string' || !LEAD_USE_CASES.includes(input.useCase as LeadUseCase)) errors.push(`useCase must be one of ${LEAD_USE_CASES.join(', ')}`);
 return errors;
}

export function createLead(input: LeadInput, now: Date = new Date()): Lead {
 return { id: `lead_${randomBytes(8).toString('hex')}`, ...input, status: 'NEW', createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function transitionLead(lead: Lead, status: LeadStatus, now: Date = new Date()): Lead {
 return { ...lead, status, updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Domain restrictions (approved email domains for an organization).
// ---------------------------------------------------------------------------

/** Server-side check only; never rely on frontend validation for domain restriction. */
export function isEmailDomainAllowed(email: string, allowedDomains: string[] | undefined): boolean {
 if (!allowedDomains || allowedDomains.length === 0) return true;
 const domain = email.split('@')[1]?.toLowerCase();
 return Boolean(domain) && allowedDomains.some(allowed => allowed.toLowerCase() === domain);
}
