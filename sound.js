/*
 * 効果音と振動
 *
 *   Sound.play('move', { seat: 0 })   … 効果音を鳴らし、対応する振動も出す
 *   Sound.setMuted(true/false)        … 音と振動をまとめてオン/オフ（端末に記憶）
 *
 * 音は Web Audio API でその場で合成するので、音声ファイルは不要。
 * ▼ 差し替えポイント：SOUND_FILES にパスを入れると、合成音の代わりにその音声ファイルを再生します。
 *
 * 注意：
 *   - スマホのブラウザは「画面に触れるまで音を出せない」ため、最初のタップで音声を有効化します。
 *   - iPhone はマナーモード中だと Web Audio の音が鳴りません。振動（vibrate）も iPhone の Safari は非対応です。
 */
window.Sound = (() => {
  'use strict';

  const SOUND_FILES = {
    move: null,      // 例) 'sound/move.mp3'
    arm: null,
    skill: null,
    capture: null,
    castle: null,
    pass: null,
    tick: null,
    clash: null,     // 近接攻撃
    shoot: null,     // 弓・鉄砲
    destroy: null,   // 部隊を撃破
    item: null,      // アイテム入手
    start: null,     // 例) 'sound/horagai.mp3'（ほら貝）
    win: null,
  };

  // 振動パターン（ミリ秒。[振動, 休み, 振動, ...]）
  const HAPTICS = {
    move: 12,
    arm: 20,
    skill: [40, 40, 90],
    capture: [25, 35, 25, 35, 60],
    castle: [80, 60, 120],
    pass: [60, 50, 60],
    start: [30, 60, 120],
    win: [100, 60, 100, 60, 250],
    clash: 15,
    shoot: 10,
    destroy: [60, 40, 120],
    item: [15, 30, 15],
  };

  const MASTER_VOLUME = 0.6;
  const STORAGE_KEY = 'doubutsu-sengoku.muted';

  // 雅な「ヨナ抜き音階（ヨ音階）」D E G A B
  const YO = { D5: 587.3, E5: 659.3, G5: 784.0, A5: 880.0, B5: 987.8, D6: 1174.7, E6: 1318.5 };

  let ctx = null;
  let master = null;
  let isMuted = loadMuted();
  const buffers = new Map();   // 差し替え音声のデコード済みデータ

  function loadMuted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function saveMuted(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // プライベートブラウズ等で保存できなくても、この画面の間は設定が効くので無視してよい
    }
  }

  /** 最初のタップで AudioContext を作る／再開する（スマホの自動再生制限対策） */
  function unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = MASTER_VOLUME;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // ===== 合成の部品 =====
  /**
   * 1音を鳴らす。
   * @param {{ freq:number, freqEnd?:number, type?:OscillatorType, dur:number, vol?:number,
   *           delay?:number, lowpass?:number, vibrato?:number }} o
   */
  function tone(o) {
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t0 + o.dur);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

    let out = osc;
    if (o.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.lowpass;
      out.connect(filter);
      out = filter;
    }
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = o.vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + o.dur);
    }
    out.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  /** ノイズ（太鼓の皮の響き・風切り音など） */
  function noise({ dur, vol = 0.2, delay = 0, lowpass = 1200 }) {
    const t0 = ctx.currentTime + delay;
    const length = Math.ceil(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  /** 和太鼓「ドン」 */
  const taiko = (delay = 0, vol = 0.8) => {
    tone({ freq: 140, freqEnd: 48, dur: 0.4, vol, delay });
    noise({ dur: 0.12, vol: vol * 0.35, delay, lowpass: 700 });
  };

  // ===== 効果音のレシピ =====
  const SYNTHS = {
    // 移動：ぽこっ（赤は高め、青は低めで聞き分けられる）
    move: ({ seat = 0 } = {}) => {
      const base = seat === 0 ? 560 : 440;
      tone({ freq: base, freqEnd: base * 1.6, dur: 0.11, vol: 0.28, type: 'sine' });
    },
    // 技ボタンを構えた：きらっ
    arm: () => {
      tone({ freq: YO.A5, dur: 0.12, vol: 0.15, type: 'triangle' });
      tone({ freq: YO.E6, dur: 0.2, vol: 0.12, type: 'triangle', delay: 0.07 });
    },
    // 技の発動：ドドン！＋しゃらん
    skill: () => {
      taiko(0);
      taiko(0.17, 0.9);
      [YO.D6, YO.E6, YO.B5].forEach((f, i) => tone({ freq: f, dur: 0.35, vol: 0.08, type: 'triangle', delay: 0.32 + i * 0.05 }));
    },
    // 包囲：ヨ音階の駆け上がり
    capture: () => {
      [YO.D5, YO.E5, YO.G5, YO.A5, YO.B5, YO.D6].forEach((f, i) => {
        tone({ freq: f, dur: 0.22, vol: 0.18, type: 'triangle', delay: i * 0.06 });
      });
    },
    // 城を落とした：ごーん（銅鑼）
    castle: () => {
      tone({ freq: 196, dur: 1.4, vol: 0.35 });
      tone({ freq: 196 * 2.76, dur: 0.9, vol: 0.08 });
      tone({ freq: 196 * 1.51, dur: 1.1, vol: 0.12 });
      noise({ dur: 0.25, vol: 0.12, lowpass: 2500 });
    },
    // パス：ぶぶー
    pass: () => {
      tone({ freq: 220, freqEnd: 150, dur: 0.18, vol: 0.12, type: 'square', lowpass: 1200 });
      tone({ freq: 200, freqEnd: 130, dur: 0.25, vol: 0.12, type: 'square', lowpass: 1200, delay: 0.2 });
    },
    // 近接攻撃：かきん（金属音）
    clash: () => {
      noise({ dur: 0.08, vol: 0.25, lowpass: 5000 });
      tone({ freq: 1800, freqEnd: 1400, dur: 0.12, vol: 0.08, type: 'square', lowpass: 4000 });
    },
    // 弓・鉄砲：ぱんっ
    shoot: () => {
      noise({ dur: 0.14, vol: 0.35, lowpass: 2200 });
      tone({ freq: 320, freqEnd: 90, dur: 0.12, vol: 0.2 });
    },
    // 撃破：どどーん
    destroy: () => {
      taiko(0, 0.9);
      noise({ dur: 0.4, vol: 0.2, lowpass: 600, delay: 0.05 });
      tone({ freq: 110, freqEnd: 40, dur: 0.6, vol: 0.3, delay: 0.1 });
    },
    // アイテム入手：ちゃりん
    item: () => {
      tone({ freq: YO.B5, dur: 0.12, vol: 0.14, type: 'triangle' });
      tone({ freq: YO.E6, dur: 0.3, vol: 0.14, type: 'triangle', delay: 0.08 });
    },
    // 選択画面のタップ：こつ
    tick: () => tone({ freq: 1250, dur: 0.05, vol: 0.12, type: 'triangle' }),
    // 出陣：ほら貝「ぶおぉ〜」
    start: () => {
      tone({ freq: 185, freqEnd: 220, dur: 1.1, vol: 0.22, type: 'sawtooth', lowpass: 900, vibrato: 4 });
      tone({ freq: 370, freqEnd: 440, dur: 1.1, vol: 0.06, type: 'sawtooth', lowpass: 1400, vibrato: 6 });
      taiko(1.0);
    },
    // 勝利：太鼓＋ヨ音階のファンファーレ
    win: () => {
      taiko(0);
      taiko(0.2);
      const melody = [YO.D5, YO.E5, YO.G5, YO.A5, YO.G5, YO.A5, YO.D6];
      melody.forEach((f, i) => {
        const isLast = i === melody.length - 1;
        tone({ freq: f, dur: isLast ? 0.9 : 0.2, vol: 0.16, type: 'square', lowpass: 2400, delay: 0.4 + i * 0.16 });
      });
      taiko(0.4 + (melody.length - 1) * 0.16, 1);
    },
  };

  // ===== 差し替え音声ファイルの再生 =====
  function playFile(name, src) {
    const buffer = buffers.get(src);
    if (buffer instanceof AudioBuffer) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(master);
      node.start();
      return true;
    }
    if (!buffers.has(src)) {
      buffers.set(src, 'loading');
      fetch(src)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((data) => ctx.decodeAudioData(data))
        .then((decoded) => buffers.set(src, decoded))
        .catch((err) => {
          console.warn(`効果音「${name}」(${src}) を読み込めませんでした。合成音を使います`, err);
          buffers.set(src, 'failed');
        });
    }
    return false;   // 読み込み中・失敗時は合成音で代用
  }

  /**
   * 効果音＋振動を鳴らす。
   * @param {keyof SYNTHS} name
   * @param {{ seat?: number }} [opts]
   */
  function play(name, opts) {
    if (isMuted) return;
    // ブラウザは「画面に一度触れるまで」振動を許さないので、それまでは呼ばない
    const hasTouched = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
    if (HAPTICS[name] && navigator.vibrate && hasTouched) navigator.vibrate(HAPTICS[name]);

    unlock();
    if (!ctx) return;
    const file = SOUND_FILES[name];
    if (file && playFile(name, file)) return;
    const synth = SYNTHS[name];
    if (!synth) {
      console.warn(`未定義の効果音です: ${name}`);
      return;
    }
    synth(opts);
  }

  function setMuted(value) {
    isMuted = value;
    saveMuted(value);
    if (value && navigator.vibrate) navigator.vibrate(0);
  }

  // ===== 音のオン/オフボタン =====
  // data-sound-toggle を付けたボタンはすべて連動する（盤面の下と選択画面の2か所に置いている）
  const toggles = () => [...document.querySelectorAll('[data-sound-toggle]')];
  function renderToggles() {
    toggles().forEach((btn) => {
      btn.textContent = isMuted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', isMuted ? '音と振動：オフ（タップでオン）' : '音と振動：オン（タップでオフ）');
      btn.setAttribute('aria-pressed', String(!isMuted));
    });
  }
  toggles().forEach((btn) => btn.addEventListener('click', () => {
    setMuted(!isMuted);
    renderToggles();
    play('tick');
  }));
  renderToggles();

  // 最初のタップで音声を有効化（capture で、どのボタンより先に処理する）
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });

  return { play, setMuted, isMuted: () => isMuted };
})();
