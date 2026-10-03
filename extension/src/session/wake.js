/**
 * 唤醒协调器。普通唤醒使用 1500ms 看门狗；已校验阅读缓存通过独立入口即时消费。
 */
(function (root, factory) {
  const api = factory(root.BreakGlass || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BreakGlass = root.BreakGlass || {};
  root.BreakGlass.wake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BreakGlass) {
  const validate = BreakGlass.validate || (typeof require === 'function' ? require('../curve/validate') : null);
  const attemptApi = BreakGlass.attempt || (typeof require === 'function' ? require('../attempt/simulator') : null);

  /**
   * 懒取样例装载器：页面里 preset/load.js 比 wake.js 后加载，所以只在调用时查找。
   * @returns {{ loadVisionFixture: Function } | null}
   */
  function visionLoader() {
    const live = BreakGlass.preset;
    if (live && typeof live.loadVisionFixture === 'function') return live;
    if (typeof require === 'function') {
      try {
        const api = require('../preset/load');
        if (api && typeof api.loadVisionFixture === 'function') return api;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  const PRESET_UNAVAILABLE = '当前帧没有可用的准备结果，无法进入交互。';
  const WATCHDOG_UNAVAILABLE = '无法安排保底等待，未进入交互。';
  const EXTERNAL_UNAVAILABLE = '外部结果不可用，未进入交互。';
  const MOCK_DISABLED = '本地预制未启用，无法进入交互。';
  /** 看门狗、替身迟到和预制门禁共用的延迟。配置不是这个值时，不另起一个定时器。 */
  const REQUIRED_FALLBACK_MS = 1500;

  /**
   * @param {object} options
   * @param {object} options.session 现有 SessionController
   * @param {object} options.config enableLocalMock、fallbackAfterMs、prewarmed、externalAttempt
   * @param {object | null} options.preset 已装入的预制结果；没有匹配预制时为 null
   * @param {{ now: () => number, schedule: (delayMs: number, handler: Function) => unknown, clear: (timerId: unknown) => void }} options.clock
   * @param {(state: object) => void} [options.onChange]
   * @param {{ start: Function, abort: Function }} [options.attempt] 仅测试注入；页面不得传入
   * @param {boolean} [options.cachedReading] 仅显式 true 可消费已校验的外部阅读缓存
   * @returns {{ start: Function, startCached: Function, cancel: Function, exit: Function, onPlaybackChange: Function, dispose: Function }}
   */
  function createWake({ session, config, preset, clock, onChange, attempt, cachedReading } = {}) {
    let generation = 0;
    let timerId = null;
    let activeAttempt = null;
    const time = clock || {
      now() { return 0; },
      schedule() { return null; },
      clear() {}
    };

    /**
     * 每个判定点都重新读配置，不沿用上一次唤醒时的开关。
     * @returns {{ enableLocalMock: unknown, fallbackAfterMs: unknown, prewarmed: unknown, externalAttempt: unknown }}
     */
    function readConfig() {
      const source = config || {};
      return {
        enableLocalMock: source.enableLocalMock,
        fallbackAfterMs: source.fallbackAfterMs,
        prewarmed: source.prewarmed,
        externalAttempt: source.externalAttempt,
        // 只有显式写 fixture 才算打开；缺省或其他值一律按 off。
        visionAdapter: source.visionAdapter === 'fixture' ? 'fixture' : 'off'
      };
    }

    /**
     * 作废当前请求，并清掉看门狗和替身定时器。
     */
    function disarm() {
      generation += 1;
      if (timerId != null) {
        time.clear(timerId);
        timerId = null;
      }
      if (activeAttempt && typeof activeAttempt.abort === 'function') activeAttempt.abort();
    }

    /**
     * @param {string} requestId
     * @param {number} token
     * @returns {boolean}
     */
    function stillWaiting(requestId, token) {
      if (token !== generation) return false;
      const state = session.getState();
      return state.status === 'waiting' && state.requestId === requestId;
    }

    /**
     * 把会话的公开状态交给页面。不另带 reason、decisionAt 或根上的 fallback。
     */
    function publish() {
      if (typeof onChange !== 'function') return;
      onChange(session.getState());
    }

    /**
     * @param {object} ctx
     * @returns {object}
     */
    function expected(ctx) {
      return {
        videoId: ctx.videoId,
        targetTime: session.targetTime,
        timeTolerance: session.timeTolerance,
        frameSize: ctx.frameSize,
        requestId: ctx.requestId
      };
    }

    /**
     * place-in-frame.js 比本文件后加载，调用时再取。
     * @returns {{ placeRegionInFrame: Function } | null}
     */
    function frameFitApi() {
      const live = BreakGlass.frameFit;
      if (live && typeof live.placeRegionInFrame === 'function') return live;
      if (typeof require === 'function') {
        try {
          const api = require('../preset/place-in-frame');
          if (api && typeof api.placeRegionInFrame === 'function') return api;
        } catch (error) {
          return null;
        }
      }
      return null;
    }

    /**
     * 把预制区域从它自己的源像素放进当前视频帧。放不下时返回 null，不改已装入的预制对象。
     * @param {object} source
     * @param {{ width: number, height: number }} frameSize
     * @returns {{ frameSize: { width: number, height: number }, definition: object } | null}
     */
    function placePreset(source, frameSize) {
      const definition = source && source.definition;
      const fit = frameFitApi();
      if (!definition || !fit) return null;
      const placed = fit.placeRegionInFrame(source.frameSize, definition.region, frameSize);
      if (!placed) return null;
      return {
        frameSize: placed.frameSize,
        definition: {
          equationId: definition.equationId,
          parameters: definition.parameters,
          dragParameter: definition.dragParameter,
          domain: definition.domain,
          range: definition.range,
          yAxis: definition.yAxis,
          region: placed.region
        }
      };
    }

    /**
     * 装订本次请求编号。区域按当前视频源尺寸缩放，结果画幅改为这一帧，再交给校验器复核。
     * @param {object} source
     * @param {string} requestId
     * @param {null | 'timeout'} fallback
     * @param {{ width: number, height: number }} frameSize
     * @returns {object}
     */
    function bindPreset(source, requestId, fallback, frameSize) {
      const placed = placePreset(source, frameSize);
      if (!placed) return null;
      return {
        requestId,
        videoId: source.videoId,
        time: source.time,
        frameSize: placed.frameSize,
        source: 'preset',
        fallback,
        definition: placed.definition
      };
    }

    /**
     * 画幅必须和当前帧一致。识别样例不按比例放大到另一张片子上。
     * @param {object | null | undefined} sample
     * @param {{ width: number, height: number }} frameSize
     * @returns {boolean}
     */
    function framesMatch(sample, frameSize) {
      const frame = sample && sample.frameSize;
      return Boolean(frame) && frame.width === frameSize.width && frame.height === frameSize.height;
    }

    /**
     * 识别样例在画幅已经对齐后装订区域，并保留它自己的溯源标记。
     * 与 bindPreset 的差别只有来源、fallback 固定为 null，以及 evidence / confidence 原样带过。
     * @param {object} source
     * @param {string} requestId
     * @param {{ width: number, height: number }} frameSize
     * @returns {object}
     */
    function bindVision(source, requestId, frameSize) {
      const placed = placePreset(source, frameSize);
      if (!placed) return null;
      const candidate = {
        requestId,
        videoId: source.videoId,
        time: source.time,
        frameSize: placed.frameSize,
        source: 'vision',
        fallback: null,
        definition: placed.definition
      };
      if (source.evidence !== undefined) candidate.evidence = source.evidence;
      if (source.confidence !== undefined) candidate.confidence = source.confidence;
      return candidate;
    }

    /**
     * @param {object} candidate
     * @param {object} ctx
     * @param {object} [extra] 追加的校验上下文；只有识别路径才传 `{ allowVision: true }`
     * @returns {{ ok: boolean, code?: string, message?: string }}
     */
    function checkCandidate(candidate, ctx, extra) {
      if (!validate || typeof validate.validateCurveResult !== 'function') {
        return { ok: false, code: 'validator_unavailable', message: '结果校验器不可用。' };
      }
      return validate.validateCurveResult(candidate, { ...expected(ctx), ...(extra || {}) });
    }

    /**
     * 配置里的回退延迟必须就是 1500。其它数值不换算成另一个看门狗。
     * @param {object} live
     * @returns {number | null}
     */
    function fallbackDelayMs(live) {
      return live.fallbackAfterMs === REQUIRED_FALLBACK_MS ? REQUIRED_FALLBACK_MS : null;
    }

    /**
     * @param {object} live
     * @returns {boolean}
     */
    function presetReady(live) {
      return live.enableLocalMock === true &&
        live.prewarmed === true &&
        fallbackDelayMs(live) === REQUIRED_FALLBACK_MS &&
        Boolean(preset) &&
        typeof preset === 'object';
    }

    /**
     * @param {object} live
     * @returns {{ code: string, message: string }}
     */
    function unavailableReason(live) {
      if (live.enableLocalMock !== true) return { code: 'preset_disabled', message: MOCK_DISABLED };
      return { code: 'preset_unavailable', message: PRESET_UNAVAILABLE };
    }

    /**
     * @param {object} ctx
     * @param {number} token
     * @param {string} code
     * @param {string} message
     */
    function deny(ctx, token, code, message) {
      if (!stillWaiting(ctx.requestId, token)) return;
      session.fail(code, message);
      disarm();
      publish();
    }

    /**
     * @param {object} ctx
     * @param {number} token
     * @param {null | 'timeout'} fallback
     * @returns {boolean}
     */
    function acceptPreset(ctx, token, fallback) {
      if (!stillWaiting(ctx.requestId, token)) return false;
      const live = readConfig();
      if (!presetReady(live)) {
        const reason = unavailableReason(live);
        deny(ctx, token, reason.code, reason.message);
        return false;
      }
      const candidate = bindPreset(preset, ctx.requestId, fallback, ctx.frameSize);
      if (!candidate) {
        deny(ctx, token, 'preset_unavailable', PRESET_UNAVAILABLE);
        return false;
      }
      const check = checkCandidate(candidate, ctx);
      if (!check.ok) {
        deny(ctx, token, 'preset_unavailable', PRESET_UNAVAILABLE);
        return false;
      }
      const resolved = session.resolve(candidate);
      if (!resolved.ok) {
        deny(ctx, token, 'preset_unavailable', PRESET_UNAVAILABLE);
        return false;
      }
      if (fallback === 'timeout') disarm();
      publish();
      return true;
    }

    /**
     * 识别样例路径：读包内样例 → 按冻结上下文装订 → 用同一个校验器放行。
     * 任何失败都只走 external_unavailable，不回落预制，也不新增错误码。
     * @param {object} ctx
     * @param {number} token
     */
    function acceptVision(ctx, token) {
      const loader = visionLoader();
      if (!loader) {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      timerId = time.schedule(REQUIRED_FALLBACK_MS, () => {
        timerId = null;
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
      });
      Promise.resolve()
        .then(() => loader.loadVisionFixture())
        .then((loaded) => {
          // 取消、退出、播放或离开目标时间之后到达的结果一律丢弃。
          if (!stillWaiting(ctx.requestId, token)) return;
          if (!loaded || loaded.ok !== true || !loaded.candidate) {
            deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
            return;
          }
          // 先按样例自己的画幅校验：缺证据、低可信度、越界区域在这里拒绝。
          // 画幅和当前帧不一致也拒绝，不能换算成另一张片子上的识别成功。
          const authored = checkCandidate(loaded.candidate, {}, { allowVision: true });
          if (!authored.ok || !framesMatch(authored.value, ctx.frameSize)) {
            deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
            return;
          }
          const candidate = bindVision(authored.value, ctx.requestId, ctx.frameSize);
          if (!candidate) {
            deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
            return;
          }
          const check = checkCandidate(candidate, ctx, { allowVision: true });
          if (!check.ok) {
            deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
            return;
          }
          const resolved = session.resolve(check.value, { allowVision: true });
          if (!resolved.ok) {
            deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
            return;
          }
          disarm();
          publish();
        }, () => {
          deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        });
    }

    /**
     * 只有 hang 和 late 可以在 1500ms 回退到预制。invalid 到点也不得画成成功。
     * @param {object} ctx
     * @param {number} token
     */
    function onTimeout(ctx, token) {
      if (!stillWaiting(ctx.requestId, token)) return;
      const live = readConfig();
      if (live.externalAttempt !== 'hang' && live.externalAttempt !== 'late') {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      acceptPreset(ctx, token, 'timeout');
    }

    /**
     * 迟到或已取消的结果直接丢掉，不改当前会话。
     * @param {object | null | undefined} payload
     * @param {object} ctx
     * @param {number} token
     */
    function onExternal(payload, ctx, token) {
      if (!stillWaiting(ctx.requestId, token)) return;
      const candidate = payload && payload.candidate;
      const check = candidate ? checkCandidate(candidate, ctx) : { ok: false, code: 'invalid_shape' };
      if (!check.ok || !candidate || candidate.source !== 'preset') {
        const live = readConfig();
        // hang / late 的 1.5 秒预制保底还在看门狗上。坏候选只丢弃，不把这次等待收成失败。
        if (live.externalAttempt === 'hang' || live.externalAttempt === 'late') return;
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      const resolved = session.resolve(candidate);
      if (!resolved.ok) {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      disarm();
      publish();
    }

    /**
     * @param {object} ctx
     * @param {number} token
     * @param {object} live
     * @param {number} delayMs 与看门狗相同的 1500
     */
    function listen(ctx, token, live, delayMs) {
      const created = attempt || (attemptApi && attemptApi.createAttempt({
        mode: live.externalAttempt,
        clock: time,
        lateAfterMs: delayMs,
        preset
      }));
      if (!created || typeof created.start !== 'function') {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      activeAttempt = created;
      let pendingResult;
      try {
        pendingResult = created.start(ctx);
      } catch {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return;
      }
      Promise.resolve(pendingResult).then((payload) => {
        onExternal(payload, ctx, token);
      }, () => {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
      });
    }

    /**
     * 阅读适配器已经按当前帧校验的缓存仍由规则层复核、装订并提交。
     * 缓存不得换画幅、换视频或洗掉来源；此入口不读取 Mock 配置，也不启动看门狗或替身。
     * @param {{ paused?: boolean, currentTime?: number, frameSize?: { width: number, height: number } }} [input]
     * @returns {{ ok: boolean, code?: string, message?: string, requestId?: string }}
     */
    function startCached(input = {}) {
      if (cachedReading !== true) {
        return { ok: false, code: 'external_unavailable', message: EXTERNAL_UNAVAILABLE };
      }
      const frame = input && input.frameSize;
      if (!input || input.paused !== true || !Number.isFinite(input.currentTime) ||
          !frame || !Number.isSafeInteger(frame.width) || frame.width <= 0 ||
          !Number.isSafeInteger(frame.height) || frame.height <= 0) {
        return { ok: false, code: 'not_ready', message: '请先暂停在目标时间。' };
      }
      const begun = session.beginWait({ paused: input.paused, currentTime: input.currentTime });
      if (!begun.ok) {
        publish();
        return begun;
      }
      const ctx = {
        requestId: begun.requestId,
        videoId: session.videoId,
        time: input.currentTime,
        frameSize: { width: frame.width, height: frame.height }
      };
      const token = generation;
      if (!preset || preset.source !== 'preset' || preset.fallback !== null ||
          preset.time !== session.targetTime || !framesMatch(preset, ctx.frameSize) ||
          !framesMatch({ frameSize: session.frameSize }, ctx.frameSize)) {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return startedResult(ctx);
      }
      // 先校验缓存本身的身份，再换成本次会话编号；不能靠装订掩盖缺失编号或坏数据。
      const authored = checkCandidate(preset, ctx, { requestId: preset.requestId });
      if (!authored.ok) {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return startedResult(ctx);
      }
      const resolved = session.resolve({ ...authored.value, requestId: ctx.requestId });
      if (!resolved.ok) {
        deny(ctx, token, 'external_unavailable', EXTERNAL_UNAVAILABLE);
        return startedResult(ctx);
      }
      publish();
      return startedResult(ctx);
    }

    /**
     * @param {{ paused?: boolean, currentTime?: number, frameSize?: { width: number, height: number } }} [input]
     * @returns {{ ok: boolean, code?: string, message?: string, requestId?: string }}
     */
    function start(input = {}) {
      const width = input.frameSize && input.frameSize.width;
      const height = input.frameSize && input.frameSize.height;
      if (!(width > 0) || !(height > 0)) {
        return { ok: false, code: 'not_ready', message: '请先暂停在目标时间。' };
      }
      const begun = session.beginWait({ paused: input.paused, currentTime: input.currentTime });
      if (!begun.ok) {
        publish();
        return begun;
      }
      const ctx = {
        requestId: begun.requestId,
        videoId: session.videoId,
        time: input.currentTime,
        frameSize: {
          width: input.frameSize && input.frameSize.width,
          height: input.frameSize && input.frameSize.height
        }
      };
      if (ctx.frameSize.width > 0 && ctx.frameSize.height > 0) {
        session.frameSize = { width: ctx.frameSize.width, height: ctx.frameSize.height };
      }
      const token = generation;
      const live = readConfig();
      if (live.externalAttempt === 'off' && live.visionAdapter === 'fixture') {
        // 识别样例不人为等待：本地读完即结算，失败即 external_unavailable。
        acceptVision(ctx, token);
        return startedResult(ctx);
      }
      if (live.externalAttempt === 'off') {
        acceptPreset(ctx, token, null);
        const state = session.getState();
        return {
          ok: state.status === 'interactive',
          requestId: ctx.requestId,
          code: state.code || undefined,
          message: state.message || undefined
        };
      }
      const delay = fallbackDelayMs(live);
      if (delay == null) {
        deny(ctx, token, 'preset_unavailable', PRESET_UNAVAILABLE);
        const failed = session.getState();
        return {
          ok: false,
          requestId: ctx.requestId,
          code: failed.code || 'preset_unavailable',
          message: failed.message || PRESET_UNAVAILABLE
        };
      }
      if (!clock || typeof clock.schedule !== 'function' || typeof clock.clear !== 'function') {
        deny(ctx, token, 'preset_unavailable', WATCHDOG_UNAVAILABLE);
        return startedResult(ctx);
      }
      timerId = time.schedule(delay, () => {
        timerId = null;
        onTimeout(ctx, token);
      });
      listen(ctx, token, live, delay);
      return startedResult(ctx);
    }

    /**
     * 还在等待时算已开始。同步失败（没有装载器、替身立刻抛错）不能报成成功。
     * @param {object} ctx
     * @returns {{ ok: boolean, code?: string, message?: string, requestId?: string }}
     */
    function startedResult(ctx) {
      const state = session.getState();
      if (state.status === 'waiting') {
        publish();
        return { ok: true, requestId: ctx.requestId };
      }
      return {
        ok: state.status === 'interactive',
        requestId: ctx.requestId,
        code: state.code || undefined,
        message: state.message || undefined
      };
    }

    function cancel() {
      disarm();
      session.cancel();
      publish();
      return session.getState();
    }

    function exit() {
      disarm();
      session.exit();
      publish();
      return session.getState();
    }

    /**
     * @param {{ paused?: boolean, currentTime?: number }} [playback]
     * @returns {ReturnType<typeof session.getState>}
     */
    function onPlaybackChange(playback) {
      const before = session.getState();
      session.onPlaybackChange(playback || {});
      if (before.status !== 'paused-ready' && session.status === 'paused-ready') {
        disarm();
      }
      const after = session.getState();
      if (before.status !== after.status || before.requestId !== after.requestId) publish();
      return after;
    }

    function dispose() {
      disarm();
      if (session.status === 'waiting' || session.status === 'interactive' || session.status === 'recoverable-error') {
        session.exit();
      }
      publish();
    }

    return { start, startCached, cancel, exit, onPlaybackChange, dispose };
  }

  return { createWake };
});
