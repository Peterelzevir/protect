// config.js - Konfigurasi untuk Bot Proteksi & Manajemen Grup Telegram

module.exports = {
  // Konfigurasi Bot
  botToken: "7689397289:AAHV5A6GVhUc51VWS5oTr-qtCnaVUBnwJss", // Dapatkan dari @BotFather
  
  // Konfigurasi MongoDB
  mongoURI: "mongodb+srv://protectBot:ProtectBotV1034Priv@protect.hhc2v.mongodb.net/?retryWrites=true&w=majority&appName=protect",
  
  // Pengaturan Bot
  adminIds: ["5988451717"], // Tambahkan ID Telegram Anda untuk akses admin global
  
  // Konfigurasi Logging
  enableLogging: true,
  logLevel: "info", // 'debug', 'info', 'warn', 'error'
  
  // Pengaturan Perilaku Bot
  deleteCommands: true, // Hapus pesan perintah setelah diproses
  notifyAdminOnStart: true, // Beri tahu admin ketika bot dimulai
  welcomeMessage: true, // Kirim pesan sambutan ketika ditambahkan ke grup
  
  // Pengaturan Proteksi
  defaults: {
    // Proteksi
    antiSpam: true, // Deteksi pesan spam
    antiBot: true, // Cegah bot lain masuk ke grup
    antiFlood: true, // Cegah pengguna mengirim pesan terlalu cepat
    antiRaid: true, // Proteksi terhadap raid (banyak pengguna masuk secara bersamaan)
    antiCommand: false, // Cegah penggunaan perintah bot lain
    antiForward: false, // Cegah penerusan pesan
    antiLink: false, // Cegah tautan
    antiService: false, // Cegah pesan layanan (join, left, dll)
    captchaOnJoin: false, // Captcha saat bergabung
    
    // Penalti
    maxWarnings: 3, // Jumlah peringatan sebelum mengambil tindakan
    warningAction: "mute", // Tindakan setelah peringatan maksimum: 'warn', 'mute', 'kick', 'ban'
    warningExpiry: 7, // Peringatan kadaluarsa setelah X hari
    floodThreshold: 5, // Maksimum pesan per menit
    floodAction: "mute", // Tindakan untuk flood: 'warn', 'mute', 'kick', 'ban'
    floodMuteDuration: 60, // Durasi bisu untuk flood (dalam menit)
    
    // Penyambutan
    welcomeEnabled: true,
    welcomeMessage: "Halo {user}, selamat datang di {group}!",
    welcomeButtons: true,
    welcomeDeletePrevious: true,
    
    // Lainnya
    autoKickSpammers: true, // Otomatis keluarkan pengguna yang terdeteksi sebagai spammer
    rulesText: "Belum ada aturan yang ditetapkan untuk grup ini."
  },
  
  // Filter Kata yang Diblokir Secara Default
  defaultBlockedWords: [
    "anjing",
    "bangsat",
    "kontol",
    "memek",
    "bajingan",
    "ngentot",
    "bego",
    "goblok",
    "idiot",
    "tolol",
    "bodoh"
  ],
  
  // Tombol Sambutan Default
  welcomeButtons: [
    [
      { text: "📚 Aturan Grup", callback_data: "rules:{groupId}" },
      { text: "👮‍♂️ Admin", callback_data: "chat_admins:{groupId}" }
    ],
    [
      { text: "ℹ️ Info Bot", url: "https://t.me/{botUsername}" }
    ]
  ]
};
