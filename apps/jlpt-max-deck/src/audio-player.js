function exactArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function isMissingObjectError(error) {
  return /object.*not found|notfounderror/i.test(`${error?.name || ''} ${error?.message || ''}`);
}

export function configurePlaybackAudioSession(navigatorObject = globalThis.navigator) {
  try {
    const session = navigatorObject?.audioSession;
    if (!session || !('type' in session)) return false;
    session.type = 'playback';
    return session.type === 'playback';
  } catch {
    return false;
  }
}

export class LocalAudioPlayer {
  constructor({ loadBytes, maxCached = 12, contextClass, navigatorObject } = {}) {
    if (typeof loadBytes !== 'function') throw new Error('음성 로더가 필요합니다.');
    this.loadBytes = loadBytes;
    this.maxCached = maxCached;
    this.ContextClass = contextClass === undefined
      ? globalThis.AudioContext || globalThis.webkitAudioContext
      : contextClass;
    this.navigatorObject = navigatorObject === undefined ? globalThis.navigator : navigatorObject;
    this.context = null;
    this.buffers = new Map();
    this.currentSource = null;
    this.fallbackAudio = null;
    this.fallbackUrl = '';
  }

  ensureContext() {
    if (!this.context && this.ContextClass) this.context = new this.ContextClass();
    return this.context;
  }

  async decodedBuffer(filename, context) {
    if (!this.buffers.has(filename)) {
      const pending = this.loadBytes(filename)
        .then((bytes) => context.decodeAudioData(exactArrayBuffer(bytes)))
        .catch((error) => {
          this.buffers.delete(filename);
          throw error;
        });
      this.buffers.set(filename, pending);
    }
    const buffer = await this.buffers.get(filename);
    if (this.buffers.size > this.maxCached) {
      const oldest = this.buffers.keys().next().value;
      this.buffers.delete(oldest);
    }
    return buffer;
  }

  async play(filename, mimeType = 'audio/mpeg') {
    configurePlaybackAudioSession(this.navigatorObject);
    const context = this.ensureContext();
    if (!context) return this.playFallback(filename, mimeType);

    // iOS는 사용자 탭 처리 중 오디오 컨텍스트를 먼저 활성화해야 안정적으로 재생합니다.
    const resume = context.state === 'running' ? Promise.resolve() : context.resume();
    const buffer = this.decodedBuffer(filename, context);
    await resume;

    this.currentSource?.stop();
    const source = context.createBufferSource();
    source.buffer = await buffer;
    source.connect(context.destination);
    source.addEventListener?.('ended', () => {
      if (this.currentSource === source) this.currentSource = null;
    }, { once: true });
    this.currentSource = source;
    source.start(0);
  }

  async playFallback(filename, mimeType) {
    const bytes = await this.loadBytes(filename);
    if (!this.fallbackAudio) this.fallbackAudio = new Audio();
    this.fallbackAudio.pause();
    if (this.fallbackUrl) URL.revokeObjectURL(this.fallbackUrl);
    this.fallbackUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    this.fallbackAudio.src = this.fallbackUrl;
    await this.fallbackAudio.play();
  }

  dispose() {
    try {
      this.currentSource?.stop();
    } catch {
      // 이미 끝난 소스는 중지할 필요가 없습니다.
    }
    this.fallbackAudio?.pause();
    if (this.fallbackUrl) URL.revokeObjectURL(this.fallbackUrl);
    this.context?.close?.();
    this.buffers.clear();
  }
}
