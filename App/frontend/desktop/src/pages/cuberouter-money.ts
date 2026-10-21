/** Cuberouter balance display helpers. */
import type { CuberouterCurrencySettings } from "@memmy/local-api-contracts";

/**
 * Turns raw cuberouter quota into the amount the instance wants shown. Mirrors
 * `formatQuotaWithCurrency` in cuberouter's web app: quota / quotaPerUnit * USD→currency rate,
 * two decimals at or above 1 and four below it. An older backend (or an instance that displays
 * raw quota) keeps the raw number.
 */
export function formatCuberouterRemaining(
  quota: number,
  currency: CuberouterCurrencySettings | undefined,
  language: string
): string {
  if (!currency || currency.displayType === "TOKENS") {
    return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(quota);
  }

  const amount = (quota / currency.quotaPerUnit) * currency.usdToCurrencyRate;
  const digits = Math.abs(amount) >= 1 ? 2 : 4;
  const formatted = new Intl.NumberFormat(language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(amount);
  // cuberouter separates a custom symbol from the number ("HKD 7.3"); the built-in currency
  // symbols read naturally attached ("¥53.29").
  return currency.displayType === "CUSTOM"
    ? `${currency.symbol} ${formatted}`
    : `${currency.symbol}${formatted}`;
}
