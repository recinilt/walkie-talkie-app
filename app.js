// WebRTC ve Socket.io yapılandırması
const SERVER_URL = 'https://walkie-talkie-server-4p8m.onrender.com';

// Global değişkenler
let socket = null;
let localStream = null;
let originalStream = null;
let processedStream = null;
let peerConnections = new Map();
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;
let micPermissionGranted = false;

// Ses efektleri için değişkenler
let voiceEffect = 'normal';
let audioProcessorNode = null;
let voiceTestActive = false;
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

// Klavye desteği - Mesaj için Enter
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement.id === 'messageInput') {
    sendMessage();
  }
});

// Mobil için dokunma olaylarını engelleme
document.addEventListener('gesturestart', function(e) {
  e.preventDefault();
});