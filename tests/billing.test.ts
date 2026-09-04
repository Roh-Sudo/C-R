import { describe, expect, it } from 'vitest';
import {
  PLANS, UNLIMITED, canUse, getLimit, listPlans,
  currentPeriod, periodStart, periodEnd,
  recordUsage, usageForPeriod, remainingAllowance,
  checkLimit, enforceHardLimit, EntitlementError,
  startTrial, trialDaysRemaining, isTrialExpired, expireTrial, changePlan, cancelSubscription, downgradePlan,
  LocalBillingProvider,
  createBillingAuditEvent, createCommercialEvent,
  isActivated, hoursBetween, summarizeTimeToValue, percentile,
  createLead, validateLeadInput, transitionLead,
  isEmailDomainAllowed
} from '../packages/billing-core/src/index.js';

describe('plans and entitlements', () => {
  it('centralizes plan definitions instead of scattering plan checks', () => {
    expect(listPlans().map(plan => plan.id)).toEqual(['FREE', 'TEAM', 'BUSINESS', 'ENTERPRISE']);
    expect(canUse('FREE', 'shadowAI')).toBe(false);
    expect(canUse('TEAM', 'shadowAI')).toBe(true);
    expect(canUse('BUSINESS', 'customPolicies')).toBe(true);
    expect(canUse('FREE', 'customPolicies')).toBe(false);
    expect(canUse('ENTERPRISE', 'sso')).toBe(true);
  });

  it('supports negotiated enterprise overrides for numeric limits', () => {
    expect(getLimit('TEAM', 'repositories')).toBe(PLANS.TEAM.limits.repositories);
    expect(getLimit('ENTERPRISE', 'repositories')).toBe(UNLIMITED);
    expect(getLimit('BUSINESS', 'repositories', { repositories: 250 })).toBe(250);
  });

  it('never invents a price for enterprise (contact sales)', () => {
    expect(PLANS.ENTERPRISE.priceMonthlyUsd).toBeNull();
    expect(PLANS.ENTERPRISE.selfServiceCheckout).toBe(false);
  });
});

describe('billing periods', () => {
  it('derives a stable monthly period key in UTC without scattering calendar math', () => {
    const period = currentPeriod(new Date('2026-09-04T12:00:00Z'));
    expect(period).toBe('2026-09');
    expect(periodStart(period).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(periodEnd(period).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('usage metering', () => {
  it('records usage without any sensitive content and sums by period', () => {
    const now = new Date('2026-09-04T00:00:00Z');
    const records = [recordUsage('org_1', 'scansCompleted', 1, now), recordUsage('org_1', 'scansCompleted', 1, now), recordUsage('org_2', 'scansCompleted', 1, now)];
    expect(Object.keys(records[0])).toEqual(['id', 'organizationId', 'metric', 'quantity', 'period', 'timestamp']);
    expect(usageForPeriod(records, 'org_1', 'scansCompleted', '2026-09')).toBe(2);
    expect(usageForPeriod(records, 'org_2', 'scansCompleted', '2026-09')).toBe(1);
  });

  it('computes remaining allowance including unlimited plans', () => {
    expect(remainingAllowance(3, 10)).toBe(7);
    expect(remainingAllowance(3, UNLIMITED)).toBe(UNLIMITED);
  });
});

describe('soft vs hard limits', () => {
  it('flags soft limit at the configured threshold and hard limit at 100%', () => {
    expect(checkLimit('repositories', 7, 10).level).toBe('OK');
    expect(checkLimit('repositories', 8, 10).level).toBe('SOFT_LIMIT');
    expect(checkLimit('repositories', 10, 10).level).toBe('HARD_LIMIT');
    expect(checkLimit('repositories', 3, UNLIMITED).level).toBe('OK');
  });

  it('enforces hard limits by throwing a structured EntitlementError', () => {
    expect(() => enforceHardLimit('repositories', 10, 10)).toThrow(EntitlementError);
    expect(() => enforceHardLimit('repositories', 9, 10)).not.toThrow();
    try {
      enforceHardLimit('users', 15, 15);
    } catch (error) {
      expect(error).toBeInstanceOf(EntitlementError);
      expect((error as EntitlementError).capability).toBe('users');
      expect((error as EntitlementError).code).toBe('LIMIT_REACHED');
    }
  });
});

describe('trial lifecycle', () => {
  it('starts a 14-day trial by default and counts down days remaining', () => {
    const now = new Date('2026-09-04T00:00:00Z');
    const subscription = startTrial('org_1', 'TEAM', now);
    expect(subscription.status).toBe('TRIALING');
    expect(trialDaysRemaining(subscription, now)).toBe(14);
    expect(trialDaysRemaining(subscription, new Date('2026-09-10T00:00:00Z'))).toBe(8);
    expect(isTrialExpired(subscription, now)).toBe(false);
  });

  it('expires a trial without deleting data, restricting to FREE limits', () => {
    const now = new Date('2026-09-04T00:00:00Z');
    const subscription = startTrial('org_1', 'TEAM', now, 14);
    const later = new Date('2026-09-19T00:00:00Z');
    expect(isTrialExpired(subscription, later)).toBe(true);
    const expired = expireTrial(subscription, later);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.planId).toBe('FREE');
    expect(expired.id).toBe(subscription.id);
  });
});

describe('upgrade, downgrade and cancellation', () => {
  it('changes plan without altering identity or historical fields', () => {
    const subscription = startTrial('org_1', 'FREE');
    const upgraded = changePlan(subscription, 'BUSINESS');
    expect(upgraded.planId).toBe('BUSINESS');
    expect(upgraded.status).toBe(subscription.status);
  });

  it('downgrades without touching historical data (data is preserved elsewhere; only the plan changes)', () => {
    const subscription = { ...startTrial('org_1', 'BUSINESS'), status: 'ACTIVE' as const };
    const downgraded = downgradePlan(subscription, 'FREE');
    expect(downgraded.planId).toBe('FREE');
    expect(downgraded.id).toBe(subscription.id);
  });

  it('cancels at period end by default, distinct from immediate cancellation', () => {
    const subscription = { ...startTrial('org_1', 'TEAM'), status: 'ACTIVE' as const };
    const scheduled = cancelSubscription(subscription);
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.status).toBe('ACTIVE');
    const immediate = cancelSubscription(subscription, new Date(), true);
    expect(immediate.status).toBe('CANCELLED');
  });
});

describe('local billing provider', () => {
  it('simulates the full commercial lifecycle without real payment information', async () => {
    const provider = new LocalBillingProvider();
    const customer = await provider.createCustomer('org_1', 'owner@example.com');
    expect(customer.customerId).toMatch(/^cus_local_/);
    const checkout = await provider.createCheckoutSession('org_1', 'TEAM');
    expect(checkout.url).toMatch(/^local-billing:\/\//);
    const subscription = await provider.createSubscription('org_1', 'TEAM');
    expect(subscription.status).toBe('ACTIVE');
    const changed = await provider.changePlan(subscription.id, 'BUSINESS');
    expect(changed.planId).toBe('BUSINESS');
    const fetched = await provider.getSubscription(subscription.id);
    expect(fetched?.planId).toBe('BUSINESS');
    const cancelled = await provider.cancelSubscription(subscription.id);
    expect(cancelled.cancelled).toBe(true);
    const portal = await provider.createPortalSession(customer.customerId);
    expect(portal.url).toMatch(/^local-billing:\/\/portal\//);
  });

  it('verifies webhook signatures and rejects forged or unsigned payloads', async () => {
    const provider = new LocalBillingProvider('shared-secret');
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.completed', organizationId: 'org_1', planId: 'TEAM' });
    const validSignature = provider.sign(payload);
    const event = await provider.processWebhook(payload, validSignature);
    expect(event.organizationId).toBe('org_1');
    await expect(provider.processWebhook(payload, 'forged-signature')).rejects.toThrow();
    await expect(provider.processWebhook(payload, undefined)).rejects.toThrow();
  });
});

describe('billing audit events and commercial events', () => {
  it('never includes card data or raw provider payloads', () => {
    const event = createBillingAuditEvent('org_1', 'SUBSCRIPTION_STARTED', { planId: 'TEAM' });
    expect(Object.keys(event).sort()).toEqual(['id', 'metadata', 'organizationId', 'timestamp', 'type'].sort());
    expect(JSON.stringify(event)).not.toMatch(/card|ssn|secret/i);
  });

  it('produces privacy-safe commercial events', () => {
    const event = createCommercialEvent('org_1', 'FIRST_SCAN_COMPLETED');
    expect(event.type).toBe('FIRST_SCAN_COMPLETED');
  });
});

describe('activation and time to first value', () => {
  it('activates only when a repository is connected and a scan has completed', () => {
    expect(isActivated(false, false)).toBe(false);
    expect(isActivated(true, false)).toBe(false);
    expect(isActivated(false, true)).toBe(false);
    expect(isActivated(true, true)).toBe(true);
  });

  it('does not compute a percentile from a tiny sample without indicating sample size', () => {
    const small = summarizeTimeToValue([1, 2, 3]);
    expect(small.sampleSize).toBe(3);
    expect(small.p50).toBeUndefined();
    expect(small.note).toMatch(/sample size/);
  });

  it('computes p50/p95 once enough samples exist', () => {
    const summary = summarizeTimeToValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(summary.sampleSize).toBe(10);
    expect(summary.p50).toBeDefined();
    expect(summary.p95).toBeDefined();
    expect(percentile([1, 2, 3], 50)).toBeUndefined();
  });

  it('computes hours between two timestamps', () => {
    expect(hoursBetween('2026-09-04T00:00:00Z', '2026-09-04T12:00:00Z')).toBe(12);
  });
});

describe('sales-assisted lead capture', () => {
  it('validates required fields and rejects personal email domains', () => {
    const errors = validateLeadInput({ name: 'A', workEmail: 'a@gmail.com', company: '', role: '', companySize: '', repositoriesExpected: -1, useCase: 'Nope' as never });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(error => /work email/.test(error))).toBe(true);
  });

  it('creates a lead in the NEW state and supports minimal state transitions', () => {
    const lead = createLead({ name: 'Jane Doe', workEmail: 'jane@example.com', company: 'Example Corp', role: 'CISO', companySize: '500-1000', repositoriesExpected: 40, useCase: 'AI Governance' });
    expect(lead.status).toBe('NEW');
    const qualified = transitionLead(lead, 'QUALIFIED');
    expect(qualified.status).toBe('QUALIFIED');
    expect(qualified.id).toBe(lead.id);
  });
});

describe('domain restrictions', () => {
  it('enforces allowed domains server-side and allows unrestricted orgs by default', () => {
    expect(isEmailDomainAllowed('user@example.com', undefined)).toBe(true);
    expect(isEmailDomainAllowed('user@example.com', ['example.com'])).toBe(true);
    expect(isEmailDomainAllowed('user@evil.com', ['example.com'])).toBe(false);
  });
});
