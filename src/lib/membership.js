// Membership plans (owner, 1 Nov: "Choose your gaming membership plan" — Basic / Premium / Pro, hours for a
// price, PC and PS5). Stored as data in shop_settings.membership, edited in Admin → Website.
// The discount is worked out against the normal 1-hour rate, so it stays right if the plan or the rates change.
export function planDiscount(price, hours, hourly) {
  if (!price || !hours || !hourly) return null
  const d = (1 - price / (hours * hourly)) * 100
  return d > 0 ? Math.round(d * 10) / 10 : null
}
export const hourlyRate = (rates = [], kind) => Number(rates.find((r) => r.kind === kind && r.minutes === 60 && !r.happy)?.price) || null
