// Oda listesini yenile
function refreshRoomList() {
  const tempSocket = io(SERVER_URL);
  
  tempSocket.on('connect', () => {
    tempSocket.emit('get-rooms');
  });
  
  tempSocket.on('room-list', (rooms) => {
    displayRoomList(rooms);
    tempSocket.disconnect();
  });
  
  tempSocket.on('connect_error', () => {
    document.getElementById('roomListLoading').style.display = 'none';
    document.getElementById('noRoomsMessage').textContent = 'Sunucuya bağlanılamadı';
    document.getElementById('noRoomsMessage').style.display = 'block';
    tempSocket.disconnect();
  });
  
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

  const joinButton = document.getElementById('joinButton');
  joinButton.disabled = true;
  joinButton.textContent = 'Bağlanıyor...';

  connectToServer();
}

// Odadan ayrıl
function leaveRoom() {
  if (socket) {
    socket.disconnect();
  }
  
  if (originalStream) {
    originalStream.getTracks().forEach(track => track.stop());
  }
  
  if (processedStream) {
    processedStream.getTracks().forEach(track => track.stop());
  }
  
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();
  
  document.querySelectorAll('audio').forEach(audio => audio.remove());
  
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
  }
  
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
  
  document.getElementById('voiceEffect').value = 'normal';
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  
  resetLoginForm();
  document.getElementById('participantList').innerHTML = '';
  document.getElementById('chatMessages').innerHTML = '';
  
  refreshRoomList();
}