const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();

// CORS ayarları - Güncellenmiş
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://localhost:5173', // Vite için
    'https://www.recinilt.com',
    'https://recinilt.com',
    'https://telsiz.recinilt.com',
    'https://recinilt.github.io',
    'https://recinilt.github.io/walkie-talkie-app',
    'https://recinilt.github.io/walkie-talkie-app/client/index.html',
    /^https:\/\/.*\.netlify\.app$/, // Tüm Netlify preview URL'leri için regex
    /^https:\/\/.*\.vercel\.app$/ // Vercel için
  ],
  methods: ["GET", "POST"],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Static dosyaları sun (opsiyonel - eğer aynı yerden frontend sunacaksanız)
app.use(express.static('public'));

const server = http.createServer(app);
const io = socketIO(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling'] // Transport metodları
});

// Oda ve kullanıcı yönetimi
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
  console.log('Yeni kullanıcı bağlandı:', socket.id);

  // Mevcut odaları listele
  socket.on('get-rooms', () => {
    const roomList = Array.from(rooms.values()).map(room => ({
      id: room.id,
      userCount: room.users.size,
      hasPassword: room.password !== null && room.password !== '',
      mode: room.mode,
      createdAt: room.createdAt
    }));
    
    socket.emit('room-list', roomList);
  });

  // Odaya katılma
  socket.on('join-room', ({ roomId, roomPassword, userName }) => {
    console.log(`Katılma isteği - Oda: ${roomId}, Kullanıcı: ${userName}`);
    
    // Boş kontrolleri
    if (!roomId || !userName) {
      socket.emit('room-error', { message: 'Eksik bilgi!' });
      return;
    }
    
    // Oda var mı kontrol et
    let room = rooms.get(roomId);
    
    if (room) {
      // Şifre kontrolü - sadece şifre varsa kontrol et
      if (room.password !== null && room.password !== '') {
        const existingPassword = String(room.password).trim();
        const enteredPassword = roomPassword ? String(roomPassword).trim() : '';
        
        console.log(`Şifre kontrolü - Mevcut: "${existingPassword}", Girilen: "${enteredPassword}"`);
        
        if (existingPassword !== enteredPassword) {
          socket.emit('room-error', { message: 'Yanlış oda şifresi!' });
          return;
        }
      }
    } else {
      // Oda yoksa oluştur - ilk katılan kişi oda sahibi olur
      const password = roomPassword ? String(roomPassword).trim() : null;
      
      room = {
        id: roomId,
        password: password,
        owner: socket.id,
        users: new Map(),
        talkingUser: null,
        mode: 'free', // 'free', 'ordered', 'queue'
        talkQueue: [], // Sıralı konuşma için kuyruk
        currentSpeakerIndex: 0,
        speakRequests: [], // Söz isteyenlerin sırası (queue mode)
        messages: [], // Mesaj geçmişi
        createdAt: new Date()
      };
      rooms.set(roomId, room);
      console.log(`Yeni oda oluşturuldu: ${roomId} - Sahip: ${userName} - Şifreli: ${password !== null}`);
      
      // Yeni oda oluşturulduğunda tüm kullanıcılara bildir
      io.emit('room-created', {
        id: roomId,
        userCount: 1,
        hasPassword: password !== null && password !== '',
        mode: room.mode,
        createdAt: room.createdAt
      });
    }

    // Kullanıcı bilgilerini kaydet
    const user = {
      id: socket.id,
      name: userName,
      roomId: roomId,
      isTalking: false,
      hasSpoken: false,
      handRaised: false, // El kaldırma durumu
      joinedAt: new Date()
    };
    users.set(socket.id, user);

    // Odaya katıl
    socket.join(roomId);
    room.users.set(socket.id, user);

    // Sıralı modda kuyruğa ekle
    if (room.mode === 'ordered') {
      room.talkQueue.push(socket.id);
    }

    // Başarılı katılım
    socket.emit('room-joined', {
      roomId: roomId,
      roomName: room.name || roomId,
      isOwner: room.owner === socket.id,
      mode: room.mode
    });

    // Yeni kullanıcıya mevcut kullanıcıları gönder - KENDİSİ DAHİL
    const existingUsers = Array.from(room.users.values())
      .map(u => ({ 
        userId: u.id, 
        userName: u.name, 
        isTalking: u.isTalking,
        handRaised: u.handRaised 
      }));
    
    socket.emit('existing-users', existingUsers);

    // Son 50 mesajı gönder
    const recentMessages = room.messages.slice(-50);
    socket.emit('message-history', recentMessages);

    // Odadaki diğer kullanıcılara yeni katılımı bildir
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: userName
    });

    // Sistem mesajı
    const joinMessage = {
      id: Date.now().toString(),
      type: 'system',
      text: `${userName} odaya katıldı`,
      timestamp: new Date()
    };
    room.messages.push(joinMessage);
    io.to(roomId).emit('new-message', joinMessage);

    // Oda durumunu güncelle
    updateRoomStatus(roomId);
    
    // Oda sayısı güncellemesi
    io.emit('room-updated', {
      id: roomId,
      userCount: room.users.size,
      hasPassword: room.password !== null && room.password !== '',
      mode: room.mode
    });
  });

  // Mesaj gönderme
  socket.on('send-message', ({ text }) => {
    const user = users.get(socket.id);
    if (!user || !text || text.trim() === '') return;

    const room = rooms.get(user.roomId);
    if (!room) return;

    const message = {
      id: Date.now().toString() + Math.random(),
      userId: socket.id,
      userName: user.name,
      text: text.trim(),
      timestamp: new Date(),
      type: 'user'
    };

    // Mesajı kaydet (maksimum 100 mesaj tut)
    room.messages.push(message);
    if (room.messages.length > 100) {
      room.messages = room.messages.slice(-100);
    }

    // Mesajı odadaki herkese gönder
    io.to(user.roomId).emit('new-message', message);
  });

  // Sıra atlama (sadece oda sahibi)
  socket.on('skip-turn', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room) return;

    // Sadece oda sahibi ve sıralı modda
    if (room.owner !== socket.id || room.mode !== 'ordered') {
      return;
    }

    // Konuşan varsa durdur
    if (room.talkingUser) {
      const talkingUser = room.users.get(room.talkingUser);
      if (talkingUser) {
        talkingUser.isTalking = false;
      }
      io.to(user.roomId).emit('talk-stopped', {
        userId: room.talkingUser
      });
      room.talkingUser = null;
    }

    // Sırayı bir sonrakine geç
    let nextIndex = (room.currentSpeakerIndex + 1) % room.talkQueue.length;
    let attempts = 0;
    
    // Henüz konuşmamış birini bul
    while (attempts < room.talkQueue.length) {
      const nextUserId = room.talkQueue[nextIndex];
      const nextUser = room.users.get(nextUserId);
      
      if (nextUser && !nextUser.hasSpoken) {
        room.currentSpeakerIndex = nextIndex;
        break;
      }
      
      nextIndex = (nextIndex + 1) % room.talkQueue.length;
      attempts++;
    }

    // Herkes konuştuysa turu sıfırla
    if (attempts >= room.talkQueue.length) {
      room.users.forEach(u => u.hasSpoken = false);
      room.currentSpeakerIndex = 0;
    }

    // Sistem mesajı
    const skipMessage = {
      id: Date.now().toString(),
      type: 'system',
      text: `Oda sahibi sırayı atlattı`,
      timestamp: new Date()
    };
    room.messages.push(skipMessage);
    io.to(user.roomId).emit('new-message', skipMessage);

    updateRoomStatus(user.roomId);
  });

  // El kaldırma (queue mode)
  socket.on('raise-hand', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room || room.mode !== 'queue') return;

    // Zaten el kaldırmışsa veya konuşuyorsa
    if (user.handRaised || room.talkingUser === socket.id) return;

    user.handRaised = true;
    room.speakRequests.push(socket.id);

    io.to(user.roomId).emit('hand-raised', {
      userId: socket.id,
      userName: user.name,
      queuePosition: room.speakRequests.length
    });

    updateRoomStatus(user.roomId);
  });

  // El indirme (queue mode)
  socket.on('lower-hand', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room || room.mode !== 'queue') return;

    user.handRaised = false;
    const index = room.speakRequests.indexOf(socket.id);
    if (index > -1) {
      room.speakRequests.splice(index, 1);
    }

    io.to(user.roomId).emit('hand-lowered', {
      userId: socket.id
    });

    updateRoomStatus(user.roomId);
  });

  // Sıradaki konuşmacıya geç (queue mode - sadece oda sahibi)
  socket.on('next-speaker', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room) return;

    // Sadece oda sahibi ve queue modda
    if (room.owner !== socket.id || room.mode !== 'queue') {
      return;
    }

    // Konuşan varsa durdur
    if (room.talkingUser) {
      const talkingUser = room.users.get(room.talkingUser);
      if (talkingUser) {
        talkingUser.isTalking = false;
        talkingUser.handRaised = false;
      }
      io.to(user.roomId).emit('talk-stopped', {
        userId: room.talkingUser
      });
      room.talkingUser = null;
    }

    // Sıradaki varsa ona izin ver
    if (room.speakRequests.length > 0) {
      const nextSpeakerId = room.speakRequests.shift();
      const nextSpeaker = room.users.get(nextSpeakerId);
      
      if (nextSpeaker) {
        io.to(user.roomId).emit('queue-turn', {
          userId: nextSpeakerId,
          userName: nextSpeaker.name
        });
      }
    }

    updateRoomStatus(user.roomId);
  });

  // Oda modunu değiştirme (sadece oda sahibi)
  socket.on('change-room-mode', ({ mode }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room) return;

    // Sadece oda sahibi değiştirebilir
    if (room.owner !== socket.id) {
      socket.emit('mode-change-error', { message: 'Sadece oda sahibi modu değiştirebilir!' });
      return;
    }

    const oldMode = room.mode;
    // Modu değiştir
    room.mode = mode;
    
    // Mod değişimine göre ayarlamalar
    if (mode === 'ordered') {
      room.talkQueue = Array.from(room.users.keys());
      room.currentSpeakerIndex = 0;
      room.users.forEach(u => u.hasSpoken = false);
      room.speakRequests = [];
    } else if (mode === 'free') {
      room.talkQueue = [];
      room.speakRequests = [];
      room.users.forEach(u => {
        u.hasSpoken = false;
        u.handRaised = false;
      });
    } else if (mode === 'queue') {
      room.talkQueue = [];
      room.speakRequests = [];
      room.users.forEach(u => {
        u.hasSpoken = false;
        u.handRaised = false;
      });
    }

    // Konuşan varsa durdur
    if (room.talkingUser) {
      const talkingUser = room.users.get(room.talkingUser);
      if (talkingUser) {
        talkingUser.isTalking = false;
      }
      io.to(user.roomId).emit('talk-stopped', {
        userId: room.talkingUser
      });
      room.talkingUser = null;
    }

    // Tüm kullanıcılara modu bildir
    io.to(user.roomId).emit('room-mode-changed', { mode });

    // Sistem mesajı
    const modeNames = {
      'free': 'Serbest',
      'ordered': 'Sıralı',
      'queue': 'Söz Sırası'
    };
    const modeMessage = {
      id: Date.now().toString(),
      type: 'system',
      text: `Konuşma modu değişti: ${modeNames[mode]}`,
      timestamp: new Date()
    };
    room.messages.push(modeMessage);
    io.to(user.roomId).emit('new-message', modeMessage);

    updateRoomStatus(user.roomId);
    
    // Oda listesini güncelle
    io.emit('room-updated', {
      id: user.roomId,
      userCount: room.users.size,
      hasPassword: room.password !== null && room.password !== '',
      mode: room.mode
    });
  });

  // WebRTC sinyalleri
  socket.on('offer', ({ to, offer }) => {
    socket.to(to).emit('offer', {
      from: socket.id,
      offer: offer
    });
  });

  socket.on('answer', ({ to, answer }) => {
    socket.to(to).emit('answer', {
      from: socket.id,
      answer: answer
    });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate: candidate
    });
  });

  // Konuşma kontrolü - TOGGLE SİSTEMİ
  socket.on('toggle-talk', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const room = rooms.get(user.roomId);
    if (!room) return;

    // Eğer bu kullanıcı konuşuyorsa, durdur
    if (room.talkingUser === socket.id) {
      room.talkingUser = null;
      user.isTalking = false;

      io.to(user.roomId).emit('talk-stopped', {
        userId: socket.id
      });

      // Sıralı modda bir sonraki kişiye geç
      if (room.mode === 'ordered' && user.hasSpoken) {
        // Bir sonraki konuşmacıyı bul
        let nextIndex = (room.currentSpeakerIndex + 1) % room.talkQueue.length;
        let attempts = 0;
        
        // Henüz konuşmamış birini bul
        while (attempts < room.talkQueue.length) {
          const nextUserId = room.talkQueue[nextIndex];
          const nextUser = room.users.get(nextUserId);
          
          if (nextUser && !nextUser.hasSpoken) {
            room.currentSpeakerIndex = nextIndex;
            break;
          }
          
          nextIndex = (nextIndex + 1) % room.talkQueue.length;
          attempts++;
        }

        // Herkes konuştuysa turu sıfırla
        if (attempts >= room.talkQueue.length) {
          room.users.forEach(u => u.hasSpoken = false);
          room.currentSpeakerIndex = 0;
        }
      }
      // Queue modda el kaldırma durumunu sıfırla ve listeden çıkar
      else if (room.mode === 'queue') {
        user.handRaised = false;
        const index = room.speakRequests.indexOf(socket.id);
        if (index > -1) {
          room.speakRequests.splice(index, 1);
        }
      }

      console.log(`${user.name} konuşmayı bitirdi - Oda: ${user.roomId}`);
      updateRoomStatus(user.roomId);
      return;
    }

    // Konuşmaya başlama kontrolü
    // Serbest mod
    if (room.mode === 'free') {
      // Oda boşsa konuşmaya izin ver
      if (!room.talkingUser) {
        room.talkingUser = socket.id;
        user.isTalking = true;

        io.to(user.roomId).emit('talk-started', {
          userId: socket.id,
          userName: user.name
        });

        socket.emit('talk-granted');
        console.log(`${user.name} konuşmaya başladı - Oda: ${user.roomId} (Serbest mod)`);
      } else {
        socket.emit('talk-denied', {
          currentSpeaker: room.users.get(room.talkingUser).name
        });
      }
    } 
    // Sıralı mod
    else if (room.mode === 'ordered') {
      // Sıra bu kullanıcıda mı kontrol et
      const currentUserId = room.talkQueue[room.currentSpeakerIndex];
      
      if (currentUserId === socket.id && !room.talkingUser) {
        room.talkingUser = socket.id;
        user.isTalking = true;
        user.hasSpoken = true;

        io.to(user.roomId).emit('talk-started', {
          userId: socket.id,
          userName: user.name
        });

        socket.emit('talk-granted');
        console.log(`${user.name} konuşmaya başladı - Oda: ${user.roomId} (Sıralı mod)`);
      } else if (room.talkingUser) {
        socket.emit('talk-denied', {
          currentSpeaker: room.users.get(room.talkingUser).name
        });
      } else {
        const nextSpeaker = room.users.get(currentUserId);
        socket.emit('talk-denied', {
          message: `Sıra ${nextSpeaker ? nextSpeaker.name : 'başkasında'}`
        });
      }
    }
    // Söz sırası modu
    else if (room.mode === 'queue') {
      // El kaldırmış ve sırası gelmişse
      if (user.handRaised && room.speakRequests[0] === socket.id && !room.talkingUser) {
        room.talkingUser = socket.id;
        user.isTalking = true;

        io.to(user.roomId).emit('talk-started', {
          userId: socket.id,
          userName: user.name
        });

        socket.emit('talk-granted');
        console.log(`${user.name} konuşmaya başladı - Oda: ${user.roomId} (Söz sırası modu)`);
      } else if (room.talkingUser) {
        socket.emit('talk-denied', {
          currentSpeaker: room.users.get(room.talkingUser).name
        });
      } else if (!user.handRaised) {
        socket.emit('talk-denied', {
          message: 'Önce el kaldırmalısınız'
        });
      } else {
        const position = room.speakRequests.indexOf(socket.id) + 1;
        socket.emit('talk-denied', {
          message: `Sıranız: ${position}`
        });
      }
    }
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    console.log('Kullanıcı ayrıldı:', socket.id);
    
    const user = users.get(socket.id);
    if (user) {
      const room = rooms.get(user.roomId);
      
      if (room) {
        // Konuşuyorsa konuşmayı durdur
        if (room.talkingUser === socket.id) {
          room.talkingUser = null;
          io.to(user.roomId).emit('talk-stopped', {
            userId: socket.id
          });

          // Sıralı modda bir sonrakine geç
          if (room.mode === 'ordered') {
            const index = room.talkQueue.indexOf(socket.id);
            if (index !== -1 && index === room.currentSpeakerIndex) {
              room.currentSpeakerIndex = (room.currentSpeakerIndex + 1) % room.talkQueue.length;
            }
          }
        }

        // Kullanıcıyı odadan çıkar
        room.users.delete(socket.id);
        
        // Sıralı modda kuyruktan çıkar
        if (room.mode === 'ordered') {
          const index = room.talkQueue.indexOf(socket.id);
          if (index !== -1) {
            room.talkQueue.splice(index, 1);
            // İndeksi güncelle
            if (room.currentSpeakerIndex >= room.talkQueue.length && room.talkQueue.length > 0) {
              room.currentSpeakerIndex = 0;
            }
          }
        }

        // Queue modda söz sırasından çıkar
        if (room.mode === 'queue') {
          const index = room.speakRequests.indexOf(socket.id);
          if (index > -1) {
            room.speakRequests.splice(index, 1);
          }
        }
        
        // Diğer kullanıcılara bildir
        socket.to(user.roomId).emit('user-left', {
          userId: socket.id
        });

        // Sistem mesajı
        const leaveMessage = {
          id: Date.now().toString(),
          type: 'system',
          text: `${user.name} odadan ayrıldı`,
          timestamp: new Date()
        };
        room.messages.push(leaveMessage);
        io.to(user.roomId).emit('new-message', leaveMessage);

        // Oda sahibi ayrıldıysa yeni sahip ata
        if (room.owner === socket.id && room.users.size > 0) {
          const newOwner = room.users.keys().next().value;
          room.owner = newOwner;
          io.to(user.roomId).emit('owner-changed', {
            newOwnerId: newOwner,
            newOwnerName: room.users.get(newOwner).name
          });
        }

        // Oda boşsa sil
        if (room.users.size === 0) {
          rooms.delete(user.roomId);
          console.log(`Oda silindi: ${user.roomId}`);
          // Oda silindiğini bildir
          io.emit('room-deleted', { id: user.roomId });
        } else {
          updateRoomStatus(user.roomId);
          // Oda kullanıcı sayısı güncellemesi
          io.emit('room-updated', {
            id: user.roomId,
            userCount: room.users.size,
            hasPassword: room.password !== null && room.password !== '',
            mode: room.mode
          });
        }
      }

      users.delete(socket.id);
    }
  });

  // Oda durumunu güncelle
  function updateRoomStatus(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    let nextSpeaker = null;
    let nextSpeakerId = null;
    
    if (room.mode === 'ordered' && room.talkQueue.length > 0) {
      const nextUserId = room.talkQueue[room.currentSpeakerIndex];
      const nextUser = room.users.get(nextUserId);
      if (nextUser && !nextUser.hasSpoken) {
        nextSpeaker = nextUser.name;
        nextSpeakerId = nextUserId;
      }
    } else if (room.mode === 'queue' && room.speakRequests.length > 0) {
      const nextUserId = room.speakRequests[0];
      const nextUser = room.users.get(nextUserId);
      if (nextUser) {
        nextSpeaker = nextUser.name;
        nextSpeakerId = nextUserId;
      }
    }

    const status = {
      userCount: room.users.size,
      isBusy: room.talkingUser !== null,
      talkingUser: room.talkingUser ? room.users.get(room.talkingUser).name : null,
      mode: room.mode,
      nextSpeaker: nextSpeaker,
      nextSpeakerId: nextSpeakerId,
      owner: room.owner,
      queueLength: room.speakRequests.length,
      speakRequests: room.speakRequests.map(id => {
        const user = room.users.get(id);
        return user ? { id, name: user.name } : null;
      }).filter(Boolean)
    };

    io.to(roomId).emit('room-status', status);
  }
});

// Ana sayfa route'u
app.get('/', (req, res) => {
  res.send(`
    <h1>Walkie Talkie Server</h1>
    <p>Server is running!</p>
    <p>Connect your client to this server.</p>
    <p>Health check: <a href="/health">/health</a></p>
    <p>Active rooms: <a href="/rooms">/rooms</a></p>
  `);
});

// Basit API endpoint'leri
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    rooms: rooms.size, 
    users: users.size,
    uptime: process.uptime()
  });
});

// Aktif odaları listele
app.get('/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    userCount: room.users.size,
    hasPassword: room.password !== null && room.password !== '',
    mode: room.mode,
    createdAt: room.createdAt
  }));
  
  res.json(roomList);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
