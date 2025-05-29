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
  // Tüm ses efekti kodları buraya...
}

// Diğer ses fonksiyonları...