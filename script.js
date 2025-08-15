const fileInput = document.getElementById('audioFile');
const playBtn = document.getElementById('playBtn');

const downloadBtn = document.getElementById('downloadBtn');
const audio = document.getElementById('audio');

let audioContext, source, panner, animationId, buffer, analyser, dataArray;

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    audio.src = url;
    playBtn.disabled = false;
    downloadBtn.disabled = false;
    buffer = await file.arrayBuffer();
});
// Download 3D audio as WAV
downloadBtn.addEventListener('click', async () => {
    if (!buffer) return;
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Processing...';
    // Decode audio
    const tempCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 44100 * 300, 44100); // up to 5 min
    const decoded = await tempCtx.decodeAudioData(buffer.slice(0));
    // Create buffer source
    const source = tempCtx.createBufferSource();
    source.buffer = decoded;
    // Create panner node (simulate 3D effect by moving source in a circle)
    const panner = tempCtx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.setPosition(1, 0, 0);
    source.connect(panner).connect(tempCtx.destination);

    // Animate panner during rendering
    const duration = decoded.duration;
    const steps = Math.floor(duration * 60); // 60 steps per second
    for (let i = 0; i < steps; i++) {
        const t = i / 60;
        const angle = t * 0.03 * 60; // match play animation speed
        const x = Math.cos(angle) * 1.5;
        const z = Math.sin(angle) * 1.5;
        panner.positionX.setValueAtTime(x, t);
        panner.positionZ.setValueAtTime(z, t);
    }

    source.start();
    const renderedBuffer = await tempCtx.startRendering();
    // Convert to WAV
    const wavBlob = bufferToWavBlob(renderedBuffer);
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '3d-audio.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    downloadBtn.textContent = 'Download 3D Audio';
    downloadBtn.disabled = false;
});

// Helper: Convert AudioBuffer to WAV Blob
function bufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);

    // Write WAV header
    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, length - 8, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numOfChan, true); offset += 2;
    view.setUint32(offset, buffer.sampleRate, true); offset += 4;
    view.setUint32(offset, buffer.sampleRate * numOfChan * 2, true); offset += 4;
    view.setUint16(offset, numOfChan * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, length - offset - 4, true); offset += 4;

    // Write interleaved PCM samples
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numOfChan; ch++) {
            let sample = buffer.getChannelData(ch)[i];
            sample = Math.max(-1, Math.min(1, sample));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }
    return new Blob([bufferArray], { type: 'audio/wav' });
}

playBtn.addEventListener('click', async () => {
    if (audioContext) {
        stopAudio();
        playBtn.textContent = 'Play 3D Audio';
        return;
    }
    playBtn.textContent = 'Stop';
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    source = audioContext.createBufferSource();
    source.buffer = decoded;
    panner = audioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.setPosition(1, 0, 0);

    // Create analyser node
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Connect nodes: source -> analyser -> panner -> destination
    source.connect(analyser);
    analyser.connect(panner);
    panner.connect(audioContext.destination);

    source.start();
    animatePannerMelody();
    source.onended = stopAudio;
});


// Move panner based on melody (dominant frequency)
function animatePannerMelody() {
    let angle = 0;
    function move() {
        analyser.getByteFrequencyData(dataArray);
        // Find the index of the loudest frequency bin
        let maxVal = 0, maxIdx = 0;
        for (let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxVal) {
                maxVal = dataArray[i];
                maxIdx = i;
            }
        }
        // Map the dominant frequency to an angle increment and radius
        const freq = maxIdx * audioContext.sampleRate / analyser.fftSize;
        // Angle speed: higher freq = faster movement
        const speed = 0.01 + (freq / 8000) * 0.1; // 0.01 to 0.11
        angle += speed;
        // Radius: louder = wider
        const radius = 1 + (maxVal / 255) * 1.5; // 1 to 2.5
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        panner.setPosition(x, 0, z);
        animationId = requestAnimationFrame(move);
    }
    move();
}

function stopAudio() {
    if (source) source.stop();
    if (audioContext) audioContext.close();
    if (animationId) cancelAnimationFrame(animationId);
    audioContext = null;
    source = null;
    panner = null;
    analyser = null;
    dataArray = null;
    animationId = null;
    playBtn.textContent = 'Play 3D Audio';
}
