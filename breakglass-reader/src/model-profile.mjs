export const MODEL_PROFILE_VERSION = 'recognition-profile-v1';
const REASONING = new Set(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const PROFILE_FIELDS = ['profileVersion', 'temperaturePolicy', 'temperature', 'reasoningEffort', 'imageTransport'];
export class ModelProfileError extends Error {
  constructor(code) {
    super(({ invalid_model_profile: '模型能力配置无效。', unconfigured: '视觉模型尚未配置。',
      unsupported_image_transport: '当前模型传输策略不支持 inline JPEG；不会公开或上传图片地址。' })[code] || '模型配置不可用。');
    this.name = 'ModelProfileError'; this.code = code;
  }
}
const invalid = () => { throw new ModelProfileError('invalid_model_profile'); };

function validateProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  if (Reflect.ownKeys(value).length !== PROFILE_FIELDS.length || !PROFILE_FIELDS.every((key) => {
    const entry = Object.getOwnPropertyDescriptor(value, key);
    return entry && entry.enumerable && Object.hasOwn(entry, 'value');
  })) return invalid();
  if (value.profileVersion !== MODEL_PROFILE_VERSION || !['fixed', 'omit'].includes(value.temperaturePolicy)
    || typeof value.temperature !== 'number' || !Number.isFinite(value.temperature)
    || value.temperature < 0 || value.temperature > 2 || !REASONING.has(value.reasoningEffort)
    || !['inline', 'public-url'].includes(value.imageTransport)) return invalid();
  return Object.freeze({ ...value });
}

/** Strict server environment options only; no arbitrary supplier JSON, headers or retry policy. */
export function loadModelProfile(env = {}) {
  const option = (key, fallback) => {
    if (env[key] === undefined) return fallback;
    if (typeof env[key] !== 'string') return invalid();
    return env[key].trim();
  };
  const temperature = option('READER_TEMPERATURE', '0');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(temperature)) return invalid();
  return validateProfile({ profileVersion: MODEL_PROFILE_VERSION,
    temperaturePolicy: option('READER_TEMPERATURE_POLICY', 'fixed'), temperature: Number(temperature),
    reasoningEffort: option('READER_REASONING_EFFORT', ''), imageTransport: option('READER_IMAGE_TRANSPORT', 'inline') });
}
function profile(settings) {
  return settings.modelProfile === undefined ? loadModelProfile() : validateProfile(settings.modelProfile);
}
/** Stable non-secret configuration identity for gateway/cache versioning. */
export function modelProfileIdentity(settings = {}) {
  const value = profile(settings);
  return Object.freeze({ ...value, temperature: value.temperaturePolicy === 'omit' ? null : value.temperature,
    jsonMode: settings.jsonMode === true });
}
export function buildModelRequest(settings, messages) {
  const value = profile(settings);
  if (![settings.baseUrl, settings.apiKey, settings.model].every((item) => typeof item === 'string' && Boolean(item.trim())))
    throw new ModelProfileError('unconfigured');
  if (value.imageTransport === 'public-url' && messages.some((message) => Array.isArray(message.content)
    && message.content.some((part) => part?.type === 'image_url' && typeof part.image_url?.url === 'string'
      && /^data:/i.test(part.image_url.url)))) throw new ModelProfileError('unsupported_image_transport');
  const body = { model: settings.model, messages };
  if (value.temperaturePolicy === 'fixed') body.temperature = value.temperature;
  if (value.reasoningEffort) body.reasoning_effort = value.reasoningEffort;
  if (settings.jsonMode === true) body.response_format = { type: 'json_object' };
  return body;
}
