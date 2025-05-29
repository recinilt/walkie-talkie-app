// WebRTC ve Socket.io yapılandırması
// Render.com URL'nizi buraya yazın
//const SERVER_URL = 'https://walkie-talkie-server.onrender.com';
const SERVER_URL = 'https://walkie-talkie-server-4p8m.onrender.com';
let socket = null;
let localStream = null;
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

// Toggle konuşma
function toggleTalk() {
  if (!isConnected || !socket) return;
  
  // İlk defa basıldıysa mikrofon izni al
  if (!micPermissionGranted) {
    requestMicrophonePermission().then(granted => {
      if (granted) {
        socket.emit('toggle-talk');
      }
    });
  } else {
    socket.emit('toggle-talk');
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

// Mikrofon iznini al ve peer bağlantılarını kur - GÜNCELLENMİŞ
async function requestMicrophonePermission() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
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
    
    // Ses efektleri için processor node oluştur
    setupAudioProcessor();

    // Başlangıçta mikrofonu kapat
    localStream.getAudioTracks()[0].enabled = false;

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

// Ses işlemci kurulumu - DÜZELTİLMİŞ
function setupAudioProcessor() {
  if (!localStream || !audioContext) return;
  
  const source = audioContext.createMediaStreamSource(localStream);
  const destination = audioContext.createMediaStreamDestination();
  
  // Ses efekti zinciri oluştur
  audioProcessorNode = createEffectChain(voiceEffect);
  
  // Bağlantıları kur
  source.connect(audioProcessorNode.input);
  audioProcessorNode.output.connect(destination);
  audioProcessorNode.output.connect(analyser);
  
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

// Ses efekti zinciri oluştur - DÜZELTİLMİŞ
function createEffectChain(effect) {
  const input = audioContext.createGain();
  input.gain.value = 1.0;
  
  const outputGain = audioContext.createGain();
  outputGain.gain.value = 1.0;
  
  let currentNode = input;
  
  switch(effect) {
    case 'robot':
      // Robot sesi - Basitleştirilmiş versiyon
      const robotFilter = audioContext.createBiquadFilter();
      robotFilter.type = 'lowpass';
      robotFilter.frequency.value = 1000;
      robotFilter.Q.value = 10;
      
      const robotDistortion = audioContext.createWaveShaper();
      robotDistortion.curve = makeDistortionCurve(50);
      robotDistortion.oversample = '4x';
      
      currentNode.connect(robotFilter);
      robotFilter.connect(robotDistortion);
      robotDistortion.connect(outputGain);
      break;
      
    case 'alien':
      // Uzaylı sesi
      const alienFilter1 = audioContext.createBiquadFilter();
      alienFilter1.type = 'bandpass';
      alienFilter1.frequency.value = 1500;
      alienFilter1.Q.value = 5;
      
      const alienDelay = audioContext.createDelay(1);
      alienDelay.delayTime.value = 0.05;
      
      const alienGain = audioContext.createGain();
      alienGain.gain.value = 0.6;
      
      currentNode.connect(alienFilter1);
      alienFilter1.connect(alienDelay);
      alienDelay.connect(alienGain);
      alienFilter1.connect(alienGain);
      alienGain.connect(outputGain);
      break;
      
    case 'deep':
      // Kalın ses
      const deepFilter = audioContext.createBiquadFilter();
      deepFilter.type = 'lowpass';
      deepFilter.frequency.value = 500;
      deepFilter.Q.value = 10;
      
      const deepGain = audioContext.createGain();
      deepGain.gain.value = 1.5;
      
      currentNode.connect(deepFilter);
      deepFilter.connect(deepGain);
      deepGain.connect(outputGain);
      break;
      
    case 'high':
      // İnce ses
      const highFilter = audioContext.createBiquadFilter();
      highFilter.type = 'highpass';
      highFilter.frequency.value = 1000;
      highFilter.Q.value = 10;
      
      currentNode.connect(highFilter);
      highFilter.connect(outputGain);
      break;
      
    case 'echo':
      // Yankı efekti
      const echoDelay = audioContext.createDelay(1);
      echoDelay.delayTime.value = 0.3;
      
      const echoGain = audioContext.createGain();
      echoGain.gain.value = 0.5;
      
      const echoFilter = audioContext.createBiquadFilter();
      echoFilter.type = 'highpass';
      echoFilter.frequency.value = 500;
      
      // Dry signal
      currentNode.connect(outputGain);
      
      // Wet signal (echo)
      currentNode.connect(echoDelay);
      echoDelay.connect(echoGain);
      echoGain.connect(echoFilter);
      echoFilter.connect(echoDelay);
      echoFilter.connect(outputGain);
      break;
      
    case 'radio':
      // Radyo sesi
      const radioFilter1 = audioContext.createBiquadFilter();
      radioFilter1.type = 'bandpass';
      radioFilter1.frequency.value = 2000;
      radioFilter1.Q.value = 10;
      
      const radioFilter2 = audioContext.createBiquadFilter();
      radioFilter2.type = 'bandpass';
      radioFilter2.frequency.value = 2500;
      radioFilter2.Q.value = 10;
      
      const radioCompressor = audioContext.createDynamicsCompressor();
      radioCompressor.threshold.value = -20;
      radioCompressor.ratio.value = 8;
      
      currentNode.connect(radioFilter1);
      radioFilter1.connect(radioFilter2);
      radioFilter2.connect(radioCompressor);
      radioCompressor.connect(outputGain);
      break;
      
    case 'underwater':
      // Su altı sesi
      const waterFilter = audioContext.createBiquadFilter();
      waterFilter.type = 'lowpass';
      waterFilter.frequency.value = 400;
      waterFilter.Q.value = 2;
      
      const waterDelay = audioContext.createDelay(1);
      waterDelay.delayTime.value = 0.03;
      
      const waterGain = audioContext.createGain();
      waterGain.gain.value = 0.8;
      
      currentNode.connect(waterFilter);
      waterFilter.connect(waterDelay);
      waterDelay.connect(waterGain);
      waterFilter.connect(waterGain);
      waterGain.connect(outputGain);
      break;
      
    case 'telephone':
      // Telefon sesi
      const telFilter1 = audioContext.createBiquadFilter();
      telFilter1.type = 'bandpass';
      telFilter1.frequency.value = 2000;
      telFilter1.Q.value = 15;
      
      const telFilter2 = audioContext.createBiquadFilter();
      telFilter2.type = 'bandpass';
      telFilter2.frequency.value = 2500;
      telFilter2.Q.value = 15;
      
      const telCompressor = audioContext.createDynamicsCompressor();
      telCompressor.threshold.value = -30;
      telCompressor.ratio.value = 10;
      
      currentNode.connect(telFilter1);
      telFilter1.connect(telFilter2);
      telFilter2.connect(telCompressor);
      telCompressor.connect(outputGain);
      break;
      
    case 'cave':
      // Mağara sesi
      const caveGain = audioContext.createGain();
      caveGain.gain.value = 0.7;
      
      currentNode.connect(caveGain);
      caveGain.connect(outputGain);
      
      // Multiple echoes
      for (let i = 0; i < 3; i++) {
        const delay = audioContext.createDelay(1);
        delay.delayTime.value = (i + 1) * 0.15;
        
        const gain = audioContext.createGain();
        gain.gain.value = 0.4 / (i + 1);
        
        caveGain.connect(delay);
        delay.connect(gain);
        gain.connect(outputGain);
      }
      break;
      
    case 'normal':
    default:
      // Normal ses - direkt bağlantı
      currentNode.connect(outputGain);
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

// Ses efektini değiştir - DÜZELTİLMİŞ
function changeVoiceEffect() {
  const selectedEffect = document.getElementById('voiceEffect').value;
  voiceEffect = selectedEffect;
  
  // Eğer mikrofon izni varsa ve audioContext aktifse
  if (micPermissionGranted && audioContext && audioContext.state === 'running' && localStream) {
    try {
      setupAudioProcessor();
      
      // Kullanıcıya bilgi ver
      showNotification(`Ses efekti değişti: ${getEffectName(selectedEffect)}`);
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

// Ses testi başlat - GÜNCELLENMİŞ
function startVoiceTest() {
  const testBtn = document.getElementById('testVoiceBtn');
  
  if (voiceTestActive) {
    // Testi durdur
    voiceTestActive = false;
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

// Ses testini gerçekleştir
function performVoiceTest() {
  const testBtn = document.getElementById('testVoiceBtn');
  
  voiceTestActive = true;
  if (localStream) {
    localStream.getAudioTracks()[0].enabled = true;
  }
  testBtn.textContent = '⏹️ Durdur';
  testBtn.classList.add('testing');
  startVisualizer();
}

// Peer bağlantısı oluştur
function createPeerConnection(userId, createOffer) {
  if (!localStream) return null;

  const pc = new RTCPeerConnection(rtcConfig);

  // İşlenmiş ses akışını ekle
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

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
    });
  }

  return pc;
}

// Odadan ayrıl
function leaveRoom() {
  if (socket) {
    socket.disconnect();
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  
  // Ses elementlerini temizle
  document.querySelectorAll('audio').forEach(audio => audio.remove());
  
  // AudioContext'i kapat
  if (audioContext) {
    audioContext.close();
  }
  
  // Değişkenleri sıfırla
  micPermissionGranted = false;
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