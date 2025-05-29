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

function showError(message) {
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorModal').style.display = 'flex';
}

function closeErrorModal() {
  document.getElementById('errorModal').style.display = 'none';
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

// Katılımcı yönetimi
function addParticipant(userId, userName, isTalking, handRaised, isMuted) {
  const li = document.createElement('li');
  li.id = `participant-${userId}`;
  li.className = 'participant';
  
  if (isTalking) li.classList.add('talking');
  if (handRaised) li.classList.add('hand-raised');
  if (isMuted) li.classList.add('muted');
  
  const participantInfo = document.createElement('div');
  participantInfo.className = 'participant-info';
  
  const nameSpan = document.createElement('span');
  nameSpan.className = 'participant-name';
  nameSpan.textContent = userName + (userId === myId ? ' (Ben)' : '');
  
  const actions = document.createElement('div');
  actions.className = 'participant-actions';
  
  // Oda sahibi işaretçisi
  if (isOwner && userId === myId) {
    nameSpan.textContent += ' 👑';
  }
  
  // Multi modda sessize alma butonu (sadece oda sahibine)
  if (isOwner && roomMode === 'multi' && userId !== myId) {
    const muteBtn = document.createElement('button');
    muteBtn.className = 'mute-btn';
    muteBtn.textContent = isMuted ? '🔊' : '🔇';
    muteBtn.onclick = () => toggleMuteUser(userId);
    actions.appendChild(muteBtn);
  }
  
  const indicator = document.createElement('div');
  indicator.className = 'talking-indicator';
  actions.appendChild(indicator);
  
  participantInfo.appendChild(nameSpan);
  li.appendChild(participantInfo);
  li.appendChild(actions);
  
  document.getElementById('participantList').appendChild(li);
}

function removeParticipant(userId) {
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) {
    participant.remove();
  }
  
  // Ses elementini de kaldır
  const audio = document.getElementById(`audio-${userId}`);
  if (audio) {
    audio.remove();
  }
}

function updateParticipantCount() {
  const count = document.getElementById('participantList').children.length;
  document.getElementById('participantCount').textContent = count;
}

function updateParticipantOwnerStatus(userId, isOwner) {
  const participant = document.getElementById(`participant-${userId}`);
  if (participant) {
    const nameSpan = participant.querySelector('.participant-name');
    if (nameSpan) {
      const currentText = nameSpan.textContent.replace(' 👑', '');
      nameSpan.textContent = isOwner ? currentText + ' 👑' : currentText;
    }
  }
}

// Oda kontrolleri
function updateOwnerControls() {
  const ownerControls = document.getElementById('ownerControls');
  const ownerBadge = document.getElementById('ownerBadge');
  const roomModeSelect = document.getElementById('roomMode');
  const transferBtn = document.getElementById('transferOwnershipBtn');
  
  if (isOwner) {
    ownerControls.style.display = 'block';
    ownerBadge.style.display = 'inline';
    roomModeSelect.disabled = false;
    transferBtn.style.display = 'inline-block';
  } else {
    ownerControls.style.display = 'none';
    ownerBadge.style.display = 'none';
    roomModeSelect.disabled = true;
    transferBtn.style.display = 'none';
  }
}

function updateModeInfo(mode) {
  const modeInfo = document.getElementById('modeInfo');
  const modeTexts = {
    'free': '🎤 Serbest Mod: Telsiz boşken herkes konuşabilir',
    'ordered': '📋 Sıralı Mod: Herkes sırayla konuşur',
    'queue': '✋ Söz Sırası: El kaldıranlar sırayla konuşur',
    'multi': '👥 Aynı Anda: Oda sahibi izin verdiklerini konuşturur'
  };
  
  modeInfo.textContent = modeTexts[mode] || '';
  modeInfo.style.display = 'block';
}

function updateModeControls() {
  const skipTurnBtn = document.getElementById('skipTurnBtn');
  const nextSpeakerBtn = document.getElementById('nextSpeakerBtn');
  const raiseHandBtn = document.getElementById('raiseHandBtn');
  const speakQueueContainer = document.getElementById('speakQueueContainer');
  const mutedUsersContainer = document.getElementById('mutedUsersContainer');
  
  // Tüm kontrolleri gizle
  skipTurnBtn.style.display = 'none';
  nextSpeakerBtn.style.display = 'none';
  raiseHandBtn.style.display = 'none';
  speakQueueContainer.style.display = 'none';
  mutedUsersContainer.style.display = 'none';
  
  // Moda göre göster
  if (roomMode === 'ordered' && isOwner) {
    skipTurnBtn.style.display = 'inline-block';
  } else if (roomMode === 'queue') {
    raiseHandBtn.style.display = 'block';
    speakQueueContainer.style.display = 'block';
    if (isOwner) {
      nextSpeakerBtn.style.display = 'inline-block';
    }
  } else if (roomMode === 'multi') {
    mutedUsersContainer.style.display = 'block';
  }
}

function updateSpeakQueue(speakRequests) {
  const queueList = document.getElementById('speakQueueList');
  queueList.innerHTML = '';
  
  speakRequests.forEach((request, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${request.name}`;
    if (request.id === myId) {
      li.className = 'my-queue-position';
    }
    queueList.appendChild(li);
  });
}

// Mesajlaşma
function addMessageToChat(message) {
  const chatMessages = document.getElementById('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'chat-message';
  
  if (message.type === 'system') {
    messageDiv.classList.add('system-message');
    messageDiv.textContent = message.text;
  } else {
    if (message.userId === myId) {
      messageDiv.classList.add('my-message');
    } else {
      messageDiv.classList.add('other-message');
    }
    
    const header = document.createElement('div');
    header.className = 'message-header';
    
    const author = document.createElement('span');
    author.className = 'message-author';
    author.textContent = message.userName;
    
    const time = document.createElement('span');
    time.className = 'message-time';
    time.textContent = new Date(message.timestamp).toLocaleTimeString('tr-TR', {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    header.appendChild(author);
    header.appendChild(time);
    
    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.text;
    
    messageDiv.appendChild(header);
    messageDiv.appendChild(text);
  }
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  
  if (text && socket && isConnected) {
    socket.emit('send-message', { text });
    input.value = '';
  }
}

// Login formu
function resetLoginForm() {
  document.getElementById('joinButton').disabled = false;
  document.getElementById('joinButton').textContent = 'Odaya Katıl';
}

// Kontrol fonksiyonları
function toggleTalk() {
  if (!isConnected) {
    showError('Sunucu bağlantısı yok!');
    return;
  }

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

function changeRoomMode() {
  const newMode = document.getElementById('roomMode').value;
  if (socket && isOwner) {
    socket.emit('change-room-mode', { mode: newMode });
  }
}

function skipTurn() {
  if (socket && isOwner && roomMode === 'ordered') {
    socket.emit('skip-turn');
  }
}

function nextSpeaker() {
  if (socket && isOwner && roomMode === 'queue') {
    socket.emit('next-speaker');
  }
}

function toggleHand() {
  if (socket && roomMode === 'queue') {
    if (handRaised) {
      socket.emit('lower-hand');
    } else {
      socket.emit('raise-hand');
    }
  }
}

function toggleMuteUser(targetUserId) {
  if (socket && isOwner && roomMode === 'multi') {
    socket.emit('toggle-mute-user', { targetUserId });
  }
}

function transferOwnership() {
  const transferModal = document.getElementById('transferModal');
  const modalBody = document.getElementById('transferModalBody');
  modalBody.innerHTML = '';
  
  const transferList = document.createElement('div');
  transferList.className = 'transfer-list';
  
  const participants = document.getElementById('participantList').children;
  Array.from(participants).forEach(participant => {
    const userId = participant.id.replace('participant-', '');
    if (userId !== myId) {
      const userName = participant.querySelector('.participant-name').textContent.replace(' 👑', '');
      
      const item = document.createElement('div');
      item.className = 'transfer-item';
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = userName;
      
      const selectBtn = document.createElement('button');
      selectBtn.className = 'transfer-select-btn';
      selectBtn.textContent = 'Seç';
      selectBtn.onclick = () => {
        if (socket) {
          socket.emit('transfer-ownership', { newOwnerId: userId });
          closeTransferModal();
        }
      };
      
      item.appendChild(nameSpan);
      item.appendChild(selectBtn);
      transferList.appendChild(item);
    }
  });
  
  modalBody.appendChild(transferList);
  transferModal.style.display = 'flex';
}

function closeTransferModal() {
  document.getElementById('transferModal').style.display = 'none';
}