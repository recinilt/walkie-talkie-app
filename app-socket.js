// Sunucuya bağlan
function connectToServer() {
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    console.log('Sunucuya bağlandı');
    myId = socket.id;
    isConnected = true;
    
    socket.emit('join-room', { 
      roomId: currentRoom, 
      roomPassword: roomPassword,
      userName: myName 
    });
  });

  // Oda listesi güncellemeleri
  socket.on('room-created', (room) => {
    console.log('Yeni oda oluşturuldu:', room.id);
  });
  
  socket.on('room-updated', (room) => {
    console.log('Oda güncellendi:', room.id);
  });
  
  socket.on('room-deleted', ({ id }) => {
    console.log('Oda silindi:', id);
  });

  // Oda hatası
  socket.on('room-error', ({ message }) => {
    showError(message);
    socket.disconnect();
    resetLoginForm();
  });

  // Odaya başarıyla katıldı
  socket.on('room-joined', ({ roomId, isOwner: ownerStatus, mode }) => {
    console.log('Odaya katıldı:', roomId, 'Sahip mi:', ownerStatus);
    
    isOwner = ownerStatus;
    roomMode = mode;
    
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
    document.getElementById('currentRoom').textContent = roomId;
    
    if (roomPassword) {
      document.getElementById('roomCode').textContent = `(Şifre: ${roomPassword})`;
    } else {
      document.getElementById('roomCode').textContent = '(Şifresiz)';
    }
    
    updateOwnerControls();
    updateModeInfo(mode);
    updateModeControls();
    updateStatus('📡 Telsiz Hazır', 'idle');
  });

  // Mesaj eventleri
  socket.on('message-history', (messages) => {
    messages.forEach(msg => {
      addMessageToChat(msg);
    });
  });

  socket.on('new-message', (message) => {
    addMessageToChat(message);
  });

  // Kullanıcı eventleri
  socket.on('existing-users', (users) => {
    console.log('Mevcut kullanıcılar:', users);
    document.getElementById('participantList').innerHTML = '';
    
    users.forEach(user => {
      addParticipant(user.userId, user.userName, user.isTalking, user.handRaised, user.isMuted);
      if (micPermissionGranted && user.userId !== myId) {
        createPeerConnection(user.userId, true);
      }
    });
    updateParticipantCount();
  });

  socket.on('user-joined', ({ userId, userName }) => {
    console.log('Yeni kullanıcı:', userName);
    addParticipant(userId, userName, false, false, false);
    if (micPermissionGranted) {
      createPeerConnection(userId, false);
    }
    updateParticipantCount();
  });

  socket.on('user-left', ({ userId }) => {
    removeParticipant(userId);
    if (peerConnections.has(userId)) {
      peerConnections.get(userId).close();
      peerConnections.delete(userId);
    }
    updateParticipantCount();
  });

  // Oda yönetimi eventleri
  socket.on('owner-changed', ({ newOwnerId, newOwnerName, oldOwnerId, oldOwnerName }) => {
    if (newOwnerId === myId) {
      isOwner = true;
      updateOwnerControls();
      showNotification('Artık oda sahibisiniz!');
    } else {
      isOwner = false;
      updateOwnerControls();
    }
    
    updateParticipantOwnerStatus(oldOwnerId, false);
    updateParticipantOwnerStatus(newOwnerId, true);
  });

  socket.on('room-mode-changed', ({ mode }) => {
    roomMode = mode;
    document.getElementById('roomMode').value = mode;
    updateModeInfo(mode);
    updateModeControls();
    
    if (mode !== 'queue') {
      handRaised = false;
      document.getElementById('raiseHandBtn').textContent = '✋ El Kaldır';
      document.getElementById('raiseHandBtn').classList.remove('hand-raised');
    }
    
    if (mode !== 'multi') {
      isMuted = false;
      mutedUsers.clear();
      document.querySelectorAll('.participant').forEach(p => {
        p.classList.remove('muted');
      });
    }
  });

  // Konuşma kontrol eventleri
  socket.on('talk-granted', () => {
    isTalking = true;
    updateTalkButton('talking');
    updateStatus('🎤 Konuşuyor...', 'talking');
    startVisualizer();
    
    if (localStream && localStream.getAudioTracks()[0]) {
      localStream.getAudioTracks()[0].enabled = true;
    }
  });

  socket.on('talk-denied', ({ message, currentSpeaker }) => {
    if (message) {
      showError(message);
    } else if (currentSpeaker) {
      updateStatus(`🔇 ${currentSpeaker} konuşuyor`, 'busy');
    }
  });

  socket.on('talk-started', ({ userId, userName }) => {
    console.log(`${userName} konuşmaya başladı`);
    
    const participant = document.getElementById(`participant-${userId}`);
    if (participant) {
      participant.classList.add('talking');
    }
    
    if (userId !== myId) {
      updateStatus(`🎤 ${userName} konuşuyor`, 'busy');
      updateTalkButton('disabled');
    }
  });

  socket.on('talk-stopped', ({ userId }) => {
    console.log(`Kullanıcı konuşmayı bitirdi: ${userId}`);
    
    const participant = document.getElementById(`participant-${userId}`);
    if (participant) {
      participant.classList.remove('talking');
    }
    
    if (userId === myId) {
      isTalking = false;
      if (localStream && localStream.getAudioTracks()[0]) {
        localStream.getAudioTracks()[0].enabled = false;
      }
      stopVisualizer();
    }
    
    updateStatus('📡 Telsiz Hazır', 'idle');
    updateTalkButton('available');
  });

  // Oda durumu
  socket.on('room-status', (status) => {
    // Multi mod
    if (status.mode === 'multi') {
      if (status.mutedUsers.includes(myId)) {
        isMuted = true;
        updateTalkButton('disabled');
      } else {
        isMuted = false;
        if (!isTalking) {
          updateTalkButton('available');
        }
      }
      
      // Sessize alınanları güncelle
      mutedUsers = new Set(status.mutedUsers);
      document.querySelectorAll('.participant').forEach(p => {
        const userId = p.id.replace('participant-', '');
        if (mutedUsers.has(userId)) {
          p.classList.add('muted');
        } else {
          p.classList.remove('muted');
        }
      });
    }
    
    // Sıradaki konuşmacı gösterimi
    if (status.nextSpeakerId) {
      nextSpeakerId = status.nextSpeakerId;
      document.querySelectorAll('.participant').forEach(p => {
        p.classList.remove('next-speaker');
      });
      
      const nextParticipant = document.getElementById(`participant-${status.nextSpeakerId}`);
      if (nextParticipant) {
        nextParticipant.classList.add('next-speaker');
      }
      
      if (status.nextSpeakerId === myId) {
        updateStatus('📢 Sıra sizde!', 'next');
        showNotification('Konuşma sıranız geldi!');
      }
    } else {
      nextSpeakerId = null;
      document.querySelectorAll('.participant').forEach(p => {
        p.classList.remove('next-speaker');
      });
    }
    
    // Söz sırası listesini güncelle (queue mode)
    if (status.mode === 'queue' && status.speakRequests) {
      updateSpeakQueue(status.speakRequests);
    }
  });

  // Queue mode eventleri
  socket.on('queue-turn', ({ userId, userName }) => {
    if (userId === myId) {
      updateStatus('📢 Konuşma sıranız!', 'next');
      showNotification('Şimdi konuşabilirsiniz!');
      updateTalkButton('available');
    }
  });

  socket.on('hand-raised', ({ userId, userName, queuePosition }) => {
    const participant = document.getElementById(`participant-${userId}`);
    if (participant) {
      participant.classList.add('hand-raised');
    }
    
    if (userId === myId) {
      handRaised = true;
      document.getElementById('raiseHandBtn').textContent = '✋ El İndir';
      document.getElementById('raiseHandBtn').classList.add('hand-raised');
    }
  });

  socket.on('hand-lowered', ({ userId }) => {
    const participant = document.getElementById(`participant-${userId}`);
    if (participant) {
      participant.classList.remove('hand-raised');
    }
    
    if (userId === myId) {
      handRaised = false;
      document.getElementById('raiseHandBtn').textContent = '✋ El Kaldır';
      document.getElementById('raiseHandBtn').classList.remove('hand-raised');
    }
  });

  // Multi mode eventleri
  socket.on('user-muted', ({ userId, userName }) => {
    mutedUsers.add(userId);
    const participant = document.getElementById(`participant-${userId}`);
    if (participant) {
      participant.classList.add('muted');
    }
    
    if (userId === myId) {
      isMuted = true;
      updateTalkButton('disabled');
      showNotification('Oda sahibi tarafından sessize alındınız');
      
      // Konuşuyorsa durdur
      if (isTalking) {
        socket.emit('toggle-talk');
      }
    }
  });

  socket.on('user-unmuted', ({ userId, userName }) => {
    mutedUsers.delete(userId);
    const participant = document.getElementById(`participant-${userId}`);
    if (participant) {
      participant.classList.remove('muted');
    }
    
    if (userId === myId) {
      isMuted = false;
      updateTalkButton('available');
      showNotification('Sesiniz açıldı');
    }
  });

  socket.on('muted-users', (mutedUserIds) => {
    mutedUsers = new Set(mutedUserIds);
    if (mutedUsers.has(myId)) {
      isMuted = true;
      updateTalkButton('disabled');
    }
  });

  // WebRTC eventleri
  socket.on('offer', ({ from, offer }) => {
    console.log('Offer alındı:', from);
    handleOffer(from, offer);
  });

  socket.on('answer', ({ from, answer }) => {
    console.log('Answer alındı:', from);
    handleAnswer(from, answer);
  });

  socket.on('ice-candidate', ({ from, candidate }) => {
    console.log('ICE candidate alındı:', from);
    handleIceCandidate(from, candidate);
  });

  // Hata eventleri
  socket.on('mode-change-error', ({ message }) => {
    showError(message);
  });

  socket.on('ownership-transfer-error', ({ message }) => {
    showError(message);
  });

  // Bağlantı kopması
  socket.on('disconnect', () => {
    isConnected = false;
    updateStatus('❌ Bağlantı koptu', 'error');
    setTimeout(() => {
      if (!isConnected) {
        leaveRoom();
        showError('Sunucu bağlantısı koptu!');
      }
    }, 3000);
  });
}

// WebRTC handler fonksiyonları
function handleOffer(from, offer) {
  const pc = peerConnections.get(from) || createPeerConnection(from, false);
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(offer))
      .then(() => pc.createAnswer())
      .then(answer => {
        pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
      })
      .catch(err => console.error('Answer oluşturma hatası:', err));
  }
}

function handleAnswer(from, answer) {
  const pc = peerConnections.get(from);
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(answer))
      .catch(err => console.error('Answer set hatası:', err));
  }
}

function handleIceCandidate(from, candidate) {
  const pc = peerConnections.get(from);
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(err => console.error('ICE candidate hatası:', err));
  }
}