export const EQUATION_LIMITS = Object.freeze({ coefficient: 1e6, minimumA: 1e-6 });

// Read only own data properties. Candidate coefficients never execute getters or expressions.
function exactData(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every((key) => {
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property && property.enumerable && Object.hasOwn(property, 'value');
  });
}
function bounded(value) {
  return typeof value === 'number' && Number.isFinite(value)
    && Math.abs(value) <= EQUATION_LIMITS.coefficient;
}
const invalid = () => ({ ok: false, reason: 'equation_invalid' });

/** A finite candidate conversion, not proof that the formula was read correctly from a frame. */
export function normaliseEquation(value) {
  try {
    let form;
    if (exactData(value, ['a', 'h', 'k'])) form = 'legacy';
    else if (exactData(value, ['form', 'a', 'b', 'c']) && value.form === 'general') form = 'general';
    else if (exactData(value, ['form', 'a', 'h', 'k']) && value.form === 'vertex') form = 'vertex';
    else return invalid();
    const coefficients = form === 'general' ? [value.a, value.b, value.c] : [value.a, value.h, value.k];
    if (!coefficients.every(bounded) || Math.abs(value.a) < EQUATION_LIMITS.minimumA) return invalid();
    let h;
    let k;
    if (form === 'general') {
      const divisor = 2 * value.a;
      const square = value.b * value.b;
      const quarterDivisor = 4 * value.a;
      if (!Number.isFinite(divisor) || divisor === 0 || !Number.isFinite(square)
        || !Number.isFinite(quarterDivisor) || quarterDivisor === 0) return invalid();
      h = -value.b / divisor;
      const displacement = square / quarterDivisor;
      if (!Number.isFinite(h) || !Number.isFinite(displacement)) return invalid();
      k = value.c - displacement;
    } else {
      h = value.h; k = value.k;
    }
    if (![value.a, h, k].every(bounded)) return invalid();
    return { ok: true, params: { a: value.a, h: h === 0 ? 0 : h, k: k === 0 ? 0 : k }, form };
  } catch {
    return invalid();
  }
}
