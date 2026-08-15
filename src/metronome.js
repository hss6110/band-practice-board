import belugaSpriteUrl from './assets/beluga-metronome-sprite.png'
import bellySlapSoundUrl from './assets/beluga-belly-slap.wav'

const BPM_MIN = 40
const BPM_MAX = 240
const DEFAULT_BPM = 100
const DEFAULT_BEATS_PER_MEASURE = 4
const DEFAULT_VOLUME = 0.55
const DEFAULT_SOUND = 'belly'
const SOUND_TYPES = ['belly', 'click']
const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_SECONDS = 0.1

const STORAGE_KEYS = {
  bpm: 'beluga-metronome-bpm',
  beatsPerMeasure: 'beluga-metronome-beats',
  volume: 'beluga-metronome-volume',
  sound: 'beluga-metronome-sound'
}

let activeCleanup = null

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function readStoredNumber(key, fallback) {
  try {
    const storedValue = window.localStorage.getItem(key)

    if (storedValue === null || storedValue.trim() === '') {
      return fallback
    }

    const value = Number(storedValue)
    return Number.isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function storeNumber(key, value) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 브라우저 저장소가 차단돼도 메트로놈은 계속 동작합니다.
  }
}

function readStoredText(key, fallback) {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function storeText(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 브라우저 저장소가 차단돼도 메트로놈은 계속 동작합니다.
  }
}

function createMetronome(container) {
  const initialBpm = clamp(
    Math.round(
      readStoredNumber(STORAGE_KEYS.bpm, DEFAULT_BPM)
    ),
    BPM_MIN,
    BPM_MAX
  )

  const storedBeats = readStoredNumber(
    STORAGE_KEYS.beatsPerMeasure,
    DEFAULT_BEATS_PER_MEASURE
  )

  const initialBeats = [2, 3, 4, 6].includes(storedBeats)
    ? storedBeats
    : DEFAULT_BEATS_PER_MEASURE

  const initialVolume = clamp(
    readStoredNumber(STORAGE_KEYS.volume, DEFAULT_VOLUME),
    0,
    1
  )

  const storedSound = readStoredText(
    STORAGE_KEYS.sound,
    DEFAULT_SOUND
  )
  const initialSound = SOUND_TYPES.includes(storedSound)
    ? storedSound
    : DEFAULT_SOUND

  container.innerHTML = `
    <section class="metronome-section">
      <div class="metronome-intro">
        <span class="metronome-eyebrow">BELUGA BEAT</span>
        <h2>벨루가 배 박수</h2>
        <p>벨루가가 지느러미로 배를 두드리며 박자를 맞춰줘요.</p>
      </div>

      <div class="metronome-card">
        <div class="beluga-stage">
          <span class="beluga-bubble beluga-bubble-one" aria-hidden="true"></span>
          <span class="beluga-bubble beluga-bubble-two" aria-hidden="true"></span>
          <span class="beluga-bubble beluga-bubble-three" aria-hidden="true"></span>

          <div
            class="beluga-sprite"
            data-frame="idle"
            role="img"
            aria-label="배 박수를 준비하는 귀여운 벨루가"
          ></div>
          <span class="beluga-beat-ring" aria-hidden="true"></span>
        </div>

        <p class="metronome-status">배 박수 준비 완료!</p>

        <div
          class="metronome-beat-dots"
          aria-label="현재 박자"
        ></div>

        <div class="metronome-bpm-display">
          <strong class="metronome-bpm-value"></strong>
          <span>BPM</span>
        </div>

        <div class="metronome-bpm-controls">
          <button
            class="metronome-step-button metronome-minus-button"
            type="button"
            aria-label="BPM 1 낮추기"
          >
            −
          </button>

          <input
            class="metronome-bpm-slider"
            type="range"
            min="${BPM_MIN}"
            max="${BPM_MAX}"
            step="1"
            aria-label="메트로놈 속도"
          >

          <button
            class="metronome-step-button metronome-plus-button"
            type="button"
            aria-label="BPM 1 높이기"
          >
            +
          </button>
        </div>

        <div class="metronome-settings">
          <label class="metronome-setting-field">
            박자표
            <select class="metronome-meter-select">
              <option value="2">2/4</option>
              <option value="3">3/4</option>
              <option value="4">4/4</option>
              <option value="6">6/8</option>
            </select>
          </label>

          <label class="metronome-setting-field">
            소리
            <select class="metronome-sound-select">
              <option value="belly">벨루가 챱</option>
              <option value="click">기본 틱</option>
            </select>
          </label>

          <label class="metronome-setting-field">
            소리 크기
            <input
              class="metronome-volume-slider"
              type="range"
              min="0"
              max="1"
              step="0.05"
            >
          </label>
        </div>

        <div class="metronome-main-actions">
          <button
            class="metronome-start-button"
            type="button"
            aria-pressed="false"
          >
            배 박수 시작
          </button>
          <button
            class="metronome-tap-button"
            type="button"
          >
            TAP TEMPO
          </button>
        </div>

        <p class="metronome-hint">
          TAP TEMPO를 박자에 맞춰 두 번 이상 눌러도 속도를 정할 수 있어요.
        </p>
      </div>
    </section>
  `

  const sprite = container.querySelector('.beluga-sprite')
  const beatRing = container.querySelector(
    '.beluga-beat-ring'
  )
  const status = container.querySelector(
    '.metronome-status'
  )
  const beatDots = container.querySelector(
    '.metronome-beat-dots'
  )
  const bpmValue = container.querySelector(
    '.metronome-bpm-value'
  )
  const bpmSlider = container.querySelector(
    '.metronome-bpm-slider'
  )
  const minusButton = container.querySelector(
    '.metronome-minus-button'
  )
  const plusButton = container.querySelector(
    '.metronome-plus-button'
  )
  const meterSelect = container.querySelector(
    '.metronome-meter-select'
  )
  const soundSelect = container.querySelector(
    '.metronome-sound-select'
  )
  const volumeSlider = container.querySelector(
    '.metronome-volume-slider'
  )
  const startButton = container.querySelector(
    '.metronome-start-button'
  )
  const tapButton = container.querySelector(
    '.metronome-tap-button'
  )

  sprite.style.backgroundImage = `url("${belugaSpriteUrl}")`

  let bpm = initialBpm
  let beatsPerMeasure = initialBeats
  let volume = initialVolume
  let soundType = initialSound
  let isPlaying = false
  let isStarting = false
  let audioContext = null
  let schedulerTimer = null
  let spriteResetTimer = null
  let nextBeatTime = 0
  let currentBeat = 0
  let tapTimes = []
  let slapNoiseBuffer = null
  let bellySlapSampleBuffer = null
  let bellySlapSamplePromise = null
  const visualTimers = new Set()

  function renderBeatDots(activeBeat = null) {
    beatDots.replaceChildren()

    for (let index = 0; index < beatsPerMeasure; index += 1) {
      const dot = document.createElement('span')
      dot.className = 'metronome-beat-dot'
      dot.setAttribute('aria-hidden', 'true')
      dot.classList.toggle('is-accent', index === 0)
      dot.classList.toggle('is-current', index === activeBeat)
      beatDots.append(dot)
    }
  }

  function updateBpm(nextBpm, announce = true) {
    bpm = clamp(Math.round(nextBpm), BPM_MIN, BPM_MAX)
    bpmValue.textContent = String(bpm)
    bpmSlider.value = String(bpm)
    storeNumber(STORAGE_KEYS.bpm, bpm)

    if (announce && !isPlaying) {
      status.textContent = `${bpm} BPM으로 준비됐어요.`
    }
  }

  function clearVisualTimers() {
    visualTimers.forEach((timer) => {
      window.clearTimeout(timer)
    })
    visualTimers.clear()
    window.clearTimeout(spriteResetTimer)
    spriteResetTimer = null
  }

  function showBeat(beat) {
    const isAccent = beat === 0
    const frame = isAccent
      ? 'accent'
      : beat % 2 === 1
        ? 'left'
        : 'right'

    sprite.dataset.frame = frame
    sprite.classList.remove('is-clapping')
    beatRing.classList.remove('is-visible')
    void sprite.offsetWidth
    sprite.classList.add('is-clapping')
    beatRing.classList.add('is-visible')
    renderBeatDots(beat)
    const soundWord = soundType === 'belly' ? '챱!' : '짝!'
    status.textContent = isAccent
      ? `첫 박! 양쪽 지느러미로 ${soundWord}`
      : `${beat + 1}박, ${soundWord}`

    window.clearTimeout(spriteResetTimer)
    spriteResetTimer = window.setTimeout(() => {
      sprite.dataset.frame = 'idle'
      sprite.classList.remove('is-clapping')
      beatRing.classList.remove('is-visible')
    }, Math.min(170, (60_000 / bpm) * 0.42))
  }

  function scheduleClickSound(beat, time) {
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    const isAccent = beat === 0
    const peakVolume = Math.max(
      0.0001,
      volume * (isAccent ? 2.56 : 2.47)
    )

    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(
      isAccent ? 1040 : 720,
      time
    )

    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.exponentialRampToValueAtTime(
      peakVolume,
      time + 0.003
    )
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + 0.065
    )

    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start(time)
    oscillator.stop(time + 0.07)
  }

  function getSlapNoiseBuffer() {
    if (slapNoiseBuffer) {
      return slapNoiseBuffer
    }

    const duration = 0.11
    const frameCount = Math.floor(
      audioContext.sampleRate * duration
    )
    slapNoiseBuffer = audioContext.createBuffer(
      1,
      frameCount,
      audioContext.sampleRate
    )

    const samples = slapNoiseBuffer.getChannelData(0)

    for (let index = 0; index < frameCount; index += 1) {
      const progress = index / frameCount
      const naturalDecay = (1 - progress) ** 1.7
      samples[index] =
        (Math.random() * 2 - 1) * naturalDecay
    }

    return slapNoiseBuffer
  }

  async function loadBellySlapSample() {
    if (bellySlapSampleBuffer || !audioContext) {
      return
    }

    if (!bellySlapSamplePromise) {
      const decodingContext = audioContext
      bellySlapSamplePromise = fetch(bellySlapSoundUrl)
        .then((response) => {
          if (!response.ok) {
            throw new Error('배 박수 음원을 불러오지 못했어요.')
          }

          return response.arrayBuffer()
        })
        .then((audioData) =>
          decodingContext.decodeAudioData(audioData)
        )
        .then((decodedBuffer) => {
          bellySlapSampleBuffer = decodedBuffer
        })
        .catch((error) => {
          bellySlapSamplePromise = null
          throw error
        })
    }

    await bellySlapSamplePromise
  }

  function scheduleRecordedBellySlapSound(beat, time) {
    const source = audioContext.createBufferSource()
    const gain = audioContext.createGain()
    const isAccent = beat === 0

    source.buffer = bellySlapSampleBuffer
    source.playbackRate.setValueAtTime(
      isAccent ? 0.96 : beat % 2 === 1 ? 1.02 : 0.99,
      time
    )
    gain.gain.setValueAtTime(
      volume * (isAccent ? 1.1 : 0.95),
      time
    )

    source.connect(gain)
    gain.connect(audioContext.destination)
    source.start(time)
  }

  function scheduleBellySlapSound(beat, time) {
    const isAccent = beat === 0
    const clapNoise = audioContext.createBufferSource()
    const clapHighpass = audioContext.createBiquadFilter()
    const clapLowpass = audioContext.createBiquadFilter()
    const clapGain = audioContext.createGain()
    const bellyNoise = audioContext.createBufferSource()
    const bellyFilter = audioContext.createBiquadFilter()
    const bellyGain = audioContext.createGain()
    const thump = audioContext.createOscillator()
    const thumpFilter = audioContext.createBiquadFilter()
    const thumpGain = audioContext.createGain()
    const mixGain = audioContext.createGain()
    const compressor = audioContext.createDynamicsCompressor()
    const clapPeak = Math.max(
      0.0001,
      volume * (isAccent ? 0.52 : 0.42)
    )
    const bellyPeak = Math.max(
      0.0001,
      volume * (isAccent ? 0.38 : 0.3)
    )
    const thumpPeak = Math.max(
      0.0001,
      volume * (isAccent ? 0.17 : 0.13)
    )

    clapNoise.buffer = getSlapNoiseBuffer()
    clapNoise.playbackRate.setValueAtTime(
      beat % 2 === 1 ? 1.08 : 1.02,
      time
    )

    clapHighpass.type = 'highpass'
    clapHighpass.frequency.setValueAtTime(720, time)
    clapLowpass.type = 'lowpass'
    clapLowpass.frequency.setValueAtTime(6200, time)

    const clapPulses = [
      { offset: 0, strength: 1, decay: 0.006 },
      { offset: 0.009, strength: 0.72, decay: 0.006 },
      { offset: 0.018, strength: 0.52, decay: 0.045 }
    ]

    clapGain.gain.setValueAtTime(0.0001, time)
    clapPulses.forEach(({ offset, strength, decay }) => {
      const pulseTime = time + offset
      clapGain.gain.setValueAtTime(0.0001, pulseTime)
      clapGain.gain.linearRampToValueAtTime(
        clapPeak * strength,
        pulseTime + 0.0015
      )
      clapGain.gain.exponentialRampToValueAtTime(
        0.0001,
        pulseTime + decay
      )
    })

    bellyNoise.buffer = getSlapNoiseBuffer()
    bellyNoise.playbackRate.setValueAtTime(
      isAccent ? 0.78 : beat % 2 === 1 ? 0.88 : 0.84,
      time
    )

    bellyFilter.type = 'bandpass'
    bellyFilter.frequency.setValueAtTime(
      isAccent ? 390 : 510,
      time
    )
    bellyFilter.Q.setValueAtTime(0.9, time)

    bellyGain.gain.setValueAtTime(0.0001, time)
    bellyGain.gain.linearRampToValueAtTime(
      bellyPeak,
      time + 0.004
    )
    bellyGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + 0.095
    )

    thump.type = 'triangle'
    thump.frequency.setValueAtTime(
      isAccent ? 122 : 138,
      time
    )
    thump.frequency.exponentialRampToValueAtTime(
      isAccent ? 58 : 68,
      time + 0.095
    )

    thumpFilter.type = 'lowpass'
    thumpFilter.frequency.setValueAtTime(280, time)
    thumpFilter.Q.setValueAtTime(0.7, time)

    thumpGain.gain.setValueAtTime(0.0001, time)
    thumpGain.gain.linearRampToValueAtTime(
      thumpPeak,
      time + 0.003
    )
    thumpGain.gain.exponentialRampToValueAtTime(
      0.0001,
      time + 0.11
    )

    mixGain.gain.setValueAtTime(0.92, time)
    compressor.threshold.setValueAtTime(-20, time)
    compressor.knee.setValueAtTime(14, time)
    compressor.ratio.setValueAtTime(5, time)
    compressor.attack.setValueAtTime(0.002, time)
    compressor.release.setValueAtTime(0.08, time)

    clapNoise.connect(clapHighpass)
    clapHighpass.connect(clapLowpass)
    clapLowpass.connect(clapGain)
    clapGain.connect(mixGain)

    bellyNoise.connect(bellyFilter)
    bellyFilter.connect(bellyGain)
    bellyGain.connect(mixGain)

    thump.connect(thumpFilter)
    thumpFilter.connect(thumpGain)
    thumpGain.connect(mixGain)

    mixGain.connect(compressor)
    compressor.connect(audioContext.destination)

    clapNoise.start(time)
    clapNoise.stop(time + 0.105)
    bellyNoise.start(time)
    bellyNoise.stop(time + 0.12)
    thump.start(time)
    thump.stop(time + 0.115)
  }

  function scheduleSound(beat, time) {
    if (!audioContext || volume <= 0) {
      return
    }

    if (soundType === 'belly') {
      if (bellySlapSampleBuffer) {
        scheduleRecordedBellySlapSound(beat, time)
        return
      }

      scheduleBellySlapSound(beat, time)
      return
    }

    scheduleClickSound(beat, time)
  }

  function scheduleVisual(beat, time) {
    if (!audioContext) {
      return
    }

    const delay = Math.max(
      0,
      (time - audioContext.currentTime) * 1000
    )

    const timer = window.setTimeout(() => {
      visualTimers.delete(timer)

      if (isPlaying) {
        showBeat(beat)
      }
    }, delay)

    visualTimers.add(timer)
  }

  function scheduler() {
    if (!audioContext || !isPlaying) {
      return
    }

    if (nextBeatTime < audioContext.currentTime - 0.1) {
      nextBeatTime = audioContext.currentTime + 0.06
      currentBeat = 0
    }

    while (
      nextBeatTime <
      audioContext.currentTime + SCHEDULE_AHEAD_SECONDS
    ) {
      scheduleSound(currentBeat, nextBeatTime)
      scheduleVisual(currentBeat, nextBeatTime)
      nextBeatTime += 60 / bpm
      currentBeat = (currentBeat + 1) % beatsPerMeasure
    }

    schedulerTimer = window.setTimeout(
      scheduler,
      LOOKAHEAD_MS
    )
  }

  async function ensureAudioContext() {
    const AudioContextClass =
      window.AudioContext ?? window.webkitAudioContext

    if (!AudioContextClass) {
      throw new Error(
        '이 브라우저에서는 메트로놈 소리를 재생할 수 없습니다.'
      )
    }

    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContextClass()
      slapNoiseBuffer = null
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume()
    }
  }

  function stopMetronome() {
    isPlaying = false
    window.clearTimeout(schedulerTimer)
    schedulerTimer = null
    clearVisualTimers()
    sprite.dataset.frame = 'idle'
    sprite.classList.remove('is-clapping')
    beatRing.classList.remove('is-visible')
    renderBeatDots()
    startButton.textContent = '배 박수 시작'
    startButton.classList.remove('is-playing')
    startButton.setAttribute('aria-pressed', 'false')
    status.textContent = `${bpm} BPM에서 잠깐 쉬는 중이에요.`

    if (audioContext && audioContext.state !== 'closed') {
      const contextToClose = audioContext
      audioContext = null
      void contextToClose.close()
    }
  }

  async function startMetronome() {
    if (isStarting || isPlaying) {
      return
    }

    isStarting = true
    startButton.disabled = true
    status.textContent = '벨루가가 지느러미를 준비하고 있어요.'

    try {
      await ensureAudioContext()

      if (soundType === 'belly') {
        try {
          await loadBellySlapSample()
        } catch (error) {
          console.warn(
            '녹음된 배 박수 음원 대신 합성음을 사용합니다.',
            error
          )
        }
      }

      isPlaying = true
      currentBeat = 0
      nextBeatTime = audioContext.currentTime + 0.06
      startButton.textContent = '배 박수 멈추기'
      startButton.classList.add('is-playing')
      startButton.setAttribute('aria-pressed', 'true')
      scheduler()
    } catch (error) {
      console.error(error)
      status.textContent =
        error instanceof Error
          ? error.message
          : '오디오를 시작하지 못했어요. 잠시 후 다시 시도해주세요.'
    } finally {
      isStarting = false
      startButton.disabled = false
    }
  }

  function handleTapTempo() {
    const now = performance.now()
    const lastTap = tapTimes.at(-1)

    if (lastTap && now - lastTap > 2000) {
      tapTimes = []
    }

    tapTimes.push(now)

    if (tapTimes.length > 6) {
      tapTimes.shift()
    }

    if (tapTimes.length < 2) {
      status.textContent = '한 번 더 두드려주세요!'
      return
    }

    const intervals = tapTimes
      .slice(1)
      .map((time, index) => time - tapTimes[index])
    const averageInterval =
      intervals.reduce((sum, interval) => sum + interval, 0) /
      intervals.length

    updateBpm(60_000 / averageInterval, false)
    status.textContent = `탭 속도를 ${bpm} BPM으로 맞췄어요.`
  }

  minusButton.addEventListener('click', () => {
    updateBpm(bpm - 1)
  })

  plusButton.addEventListener('click', () => {
    updateBpm(bpm + 1)
  })

  bpmSlider.addEventListener('input', () => {
    updateBpm(Number(bpmSlider.value))
  })

  meterSelect.addEventListener('change', () => {
    beatsPerMeasure = Number(meterSelect.value)
    currentBeat = 0
    storeNumber(
      STORAGE_KEYS.beatsPerMeasure,
      beatsPerMeasure
    )
    renderBeatDots()
    status.textContent = `${meterSelect.selectedOptions[0].textContent} 박자로 맞췄어요.`
  })

  volumeSlider.addEventListener('input', () => {
    volume = clamp(Number(volumeSlider.value), 0, 1)
    storeNumber(STORAGE_KEYS.volume, volume)
  })

  soundSelect.addEventListener('change', () => {
    soundType = SOUND_TYPES.includes(soundSelect.value)
      ? soundSelect.value
      : DEFAULT_SOUND
    storeText(STORAGE_KEYS.sound, soundType)

    if (soundType === 'belly' && audioContext) {
      void loadBellySlapSample().catch((error) => {
        console.warn(
          '녹음된 배 박수 음원 대신 합성음을 사용합니다.',
          error
        )
      })
    }

    status.textContent =
      soundType === 'belly'
        ? '말랑한 벨루가 챱 소리로 맞췄어요.'
        : '또렷한 기본 틱 소리로 맞췄어요.'
  })

  startButton.addEventListener('click', () => {
    if (isPlaying) {
      stopMetronome()
      return
    }

    void startMetronome()
  })

  tapButton.addEventListener('click', handleTapTempo)

  bpmSlider.value = String(bpm)
  meterSelect.value = String(beatsPerMeasure)
  soundSelect.value = soundType
  volumeSlider.value = String(volume)
  updateBpm(bpm, false)
  renderBeatDots()

  return () => {
    isPlaying = false
    window.clearTimeout(schedulerTimer)
    clearVisualTimers()
    tapTimes = []

    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close()
    }

    container.replaceChildren()
  }
}

export function mountMetronome({ container }) {
  unmountMetronome()

  if (!container) {
    return
  }

  activeCleanup = createMetronome(container)
}

export function unmountMetronome() {
  activeCleanup?.()
  activeCleanup = null
}
