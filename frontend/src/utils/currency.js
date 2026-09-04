/**
 * FinGraph Indian Rupee (INR - ₹) Currency Formatting & Conversion Utilities
 * Default Exchange Rate: 1 USD = 83 INR (configurable)
 */

export const DEFAULT_EXCHANGE_RATE = 83.0;
export const DEFAULT_CURRENCY = "INR";

/**
 * Converts a USD amount to INR using the given exchange rate.
 * @param {number} usdAmount
 * @param {number} [rate=83.0]
 * @returns {number}
 */
export function convertUsdToInr(usdAmount, rate = DEFAULT_EXCHANGE_RATE) {
  const num = Number(usdAmount) || 0;
  return num * rate;
}

/**
 * Converts an INR amount to USD using the given exchange rate.
 * @param {number} inrAmount
 * @param {number} [rate=83.0]
 * @returns {number}
 */
export function convertInrToUsd(inrAmount, rate = DEFAULT_EXCHANGE_RATE) {
  const num = Number(inrAmount) || 0;
  return rate > 0 ? num / rate : 0;
}

/**
 * Formats a number with Indian numbering system (e.g., 8,13,400.00 or 8,13,400) with ₹ symbol.
 * @param {number|string} amount
 * @param {Object} [options={}]
 * @param {number} [options.minimumFractionDigits=2]
 * @param {number} [options.maximumFractionDigits=2]
 * @param {boolean} [options.showSymbol=true]
 * @returns {string}
 */
export function formatINR(amount, options = {}) {
  const num = Number(amount) || 0;
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    showSymbol = true,
  } = options;

  const formattedNumber = num.toLocaleString("en-IN", {
    minimumFractionDigits,
    maximumFractionDigits,
  });

  return showSymbol ? `₹${formattedNumber}` : formattedNumber;
}

/**
 * Compact Indian Number Formatter for badges, tooltips, and canvas graphs:
 * - ≥ 1 Crore (1,00,00,000) -> ₹1.2Cr or ₹1.20Cr
 * - ≥ 1 Lakh (1,00,000)     -> ₹8.1L or ₹8.13L
 * - ≥ 1 Thousand (1,000)    -> ₹8.1k
 * - < 1,000                 -> ₹500
 *
 * @param {number|string} amount
 * @param {Object} [options={}]
 * @param {boolean} [options.showSymbol=true]
 * @param {number} [options.precision=1]
 * @returns {string}
 */
export function formatCompactINR(amount, options = {}) {
  const num = Number(amount) || 0;
  const { showSymbol = true, precision = 1 } = options;
  const symbol = showSymbol ? "₹" : "";

  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";

  if (abs >= 10000000) {
    const cr = abs / 10000000;
    const formatted = cr >= 10 ? cr.toFixed(precision) : cr.toFixed(precision + 1);
    return `${sign}${symbol}${parseFloat(formatted)}Cr`;
  }

  if (abs >= 100000) {
    const l = abs / 100000;
    const formatted = l >= 10 ? l.toFixed(precision) : l.toFixed(precision + 1);
    return `${sign}${symbol}${parseFloat(formatted)}L`;
  }

  if (abs >= 1000) {
    return `${sign}${symbol}${(abs / 1000).toFixed(precision)}k`;
  }

  return `${sign}${symbol}${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Unified currency formatter supporting both INR and USD.
 * @param {number|string} amount
 * @param {string} [currency="INR"] - "INR" | "USD"
 * @param {Object} [options={}]
 * @returns {string}
 */
export function formatCurrency(amount, currency = "INR", options = {}) {
  const num = Number(amount) || 0;
  const curr = (currency || "INR").toUpperCase();

  if (curr === "USD") {
    const {
      minimumFractionDigits = 2,
      maximumFractionDigits = 2,
      showSymbol = true,
      compact = false,
    } = options;

    if (compact) {
      if (Math.abs(num) >= 1000000) return `${showSymbol ? "$" : ""}${(num / 1000000).toFixed(1)}M`;
      if (Math.abs(num) >= 1000) return `${showSymbol ? "$" : ""}${(num / 1000).toFixed(1)}k`;
      return `${showSymbol ? "$" : ""}${num.toFixed(0)}`;
    }

    const formatted = num.toLocaleString("en-US", {
      minimumFractionDigits,
      maximumFractionDigits,
    });
    return showSymbol ? `$${formatted}` : formatted;
  }

  // Default: INR
  if (options.compact) {
    return formatCompactINR(num, options);
  }

  return formatINR(num, options);
}
