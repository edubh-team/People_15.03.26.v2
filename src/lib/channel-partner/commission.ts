import { isClosedLeadStatus } from "@/lib/leads/status";
import type { LeadDoc } from "@/lib/types/crm";

export type ChannelPartnerCommissionConfig = {
  basePerSale: number;
  bonusThresholdSales: number;
  bonusPerSaleAfterThreshold: number;
  minimumSalesForPayout: number;
};

export const DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG: ChannelPartnerCommissionConfig = {
  basePerSale: 1200,
  bonusThresholdSales: 10,
  bonusPerSaleAfterThreshold: 350,
  minimumSalesForPayout: 1,
};

export type ChannelPartnerCommissionBreakdown = {
  saleCount: number;
  eligible: boolean;
  baseAmount: number;
  bonusAmount: number;
  totalAmount: number;
};

function coercePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date((value as { seconds: number }).seconds * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeChannelPartnerCommissionConfig(
  raw: Partial<ChannelPartnerCommissionConfig> | null | undefined,
) {
  return {
    basePerSale: coercePositiveInt(
      raw?.basePerSale,
      DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG.basePerSale,
    ),
    bonusThresholdSales: coercePositiveInt(
      raw?.bonusThresholdSales,
      DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG.bonusThresholdSales,
    ),
    bonusPerSaleAfterThreshold: coercePositiveInt(
      raw?.bonusPerSaleAfterThreshold,
      DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG.bonusPerSaleAfterThreshold,
    ),
    minimumSalesForPayout: coercePositiveInt(
      raw?.minimumSalesForPayout,
      DEFAULT_CHANNEL_PARTNER_COMMISSION_CONFIG.minimumSalesForPayout,
    ),
  } satisfies ChannelPartnerCommissionConfig;
}

export function getLeadClosedAt(lead: LeadDoc) {
  return (
    toDate(lead.enrollmentDetails?.closedAt) ??
    toDate(lead.closedAt) ??
    toDate(lead.updatedAt) ??
    toDate(lead.createdAt)
  );
}

export function isLeadClosedWithinMonth(lead: LeadDoc, anchor = new Date()) {
  if (!isClosedLeadStatus(lead.status)) return false;
  const closedAt = getLeadClosedAt(lead);
  if (!closedAt) return false;
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const nextMonthStart = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return closedAt.getTime() >= monthStart.getTime() && closedAt.getTime() < nextMonthStart.getTime();
}

export function calculateChannelPartnerCommission(input: {
  saleCount: number;
  config: ChannelPartnerCommissionConfig;
}): ChannelPartnerCommissionBreakdown {
  const saleCount = Math.max(0, Math.floor(input.saleCount));
  const config = normalizeChannelPartnerCommissionConfig(input.config);
  const eligible = saleCount >= config.minimumSalesForPayout;
  if (!eligible) {
    return {
      saleCount,
      eligible: false,
      baseAmount: 0,
      bonusAmount: 0,
      totalAmount: 0,
    };
  }

  const threshold = config.bonusThresholdSales;
  const baseAmount = saleCount * config.basePerSale;
  const bonusAmount = Math.max(0, saleCount - threshold) * config.bonusPerSaleAfterThreshold;
  return {
    saleCount,
    eligible: true,
    baseAmount,
    bonusAmount,
    totalAmount: baseAmount + bonusAmount,
  };
}
