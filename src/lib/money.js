// Monetary values use standard half-up rounding to two decimal places.
// Scaling EPSILON by the value avoids binary floating-point cases such as 1.005.
export const roundMoney = value => {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return 0
  const absolute = Math.abs(number)
  const rounded = Math.round((absolute + Number.EPSILON * Math.max(1, absolute)) * 100) / 100
  return number < 0 ? -rounded : rounded
}
