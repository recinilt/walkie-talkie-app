// Peer bağlantısı oluştur
function createPeerConnection(userId, createOffer) {
  if (!localStream) return null;

  const pc = new RTCPeerConnection(rtcConfig);

  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    pc.addTrack(audioTrack, localStream);
  }

  pc.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
    audio.id = `audio-${userId}`;
    document.body.appendChild(audio);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: userId, candidate: event.candidate });
    }
  };

  peerConnections.set(userId, pc);

  if (createOffer) {
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      socket.emit('offer', { to: userId, offer });
    }).catch(err => {
      console.error('Offer oluşturma hatası:', err);
    });
  }

  return pc;
}

// Tüm peer bağlantılarını güncelle
function updateAllPeerConnections() {
  if (!localStream) return;
  
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  
  peerConnections.forEach((pc, userId) => {
    const senders = pc.getSenders();
    const audioSender = senders.find(sender => 
      sender.track && sender.track.kind === 'audio'
    );
    
    if (audioSender) {
      audioSender.replaceTrack(audioTrack).catch(err => {
        console.error('Track değiştirme hatası:', err);
      });
    }
  });
}