// Mikrofon iznini al
async function requestMicrophonePermission() {
  try {
    originalStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });

    micPermissionGranted = true;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    localStream = originalStream;
    setupAudioProcessor();

    if (processedStream) {
      processedStream.getAudioTracks()[0].enabled = false;
    }

    const participants = document.querySelectorAll('.participant');
    participants.forEach(participant => {
      const userId = participant.id.replace('participant-', '');
      if (userId !== myId) {
        createPeerConnection(userId, true);
      }
    });

    return true;
  } catch (error) {
    console.error('Mikrofon erişimi reddedildi:', error);
    showError('Mikrofon erişimi reddedildi! Konuşma özelliği kullanılamaz.');
    return false;
  }
}

// Ses işlemci kurulumu
function setupAudioProcessor() {
  if (!originalStream || !audioContext) return;
  
  if (processedStream) {
    processedStream.getTracks().forEach(track => track.stop());
  }
  
  const source = audioContext.createMediaStreamSource(originalStream);
  const destination = audioContext.createMediaStreamDestination();
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 1.2;
  
  audioProcessorNode = createEffectChain(voiceEffect);
  
  source.connect(audioProcessorNode.input);
  audioProcessorNode.output.connect(masterGain);
  masterGain.connect(destination);
  masterGain.connect(analyser);
  
  processedStream = destination.stream;
  
  const wasEnabled = localStream && localStream.getAudioTracks()[0] ? 
    localStream.getAudioTracks()[0].enabled : false;
  
  localStream = processedStream;
  
  if (localStream.getAudioTracks()[0]) {
    localStream.getAudioTracks()[0].enabled = wasEnabled;
  }
  
  updateAllPeerConnections();
}

// Ses efekti zinciri oluştur
function createEffectChain(effect) {
  const input = audioContext.createGain();
  const output = audioContext.createGain();
  
  switch(effect) {
    case 'normal':
      input.connect(output);
      break;
      
    case 'robot':
      const robotWaveShaper = audioContext.createWaveShaper();
      const robotCurve = new Float32Array(256);
      for (let i = 0; i < 128; i++) {
        robotCurve[i] = -1 + (i / 64);
        robotCurve[i + 128] = 1 - (i / 64);
      }
      robotWaveShaper.curve = robotCurve;
      
      const robotOscillator = audioContext.createOscillator();
      const robotGain = audioContext.createGain();
      robotOscillator.type = 'sawtooth';
      robotOscillator.frequency.value = 50;
      robotGain.gain.value = 0.05;
      robotOscillator.connect(robotGain);
      robotOscillator.start();
      
      const robotRingMod = audioContext.createGain();
      input.connect(robotRingMod);
      robotGain.connect(robotRingMod.gain);
      robotRingMod.connect(robotWaveShaper);
      robotWaveShaper.connect(output);
      break;
      
    case 'alien':
      const alienPitchShift = audioContext.createScriptProcessor(4096, 1, 1);
      let alienPhase = 0;
      
      alienPitchShift.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        const pitchRatio = 1.5 + Math.sin(alienPhase) * 0.3;
        alienPhase += 0.01;
        
        for (let i = 0; i < input.length; i++) {
          const index = Math.floor(i / pitchRatio);
          output[i] = index < input.length ? input[index] * 0.8 : 0;
        }
      };
      
      const alienFilter = audioContext.createBiquadFilter();
      alienFilter.type = 'bandpass';
      alienFilter.frequency.value = 1500;
      alienFilter.Q.value = 5;
      
      input.connect(alienPitchShift);
      alienPitchShift.connect(alienFilter);
      alienFilter.connect(output);
      break;
      
    case 'deep':
      const deepPitchDown = audioContext.createScriptProcessor(4096, 1, 1);
      deepPitchDown.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        const pitchRatio = 0.65;
        
        for (let i = 0; i < output.length; i++) {
          const index = Math.floor(i * pitchRatio);
          output[i] = index < input.length ? input[index] : 0;
        }
      };
      
      const deepLowpass = audioContext.createBiquadFilter();
      deepLowpass.type = 'lowpass';
      deepLowpass.frequency.value = 800;
      
      input.connect(deepPitchDown);
      deepPitchDown.connect(deepLowpass);
      deepLowpass.connect(output);
      break;
      
    case 'high':
      const highPitchUp = audioContext.createScriptProcessor(4096, 1, 1);
      highPitchUp.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        const pitchRatio = 1.8;
        
        for (let i = 0; i < output.length; i++) {
          const index = Math.floor(i / pitchRatio);
          output[i] = index < input.length ? input[index] : 0;
        }
      };
      
      const highpass = audioContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 500;
      
      input.connect(highPitchUp);
      highPitchUp.connect(highpass);
      highpass.connect(output);
      break;
      
    case 'echo':
      const echoDelay = audioContext.createDelay(1);
      echoDelay.delayTime.value = 0.3;
      
      const echoFeedback = audioContext.createGain();
      echoFeedback.gain.value = 0.5;
      
      const echoFilter = audioContext.createBiquadFilter();
      echoFilter.type = 'lowpass';
      echoFilter.frequency.value = 2000;
      
      const echoMix = audioContext.createGain();
      echoMix.gain.value = 0.5;
      
      input.connect(output);
      input.connect(echoDelay);
      echoDelay.connect(echoFeedback);
      echoFeedback.connect(echoFilter);
      echoFilter.connect(echoDelay);
      echoDelay.connect(echoMix);
      echoMix.connect(output);
      break;
      
    case 'radio':
      const radioBandpass = audioContext.createBiquadFilter();
      radioBandpass.type = 'bandpass';
      radioBandpass.frequency.value = 2000;
      radioBandpass.Q.value = 10;
      
      const radioDistortion = audioContext.createWaveShaper();
      const radioCurve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i - 128) / 128;
        radioCurve[i] = Math.tanh(x * 3);
      }
      radioDistortion.curve = radioCurve;
      
      const radioNoise = audioContext.createScriptProcessor(4096, 1, 1);
      radioNoise.onaudioprocess = function(e) {
        const output = e.outputBuffer.getChannelData(0);
        const input = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) {
          output[i] = input[i] + (Math.random() - 0.5) * 0.02;
        }
      };
      
      const radioGain = audioContext.createGain();
      radioGain.gain.value = 0.8;
      
      input.connect(radioBandpass);
      radioBandpass.connect(radioDistortion);
      radioDistortion.connect(radioNoise);
      radioNoise.connect(radioGain);
      radioGain.connect(output);
      break;
      
    case 'underwater':
      const waterLowpass = audioContext.createBiquadFilter();
      waterLowpass.type = 'lowpass';
      waterLowpass.frequency.value = 400;
      waterLowpass.Q.value = 2;
      
      const waterDelay = audioContext.createDelay(0.1);
      waterDelay.delayTime.value = 0.03;
      
      const waterLFO = audioContext.createOscillator();
      const waterLFOGain = audioContext.createGain();
      waterLFO.frequency.value = 3;
      waterLFOGain.gain.value = 10;
      waterLFO.connect(waterLFOGain);
      waterLFOGain.connect(waterLowpass.frequency);
      waterLFO.start();
      
      const waterGain = audioContext.createGain();
      waterGain.gain.value = 0.7;
      
      input.connect(waterLowpass);
      waterLowpass.connect(waterDelay);
      waterDelay.connect(waterGain);
      waterGain.connect(output);
      break;
      
    case 'telephone':
      const telHighpass = audioContext.createBiquadFilter();
      telHighpass.type = 'highpass';
      telHighpass.frequency.value = 300;
      
      const telLowpass = audioContext.createBiquadFilter();
      telLowpass.type = 'lowpass';
      telLowpass.frequency.value = 3400;
      
      const telDistortion = audioContext.createWaveShaper();
      const telCurve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i - 128) / 128;
        telCurve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.7);
      }
      telDistortion.curve = telCurve;
      
      const telCompressor = audioContext.createDynamicsCompressor();
      telCompressor.threshold.value = -30;
      telCompressor.ratio.value = 12;
      
      input.connect(telHighpass);
      telHighpass.connect(telLowpass);
      telLowpass.connect(telDistortion);
      telDistortion.connect(telCompressor);
      telCompressor.connect(output);
      break;
      
    case 'cave':
      const caveDelay1 = audioContext.createDelay(1);
      caveDelay1.delayTime.value = 0.1;
      const caveDelay2 = audioContext.createDelay(1);
      caveDelay2.delayTime.value = 0.2;
      const caveDelay3 = audioContext.createDelay(1);
      caveDelay3.delayTime.value = 0.3;
      
      const caveFeedback1 = audioContext.createGain();
      caveFeedback1.gain.value = 0.6;
      const caveFeedback2 = audioContext.createGain();
      caveFeedback2.gain.value = 0.5;
      const caveFeedback3 = audioContext.createGain();
      caveFeedback3.gain.value = 0.4;
      
      const caveFilter = audioContext.createBiquadFilter();
      caveFilter.type = 'lowpass';
      caveFilter.frequency.value = 1500;
      
      const caveMix = audioContext.createGain();
      caveMix.gain.value = 0.3;
      
      input.connect(output);
      input.connect(caveDelay1);
      caveDelay1.connect(caveFeedback1);
      caveFeedback1.connect(caveFilter);
      caveFilter.connect(caveDelay1);
      
      input.connect(caveDelay2);
      caveDelay2.connect(caveFeedback2);
      caveFeedback2.connect(caveDelay2);
      
      input.connect(caveDelay3);
      caveDelay3.connect(caveFeedback3);
      caveFeedback3.connect(caveDelay3);
      
      caveDelay1.connect(caveMix);
      caveDelay2.connect(caveMix);
      caveDelay3.connect(caveMix);
      caveMix.connect(output);
      break;
      
    // YENİ KRİPTOLU SES EFEKTLERİ
    case 'crypto1': // Dijital Şifreleme
      const cryptoProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      let cryptoPhase = 0;
      
      cryptoProcessor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
          // Frekans kaydırma ve modülasyon
          const modulation = Math.sin(cryptoPhase + i * 0.1) * 0.5 + 0.5;
          const scrambled = input[i] * Math.cos(i * 0.5 + cryptoPhase);
          
          // Bit crushing efekti
          const bits = 4;
          const step = 2 / Math.pow(2, bits);
          output[i] = Math.round(scrambled / step) * step * modulation;
          
          cryptoPhase += 0.001;
        }
      };
      
      const cryptoFilter = audioContext.createBiquadFilter();
      cryptoFilter.type = 'allpass';
      cryptoFilter.frequency.value = 1000;
      
      const cryptoDistortion = audioContext.createWaveShaper();
      const cryptoCurve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i - 128) / 128;
        cryptoCurve[i] = Math.sign(x) * Math.log(1 + Math.abs(x) * 10) / Math.log(11);
      }
      cryptoDistortion.curve = cryptoCurve;
      
      input.connect(cryptoProcessor);
      cryptoProcessor.connect(cryptoFilter);
      cryptoFilter.connect(cryptoDistortion);
      cryptoDistortion.connect(output);
      break;
      
    case 'crypto2': // Spektral Karıştırma
      const spectralShift = audioContext.createScriptProcessor(4096, 1, 1);
      let spectralTime = 0;
      
      spectralShift.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        // FFT benzeri spektral manipülasyon
        for (let i = 0; i < input.length; i++) {
          let sample = input[i];
          
          // Çoklu frekans kaydırma
          sample = sample * Math.sin(i * 0.1 + spectralTime) +
                   sample * Math.cos(i * 0.2 + spectralTime * 2) * 0.5 +
                   sample * Math.sin(i * 0.05 + spectralTime * 0.5) * 0.3;
          
          // Formant kaydırma
          const formantShift = 1.3 + Math.sin(spectralTime * 3) * 0.4;
          const index = Math.floor(i / formantShift);
          
          output[i] = index < input.length ? sample * 0.7 : 0;
        }
        
        spectralTime += 0.01;
      };
      
      const spectralRing = audioContext.createGain();
      const spectralOsc = audioContext.createOscillator();
      spectralOsc.frequency.value = 237; // Prime number frequency
      spectralOsc.type = 'triangle';
      const spectralOscGain = audioContext.createGain();
      spectralOscGain.gain.value = 0.3;
      spectralOsc.connect(spectralOscGain);
      spectralOsc.start();
      
      input.connect(spectralShift);
      spectralShift.connect(spectralRing);
      spectralOscGain.connect(spectralRing.gain);
      spectralRing.connect(output);
      break;
      
    case 'crypto3': // Kuantum Karışım
      const quantumProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      let quantumSeed = Math.random() * 1000;
      
      quantumProcessor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
          // Pseudo-random pitch shifting
          const randomShift = Math.sin(quantumSeed + i * 0.01) * 0.5 + 1;
          const shiftedIndex = Math.floor(i / randomShift);
          
          // Granular synthesis benzeri
          const grainSize = 64;
          const grainIndex = i % grainSize;
          const envelope = Math.sin((grainIndex / grainSize) * Math.PI);
          
          let sample = shiftedIndex < input.length ? input[shiftedIndex] : 0;
          sample *= envelope;
          
          // Chaos modulation
          quantumSeed = (quantumSeed * 1.1 + 0.1) % 1000;
          const chaos = Math.sin(quantumSeed) * 0.3;
          
          output[i] = sample * (1 + chaos);
        }
      };
      
      const quantumFilter1 = audioContext.createBiquadFilter();
      quantumFilter1.type = 'notch';
      quantumFilter1.frequency.value = 800;
      quantumFilter1.Q.value = 20;
      
      const quantumFilter2 = audioContext.createBiquadFilter();
      quantumFilter2.type = 'peaking';
      quantumFilter2.frequency.value = 1500;
      quantumFilter2.Q.value = 5;
      quantumFilter2.gain.value = -10;
      
      input.connect(quantumProcessor);
      quantumProcessor.connect(quantumFilter1);
      quantumFilter1.connect(quantumFilter2);
      quantumFilter2.connect(output);
      break;
      
    case 'crypto4': // Vokal Maskeleme
      const vocalMask = audioContext.createScriptProcessor(4096, 1, 1);
      let maskPhase = 0;
      const bufferSize = 2048;
      const overlapBuffer = new Float32Array(bufferSize);
      
      vocalMask.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
          // Formant shifting with overlap
          const shift1 = 0.7 + Math.sin(maskPhase) * 0.3;
          const shift2 = 1.4 + Math.cos(maskPhase * 1.5) * 0.3;
          
          const index1 = Math.floor(i * shift1);
          const index2 = Math.floor(i / shift2);
          
          let sample = 0;
          if (index1 < input.length) sample += input[index1] * 0.5;
          if (index2 < input.length) sample += input[index2] * 0.5;
          
          // Vokal karakteristik gizleme
          const vocoderFreq = 100 + Math.sin(maskPhase * 2) * 50;
          sample *= Math.sin(i * vocoderFreq * 0.01);
          
          output[i] = sample * 0.8;
          maskPhase += 0.0001;
        }
      };
      
      const vocalNotch1 = audioContext.createBiquadFilter();
      vocalNotch1.type = 'notch';
      vocalNotch1.frequency.value = 650; // İlk formant bölgesi
      vocalNotch1.Q.value = 10;
      
      const vocalNotch2 = audioContext.createBiquadFilter();
      vocalNotch2.type = 'notch';
      vocalNotch2.frequency.value = 1100; // İkinci formant bölgesi
      vocalNotch2.Q.value = 10;
      
      const vocalShelf = audioContext.createBiquadFilter();
      vocalShelf.type = 'highshelf';
      vocalShelf.frequency.value = 3000;
      vocalShelf.gain.value = -6;
      
      input.connect(vocalMask);
      vocalMask.connect(vocalNotch1);
      vocalNotch1.connect(vocalNotch2);
      vocalNotch2.connect(vocalShelf);
      vocalShelf.connect(output);
      break;
      
    case 'crypto5': // Hibrit Şifreleme
      const hybridProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      let hybridTime = 0;
      let hybridBuffer = new Float32Array(4096);
      let bufferIndex = 0;
      
      hybridProcessor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
          // Buffer'a yaz
          hybridBuffer[bufferIndex] = input[i];
          bufferIndex = (bufferIndex + 1) % hybridBuffer.length;
          
          // Karmaşık pitch ve time stretching
          const stretchFactor = 1.2 + Math.sin(hybridTime) * 0.5;
          const pitchFactor = 0.8 + Math.cos(hybridTime * 1.3) * 0.4;
          
          const readIndex1 = Math.floor((bufferIndex - i * stretchFactor) + hybridBuffer.length) % hybridBuffer.length;
          const readIndex2 = Math.floor((bufferIndex - i * pitchFactor) + hybridBuffer.length) % hybridBuffer.length;
          
          // Çoklu okuma ve karıştırma
          let sample = hybridBuffer[readIndex1] * 0.4 + hybridBuffer[readIndex2] * 0.4;
          
          // Ring modulation with varying frequency
          const ringFreq = 200 + Math.sin(hybridTime * 2) * 100;
          sample *= Math.sin(i * ringFreq * 0.001);
          
          // Bit reduction
          const bits = 6 + Math.floor(Math.sin(hybridTime * 0.5) * 2);
          const step = 2 / Math.pow(2, bits);
          sample = Math.round(sample / step) * step;
          
          output[i] = sample * 0.9;
          hybridTime += 0.00005;
        }
      };
      
      const hybridComb1 = audioContext.createDelay(0.1);
      hybridComb1.delayTime.value = 0.007;
      const hybridCombGain1 = audioContext.createGain();
      hybridCombGain1.gain.value = -0.5;
      
      const hybridComb2 = audioContext.createDelay(0.1);
      hybridComb2.delayTime.value = 0.011;
      const hybridCombGain2 = audioContext.createGain();
      hybridCombGain2.gain.value = -0.4;
      
      const hybridMix = audioContext.createGain();
      hybridMix.gain.value = 0.7;
      
      input.connect(hybridProcessor);
      hybridProcessor.connect(output);
      
      hybridProcessor.connect(hybridComb1);
      hybridComb1.connect(hybridCombGain1);
      hybridCombGain1.connect(hybridComb1);
      hybridComb1.connect(hybridMix);
      
      hybridProcessor.connect(hybridComb2);
      hybridComb2.connect(hybridCombGain2);
      hybridCombGain2.connect(hybridComb2);
      hybridComb2.connect(hybridMix);
      
      hybridMix.connect(output);
      break;
  }
  
  return { input, output };
}

// Ses efektini değiştir
function changeVoiceEffect() {
  const newEffect = document.getElementById('voiceEffect').value;
  voiceEffect = newEffect;
  
  if (micPermissionGranted && audioContext) {
    setupAudioProcessor();
  }
}

// Ses efektini test et
function testVoiceEffect() {
  const testBtn = document.getElementById('testVoiceBtn');
  
  if (!voiceTestActive) {
    // Test başlat
    if (!micPermissionGranted) {
      requestMicrophonePermission().then(granted => {
        if (granted) {
          startVoiceTest();
        }
      });
    } else {
      startVoiceTest();
    }
  } else {
    // Test durdur
    stopVoiceTest();
  }
}

// Ses testini başlat
function startVoiceTest() {
  voiceTestActive = true;
  const testBtn = document.getElementById('testVoiceBtn');
  testBtn.classList.add('testing');
  testBtn.textContent = '⏹️ Durdur';
  
  // Kaydı başlat
  if (processedStream) {
    recordedChunks = [];
    
    try {
      mediaRecorder = new MediaRecorder(processedStream, {
        mimeType: 'audio/webm'
      });
    } catch (e) {
      // Fallback
      mediaRecorder = new MediaRecorder(processedStream);
    }
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      // Kayıttan oynat
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.play();
      
      // Belleği temizle
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
    };
    
    mediaRecorder.start();
    
    // 3 saniye sonra durdur
    recordingTimeout = setTimeout(() => {
      stopVoiceTest();
    }, 3000);
  }
}

// Ses testini durdur
function stopVoiceTest() {
  voiceTestActive = false;
  const testBtn = document.getElementById('testVoiceBtn');
  testBtn.classList.remove('testing');
  testBtn.textContent = '🎤 Test Et';
  
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// Ses görselleştirici
function drawVisualizer() {
  if (!analyser || !dataArray) return;
  
  const canvas = document.getElementById('visualizerCanvas');
  const canvasCtx = canvas.getContext('2d');
  
  analyser.getByteFrequencyData(dataArray);
  
  canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  
  const barWidth = (canvas.width / dataArray.length) * 2.5;
  let barHeight;
  let x = 0;
  
  for (let i = 0; i < dataArray.length; i++) {
    barHeight = (dataArray[i] / 255) * canvas.height;
    
    const r = barHeight + 25 * (i / dataArray.length);
    const g = 250 * (i / dataArray.length);
    const b = 50;
    
    canvasCtx.fillStyle = `rgb(${r},${g},${b})`;
    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    
    x += barWidth + 1;
  }
  
  animationId = requestAnimationFrame(drawVisualizer);
}

// Visualizer'ı başlat
function startVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
  }
  drawVisualizer();
}

// Visualizer'ı durdur
function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  
  const canvas = document.getElementById('visualizerCanvas');
  const canvasCtx = canvas.getContext('2d');
  canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
}

// Konuşma toggle fonksiyonu
async function toggleTalk() {
  // Mikrofon izni yoksa al
  if (!micPermissionGranted) {
    const granted = await requestMicrophonePermission();
    if (!granted) return;
  }

  // Multi modda isMuted kontrolü
  if (roomMode === 'multi' && isMuted) {
    showNotification('Oda sahibi tarafından sessize alındınız.');
    return;
  }

  // Toggle konuşma durumu
  socket.emit('toggle-talk');
}

// Diğer ses fonksiyonları...