(() => {
  let context,
    muted = false;
  function unlock() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context ||= new Audio();
    if (context.state === 'suspended') context.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  window.gameSounds = {
    mute(value) {
      muted = value;
    },
    shot() {
      if (muted || context?.state !== 'running') return;
      const duration = 0.32,
        start = context.currentTime;
      const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.055));
      const noise = context.createBufferSource(),
        gain = context.createGain();
      noise.buffer = buffer;
      gain.gain.value = 0.32;
      noise.connect(gain).connect(context.destination);
      noise.start(start);
      noise.onended = () => {
        noise.disconnect();
        gain.disconnect();
      };
    },
  };
})();
