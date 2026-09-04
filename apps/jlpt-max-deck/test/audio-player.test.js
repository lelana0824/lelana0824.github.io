import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LocalAudioPlayer,
  configurePlaybackAudioSession,
  isMissingObjectError,
} from '../src/audio-player.js';

test('iOS의 객체 누락 오류를 재시도 대상으로 판별한다', () => {
  assert.equal(isMissingObjectError(new Error('This object is not found')), true);
  assert.equal(isMissingObjectError({ name: 'NotFoundError', message: 'Missing' }), true);
  assert.equal(isMissingObjectError(new Error('Decode failed')), false);
});

test('사용자 탭에서 오디오 컨텍스트를 먼저 활성화하고 MP3를 직접 재생한다', async () => {
  const events = [];
  let loads = 0;
  let decodes = 0;
  let starts = 0;

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.destination = {};
    }

    resume() {
      events.push('resume');
      this.state = 'running';
      return Promise.resolve();
    }

    decodeAudioData(buffer) {
      events.push('decode');
      decodes += 1;
      assert.deepEqual([...new Uint8Array(buffer)], [0xff, 0xfb, 0x10]);
      return Promise.resolve({ duration: 0.5 });
    }

    createBufferSource() {
      events.push('source');
      return {
        connect: () => events.push('connect'),
        start: () => {
          events.push('start');
          starts += 1;
        },
        stop: () => events.push('stop'),
        addEventListener: () => {},
      };
    }

    close() {}
  }

  const backing = new Uint8Array([0, 0xff, 0xfb, 0x10, 0]);
  const player = new LocalAudioPlayer({
    contextClass: FakeAudioContext,
    navigatorObject: {},
    loadBytes: async () => {
      events.push('load');
      loads += 1;
      return backing.subarray(1, 4);
    },
  });

  await player.play('sample.mp3');
  await player.play('sample.mp3');

  assert.equal(events[0], 'resume');
  assert.equal(loads, 1);
  assert.equal(decodes, 1);
  assert.equal(starts, 2);
});

test('iOS 음성 재생 전에 오디오 세션을 playback으로 지정한다', async () => {
  const assigned = [];
  const session = {
    current: 'ambient',
    get type() { return this.current; },
    set type(value) {
      assigned.push(value);
      this.current = value;
    },
  };
  const player = new LocalAudioPlayer({
    contextClass: null,
    navigatorObject: { audioSession: session },
    loadBytes: async () => new Uint8Array(),
  });
  player.playFallback = async () => {};

  await player.play('sample.mp3');

  assert.deepEqual(assigned, ['playback']);
  assert.equal(session.type, 'playback');
  assert.equal(configurePlaybackAudioSession({}), false);
});
