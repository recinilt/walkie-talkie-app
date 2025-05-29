// WebRTC ve Socket.io yapılandırması
// Render.com URL'nizi buraya yazın
//const SERVER_URL = 'https://walkie-talkie-server.onrender.com';
const SERVER_URL = 'https://walkie-talkie-server-4p8m.onrender.com';
let socket = null;
let localStream = null;
let originalStream = null; // Orijinal mikrofon akışı
let processedStream = null; // İşlenmiş ses akışı
let peerConnections = new Map();
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let micPermissionGranted = false;

// Ses efektleri için yeni değişkenler
let voiceEffect = 'normal';
let audioProcessorNode = null;
let voiceTestActive = false;

// Ses testi için kayıt değişkenleri
let mediaRecorder = null;
let recordedChunks = [];
let recordingTimeout = null;

// Kullanıcı bilgileri
let myId = null;
let myName = '';
let currentRoom = '';
let roomPassword = '';
let isTalking = false;
let isConnected = false;
let isOwner = false;
let roomMode = 'free';
let nextSpeakerId = null;
let handRaised = false;
let isMuted = false;
let mutedUsers = new Set();

// WebRTC yapılandırması
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Sayfa yüklendiğinde odaları listele
document.addEventListener('DOMContentLoaded', () => {
  refreshRoomList();
  
  // Enter ile form gönderme
  const inputs = document.querySelectorAll('#loginScreen input');
  inputs.forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        joinRoom();
      }
    });
  });
});

// Oda listesini yenile
function refreshRoomList() {
  // Geçici socket bağlantısı
  const tempSocket = io(SERVER_URL);
  
  tempSocket.on('connect', () => {
    tempSocket.emit('get-rooms');
  });
  
  tempSocket.on('room-list', (rooms) => {
    displayRoomList(rooms);
    tempSocket.disconnect();
  });
  
  // Hata durumunda
  tempSocket.on('connect_error', () => {
    document.getElementById('roomListLoading').style.display = 'none';
    document.getElementById('noRoomsMessage').textContent = 'Sunucuya bağlanılamadı';
    document.getElementById('noRoomsMessage').style.display = 'block';
    tempSocket.disconnect();
  });
  
  // 5 saniye sonra timeout
  setTimeout(() => {
    if (tempSocket.connected) {
      tempSocket.disconnect();
    }
  }, 5000);
}

// Oda listesini göster
function displayRoomList(rooms) {
  const roomListEl = document.getElementById('roomList');
  const loadingEl = document.getElementById('roomListLoading');
  const noRoomsEl = document.getElementById('noRoomsMessage');
  
  loadingEl.style.display = 'none';
  
  if (rooms.length === 0) {
    roomListEl.style.display = 'none';
    noRoomsEl.style.display = 'block';
    return;
  }
  
  noRoomsEl.style.display = 'none';
  roomListEl.style.display = 'block';
  roomListEl.innerHTML = '';
  
  rooms.forEach(room => {
    const li = document.createElement('li');
    li.className = 'room-item';
    
    const modeIcons = {
      'free': '🎤',
      'ordered': '📋',
      'queue': '✋',
      'multi': '👥'
    };
    
    li.innerHTML = `
      <div class="room-item-info">
        <span class="room-name">${room.id}</span>
        <span class="room-details">
          ${modeIcons[room.mode] || '🎤'} 
          ${room.hasPassword ? '🔒' : '🔓'} 
          👥 ${room.userCount}
        </span>
      </div>
      <button onclick="quickJoinRoom('${room.id}', ${room.hasPassword})" class="quick-join-btn">
        Katıl
      </button>
    `;
    
    roomListEl.appendChild(li);
  });
}

// Hızlı oda katılımı
function quickJoinRoom(roomId, hasPassword) {
  const userName = document.getElementById('userName').value.trim();
  
  if (!userName) {
    showError('Lütfen önce adınızı girin!');
    return;
  }
  
  document.getElementById('roomId').value = roomId;
  
  if (hasPassword) {
    const password = prompt('Bu oda şifreli. Lütfen şifreyi girin:');
    if (password !== null) {
      document.getElementById('roomPassword').value = password;
      joinRoom();
    }
  } else {
    document.getElementById('roomPassword').value = '';
    joinRoom();
  }
}

// Odaya katıl
async function joinRoom() {
  const userName = document.getElementById('userName').value.trim();
  const roomId = document.getElementById('roomId').value.trim();
  const password = document.getElementById('roomPassword').value;

  if (!userName) {
    showError('Lütfen adınızı girin!');
    return;
  }

  if (!roomId) {
    showError('Lütfen oda adı girin!');
    return;
  }

  myName = userName;
  currentRoom = roomId;
  roomPassword = password || '';

  // Loading durumu
  const joinButton = document.getElementById('joinButton');
  joinButton.disabled = true;
  joinButton.textContent = 'Bağlanıyor...';

  // Socket bağlantısı kur
  connectToServer();
}

// Sunucuya bağlan
function connectToServer() {
  socket = io(SERVER_URL);

  socket.on('connect', () => {
    console.log('Sunucuya bağlandı');
    myId = socket.id;
    isConnected = true;
    
    // Odaya katıl
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
    
    // Ekranları değiştir
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
    document.getElementById('currentRoom').textContent = roomId;
    
    // Şifre durumunu göster
    if (roomPassword) {
      document.getElementById('roomCode').textContent = `(Şifre: ${roomPassword})`;
    } else {
      document.getElementById('roomCode').textContent = '(Şifresiz)';
    }
    
    // Oda sahibi kontrollerini ayarla
    updateOwnerControls();
    
    updateModeInfo(mode);
    updateModeControls();
    updateStatus('📡 Telsiz Hazır', 'idle');
  });

  // Mesaj geçmişi
  socket.on('message-history', (messages) => {
    messages.forEach(msg => {
      addMessageToChat(msg);
    });
  });

  // Yeni mesaj
  socket.on('new-message', (message) => {
    addMessageToChat(message);
  });

  // Mevcut kullanıcılar
  socket.on('existing-users', (users) => {
    console.log('Mevcut kullanıcılar:', users);
    // Önce listeyi temizle
    document.getElementById('participantList').innerHTML = '';
    
    // Tüm kullanıcıları ekle (kendisi dahil)
    users.forEach(user => {
      addParticipant(user.userId, user.userName, user.isTalking, user.handRaised, user.isMuted);
      if (micPermissionGranted && user.userId !== myId) {
        createPeerConnection(user.userId, true);
      }
    });
    updateParticipantCount();
  });

  // Yeni kullanıcı katıldı
  socket.on('user-joined', ({ userId, userName }) => {
    console.log('Yeni kullanıcı:', userName);
    addParticipant(userId, userName, false, false, false);
    if (micPermissionGranted) {
      createPeerConnection(userId, false);
    }
    updateParticipantCount();
  });

  // Kullanıcı ayrıldı
  socket.on('user-left', ({ userId }) => {
    removeParticipant(userId);
    if (peerConnections.has(userId)) {
      peerConnections.get(userId).close();
      peerConnections.delete(userId);
    }
    updateParticipantCount();
  });

  // Oda sahibi değişti
  socket.on('owner-changed', ({ newOwnerId, newOwnerName, oldOwnerId, oldOwnerName }) => {
    if (newOwnerId === myId) {
      isOwner = true;
      updateOwnerControls();
      showNotification('Artık oda sahibisiniz!');
    } else {
      isOwner = false;
      updateOwnerControls();
    }
    
    // Eski ve yeni sahiplerin görünümlerini güncelle
    updateParticipantOwnerStatus(oldOwnerId, false);
    updateParticipantOwnerStatus(newOwnerId, true);
  });

  // Oda modu değişti
  socket.on('room-mode-changed', ({ mode }) => {
    roomMode = mode;
    document.getElementById('roomMode').value = mode;
    updateModeInfo(mode);
    updateModeControls();
    
    // Queue moddan çıkıldıysa el kaldırma durumunu sıfırla
    if (mode !== 'queue') {
      handRaised = false;
      document.getElementById('raiseHandBtn').textContent = '✋ El Kaldır';
      document.getElementById('raiseHandBtn').classList.remove('hand-raised');
    }
    
    // Multi moddan çıkıldıysa sessize alma durumlarını sıfırla
    if (mode !== 'multi') {
      isMuted = false;
      mutedUsers.clear();
      document.querySelectorAll('.participant').forEach(p => {
        p.classList.remove('muted');
      });
    }
  });

  // Sessize alınan kullanıcılar listesi (multi mode)
  socket.on('muted-users', (users) => {
    mutedUsers = new Set(users);
    isMuted = users.includes(myId);
    
    // Tüm katılımcıların sessize alma durumunu güncelle
    document.querySelectorAll('.participant').forEach(p => {
      const userId = p.id.replace('participant-', '');
      if (mutedUsers.has(userId)) {
        p.classList.add('muted');
      } else {
        p.classList.remove('muted');
      }
    });
    
    updateModeControls();
  });

  // Kullanıcı sessize alındı (multi mode)
  socket.on('user-muted', ({ userId, userName }) => {
    mutedUsers.add(userId);
    if (userId === myId) {
      isMuted = true;
      showNotification('Oda sahibi tarafından sessize alındınız!');
      // Eğer konuşuyorsa durdur
      if (isTalking) {
        toggleTalk();
      }
    }
    updateParticipantMutedStatus(userId, true);
    updateModeControls();
  });

  // Kullanıcının sessize alması kaldırıldı (multi mode)
  socket.on('user-unmuted', ({ userId, userName }) => {
    mutedUsers.delete(userId);
    if (userId === myId) {
      isMuted = false;
      showNotification('Sessize alma kaldırıldı!');
    }
    updateParticipantMutedStatus(userId, false);
    updateModeControls();
  });

  // El kaldırıldı (queue mode)
  socket.on('hand-raised', ({ userId, userName, queuePosition }) => {
    updateParticipantHand(userId, true);
    if (userId === myId && queuePosition) {
      showNotification(`El kaldırdınız. Sıranız: ${queuePosition}`);
    }
  });

  // El indirildi (queue mode)
  socket.on('hand-lowered', ({ userId }) => {
    updateParticipantHand(userId, false);
  });

  // Sıra geldi (queue mode)
  socket.on('queue-turn', ({ userId, userName }) => {
    if (userId === myId) {
      showNotification('Sıranız geldi! Konuşabilirsiniz.');
    }
  });

  // Mod değiştirme hatası
  socket.on('mode-change-error', ({ message }) => {
    showError(message);
  });

  // Sahiplik devir hatası
  socket.on('ownership-transfer-error', ({ message }) => {
    showError(message);
  });

  // WebRTC sinyalleri
  socket.on('offer', async ({ from, offer }) => {
    if (micPermissionGranted) {
      const pc = createPeerConnection(from, false);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { to: from, answer });
    }
  });

  socket.on('answer', async ({ from, answer }) => {
    const pc = peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(answer);
    }
  });

  socket.on('ice-candidate', ({ from, candidate }) => {
    const pc = peerConnections.get(from);
    if (pc) {
      pc.addIceCandidate(candidate);
    }
  });

  // Konuşma kontrolleri
  socket.on('talk-granted', () => {
    isTalking = true;
    if (localStream) {
      localStream.getAudioTracks()[0].enabled = true;
    }
    updateTalkButton('talking');
    updateStatus('🔴 Konuşuyorsun', 'talking');
    startVisualizer();
  });

  socket.on('talk-denied', ({ currentSpeaker, message }) => {
    if (message) {
      updateStatus(`⏳ ${message}`, 'busy');
    } else if (currentSpeaker) {
      updateStatus(`🔊 ${currentSpeaker} konuşuyor`, 'busy');
    }
    updateTalkButton('available');
  });

  socket.on('talk-started', ({ userId, userName }) => {
    if (userId !== myId) {
      if (roomMode === 'multi') {
        updateStatus(`🔊 Konuşanlar var`, 'busy');
      } else {
        updateStatus(`🔊 ${userName} konuşuyor`, 'busy');
      }
      if (roomMode !== 'multi') {
        updateTalkButton('disabled');
      }
    }
    updateParticipantTalking(userId, true);
  });

  socket.on('talk-stopped', ({ userId }) => {
    updateParticipantTalking(userId, false);
    
    if (userId === myId) {
      // Kendimiz durdurduysak
      isTalking = false;
      if (localStream) {
        localStream.getAudioTracks()[0].enabled = false;
      }
      updateTalkButton('available');
      updateStatus('📡 Telsiz Hazır', 'idle');
      stopVisualizer();
    } else {
      // Başkası durdurduğunda
      if (roomMode === 'multi') {
        // Multi modda hala konuşan var mı kontrol et
        const talkingCount = document.querySelectorAll('.participant.talking').length;
        if (talkingCount > 0) {
          updateStatus(`🔊 Konuşanlar var`, 'busy');
        } else {
          updateStatus('📡 Telsiz Hazır', 'idle');
        }
      } else {
        updateStatus('📡 Telsiz Hazır', 'idle');
        updateTalkButton('available');
      }
    }
  });

  socket.on('room-status', ({ userCount, isBusy, talkingUser, talkingUsers, mode, nextSpeaker, nextSpeakerId: speakerId, queueLength, speakRequests, mutedUsers: muted, owner }) => {
    document.getElementById('participantCount').textContent = userCount;
    nextSpeakerId = speakerId;
    
    if (mode === 'multi' && muted) {
      mutedUsers = new Set(muted);
      isMuted = muted.includes(myId);
    }
    
    if (mode === 'ordered' && nextSpeaker && !isBusy) {
      updateStatus(`⏳ Sıra: ${nextSpeaker}`, nextSpeaker === myName ? 'next' : 'idle');
      updateNextSpeakerIndicator(speakerId);
    } else if (mode === 'queue' && !isBusy) {
      if (queueLength > 0) {
        updateStatus(`📋 Bekleyen: ${queueLength} kişi`, 'idle');
      }
      updateSpeakQueue(speakRequests);
    } else if (mode === 'multi' && talkingUsers && talkingUsers.length > 0) {
      const names = talkingUsers.map(u => u.name).join(', ');
      updateStatus(`🔊 Konuşanlar: ${names}`, 'busy');
    }
    
    updateOwnerControls();
  });

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

// Mesaj gönder
function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  
  if (!text || !socket || !isConnected) return;
  
  socket.emit('send-message', { text });
  input.value = '';
}

// Mesajı chat'e ekle
function addMessageToChat(message) {
  const chatMessages = document.getElementById('chatMessages');
  const messageEl = document.createElement('div');
  
  if (message.type === 'system') {
    messageEl.className = 'chat-message system-message';
    messageEl.innerHTML = `
      <span class="message-text">${message.text}</span>
      <span class="message-time">${formatTime(message.timestamp)}</span>
    `;
  } else {
    messageEl.className = `chat-message ${message.userId === myId ? 'my-message' : 'other-message'}`;
    messageEl.innerHTML = `
      <div class="message-header">
        <span class="message-author">${message.userName}</span>
        <span class="message-time">${formatTime(message.timestamp)}</span>
      </div>
      <div class="message-text">${escapeHtml(message.text)}</div>
    `;
  }
  
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Toggle konuşma - GÜNCELLENDİ
function toggleTalk() {
  if (!isConnected || !socket) return;
  
  // İlk defa basıldıysa mikrofon izni al
  if (!micPermissionGranted) {
    requestMicrophonePermission().then(granted => {
      if (granted) {
        // AudioContext'i başlat
        if (audioContext && audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            socket.emit('toggle-talk');
          });
        } else {
          socket.emit('toggle-talk');
        }
      }
    });
  } else {
    // AudioContext'i kontrol et
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        socket.emit('toggle-talk');
      });
    } else {
      socket.emit('toggle-talk');
    }
  }
}

// Oda sahibi kontrollerini güncelle
function updateOwnerControls() {
  const roomModeSelect = document.getElementById('roomMode');
  const ownerBadge = document.getElementById('ownerBadge');
  const ownerControls = document.getElementById('ownerControls');
  const skipBtn = document.getElementById('skipTurnBtn');
  const nextBtn = document.getElementById('nextSpeakerBtn');
  const transferBtn = document.getElementById('transferOwnershipBtn');
  
  if (isOwner) {
    roomModeSelect.disabled = false;
    ownerBadge.style.display = 'inline';
    ownerControls.style.display = 'block';
    transferBtn.style.display = 'inline-block';
    
    // Mod'a göre butonları göster/gizle
    if (roomMode === 'ordered') {
      skipBtn.style.display = 'inline-block';
      nextBtn.style.display = 'none';
    } else if (roomMode === 'queue') {
      skipBtn.style.display = 'none';
      nextBtn.style.display = 'inline-block';
    } else {
      skipBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    }
  } else {
    roomModeSelect.disabled = true;
    ownerBadge.style.display = 'none';
    ownerControls.style.display = 'none';
    transferBtn.style.display = 'none';
  }
}

// Mod kontrollerini güncelle
function updateModeControls() {
  const raiseHandBtn = document.getElementById('raiseHandBtn');
  const speakQueueContainer = document.getElementById('speakQueueContainer');
  const mutedUsersContainer = document.getElementById('mutedUsersContainer');
  
  if (roomMode === 'queue') {
    raiseHandBtn.style.display = 'inline-block';
    speakQueueContainer.style.display = 'block';
    mutedUsersContainer.style.display = 'none';
  } else if (roomMode === 'multi') {
    raiseHandBtn.style.display = 'none';
    speakQueueContainer.style.display = 'none';
    mutedUsersContainer.style.display = 'block';
    
    // Konuş butonu durumunu güncelle - sessize alınmışsa disabled, değilse available
    if (isMuted) {
      updateTalkButton('disabled');
    } else if (!isTalking) {
      updateTalkButton('available');
    }
  } else {
    raiseHandBtn.style.display = 'none';
    speakQueueContainer.style.display = 'none';
    mutedUsersContainer.style.display = 'none';
  }
}

// Sırayı atlat
function skipTurn() {
  if (!socket || !isConnected || !isOwner || roomMode !== 'ordered') return;
  socket.emit('skip-turn');
}

// Sonraki konuşmacı (queue mode)
function nextSpeaker() {
  if (!socket || !isConnected || !isOwner || roomMode !== 'queue') return;
  socket.emit('next-speaker');
}

// Sahipliği devret
function transferOwnership() {
  if (!socket || !isConnected || !isOwner) return;
  
  // Kullanıcı seçimi için modal aç
  const participants = document.querySelectorAll('.participant');
  if (participants.length <= 1) {
    showError('Sahipliği devredecek başka kullanıcı yok!');
    return;
  }
  
  let userList = '<div class="transfer-list">';
  participants.forEach(p => {
    const userId = p.id.replace('participant-', '');
    if (userId !== myId) {
      const userName = p.querySelector('.participant-name').textContent.replace(' (Sen)', '').replace(' 👑', '');
      userList += `
        <div class="transfer-item" onclick="confirmTransferOwnership('${userId}', '${userName}')">
          <span>${userName}</span>
          <button class="transfer-select-btn">Seç</button>
        </div>
      `;
    }
  });
  userList += '</div>';
  
  showTransferModal(userList);
}

// Sahiplik devri onayı
function confirmTransferOwnership(userId, userName) {
  if (confirm(`Oda sahipliğini ${userName} kişisine devretmek istediğinize emin misiniz?`)) {
    socket.emit('transfer-ownership', { newOwnerId: userId });
    closeTransferModal();
  }
}

// Sessize al/aç (multi mode)
function toggleMuteUser(userId) {
  if (!socket || !isConnected || !isOwner || roomMode !== 'multi') return;
  socket.emit('toggle-mute-user', { targetUserId: userId });
}

// El kaldır/indir
function toggleHand() {
  if (!socket || !isConnected || roomMode !== 'queue') return;
  
  if (handRaised) {
    socket.emit('lower-hand');
    handRaised = false;
    document.getElementById('raiseHandBtn').textContent = '✋ El Kaldır';
    document.getElementById('raiseHandBtn').classList.remove('hand-raised');
  } else {
    socket.emit('raise-hand');
    handRaised = true;
    document.getElementById('raiseHandBtn').textContent = '✋ El İndir';
    document.getElementById('raiseHandBtn').classList.add('hand-raised');
  }
}

// Söz sırası listesini güncelle
function updateSpeakQueue(speakRequests) {
  const queueList = document.getElementById('speakQueueList');
  queueList.innerHTML = '';
  
  speakRequests.forEach((req, index) => {
    const li = document.createElement('li');
    li.textContent = req.name;
    if (req.id === myId) {
      li.classList.add('my-queue-position');
    }
    queueList.appendChild(li);
  });
}

// Sıradaki konuşmacıyı işaretle
function updateNextSpeakerIndicator(speakerId) {
  // Önce tüm işaretleri kaldır
  document.querySelectorAll('.participant').forEach(p => {
    p.classList.remove('next-speaker');
  });
  
  // Sıradaki kişiyi işaretle
  if (speakerId) {
    const nextSpeakerEl = document.getElementById(`participant-${speakerId}`);
    if (nextSpeakerEl) {
      nextSpeakerEl.classList.add('next-speaker');
    }
  }
}

// El kaldırma durumunu güncelle
function updateParticipantHand(userId, raised) {
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) {
    if (raised) {
      participant.classList.add('hand-raised');
    } else {
      participant.classList.remove('hand-raised');
    }
  }
}

// Sessize alma durumunu güncelle
function updateParticipantMutedStatus(userId, muted) {
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) {
    if (muted) {
      participant.classList.add('muted');
    } else {
      participant.classList.remove('muted');
    }
    
    // Sessize al butonunu güncelle
    const muteBtn = participant.querySelector('.mute-btn');
    if (muteBtn) {
      muteBtn.textContent = muted ? '🔊' : '🔇';
    }
  }
}

// Sahiplik durumunu güncelle
function updateParticipantOwnerStatus(userId, isOwner) {
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) {
    const nameEl = participant.querySelector('.participant-name');
    if (nameEl) {
      const currentName = nameEl.textContent.replace(' (Sen)', '').replace(' 👑', '');
      if (isOwner) {
        nameEl.textContent = currentName + ' 👑';
      } else {
        nameEl.textContent = currentName + (userId === myId ? ' (Sen)' : '');
      }
    }
  }
}

// Oda modunu değiştir
function changeRoomMode() {
  const mode = document.getElementById('roomMode').value;
  socket.emit('change-room-mode', { mode });
}

// Mod bilgisini güncelle
function updateModeInfo(mode) {
  const modeInfo = document.getElementById('modeInfo');
  const modeDescriptions = {
    'free': '🎤 Serbest Konuşma - Telsiz boştayken herkes konuşabilir',
    'ordered': '📋 Sıralı Konuşma - Herkes sırayla konuşur',
    'queue': '✋ Söz Sırası - El kaldıranlar sırayla konuşur',
    'multi': '👥 Aynı Anda - Herkes aynı anda konuşabilir'
  };
  
  modeInfo.textContent = modeDescriptions[mode] || '';
  modeInfo.style.display = 'block';
}

// Mikrofon iznini al ve peer bağlantılarını kur - TAMAMEN YENİDEN YAZILDI
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

    // Ses analizi için AudioContext oluştur
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Analyser'ı oluştur
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    // localStream'i orijinal akış olarak ayarla
    localStream = originalStream;
    
    // Ses efektleri için processor node oluştur
    setupAudioProcessor();

    // Başlangıçta mikrofonu kapat
    if (processedStream) {
      processedStream.getAudioTracks()[0].enabled = false;
    }

    // Mevcut kullanıcılarla peer bağlantısı kur
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

// Ses işlemci kurulumu - TAMAMEN YENİDEN YAZILDI
function setupAudioProcessor() {
  if (!originalStream || !audioContext) return;
  
  // Mevcut işlenmiş akışı temizle
  if (processedStream) {
    processedStream.getTracks().forEach(track => track.stop());
  }
  
  const source = audioContext.createMediaStreamSource(originalStream);
  const destination = audioContext.createMediaStreamDestination();
  
  // Master gain kontrolü
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 1.2;
  
  // Ses efekti zinciri oluştur
  audioProcessorNode = createEffectChain(voiceEffect);
  
  // Bağlantıları kur
  source.connect(audioProcessorNode.input);
  audioProcessorNode.output.connect(masterGain);
  masterGain.connect(destination);
  
  // Analyser'ı bağla
  masterGain.connect(analyser);
  
  // İşlenmiş ses akışını al
  processedStream = destination.stream;
  
  // Track'in enabled durumunu koru
  const wasEnabled = localStream && localStream.getAudioTracks()[0] ? 
    localStream.getAudioTracks()[0].enabled : false;
  
  // localStream'i işlenmiş akış olarak güncelle
  localStream = processedStream;
  
  // Enabled durumunu geri yükle
  if (localStream.getAudioTracks()[0]) {
    localStream.getAudioTracks()[0].enabled = wasEnabled;
  }
  
  // Tüm peer bağlantılarını güncelle
  updateAllPeerConnections();
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

// Ses efekti zinciri oluştur - SES SEVİYESİ DÜZELTİLMİŞ
function createEffectChain(effect) {
  const input = audioContext.createGain();
  input.gain.value = 1.0;
  
  const outputGain = audioContext.createGain();
  outputGain.gain.value = 1.5; // Genel çıkış seviyesini artır
  
  let currentNode = input;
  
  switch(effect) {
    case 'robot':
      // Robot sesi
      const robotGain = audioContext.createGain();
      robotGain.gain.value = 2.0; // Giriş kazancını artır
      
      const robotFilter = audioContext.createBiquadFilter();
      robotFilter.type = 'lowpass';
      robotFilter.frequency.value = 1000;
      robotFilter.Q.value = 10;
      
      const robotDistortion = audioContext.createWaveShaper();
      robotDistortion.curve = makeDistortionCurve(40); // Distortion'ı azalt
      robotDistortion.oversample = '4x';
      
      const robotOutput = audioContext.createGain();
      robotOutput.gain.value = 1.5;
      
      currentNode.connect(robotGain);
      robotGain.connect(robotFilter);
      robotFilter.connect(robotDistortion);
      robotDistortion.connect(robotOutput);
      robotOutput.connect(outputGain);
      break;
      
    case 'alien':
      // Uzaylı sesi
      const alienGain = audioContext.createGain();
      alienGain.gain.value = 2.0;
      
      const alienFilter1 = audioContext.createBiquadFilter();
      alienFilter1.type = 'bandpass';
      alienFilter1.frequency.value = 1500;
      alienFilter1.Q.value = 5;
      
      const alienDelay = audioContext.createDelay(1);
      alienDelay.delayTime.value = 0.05;
      
      const alienMix = audioContext.createGain();
      alienMix.gain.value = 0.8;
      
      currentNode.connect(alienGain);
      alienGain.connect(alienFilter1);
      alienFilter1.connect(alienDelay);
      alienDelay.connect(alienMix);
      alienFilter1.connect(alienMix);
      alienMix.connect(outputGain);
      break;
      
    case 'deep':
      // Kalın ses
      const deepGain = audioContext.createGain();
      deepGain.gain.value = 2.5; // Daha yüksek gain
      
      const deepFilter = audioContext.createBiquadFilter();
      deepFilter.type = 'lowpass';
      deepFilter.frequency.value = 500;
      deepFilter.Q.value = 10;
      
      const deepBoost = audioContext.createGain();
      deepBoost.gain.value = 1.8;
      
      currentNode.connect(deepGain);
      deepGain.connect(deepFilter);
      deepFilter.connect(deepBoost);
      deepBoost.connect(outputGain);
      break;
      
    case 'high':
      // İnce ses
      const highGain = audioContext.createGain();
      highGain.gain.value = 2.0;
      
      const highFilter = audioContext.createBiquadFilter();
      highFilter.type = 'highpass';
      highFilter.frequency.value = 1000;
      highFilter.Q.value = 10;
      
      const highBoost = audioContext.createGain();
      highBoost.gain.value = 1.5;
      
      currentNode.connect(highGain);
      highGain.connect(highFilter);
      highFilter.connect(highBoost);
      highBoost.connect(outputGain);
      break;
      
    case 'echo':
      // Yankı efekti
      const echoGain = audioContext.createGain();
      echoGain.gain.value = 1.5;
      
      const echoDelay = audioContext.createDelay(1);
      echoDelay.delayTime.value = 0.3;
      
      const echoFeedback = audioContext.createGain();
      echoFeedback.gain.value = 0.4;
      
      const echoFilter = audioContext.createBiquadFilter();
      echoFilter.type = 'highpass';
      echoFilter.frequency.value = 500;
      
      const echoMix = audioContext.createGain();
      echoMix.gain.value = 1.2;
      
      // Dry signal
      currentNode.connect(echoGain);
      echoGain.connect(echoMix);
      
      // Wet signal (echo)
      echoGain.connect(echoDelay);
      echoDelay.connect(echoFeedback);
      echoFeedback.connect(echoFilter);
      echoFilter.connect(echoDelay);
      echoFilter.connect(echoMix);
      
      echoMix.connect(outputGain);
      break;
      
    case 'radio':
      // Radyo sesi
      const radioGain = audioContext.createGain();
      radioGain.gain.value = 3.0; // Yüksek gain
      
      const radioFilter1 = audioContext.createBiquadFilter();
      radioFilter1.type = 'bandpass';
      radioFilter1.frequency.value = 2000;
      radioFilter1.Q.value = 10;
      
      const radioFilter2 = audioContext.createBiquadFilter();
      radioFilter2.type = 'bandpass';
      radioFilter2.frequency.value = 2500;
      radioFilter2.Q.value = 10;
      
      const radioCompressor = audioContext.createDynamicsCompressor();
      radioCompressor.threshold.value = -15; // Threshold'u yükselt
      radioCompressor.ratio.value = 6;
      radioCompressor.attack.value = 0.003;
      radioCompressor.release.value = 0.25;
      
      const radioOutput = audioContext.createGain();
      radioOutput.gain.value = 1.5;
      
      currentNode.connect(radioGain);
      radioGain.connect(radioFilter1);
      radioFilter1.connect(radioFilter2);
      radioFilter2.connect(radioCompressor);
      radioCompressor.connect(radioOutput);
      radioOutput.connect(outputGain);
      break;
      
    case 'underwater':
      // Su altı sesi
      const waterGain = audioContext.createGain();
      waterGain.gain.value = 2.0;
      
      const waterFilter = audioContext.createBiquadFilter();
      waterFilter.type = 'lowpass';
      waterFilter.frequency.value = 400;
      waterFilter.Q.value = 2;
      
      const waterDelay = audioContext.createDelay(1);
      waterDelay.delayTime.value = 0.03;
      
      const waterMix = audioContext.createGain();
      waterMix.gain.value = 1.5;
      
      currentNode.connect(waterGain);
      waterGain.connect(waterFilter);
      waterFilter.connect(waterDelay);
      waterDelay.connect(waterMix);
      waterFilter.connect(waterMix);
      waterMix.connect(outputGain);
      break;
      
    case 'telephone':
      // Telefon sesi
      const telGain = audioContext.createGain();
      telGain.gain.value = 3.0;
      
      const telFilter1 = audioContext.createBiquadFilter();
      telFilter1.type = 'bandpass';
      telFilter1.frequency.value = 2000;
      telFilter1.Q.value = 15;
      
      const telFilter2 = audioContext.createBiquadFilter();
      telFilter2.type = 'bandpass';
      telFilter2.frequency.value = 2500;
      telFilter2.Q.value = 15;
      
      const telCompressor = audioContext.createDynamicsCompressor();
      telCompressor.threshold.value = -20;
      telCompressor.ratio.value = 8;
      
      const telOutput = audioContext.createGain();
      telOutput.gain.value = 1.5;
      
      currentNode.connect(telGain);
      telGain.connect(telFilter1);
      telFilter1.connect(telFilter2);
      telFilter2.connect(telCompressor);
      telCompressor.connect(telOutput);
      telOutput.connect(outputGain);
      break;
      
    case 'cave':
      // Mağara sesi
      const caveInput = audioContext.createGain();
      caveInput.gain.value = 1.8;
      
      const caveGain = audioContext.createGain();
      caveGain.gain.value = 0.8;
      
      currentNode.connect(caveInput);
      caveInput.connect(caveGain);
      caveGain.connect(outputGain);
      
      // Multiple echoes
      for (let i = 0; i < 3; i++) {
        const delay = audioContext.createDelay(1);
        delay.delayTime.value = (i + 1) * 0.15;
        
        const gain = audioContext.createGain();
        gain.gain.value = 0.5 / (i + 1);
        
        caveInput.connect(delay);
        delay.connect(gain);
        gain.connect(outputGain);
      }
      break;
      
    case 'normal':
    default:
      // Normal ses - direkt bağlantı ama gain artırılmış
      const normalGain = audioContext.createGain();
      normalGain.gain.value = 1.5;
      currentNode.connect(normalGain);
      normalGain.connect(outputGain);
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
  
  return {
    input: input,
    output: outputGain
  };
}

// Distortion curve oluşturucu (robot sesi için)
function makeDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  
  return curve;
}

// Ses efektini değiştir - GÜNCELLENDİ
function changeVoiceEffect() {
  const selectedEffect = document.getElementById('voiceEffect').value;
  voiceEffect = selectedEffect;
  
  // Eğer mikrofon izni varsa ve audioContext aktifse
  if (micPermissionGranted && audioContext && originalStream) {
    try {
      // AudioContext'i resume et
      if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
          setupAudioProcessor();
          showNotification(`Ses efekti değişti: ${getEffectName(selectedEffect)}`);
        });
      } else {
        setupAudioProcessor();
        showNotification(`Ses efekti değişti: ${getEffectName(selectedEffect)}`);
      }
    } catch (error) {
      console.error('Ses efekti değiştirme hatası:', error);
      showError('Ses efekti değiştirilemedi. Lütfen sayfayı yenileyin.');
    }
  }
}

// Efekt adını getir
function getEffectName(effect) {
  const effectNames = {
    'normal': 'Normal',
    'robot': '🤖 Robot',
    'alien': '👽 Uzaylı',
    'deep': '🗿 Kalın Ses',
    'high': '🎵 İnce Ses',
    'echo': '🔊 Yankı',
    'radio': '📻 Radyo',
    'underwater': '🌊 Su Altı',
    'telephone': '📞 Telefon',
    'cave': '🕳️ Mağara'
  };
  return effectNames[effect] || 'Normal';
}

// Ses efektini test et
function testVoiceEffect() {
  if (!micPermissionGranted) {
    requestMicrophonePermission().then(granted => {
      if (granted) {
        startVoiceTest();
      }
    });
  } else {
    startVoiceTest();
  }
}

// Ses testi başlat - KAYIT VERSİYONU
function startVoiceTest() {
  const testBtn = document.getElementById('testVoiceBtn');
  
  if (voiceTestActive) {
    // Testi iptal et
    voiceTestActive = false;
    
    if (recordingTimeout) {
      clearTimeout(recordingTimeout);
      recordingTimeout = null;
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    
    if (localStream) {
      localStream.getAudioTracks()[0].enabled = false;
    }
    
    testBtn.textContent = '🎤 Test Et';
    testBtn.classList.remove('testing');
    stopVisualizer();
  } else {
    // Önce AudioContext'in durumunu kontrol et
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        performVoiceTest();
      });
    } else {
      performVoiceTest();
    }
  }
}

// Ses testini gerçekleştir - KAYIT VERSİYONU
function performVoiceTest() {
  const testBtn = document.getElementById('testVoiceBtn');
  
  voiceTestActive = true;
  if (localStream) {
    localStream.getAudioTracks()[0].enabled = true;
  }
  testBtn.textContent = '🔴 Kayıt (3 sn)';
  testBtn.classList.add('testing');
  startVisualizer();
  
  // Ses kaydını başlat
  startRecording();
}

// Ses kaydını başlat - GÜNCELLENDİ
function startRecording() {
  if (!localStream) return;
  
  recordedChunks = [];
  
  // MediaRecorder'ı işlenmiş akıştan oluştur
  const options = {
    mimeType: 'audio/webm'
  };
  
  try {
    mediaRecorder = new MediaRecorder(localStream, options);
  } catch (err) {
    // Fallback
    try {
      options.mimeType = 'audio/ogg';
      mediaRecorder = new MediaRecorder(localStream, options);
    } catch (err2) {
      mediaRecorder = new MediaRecorder(localStream);
    }
  }
  
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };
  
  mediaRecorder.onstop = () => {
    playRecording();
  };
  
  mediaRecorder.onerror = (event) => {
    console.error('MediaRecorder hatası:', event.error);
  };
  
  mediaRecorder.start();
  
  // 3 saniye sonra kaydı durdur
  recordingTimeout = setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      if (localStream) {
        localStream.getAudioTracks()[0].enabled = false;
      }
      stopVisualizer();
      
      const testBtn = document.getElementById('testVoiceBtn');
      testBtn.textContent = '▶️ Oynatılıyor...';
    }
  }, 3000);
}

// Kaydı oynat
function playRecording() {
  if (recordedChunks.length === 0) return;
  
  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const audioUrl = URL.createObjectURL(blob);
  
  const audio = new Audio(audioUrl);
  audio.volume = 1.0; // Maksimum ses seviyesi
  
  audio.onended = () => {
    // Oynatma bittiğinde
    URL.revokeObjectURL(audioUrl);
    voiceTestActive = false;
    
    const testBtn = document.getElementById('testVoiceBtn');
    testBtn.textContent = '🎤 Test Et';
    testBtn.classList.remove('testing');
  };
  
  audio.play().catch(err => {
    console.error('Ses oynatma hatası:', err);
    const testBtn = document.getElementById('testVoiceBtn');
    testBtn.textContent = '🎤 Test Et';
    testBtn.classList.remove('testing');
    voiceTestActive = false;
  });
}

// Peer bağlantısı oluştur - GÜNCELLENDİ
function createPeerConnection(userId, createOffer) {
  if (!localStream) return null;

  const pc = new RTCPeerConnection(rtcConfig);

  // İşlenmiş ses akışını ekle
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    pc.addTrack(audioTrack, localStream);
  }

  // Uzak ses akışını al
  pc.ontrack = (event) => {
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = true;
    audio.id = `audio-${userId}`;
    document.body.appendChild(audio);
  };

  // ICE adayları
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: userId, candidate: event.candidate });
    }
  };

  peerConnections.set(userId, pc);

  // Teklif oluştur
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

// Odadan ayrıl - GÜNCELLENDİ
function leaveRoom() {
  if (socket) {
    socket.disconnect();
  }
  
  // Orijinal akışı durdur
  if (originalStream) {
    originalStream.getTracks().forEach(track => track.stop());
  }
  
  // İşlenmiş akışı durdur
  if (processedStream) {
    processedStream.getTracks().forEach(track => track.stop());
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  
  // Ses elementlerini temizle
  document.querySelectorAll('audio').forEach(audio => audio.remove());
  
  // AudioContext'i kapat
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  
  // Test kayıt değişkenlerini temizle
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }
  
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordedChunks = [];
  
  // Değişkenleri sıfırla
  micPermissionGranted = false;
  originalStream = null;
  processedStream = null;
  localStream = null;
  audioContext = null;
  analyser = null;
  isTalking = false;
  isConnected = false;
  isOwner = false;
  roomMode = 'free';
  nextSpeakerId = null;
  handRaised = false;
  isMuted = false;
  mutedUsers.clear();
  voiceEffect = 'normal';
  audioProcessorNode = null;
  voiceTestActive = false;
  
  // Ses efektini sıfırla
  document.getElementById('voiceEffect').value = 'normal';
  
  // Ekranları değiştir
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  
  // Formu temizle
  resetLoginForm();
  document.getElementById('participantList').innerHTML = '';
  document.getElementById('chatMessages').innerHTML = '';
  
  // Oda listesini yenile
  refreshRoomList();
}

// UI Fonksiyonları
function updateStatus(text, type) {
  const status = document.getElementById('status');
  status.textContent = text;
  status.className = `status ${type}`;
}

function updateTalkButton(state) {
  const button = document.getElementById('talkButton');
  button.className = `talk-button ${state}`;
  
  switch(state) {
    case 'available':
      button.textContent = 'KONUŞ';
      button.disabled = false;
      break;
    case 'talking':
      button.textContent = 'KONUŞUYOR...';
      button.disabled = false;
      break;
    case 'disabled':
      button.textContent = roomMode === 'multi' && isMuted ? 'SESİZ' : 'MEŞGUL';
      button.disabled = true;
      break;
  }
}

function addParticipant(userId, userName, isTalking, handRaised, isMuted) {
  // Eğer zaten varsa ekleme
  if (document.getElementById(`participant-${userId}`)) {
    return;
  }
  
  const list = document.getElementById('participantList');
  const li = document.createElement('li');
  li.id = `participant-${userId}`;
  li.className = `participant ${isTalking ? 'talking' : ''} ${handRaised ? 'hand-raised' : ''} ${isMuted ? 'muted' : ''}`;
  
  // Multi modda ve oda sahibi ise sessize al butonunu göster (kendisine gösterme)
  const muteBtn = (roomMode === 'multi' && isOwner && userId !== myId) ? 
    `<button class="mute-btn" onclick="toggleMuteUser('${userId}')" title="Sessize Al/Aç">
      ${isMuted ? '🔊' : '🔇'}
    </button>` : '';
  
  li.innerHTML = `
    <span class="participant-name">${userName}${userId === myId ? ' (Sen)' : ''}</span>
    <div class="participant-actions">
      ${muteBtn}
      <div class="talking-indicator"></div>
    </div>
  `;
  list.appendChild(li);
}

function removeParticipant(userId) {
  const element = document.getElementById(`participant-${userId}`);
  if (element) element.remove();
  
  // Ses elementini de kaldır
  const audio = document.getElementById(`audio-${userId}`);
  if (audio) audio.remove();
}

function updateParticipantTalking(userId, isTalking) {
  const element = document.getElementById(`participant-${userId}`);
  if (element) {
    if (isTalking) {
      element.classList.add('talking');
    } else {
      element.classList.remove('talking');
    }
  }
}

function updateParticipantCount() {
  const count = document.querySelectorAll('.participant').length;
  document.getElementById('participantCount').textContent = count;
}

function showError(message) {
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorModal').style.display = 'flex';
}

function closeErrorModal() {
  document.getElementById('errorModal').style.display = 'none';
}

function showTransferModal(content) {
  const modal = document.getElementById('transferModal');
  const modalBody = document.getElementById('transferModalBody');
  modalBody.innerHTML = content;
  modal.style.display = 'flex';
}

function closeTransferModal() {
  document.getElementById('transferModal').style.display = 'none';
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function resetLoginForm() {
  const joinButton = document.getElementById('joinButton');
  joinButton.disabled = false;
  joinButton.textContent = 'Odaya Katıl';
  document.getElementById('userName').value = '';
  document.getElementById('roomId').value = '';
  document.getElementById('roomPassword').value = '';
}

// Yardımcı fonksiyonlar
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}






// Ses görselleştirici
function startVisualizer() {
  const canvas = document.getElementById('visualizerCanvas');
  const ctx = canvas.getContext('2d');
  
  function draw() {
    animationId = requestAnimationFrame(draw);
    
    if (analyser) {
      analyser.getByteFrequencyData(dataArray);
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / dataArray.length) * 2.5;
      let x = 0;
      
      for (let i = 0; i < dataArray.length; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        
        const r = barHeight + 25 * (i / dataArray.length);
        const g = 250 * (i / dataArray.length);
        const b = 50;
        
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    }
  }
  
  draw();
}

function stopVisualizer() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    const canvas = document.getElementById('visualizerCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Klavye desteği - Mesaj için Enter
document.addEventListener('keydown', (e) => {
  // Mesaj göndermek için Enter tuşu
  if (e.key === 'Enter' && document.activeElement.id === 'messageInput') {
    sendMessage();
  }
});

// Mobil için dokunma olaylarını engelleme (yanlışlıkla zoom'u önlemek için)
document.addEventListener('gesturestart', function(e) {
  e.preventDefault();
});

//////////////////////////////
// Ses efekti zinciri oluştur - SES SEVİYESİ DÜZELTİLMİŞ
function createEffectChain(effect) {
  const input = audioContext.createGain();
  input.gain.value = 1.0;
  
  const outputGain = audioContext.createGain();
  outputGain.gain.value = 1.5; // Genel çıkış seviyesini artır
  
  let currentNode = input;
  
  switch(effect) {
    case 'robot':
      // Robot sesi
      const robotGain = audioContext.createGain();
      robotGain.gain.value = 2.0; // Giriş kazancını artır
      
      const robotFilter = audioContext.createBiquadFilter();
      robotFilter.type = 'lowpass';
      robotFilter.frequency.value = 1000;
      robotFilter.Q.value = 10;
      
      const robotDistortion = audioContext.createWaveShaper();
      robotDistortion.curve = makeDistortionCurve(40); // Distortion'ı azalt
      robotDistortion.oversample = '4x';
      
      const robotOutput = audioContext.createGain();
      robotOutput.gain.value = 1.5;
      
      currentNode.connect(robotGain);
      robotGain.connect(robotFilter);
      robotFilter.connect(robotDistortion);
      robotDistortion.connect(robotOutput);
      robotOutput.connect(outputGain);
      break;
      
    case 'alien':
      // Uzaylı sesi
      const alienGain = audioContext.createGain();
      alienGain.gain.value = 2.0;
      
      const alienFilter1 = audioContext.createBiquadFilter();
      alienFilter1.type = 'bandpass';
      alienFilter1.frequency.value = 1500;
      alienFilter1.Q.value = 5;
      
      const alienDelay = audioContext.createDelay(1);
      alienDelay.delayTime.value = 0.05;
      
      const alienMix = audioContext.createGain();
      alienMix.gain.value = 0.8;
      
      currentNode.connect(alienGain);
      alienGain.connect(alienFilter1);
      alienFilter1.connect(alienDelay);
      alienDelay.connect(alienMix);
      alienFilter1.connect(alienMix);
      alienMix.connect(outputGain);
      break;
      
    case 'deep':
      // Kalın ses
      const deepGain = audioContext.createGain();
      deepGain.gain.value = 2.5; // Daha yüksek gain
      
      const deepFilter = audioContext.createBiquadFilter();
      deepFilter.type = 'lowpass';
      deepFilter.frequency.value = 500;
      deepFilter.Q.value = 10;
      
      const deepBoost = audioContext.createGain();
      deepBoost.gain.value = 1.8;
      
      currentNode.connect(deepGain);
      deepGain.connect(deepFilter);
      deepFilter.connect(deepBoost);
      deepBoost.connect(outputGain);
      break;
      
    case 'high':
      // İnce ses
      const highGain = audioContext.createGain();
      highGain.gain.value = 2.0;
      
      const highFilter = audioContext.createBiquadFilter();
      highFilter.type = 'highpass';
      highFilter.frequency.value = 1000;
      highFilter.Q.value = 10;
      
      const highBoost = audioContext.createGain();
      highBoost.gain.value = 1.5;
      
      currentNode.connect(highGain);
      highGain.connect(highFilter);
      highFilter.connect(highBoost);
      highBoost.connect(outputGain);
      break;
      
    case 'echo':
      // Yankı efekti
      const echoGain = audioContext.createGain();
      echoGain.gain.value = 1.5;
      
      const echoDelay = audioContext.createDelay(1);
      echoDelay.delayTime.value = 0.3;
      
      const echoFeedback = audioContext.createGain();
      echoFeedback.gain.value = 0.4;
      
      const echoFilter = audioContext.createBiquadFilter();
      echoFilter.type = 'highpass';
      echoFilter.frequency.value = 500;
      
      const echoMix = audioContext.createGain();
      echoMix.gain.value = 1.2;
      
      // Dry signal
      currentNode.connect(echoGain);
      echoGain.connect(echoMix);
      
      // Wet signal (echo)
      echoGain.connect(echoDelay);
      echoDelay.connect(echoFeedback);
      echoFeedback.connect(echoFilter);
      echoFilter.connect(echoDelay);
      echoFilter.connect(echoMix);
      
      echoMix.connect(outputGain);
      break;
      
    case 'radio':
      // Radyo sesi
      const radioGain = audioContext.createGain();
      radioGain.gain.value = 3.0; // Yüksek gain
      
      const radioFilter1 = audioContext.createBiquadFilter();
      radioFilter1.type = 'bandpass';
      radioFilter1.frequency.value = 2000;
      radioFilter1.Q.value = 10;
      
      const radioFilter2 = audioContext.createBiquadFilter();
      radioFilter2.type = 'bandpass';
      radioFilter2.frequency.value = 2500;
      radioFilter2.Q.value = 10;
      
      const radioCompressor = audioContext.createDynamicsCompressor();
      radioCompressor.threshold.value = -15; // Threshold'u yükselt
      radioCompressor.ratio.value = 6;
      radioCompressor.attack.value = 0.003;
      radioCompressor.release.value = 0.25;
      
      const radioOutput = audioContext.createGain();
      radioOutput.gain.value = 1.5;
      
      currentNode.connect(radioGain);
      radioGain.connect(radioFilter1);
      radioFilter1.connect(radioFilter2);
      radioFilter2.connect(radioCompressor);
      radioCompressor.connect(radioOutput);
      radioOutput.connect(outputGain);
      break;
      
    case 'underwater':
      // Su altı sesi
      const waterGain = audioContext.createGain();
      waterGain.gain.value = 2.0;
      
      const waterFilter = audioContext.createBiquadFilter();
      waterFilter.type = 'lowpass';
      waterFilter.frequency.value = 400;
      waterFilter.Q.value = 2;
      
      const waterDelay = audioContext.createDelay(1);
      waterDelay.delayTime.value = 0.03;
      
      const waterMix = audioContext.createGain();
      waterMix.gain.value = 1.5;
      
      currentNode.connect(waterGain);
      waterGain.connect(waterFilter);
      waterFilter.connect(waterDelay);
      waterDelay.connect(waterMix);
      waterFilter.connect(waterMix);
      waterMix.connect(outputGain);
      break;
      
    case 'telephone':
      // Telefon sesi
      const telGain = audioContext.createGain();
      telGain.gain.value = 3.0;
      
      const telFilter1 = audioContext.createBiquadFilter();
      telFilter1.type = 'bandpass';
      telFilter1.frequency.value = 2000;
      telFilter1.Q.value = 15;
      
      const telFilter2 = audioContext.createBiquadFilter();
      telFilter2.type = 'bandpass';
      telFilter2.frequency.value = 2500;
      telFilter2.Q.value = 15;
      
      const telCompressor = audioContext.createDynamicsCompressor();
      telCompressor.threshold.value = -20;
      telCompressor.ratio.value = 8;
      
      const telOutput = audioContext.createGain();
      telOutput.gain.value = 1.5;
      
      currentNode.connect(telGain);
      telGain.connect(telFilter1);
      telFilter1.connect(telFilter2);
      telFilter2.connect(telCompressor);
      telCompressor.connect(telOutput);
      telOutput.connect(outputGain);
      break;
      
    case 'cave':
      // Mağara sesi
      const caveInput = audioContext.createGain();
      caveInput.gain.value = 1.8;
      
      const caveGain = audioContext.createGain();
      caveGain.gain.value = 0.8;
      
      currentNode.connect(caveInput);
      caveInput.connect(caveGain);
      caveGain.connect(outputGain);
      
      // Multiple echoes
      for (let i = 0; i < 3; i++) {
        const delay = audioContext.createDelay(1);
        delay.delayTime.value = (i + 1) * 0.15;
        
        const gain = audioContext.createGain();
        gain.gain.value = 0.5 / (i + 1);
        
        caveInput.connect(delay);
        delay.connect(gain);
        gain.connect(outputGain);
      }
      break;
      
    case 'normal':
    default:
      // Normal ses - direkt bağlantı ama gain artırılmış
      const normalGain = audioContext.createGain();
      normalGain.gain.value = 1.5;
      currentNode.connect(normalGain);
      normalGain.connect(outputGain);
      break;
  }
  
  return {
    input: input,
    output: outputGain
  };
}

// setupAudioProcessor fonksiyonuna da ek gain ekleyelim
function setupAudioProcessor() {
  if (!localStream || !audioContext) return;
  
  const source = audioContext.createMediaStreamSource(localStream);
  const destination = audioContext.createMediaStreamDestination();
  
  // Master gain kontrolü ekle
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 1.2; // Genel ses seviyesini artır
  
  // Ses efekti zinciri oluştur
  audioProcessorNode = createEffectChain(voiceEffect);
  
  // Bağlantıları kur
  source.connect(audioProcessorNode.input);
  audioProcessorNode.output.connect(masterGain);
  masterGain.connect(destination);
  masterGain.connect(analyser);
  
  // İşlenmiş ses akışını al
  const processedStream = destination.stream;
  const processedTrack = processedStream.getAudioTracks()[0];
  
  // Tüm peer bağlantılarını güncelle
  peerConnections.forEach((pc, userId) => {
    const senders = pc.getSenders();
    const audioSender = senders.find(sender => sender.track && sender.track.kind === 'audio');
    if (audioSender && processedTrack) {
      audioSender.replaceTrack(processedTrack);
    }
  });
  
  // localStream'i güncelle
  localStream = processedStream;
}

// Ayrıca playRecording fonksiyonunda da ses seviyesini artıralım
function playRecording() {
  if (recordedChunks.length === 0) return;
  
  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const audioUrl = URL.createObjectURL(blob);
  
  const audio = new Audio(audioUrl);
  audio.volume = 1.0; // Maksimum ses seviyesi
  
  audio.onended = () => {
    // Oynatma bittiğinde
    URL.revokeObjectURL(audioUrl);
    voiceTestActive = false;
    
    const testBtn = document.getElementById('testVoiceBtn');
    testBtn.textContent = '🎤 Test Et';
    testBtn.classList.remove('testing');
  };
  
  audio.play().catch(err => {
    console.error('Ses oynatma hatası:', err);
    const testBtn = document.getElementById('testVoiceBtn');
    testBtn.textContent = '🎤 Test Et';
    testBtn.classList.remove('testing');
    voiceTestActive = false;
  });
}