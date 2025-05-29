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
      
    // YENİ KRİPTOLU SES EFEKTLERİ - NET VE ANLAŞILIR
    case 'crypto1': // Dijital Şifreleme - Hafif pitch shift ile
      const crypto1Pitch = audioContext.createScriptProcessor(4096, 1, 1);
      const crypto1Buffer = new Float32Array(4096);
      let crypto1Index = 0;
      
      crypto1Pitch.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        // Sabit pitch shift (1.15 = %15 yukarı)
        const pitchRatio = 1.15;
        
        for (let i = 0; i < input.length; i++) {
          crypto1Buffer[crypto1Index] = input[i];
          crypto1Index = (crypto1Index + 1) % crypto1Buffer.length;
          
          const readIndex = Math.floor(i / pitchRatio);
          if (readIndex < input.length) {
            output[i] = input[readIndex];
          } else {
            output[i] = 0;
          }
        }
      };
      
      // Formant koruma için paralel işleme
      const crypto1Formant = audioContext.createBiquadFilter();
      crypto1Formant.type = 'bandpass';
      crypto1Formant.frequency.value = 2000;
      crypto1Formant.Q.value = 1;
      
      const crypto1Mix = audioContext.createGain();
      crypto1Mix.gain.value = 0.7;
      
      const crypto1Direct = audioContext.createGain();
      crypto1Direct.gain.value = 0.3;
      
      input.connect(crypto1Pitch);
      crypto1Pitch.connect(crypto1Mix);
      
      input.connect(crypto1Formant);
      crypto1Formant.connect(crypto1Direct);
      
      crypto1Mix.connect(output);
      crypto1Direct.connect(output);
      break;
      
    case 'crypto2': // Spektral Gizleme - Formant kaydırma
      const crypto2Processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      crypto2Processor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        // Basit formant kaydırma
        for (let i = 0; i < input.length; i++) {
          // Her örneği kopyala (netlik için)
          output[i] = input[i];
        }
      };
      
      // Formant filtreler serisi
      const crypto2Filter1 = audioContext.createBiquadFilter();
      crypto2Filter1.type = 'peaking';
      crypto2Filter1.frequency.value = 700; // İlk formant bölgesi
      crypto2Filter1.Q.value = 5;
      crypto2Filter1.gain.value = -6; // Azalt
      
      const crypto2Filter2 = audioContext.createBiquadFilter();
      crypto2Filter2.type = 'peaking';
      crypto2Filter2.frequency.value = 1220; // İkinci formant bölgesi
      crypto2Filter2.Q.value = 5;
      crypto2Filter2.gain.value = -4;
      
      const crypto2Filter3 = audioContext.createBiquadFilter();
      crypto2Filter3.type = 'peaking';
      crypto2Filter3.frequency.value = 2600; // Üçüncü formant
      crypto2Filter3.Q.value = 5;
      crypto2Filter3.gain.value = 6; // Artır
      
      const crypto2Comp = audioContext.createDynamicsCompressor();
      crypto2Comp.threshold.value = -24;
      crypto2Comp.ratio.value = 4;
      crypto2Comp.attack.value = 0.003;
      crypto2Comp.release.value = 0.25;
      
      input.connect(crypto2Processor);
      crypto2Processor.connect(crypto2Filter1);
      crypto2Filter1.connect(crypto2Filter2);
      crypto2Filter2.connect(crypto2Filter3);
      crypto2Filter3.connect(crypto2Comp);
      crypto2Comp.connect(output);
      break;
      
    case 'crypto3': // Nötr Ses - Cinsiyet gizleme
      const crypto3Processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      crypto3Processor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        // Hafif pitch modülasyonu (1.0 - 1.1 arası)
        const pitchRatio = 1.05;
        
        for (let i = 0; i < output.length; i++) {
          const index = Math.floor(i / pitchRatio);
          if (index < input.length) {
            output[i] = input[index];
          } else {
            output[i] = 0;
          }
        }
      };
      
      // Cinsiyet belirleyici frekansları maskele
      const crypto3NotchMale = audioContext.createBiquadFilter();
      crypto3NotchMale.type = 'notch';
      crypto3NotchMale.frequency.value = 120; // Erkek temel frekansı
      crypto3NotchMale.Q.value = 10;
      
      const crypto3NotchFemale = audioContext.createBiquadFilter();
      crypto3NotchFemale.type = 'notch';
      crypto3NotchFemale.frequency.value = 220; // Kadın temel frekansı
      crypto3NotchFemale.Q.value = 10;
      
      const crypto3Enhance = audioContext.createBiquadFilter();
      crypto3Enhance.type = 'peaking';
      crypto3Enhance.frequency.value = 1500; // Netlik için orta frekanslar
      crypto3Enhance.Q.value = 0.7;
      crypto3Enhance.gain.value = 3;
      
      input.connect(crypto3Processor);
      crypto3Processor.connect(crypto3NotchMale);
      crypto3NotchMale.connect(crypto3NotchFemale);
      crypto3NotchFemale.connect(crypto3Enhance);
      crypto3Enhance.connect(output);
      break;
      
    case 'crypto4': // Yaş Maskeleme
      const crypto4Processor = audioContext.createScriptProcessor(4096, 1, 1);
      let crypto4Phase = 0;
      
      crypto4Processor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        // Çok hafif tremolo efekti
        for (let i = 0; i < input.length; i++) {
          const tremolo = 0.95 + Math.sin(crypto4Phase) * 0.05;
          output[i] = input[i] * tremolo;
          crypto4Phase += 0.0001;
        }
      };
      
      // Yaş belirleyici özellikleri düzleştir
      const crypto4LowShelf = audioContext.createBiquadFilter();
      crypto4LowShelf.type = 'lowshelf';
      crypto4LowShelf.frequency.value = 200;
      crypto4LowShelf.gain.value = -3; // Yaşlı seslerdeki bass'ı azalt
      
      const crypto4HighShelf = audioContext.createBiquadFilter();
      crypto4HighShelf.type = 'highshelf';
      crypto4HighShelf.frequency.value = 4000;
      crypto4HighShelf.gain.value = -2; // Genç seslerdeki tizi azalt
      
      const crypto4Smooth = audioContext.createBiquadFilter();
      crypto4Smooth.type = 'bandpass';
      crypto4Smooth.frequency.value = 1800;
      crypto4Smooth.Q.value = 0.5;
      
      const crypto4Comp = audioContext.createDynamicsCompressor();
      crypto4Comp.threshold.value = -20;
      crypto4Comp.ratio.value = 3;
      
      input.connect(crypto4Processor);
      crypto4Processor.connect(crypto4LowShelf);
      crypto4LowShelf.connect(crypto4HighShelf);
      crypto4HighShelf.connect(crypto4Smooth);
      crypto4Smooth.connect(crypto4Comp);
      crypto4Comp.connect(output);
      break;
      
    case 'crypto5': // Gelişmiş Anonimleştirme
      const crypto5Processor = audioContext.createScriptProcessor(4096, 1, 1);
      const crypto5PrevMag = new Float32Array(2048);
      
      crypto5Processor.onaudioprocess = function(e) {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        // Spektral yumuşatma
        for (let i = 0; i < input.length; i++) {
          output[i] = input[i] * 0.9 + (crypto5PrevMag[i % 2048] || 0) * 0.1;
          crypto5PrevMag[i % 2048] = input[i];
        }
      };
      
      // Çok bantlı işleme
      const crypto5Low = audioContext.createBiquadFilter();
      crypto5Low.type = 'lowpass';
      crypto5Low.frequency.value = 800;
      
      const crypto5Mid = audioContext.createBiquadFilter();
      crypto5Mid.type = 'bandpass';
      crypto5Mid.frequency.value = 1500;
      crypto5Mid.Q.value = 0.7;
      
      const crypto5High = audioContext.createBiquadFilter();
      crypto5High.type = 'highpass';
      crypto5High.frequency.value = 2500;
      
      const crypto5LowGain = audioContext.createGain();
      crypto5LowGain.gain.value = 0.8;
      
      const crypto5MidGain = audioContext.createGain();
      crypto5MidGain.gain.value = 1.2;
      
      const crypto5HighGain = audioContext.createGain();
      crypto5HighGain.gain.value = 0.6;
      
      const crypto5Merger = audioContext.createGain();
      
      // Paralel işleme
      input.connect(crypto5Processor);
      
      crypto5Processor.connect(crypto5Low);
      crypto5Low.connect(crypto5LowGain);
      crypto5LowGain.connect(crypto5Merger);
      
      crypto5Processor.connect(crypto5Mid);
      crypto5Mid.connect(crypto5MidGain);
      crypto5MidGain.connect(crypto5Merger);
      
      crypto5Processor.connect(crypto5High);
      crypto5High.connect(crypto5HighGain);
      crypto5HighGain.connect(crypto5Merger);
      
      // Final kompresyon
      const crypto5FinalComp = audioContext.createDynamicsCompressor();
      crypto5FinalComp.threshold.value = -18;
      crypto5FinalComp.ratio.value = 4;
      crypto5FinalComp.attack.value = 0.005;
      crypto5FinalComp.release.value = 0.1;
      
      crypto5Merger.connect(crypto5FinalComp);
      crypto5FinalComp.connect(output);
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