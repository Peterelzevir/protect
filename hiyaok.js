// Bot Manajemen & Proteksi Grup Telegram
const { Telegraf, Markup, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const bot = new Telegraf(config.botToken);

// Mengatur moment untuk bahasa Indonesia
moment.locale('id');

// Connect ke MongoDB
mongoose.connect(config.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Terhubung ke MongoDB');
}).catch(err => {
  console.error('❌ Gagal terhubung ke MongoDB:', err);
});

// MongoDB Schemas
const groupSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true },
  groupName: { type: String, required: true },
  groupUsername: String,
  ownerId: { type: String, required: true }, // ID user yang menambahkan bot
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  settings: {
    // Notifikasi
    notifyNewMembers: { type: Boolean, default: true },
    notifyLeftMembers: { type: Boolean, default: true },
    notifyTitleChange: { type: Boolean, default: true },
    notifyPhotoChange: { type: Boolean, default: true },
    notifyPhotoRemoved: { type: Boolean, default: true },
    notifyPinnedMessage: { type: Boolean, default: true },
    notifyTimerEnabled: { type: Boolean, default: true },
    notifyTimerDisabled: { type: Boolean, default: true },
    notifyVideoChat: { type: Boolean, default: true },
    
    // Media
    allowDocuments: { type: Boolean, default: true },
    allowPolls: { type: Boolean, default: true },
    allowPhotos: { type: Boolean, default: true },
    allowStickers: { type: Boolean, default: true },
    allowEmojis: { type: Boolean, default: true },
    allowGames: { type: Boolean, default: true },
    allowAudios: { type: Boolean, default: true },
    allowVideos: { type: Boolean, default: true },
    allowVideoMessages: { type: Boolean, default: true },
    allowVoiceMessages: { type: Boolean, default: true },
    allowGifs: { type: Boolean, default: true },
    allowContacts: { type: Boolean, default: true },
    allowLocations: { type: Boolean, default: true },
    allowInlineBots: { type: Boolean, default: true },
    allowUnsupported: { type: Boolean, default: true },
    allowInvoices: { type: Boolean, default: true },
    allowChannelMessages: { type: Boolean, default: true },
    
    // Proteksi
    antiSpam: { type: Boolean, default: true },
    antiBot: { type: Boolean, default: true },
    antiFlood: { type: Boolean, default: true },
    antiRaid: { type: Boolean, default: true },
    antiCommand: { type: Boolean, default: false },
    antiForward: { type: Boolean, default: false },
    antiLink: { type: Boolean, default: false },
    antiService: { type: Boolean, default: false },
    captchaOnJoin: { type: Boolean, default: false },
    
    // Penalti
    floodThreshold: { type: Number, default: 5 }, // Jumlah pesan per menit
    floodAction: { type: String, default: 'mute' }, // 'warn', 'mute', 'kick', 'ban'
    floodMuteDuration: { type: Number, default: 60 }, // Dalam menit
    maxWarnings: { type: Number, default: 3 },
    warningAction: { type: String, default: 'mute' }, // 'mute', 'kick', 'ban'
    warningExpiry: { type: Number, default: 7 }, // Dalam hari
    
    // Penyambutan
    welcomeEnabled: { type: Boolean, default: true },
    welcomeMessage: { type: String, default: 'Halo {user}, selamat datang di {group}!' },
    welcomeButtons: { type: Boolean, default: true },
    welcomeDeletePrevious: { type: Boolean, default: true },
    
    // Whitelist Link
    whitelistLinks: [String],
    
    // Lainnya
    rulesText: { type: String, default: 'Belum ada aturan yang ditetapkan untuk grup ini.' },
    language: { type: String, default: 'id' }, // 'id' untuk Indonesia
    logActions: { type: Boolean, default: true },
    logChannel: { type: String, default: '' },
  },
  admins: [String], // ID admin grup
  blacklist: [String], // ID pengguna yang diblacklist
  warnings: [{
    userId: String,
    count: Number,
    lastWarning: Date,
    reasons: [String]
  }],
  notes: [{
    name: String,
    content: String,
    createdBy: String,
    createdAt: Date
  }],
  blockedWords: [String], // Kata-kata yang diblokir
  customCommands: [{
    command: String,
    response: String,
    createdBy: String
  }],
  pendingCaptchas: [{
    userId: String,
    messageId: String,
    captchaAnswer: String,
    timestamp: Date
  }]
});

const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  createdAt: { type: Date, default: Date.now },
  lastActivity: { type: Date, default: Date.now },
  isBot: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  banReason: String,
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  messageCount: { type: Number, default: 0 },
  warningCount: { type: Number, default: 0 },
  trustScore: { type: Number, default: 50 }, // 0-100
  spamScore: { type: Number, default: 0 }, // 0-100
  preferences: {
    language: { type: String, default: 'id' }
  },
  captchaFails: { type: Number, default: 0 }
});

const messageStatsSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  groupId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  messageType: String // 'text', 'photo', 'video', dll
});

const Group = mongoose.model('Group', groupSchema);
const User = mongoose.model('User', userSchema);
const MessageStats = mongoose.model('MessageStats', messageStatsSchema);

// Middleware session
bot.use(session());

// Fungsi Helper
async function isGroupAdmin(ctx, userId) {
  if (!ctx.chat || ctx.chat.type === 'private') return false;
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ['creator', 'administrator'].includes(member.status);
  } catch (error) {
    console.error('❌ Error memeriksa status admin:', error);
    return false;
  }
}

async function isGroupOwner(userId, groupId) {
  try {
    const group = await Group.findOne({ groupId: groupId.toString() });
    return group && group.ownerId === userId.toString();
  } catch (error) {
    console.error('❌ Error memeriksa pemilik grup:', error);
    return false;
  }
}

async function isBotAdmin(ctx, requirePermissions = []) {
  if (!ctx.chat || ctx.chat.type === 'private') return false;
  try {
    const botMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
    
    // Cek apakah bot adalah admin
    if (!['creator', 'administrator'].includes(botMember.status)) {
      return false;
    }
    
    // Jika izin tertentu diperlukan, periksa
    if (requirePermissions.length > 0) {
      for (const perm of requirePermissions) {
        if (!botMember[perm]) {
          return false;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error memeriksa status bot:', error);
    return false;
  }
}

async function hasManagePermission(userId, groupId) {
  try {
    const group = await Group.findOne({ groupId: groupId.toString() });
    if (!group) return false;
    
    // Pengguna adalah pemilik grup atau admin
    return group.ownerId === userId.toString() || group.admins.includes(userId.toString());
  } catch (error) {
    console.error('❌ Error memeriksa izin manajemen:', error);
    return false;
  }
}

async function registerGroup(ctx) {
  if (!ctx.chat || ['private', 'channel'].includes(ctx.chat.type)) return null;
  
  try {
    // Cek apakah grup sudah terdaftar
    let group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    
    if (!group) {
      const admins = [];
      const adminMembers = await ctx.telegram.getChatAdministrators(ctx.chat.id);
      adminMembers.forEach(admin => admins.push(admin.user.id.toString()));
      
      group = new Group({
        groupId: ctx.chat.id.toString(),
        groupName: ctx.chat.title,
        groupUsername: ctx.chat.username || '',
        ownerId: ctx.from?.id?.toString() || adminMembers.find(admin => admin.status === 'creator')?.user.id.toString(),
        admins: admins
      });
      
      await group.save();
      console.log(`✅ Grup baru terdaftar: ${ctx.chat.title}`);
    }
    
    return group;
  } catch (error) {
    console.error('❌ Error mendaftarkan grup:', error);
    return null;
  }
}

async function registerUser(user) {
  try {
    let dbUser = await User.findOne({ userId: user.id.toString() });
    
    if (!dbUser) {
      dbUser = new User({
        userId: user.id.toString(),
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        isBot: user.is_bot
      });
      
      await dbUser.save();
      console.log(`✅ Pengguna baru terdaftar: ${user.id}`);
    } else {
      // Update informasi pengguna jika sudah ada
      dbUser.username = user.username;
      dbUser.firstName = user.first_name;
      dbUser.lastName = user.last_name;
      dbUser.lastActivity = new Date();
      await dbUser.save();
    }
    
    return dbUser;
  } catch (error) {
    console.error('❌ Error mendaftarkan pengguna:', error);
    return null;
  }
}

async function logActivity(ctx, action, targetUserId = null, details = {}) {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return;
    
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    if (!group || !group.settings.logActions) return;
    
    const timestamp = new Date();
    const actionBy = ctx.from?.id?.toString();
    const targetUser = targetUserId || null;
    
    // Jika ada saluran log, kirim log ke sana
    if (group.settings.logChannel) {
      try {
        let logMessage = `📝 *LOG AKTIVITAS*\n`;
        logMessage += `👥 *Grup:* ${group.groupName}\n`;
        logMessage += `🕒 *Waktu:* ${moment().format('DD MMM YYYY HH:mm:ss')}\n`;
        
        if (actionBy) {
          const user = await User.findOne({ userId: actionBy });
          const userName = user ? (user.firstName + (user.lastName ? ' ' + user.lastName : '')) : 'Tidak diketahui';
          logMessage += `👤 *Dilakukan oleh:* ${userName} (${actionBy})\n`;
        }
        
        if (targetUser) {
          const user = await User.findOne({ userId: targetUser });
          const userName = user ? (user.firstName + (user.lastName ? ' ' + user.lastName : '')) : 'Tidak diketahui';
          logMessage += `🎯 *Target:* ${userName} (${targetUser})\n`;
        }
        
        logMessage += `🔄 *Aksi:* ${formatActionName(action)}\n`;
        
        if (Object.keys(details).length > 0) {
          logMessage += `📋 *Detail:*\n`;
          for (const [key, value] of Object.entries(details)) {
            logMessage += `  • ${formatDetailKey(key)}: ${value}\n`;
          }
        }
        
        await bot.telegram.sendMessage(group.settings.logChannel, logMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.error('❌ Error mengirim log ke channel:', error);
      }
    }
  } catch (error) {
    console.error('❌ Error mencatat aktivitas:', error);
  }
}

function formatActionName(action) {
  const actionMap = {
    'group_registered': 'Grup Terdaftar',
    'user_warned': 'Pengguna Diperingatkan',
    'user_muted': 'Pengguna Dibisukan',
    'user_kicked': 'Pengguna Dikeluarkan',
    'user_banned': 'Pengguna Diblokir',
    'user_unbanned': 'Blokir Pengguna Dicabut',
    'user_blacklisted': 'Pengguna Masuk Daftar Hitam',
    'user_unblacklisted': 'Pengguna Keluar dari Daftar Hitam',
    'message_deleted': 'Pesan Dihapus',
    'setting_changed': 'Pengaturan Diubah',
    'rule_added': 'Aturan Ditambahkan',
    'rule_removed': 'Aturan Dihapus',
    'spam_detected': 'Spam Terdeteksi',
    'flood_detected': 'Flood Terdeteksi',
    'bot_detected': 'Bot Terdeteksi',
  };
  
  return actionMap[action] || action;
}

function formatDetailKey(key) {
  const keyMap = {
    'groupName': 'Nama Grup',
    'reason': 'Alasan',
    'duration': 'Durasi',
    'messageId': 'ID Pesan',
    'settingName': 'Nama Pengaturan',
    'settingValue': 'Nilai Pengaturan',
    'ruleText': 'Teks Aturan',
    'messageCount': 'Jumlah Pesan',
    'timeFrame': 'Rentang Waktu',
  };
  
  return keyMap[key] || key;
}

function formatDuration(minutes) {
  if (minutes < 60) {
    return `${minutes} menit`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} jam${mins > 0 ? ` ${mins} menit` : ''}`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return `${days} hari${hours > 0 ? ` ${hours} jam` : ''}`;
  }
}

async function warnUser(ctx, userId, reason = 'Tidak ada alasan') {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    if (!group) return false;
    
    // Cek apakah pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, userId);
    if (isAdmin) {
      await ctx.reply('❌ Tidak dapat memberikan peringatan kepada admin grup.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Ambil atau buat data peringatan untuk pengguna
    let warning = group.warnings.find(w => w.userId === userId.toString());
    
    if (!warning) {
      warning = {
        userId: userId.toString(),
        count: 0,
        lastWarning: new Date(),
        reasons: []
      };
      group.warnings.push(warning);
    }
    
    // Tingkatkan jumlah peringatan
    warning.count += 1;
    warning.lastWarning = new Date();
    warning.reasons.push(reason);
    
    await group.save();
    
    // Ambil info pengguna
    let user;
    try {
      user = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    const userName = user?.user.first_name || 'Pengguna';
    
    // Kirim notifikasi peringatan
    await ctx.reply(`⚠️ *Peringatan kepada ${userName}*\n` +
                   `🔢 *Peringatan ke-${warning.count}/${group.settings.maxWarnings}*\n` +
                   `📝 *Alasan:* ${reason}`, { 
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'user_warned', userId, { 
      reason: reason, 
      warningCount: warning.count,
      maxWarnings: group.settings.maxWarnings 
    });
    
    // Jika mencapai batas maksimum, ambil tindakan
    if (warning.count >= group.settings.maxWarnings) {
      const action = group.settings.warningAction;
      
      switch (action) {
        case 'mute':
          await muteUser(ctx, userId, 60 * 24, `Mencapai batas peringatan (${warning.count}/${group.settings.maxWarnings})`);
          break;
        case 'kick':
          await kickUser(ctx, userId, `Mencapai batas peringatan (${warning.count}/${group.settings.maxWarnings})`);
          break;
        case 'ban':
          await banUser(ctx, userId, `Mencapai batas peringatan (${warning.count}/${group.settings.maxWarnings})`);
          break;
      }
      
      // Reset peringatan
      warning.count = 0;
      warning.reasons = [];
      await group.save();
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error memberikan peringatan:', error);
    return false;
  }
}

async function muteUser(ctx, userId, duration = 60, reason = 'Tidak ada alasan') {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    
    // Cek apakah bot adalah admin
    const botIsAdmin = await isBotAdmin(ctx);
    if (!botIsAdmin) {
      await ctx.reply('❌ Saya perlu menjadi admin untuk membisukan pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Cek apakah pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, userId);
    if (isAdmin) {
      await ctx.reply('❌ Tidak dapat membisukan admin grup.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Bisukan pengguna
    const untilDate = Math.floor(Date.now() / 1000) + (duration * 60);
    await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
      until_date: untilDate,
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false
    });
    
    // Ambil info pengguna
    let user;
    try {
      user = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    const userName = user?.user.first_name || 'Pengguna';
    
    // Kirim notifikasi
    await ctx.reply(`🔇 *${userName} telah dibisukan*\n` +
                   `⏱️ *Durasi:* ${formatDuration(duration)}\n` +
                   `📝 *Alasan:* ${reason}`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'user_muted', userId, { 
      reason: reason, 
      duration: formatDuration(duration)
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error membisukan pengguna:', error);
    await ctx.reply(`❌ Gagal membisukan pengguna: ${error.message}`, {
      reply_to_message_id: ctx.message.message_id
    });
    return false;
  }
}

async function kickUser(ctx, userId, reason = 'Tidak ada alasan') {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    
    // Cek apakah bot adalah admin
    const botIsAdmin = await isBotAdmin(ctx);
    if (!botIsAdmin) {
      await ctx.reply('❌ Saya perlu menjadi admin untuk mengeluarkan pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Cek apakah pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, userId);
    if (isAdmin) {
      await ctx.reply('❌ Tidak dapat mengeluarkan admin grup.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Ambil info pengguna sebelum dikeluarkan
    let user;
    try {
      user = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    const userName = user?.user.first_name || 'Pengguna';
    
    // Keluarkan pengguna (ban dan unban)
    await ctx.telegram.kickChatMember(ctx.chat.id, userId, { until_date: Math.floor(Date.now() / 1000) + 60 });
    
    // Kirim notifikasi
    await ctx.reply(`👢 *${userName} telah dikeluarkan dari grup*\n` +
                   `📝 *Alasan:* ${reason}`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'user_kicked', userId, { reason: reason });
    
    return true;
  } catch (error) {
    console.error('❌ Error mengeluarkan pengguna:', error);
    await ctx.reply(`❌ Gagal mengeluarkan pengguna: ${error.message}`, {
      reply_to_message_id: ctx.message.message_id
    });
    return false;
  }
}

async function banUser(ctx, userId, reason = 'Tidak ada alasan') {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    
    // Cek apakah bot adalah admin
    const botIsAdmin = await isBotAdmin(ctx);
    if (!botIsAdmin) {
      await ctx.reply('❌ Saya perlu menjadi admin untuk memblokir pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Cek apakah pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, userId);
    if (isAdmin) {
      await ctx.reply('❌ Tidak dapat memblokir admin grup.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Ambil info pengguna sebelum diblokir
    let user;
    try {
      user = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    const userName = user?.user.first_name || 'Pengguna';
    
    // Blokir pengguna
    await ctx.telegram.kickChatMember(ctx.chat.id, userId);
    
    // Kirim notifikasi
    await ctx.reply(`🚫 *${userName} telah diblokir dari grup*\n` +
                   `📝 *Alasan:* ${reason}`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'user_banned', userId, { reason: reason });
    
    return true;
  } catch (error) {
    console.error('❌ Error memblokir pengguna:', error);
    await ctx.reply(`❌ Gagal memblokir pengguna: ${error.message}`, {
      reply_to_message_id: ctx.message.message_id
    });
    return false;
  }
}

async function unbanUser(ctx, userId) {
  try {
    if (!ctx.chat || ctx.chat.type === 'private') return false;
    
    // Cek apakah bot adalah admin
    const botIsAdmin = await isBotAdmin(ctx);
    if (!botIsAdmin) {
      await ctx.reply('❌ Saya perlu menjadi admin untuk membuka blokir pengguna.', {
        reply_to_message_id: ctx.message.message_id
      });
      return false;
    }
    
    // Buka blokir pengguna
    await ctx.telegram.unbanChatMember(ctx.chat.id, userId);
    
    // Kirim notifikasi
    await ctx.reply(`✅ *Pengguna ${userId} telah dibuka blokirnya*\n` +
                   `🔓 Pengguna ini sekarang dapat bergabung kembali dengan grup.`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'user_unbanned', userId);
    
    return true;
  } catch (error) {
    console.error('❌ Error membuka blokir pengguna:', error);
    await ctx.reply(`❌ Gagal membuka blokir pengguna: ${error.message}`, {
      reply_to_message_id: ctx.message.message_id
    });
    return false;
  }
}

async function deleteMessage(ctx, messageId) {
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
    return true;
  } catch (error) {
    console.error('❌ Error menghapus pesan:', error);
    return false;
  }
}

async function isUserFlooding(userId, groupId) {
  try {
    const group = await Group.findOne({ groupId: groupId.toString() });
    if (!group || !group.settings.antiFlood) return false;
    
    const threshold = group.settings.floodThreshold || 5;
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60000);
    
    // Hitung jumlah pesan dalam satu menit terakhir
    const messageCount = await MessageStats.countDocuments({
      userId: userId.toString(),
      groupId: groupId.toString(),
      timestamp: { $gte: minuteAgo }
    });
    
    return messageCount >= threshold;
  } catch (error) {
    console.error('❌ Error memeriksa flood:', error);
    return false;
  }
}

async function handleFlood(ctx, userId) {
  try {
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    if (!group) return;
    
    const action = group.settings.floodAction || 'mute';
    const duration = group.settings.floodMuteDuration || 60;
    
    // Ambil info pengguna
    let user;
    try {
      user = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    const userName = user?.user.first_name || 'Pengguna';
    
    await ctx.reply(`🚨 *Terdeteksi Flood*\n` +
                   `👤 Pengguna: ${userName}\n` +
                   `🔢 ID: \`${userId}\`\n` +
                   `⚠️ Pesan terlalu cepat dalam waktu singkat.\n` +
                   `🔄 Tindakan: ${formatAction(action)}`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    switch (action) {
      case 'warn':
        await warnUser(ctx, userId, 'Flood terdeteksi');
        break;
      case 'mute':
        await muteUser(ctx, userId, duration, 'Flood terdeteksi');
        break;
      case 'kick':
        await kickUser(ctx, userId, 'Flood terdeteksi');
        break;
      case 'ban':
        await banUser(ctx, userId, 'Flood terdeteksi');
        break;
    }
    
    // Log aktivitas
    await logActivity(ctx, 'flood_detected', userId, {
      action: action,
      duration: action === 'mute' ? formatDuration(duration) : 'N/A'
    });
  } catch (error) {
    console.error('❌ Error menangani flood:', error);
  }
}

function formatAction(action) {
  const actionMap = {
    'warn': 'Peringatan',
    'mute': 'Bisukan',
    'kick': 'Keluarkan',
    'ban': 'Blokir'
  };
  
  return actionMap[action] || action;
}

async function containsLink(text) {
  if (!text) return false;
  
  // Regex untuk mendeteksi tautan
  const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([^\s]+\.(com|org|net|id|io|me|co|biz|info|ru))/gi;
  
  return urlRegex.test(text);
}

async function containsBlockedWord(text, groupId) {
  if (!text) return false;
  
  try {
    const group = await Group.findOne({ groupId: groupId.toString() });
    if (!group || !group.blockedWords || group.blockedWords.length === 0) return false;
    
    const lowerText = text.toLowerCase();
    
    for (const word of group.blockedWords) {
      if (lowerText.includes(word.toLowerCase())) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('❌ Error memeriksa kata terlarang:', error);
    return false;
  }
}

async function isSpam(ctx) {
  if (!ctx.message || !ctx.message.text) return false;
  
  const text = ctx.message.text;
  
  // Kriteria spam
  const hasExcessiveCaps = text.length > 15 && text.toUpperCase() === text;
  const hasRepeatedCharacters = /(.)\1{5,}/.test(text); // Karakter berulang >= 5 kali
  const isTooLong = text.length > 1000; // Pesan sangat panjang
  
  // Jika memenuhi salah satu kriteria, tandai sebagai spam
  if (hasExcessiveCaps || hasRepeatedCharacters || isTooLong) {
    await ctx.reply('⚠️ Pesan Anda terdeteksi sebagai spam.', {
      reply_to_message_id: ctx.message.message_id
    });
    return true;
  }
  
  return false;
}

async function generateCaptcha() {
  // Buat captcha sederhana: operasi matematika dasar
  const operators = ['+', '-', '*'];
  const operator = operators[Math.floor(Math.random() * operators.length)];
  
  let num1, num2, answer;
  
  switch (operator) {
    case '+':
      num1 = Math.floor(Math.random() * 50) + 1;
      num2 = Math.floor(Math.random() * 50) + 1;
      answer = num1 + num2;
      break;
    case '-':
      num1 = Math.floor(Math.random() * 50) + 25; // Memastikan num1 > num2
      num2 = Math.floor(Math.random() * 20) + 1;
      answer = num1 - num2;
      break;
    case '*':
      num1 = Math.floor(Math.random() * 12) + 1;
      num2 = Math.floor(Math.random() * 12) + 1;
      answer = num1 * num2;
      break;
  }
  
  return {
    question: `${num1} ${operator} ${num2} = ?`,
    answer: answer.toString()
  };
}

// Middleware untuk log dan registrasi
bot.use(async (ctx, next) => {
  // Skip jika tidak ada pesan atau tidak ada pengguna
  if (!ctx.from) return next();
  
  try {
    // Registrasi pengguna
    await registerUser(ctx.from);
    
    // Registrasi grup jika pesan berasal dari grup
    if (ctx.chat && ['group', 'supergroup'].includes(ctx.chat.type)) {
      await registerGroup(ctx);
    }
    
    // Rekam statistik pesan untuk deteksi flood
    if (ctx.message && ctx.chat && ctx.chat.type !== 'private') {
      const messageType = Object.keys(ctx.message).find(key => {
        return ['text', 'photo', 'video', 'audio', 'document', 'sticker', 'animation'].includes(key);
      }) || 'unknown';
      
      const stats = new MessageStats({
        userId: ctx.from.id.toString(),
        groupId: ctx.chat.id.toString(),
        messageType: messageType
      });
      
      await stats.save();
    }
  } catch (error) {
    console.error('❌ Error dalam middleware:', error);
  }
  
  await next();
});

// Middleware anti flood
bot.use(async (ctx, next) => {
  if (!ctx.message || !ctx.chat || ctx.chat.type === 'private') return next();
  
  try {
    // Skip jika pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
    if (isAdmin) return next();
    
    // Cek apakah pengguna sedang flood
    if (await isUserFlooding(ctx.from.id, ctx.chat.id)) {
      await handleFlood(ctx, ctx.from.id);
      return; // Jangan lanjutkan jika terdeteksi flood
    }
  } catch (error) {
    console.error('❌ Error dalam middleware anti-flood:', error);
  }
  
  await next();
});

// Middleware untuk memeriksa dan mengelola pesan
bot.use(async (ctx, next) => {
  if (!ctx.message || !ctx.from || !ctx.chat || ctx.chat.type === 'private') return next();
  
  try {
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    if (!group) return next();
    
    // Cek apakah bot adalah admin
    const botIsAdmin = await isBotAdmin(ctx);
    if (!botIsAdmin) return next();
    
    // Cek apakah pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
    if (isAdmin) return next(); // Admin bebas dari moderasi
    
    // Cek apakah pengguna ada di blacklist
    if (group.blacklist.includes(ctx.from.id.toString())) {
      await deleteMessage(ctx, ctx.message.message_id);
      return;
    }
    
    // Tangani berbagai jenis pesan
    if (ctx.message.text) {
      // Anti-Link
      if (group.settings.antiLink && await containsLink(ctx.message.text)) {
        // Cek whitelist link jika ada
        let isWhitelisted = false;
        if (group.settings.whitelistLinks && group.settings.whitelistLinks.length > 0) {
          for (const whiteUrl of group.settings.whitelistLinks) {
            if (ctx.message.text.includes(whiteUrl)) {
              isWhitelisted = true;
              break;
            }
          }
        }
        
        if (!isWhitelisted) {
          await deleteMessage(ctx, ctx.message.message_id);
          await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, tautan tidak diizinkan dalam grup ini!`, 
            { reply_to_message_id: ctx.message.message_id });
          return;
        }
      }
      
      // Anti-Kata Terlarang
      if (await containsBlockedWord(ctx.message.text, ctx.chat.id)) {
        await deleteMessage(ctx, ctx.message.message_id);
        await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, pesan Anda mengandung kata yang dilarang dalam grup ini!`, 
          { reply_to_message_id: ctx.message.message_id });
        return;
      }
      
      // Anti-Spam
      if (group.settings.antiSpam && await isSpam(ctx)) {
        await deleteMessage(ctx, ctx.message.message_id);
        await warnUser(ctx, ctx.from.id, 'Mengirim pesan spam');
        return;
      }
      
      // Anti-Command jika diaktifkan (mencegah pengguna menggunakan perintah bot lain)
      if (group.settings.antiCommand && ctx.message.text.startsWith('/') && !ctx.message.text.startsWith('/start')) {
        const isForThisBot = ctx.message.entities && 
                             ctx.message.entities[0].type === 'bot_command' && 
                             ctx.message.entities[0].offset === 0 &&
                             ctx.message.text.includes('@' + ctx.botInfo.username);
        
        if (!isForThisBot) {
          await deleteMessage(ctx, ctx.message.message_id);
          return;
        }
      }
    }
    
    // Anti-Forward
    if (group.settings.antiForward && ctx.message.forward_from) {
      await deleteMessage(ctx, ctx.message.message_id);
      return;
    }
    
    // Filter Media
    if (ctx.message.photo && !group.settings.allowPhotos) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, foto tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
    
    if (ctx.message.video && !group.settings.allowVideos) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, video tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
    
    if (ctx.message.audio && !group.settings.allowAudios) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, audio tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
    
    if (ctx.message.voice && !group.settings.allowVoiceMessages) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, pesan suara tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
    
    if (ctx.message.document && !group.settings.allowDocuments) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, dokumen tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
    
    if (ctx.message.sticker && !group.settings.allowStickers) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, stiker tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
    
    if (ctx.message.animation && !group.settings.allowGifs) {
      await deleteMessage(ctx, ctx.message.message_id);
      await ctx.reply(`⚠️ @${ctx.from.username || ctx.from.id}, GIF tidak diizinkan dalam grup ini!`, 
        { reply_to_message_id: ctx.message.message_id });
      return;
    }
  } catch (error) {
    console.error('❌ Error dalam middleware filter pesan:', error);
  }
  
  await next();
});

// Fungsi untuk mengenali apakah ada bot baru yang masuk
async function detectNewBot(ctx, newMember) {
  try {
    if (!newMember.is_bot) return false;
    
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    if (!group || !group.settings.antiBot) return false;
    
    // Cek apakah bot adalah admin
    const botIsAdmin = await isBotAdmin(ctx);
    if (!botIsAdmin) return false;
    
    // Keluarkan bot yang coba bergabung
    await ctx.telegram.kickChatMember(ctx.chat.id, newMember.id);
    
    await ctx.reply(`🛑 Bot baru terdeteksi dan telah dikeluarkan dari grup.\n` +
                   `👤 Bot: ${newMember.first_name} ${newMember.username ? '@' + newMember.username : ''}\n` +
                   `🤖 ID: ${newMember.id}\n` +
                   `ℹ️ Grup ini dilindungi dari bot yang coba masuk.`, {
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'bot_detected', newMember.id, {
      botName: newMember.username || newMember.first_name,
      action: 'kicked'
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error mendeteksi bot baru:', error);
    return false;
  }
}

// Perintah Mulai (Start)
bot.start(async (ctx) => {
  if (ctx.chat.type === 'private') {
    await registerUser(ctx.from);
    
    const welcomeMessage = `🤖 *Selamat datang di Bot Manajemen Grup!*
    
Saya adalah bot yang akan membantu Anda mengelola dan melindungi grup Telegram Anda dari spam, raid, dan banyak lagi!

⚙️ *Fitur Utama:*
• Anti-spam & anti-flood 
• Blacklist pengguna
• Filter media & kata terlarang
• Perlindungan grup
• Sistem peringatan
• Manajemen anggota

Tambahkan saya ke grup Anda dan jadikan saya admin untuk menggunakan semua fitur!

Tekan tombol di bawah untuk mulai:`;
    
    return ctx.replyWithMarkdown(welcomeMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Tambah ke Grup', url: `https://t.me/${ctx.botInfo.username}?startgroup=settings` },
            { text: '📚 Bantuan', callback_data: 'help' }
          ],
          [
            { text: '🔍 Grup Saya', callback_data: 'my_groups' },
            { text: '👤 Tentang Bot', callback_data: 'about' }
          ]
        ]
      },
      reply_to_message_id: ctx.message.message_id
    });
  } else {
    // Pesan sambutan ketika bot ditambahkan ke grup
    await registerGroup(ctx);
    
    return ctx.replyWithMarkdown(`👋 *Hai! Saya adalah Bot Manajemen Grup.*

Saya telah ditambahkan ke grup ini. Untuk menggunakan semua fitur, tolong jadikan saya admin dengan izin:
• Hapus pesan
• Blokir pengguna
• Tambah anggota baru

*Catatan:* Hanya pengguna yang menambahkan saya dan admin grup yang dapat mengatur bot melalui chat pribadi.

Gunakan /help untuk melihat perintah yang tersedia.`, {
      reply_to_message_id: ctx.message.message_id
    });
  }
});

// Perintah Bantuan (Help)
bot.help(async (ctx) => {
  const helpMessage = `🛡️ *BANTUAN BOT MANAJEMEN GRUP* 🛡️

*Perintah Dasar:*
/start - Mulai bot
/help - Tampilkan pesan bantuan ini
/id - Dapatkan ID Anda dan ID grup
/settings - Pengaturan grup (admin saja)

*Moderasi:*
/warn [alasan] - Beri peringatan pengguna (balas ke pesan)
/mute [durasi] [alasan] - Bisukan pengguna (balas ke pesan)
/unmute - Batalkan bisukan pengguna (balas ke pesan)
/kick [alasan] - Keluarkan pengguna (balas ke pesan)
/ban [alasan] - Blokir pengguna (balas ke pesan)
/unban [user_id] - Batalkan blokir pengguna

*Blacklist:*
/bl [user_id] - Tambahkan pengguna ke daftar hitam
/unbl [user_id] - Hapus pengguna dari daftar hitam

*Kata Terlarang:*
/addword [kata] - Tambahkan kata terlarang
/rmword [kata] - Hapus kata terlarang
/wordlist - Lihat daftar kata terlarang

*Pengaturan Grup:*
Pengaturan grup dapat dikelola melalui chat pribadi dengan bot. Cukup gunakan perintah /settings atau tekan tombol "Grup Saya" di chat pribadi.

*Catatan:* Hanya admin yang dapat menggunakan perintah moderasi.`;

  return ctx.replyWithMarkdown(helpMessage, {
    reply_to_message_id: ctx.message.message_id
  });
});

// Perintah ID
bot.command('id', async (ctx) => {
  let message = `🆔 *Informasi ID*\n\n`;
  message += `👤 *Pengguna:* ${ctx.from.first_name}\n`;
  message += `📝 *ID Pengguna:* \`${ctx.from.id}\`\n`;
  
  if (ctx.chat.type !== 'private') {
    message += `\n👥 *Grup:* ${ctx.chat.title}\n`;
    message += `📝 *ID Grup:* \`${ctx.chat.id}\`\n`;
  }
  
  message += `\nℹ️ Gunakan ID ini untuk keperluan manajemen grup seperti blacklist, unban, dll.`;
  
  return ctx.replyWithMarkdown(message, {
    reply_to_message_id: ctx.message.message_id
  });
});

// Perintah Settings
bot.command('settings', async (ctx) => {
  if (ctx.chat.type === 'private') {
    return ctx.replyWithMarkdown(`⚙️ Untuk mengatur grup Anda, pilih grup melalui menu *Grup Saya*.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Grup Saya', callback_data: 'my_groups' }]
        ]
      },
      reply_to_message_id: ctx.message.message_id
    });
  } else {
    // Cek apakah pengguna adalah admin
    const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
    if (!isAdmin) {
      return ctx.reply('❌ Hanya admin grup yang dapat mengakses pengaturan.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    return ctx.replyWithMarkdown(`⚙️ *Pengaturan Grup*\n\nUntuk mengatur grup ini, silakan chat dengan saya secara pribadi dengan menekan tombol di bawah.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚙️ Buka Pengaturan di Chat Pribadi', url: `https://t.me/${ctx.botInfo.username}?start=settings_${ctx.chat.id}` }]
        ]
      },
      reply_to_message_id: ctx.message.message_id
    });
  }
});

// Handler "Grup Saya" pada chat pribadi
bot.action('my_groups', async (ctx) => {
  try {
    // Cari grup-grup yang dimiliki atau dikelola oleh pengguna
    const groups = await Group.find({
      $or: [
        { ownerId: ctx.from.id.toString() },
        { admins: ctx.from.id.toString() }
      ]
    });
    
    if (groups.length === 0) {
      await ctx.answerCbQuery('Anda belum memiliki grup yang terdaftar.');
      return ctx.editMessageText('⚠️ *Tidak ada grup yang terdaftar*\n\nUntuk menggunakan bot ini:\n1. Tambahkan bot ke grup Anda\n2. Jadikan bot sebagai admin grup\n3. Grup Anda akan muncul di sini', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ Tambah ke Grup', url: `https://t.me/${ctx.botInfo.username}?startgroup=true` }],
            [{ text: '« Kembali', callback_data: 'back_to_main' }]
          ]
        }
      });
    }
    
    // Buat tombol untuk setiap grup
    const buttons = groups.map(group => {
      return [{ text: group.groupName, callback_data: `manage_group:${group.groupId}` }];
    });
    
    // Tambahkan tombol kembali
    buttons.push([{ text: '« Kembali', callback_data: 'back_to_main' }]);
    
    await ctx.answerCbQuery();
    return ctx.editMessageText('🔍 *Grup Saya*\n\nPilih grup yang ingin Anda kelola:', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } catch (error) {
    console.error('❌ Error menampilkan grup:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
    return ctx.editMessageText('❌ Terjadi kesalahan saat mengambil daftar grup Anda. Silakan coba lagi nanti.');
  }
});

// Handler untuk mengelola grup yang dipilih
bot.action(/manage_group:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    
    // Pastikan objek session tersedia
    if (!ctx.session) {
      ctx.session = {};
    }
    
    // Periksa apakah bot masih berada dalam grup
    try {
      // Coba dapatkan informasi keanggotaan bot di grup
      const botMember = await ctx.telegram.getChatMember(groupId, ctx.botInfo.id);
      
      // Jika bot sudah tidak menjadi anggota grup
      if (!botMember || ['left', 'kicked'].includes(botMember.status)) {
        // Hapus grup dari database
        await Group.deleteOne({ groupId });
        
        await ctx.answerCbQuery('Bot tidak lagi menjadi anggota grup ini.');
        return ctx.editMessageText('❌ Bot tidak lagi menjadi anggota grup ini. Grup telah dihapus dari daftar.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
            ]
          }
        });
      }
      
      // Periksa apakah bot memiliki hak admin
      if (botMember.status !== 'administrator') {
        return ctx.editMessageText(`⚠️ *Peringatan: Bot Bukan Admin*\n\nBot saat ini bukan admin di grup ini. \n\nUntuk menggunakan semua fitur, bot harus memiliki status admin dengan izin berikut:\n• Hapus pesan\n• Blokir pengguna\n• Tambah anggota baru\n\nSilakan jadikan bot sebagai admin dengan izin penuh untuk menggunakan semua fitur.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
            ]
          }
        });
      }
      
      // Periksa apakah bot memiliki semua izin yang diperlukan
      const missingPermissions = [];
      
      if (!botMember.can_delete_messages) missingPermissions.push('Hapus pesan');
      if (!botMember.can_restrict_members) missingPermissions.push('Blokir pengguna');
      if (!botMember.can_invite_users) missingPermissions.push('Tambah anggota baru');
      
      if (missingPermissions.length > 0) {
        const permList = missingPermissions.map(p => `• ${p}`).join('\n');
        
        return ctx.editMessageText(`⚠️ *Peringatan: Izin Bot Tidak Lengkap*\n\nBot adalah admin di grup, tetapi tidak memiliki semua izin yang diperlukan.\n\nIzin yang kurang:\n${permList}\n\nSilakan perbarui izin bot untuk menggunakan semua fitur.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
            ]
          }
        });
      }
    } catch (error) {
      console.error('❌ Error memeriksa keanggotaan bot:', error);
      
      // Jika tidak dapat memeriksa keanggotaan, asumsikan bot tidak lagi di grup
      await Group.deleteOne({ groupId });
      
      await ctx.answerCbQuery('Tidak dapat mengakses grup. Bot mungkin tidak lagi menjadi anggota.');
      return ctx.editMessageText('❌ Tidak dapat mengakses grup. Bot mungkin telah dikeluarkan dari grup. Grup telah dihapus dari daftar.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    // Cari informasi grup
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan atau bot telah dikeluarkan dari grup.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    // Cek apakah pengguna memiliki izin untuk mengelola grup
    if (group.ownerId !== ctx.from.id.toString() && !group.admins.includes(ctx.from.id.toString())) {
      await ctx.answerCbQuery('Anda tidak memiliki izin untuk mengelola grup ini.');
      return ctx.editMessageText('❌ Anda tidak memiliki izin untuk mengelola grup ini. Hanya pemilik grup dan admin yang dapat mengaksesnya.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    // Jika semua pemeriksaan berhasil, sekarang tetapkan sesi
    ctx.session.currentGroupId = groupId;
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`⚙️ *Mengelola Grup: ${group.groupName}*\n\nPilih kategori pengaturan:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📢 Notifikasi', callback_data: `notifications:${groupId}` },
            { text: '🖼 Media', callback_data: `media:${groupId}` }
          ],
          [
            { text: '🛡️ Proteksi', callback_data: `protection:${groupId}` },
            { text: '⚠️ Penalti', callback_data: `penalties:${groupId}` }
          ],
          [
            { text: '👥 Anggota', callback_data: `members:${groupId}` },
            { text: '🚫 Daftar Hitam', callback_data: `blacklist:${groupId}` }
          ],
          [
            { text: '🔤 Kata Terlarang', callback_data: `blocked_words:${groupId}` },
            { text: '📝 Aturan Grup', callback_data: `rules:${groupId}` }
          ],
          [
            { text: '👋 Penyambutan', callback_data: `welcome:${groupId}` },
            { text: '⚙️ Lainnya', callback_data: `other:${groupId}` }
          ],
          [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error mengelola grup:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
    return ctx.editMessageText('❌ Terjadi kesalahan saat mengakses pengaturan grup. Silakan coba lagi nanti.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
        ]
      }
    });
  }
});



// Contoh update untuk action handler yang menggunakan session
// Perbarui setiap action handler yang menggunakan ctx.session
bot.action(/notifications:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    
    // Pastikan session ada (pengaman tambahan)
    if (!ctx.session) {
      ctx.session = {};
    }
    
    // Periksa apakah bot masih di grup
    try {
      await ctx.telegram.getChatMember(groupId, ctx.botInfo.id);
    } catch (error) {
      // Bot tidak lagi di grup
      await Group.deleteOne({ groupId });
      
      await ctx.answerCbQuery('Bot tidak lagi menjadi anggota grup ini.');
      return ctx.editMessageText('❌ Bot tidak lagi menjadi anggota grup ini. Grup telah dihapus dari daftar.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    const settings = group.settings;
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`📢 *Pengaturan Notifikasi Grup*\n_${group.groupName}_\n\nAktifkan/nonaktifkan pemberitahuan untuk peristiwa grup:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `${settings.notifyNewMembers ? '✅' : '❌'} Anggota Baru`, callback_data: `toggle:${groupId}:notifyNewMembers` }],
          [{ text: `${settings.notifyLeftMembers ? '✅' : '❌'} Anggota Keluar`, callback_data: `toggle:${groupId}:notifyLeftMembers` }],
          [{ text: `${settings.notifyTitleChange ? '✅' : '❌'} Perubahan Judul`, callback_data: `toggle:${groupId}:notifyTitleChange` }],
          [{ text: `${settings.notifyPhotoChange ? '✅' : '❌'} Perubahan Foto`, callback_data: `toggle:${groupId}:notifyPhotoChange` }],
          [{ text: `${settings.notifyPhotoRemoved ? '✅' : '❌'} Foto Dihapus`, callback_data: `toggle:${groupId}:notifyPhotoRemoved` }],
          [{ text: `${settings.notifyPinnedMessage ? '✅' : '❌'} Pesan Disematkan`, callback_data: `toggle:${groupId}:notifyPinnedMessage` }],
          [{ text: `${settings.notifyVideoChat ? '✅' : '❌'} Obrolan Video`, callback_data: `toggle:${groupId}:notifyVideoChat` }],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pengaturan notifikasi:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
    return ctx.editMessageText('❌ Terjadi kesalahan. Silakan coba lagi nanti.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali ke Daftar Grup', callback_data: 'my_groups' }]
        ]
      }
    });
  }
});

// Handler pengaturan media
bot.action(/media:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    const settings = group.settings;
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🖼 *Pengaturan Media Grup*\n_${group.groupName}_\n\nIzinkan/blokir jenis media dalam grup:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: `${settings.allowPhotos ? '✅' : '❌'} Foto`, callback_data: `toggle:${groupId}:allowPhotos` },
            { text: `${settings.allowVideos ? '✅' : '❌'} Video`, callback_data: `toggle:${groupId}:allowVideos` }
          ],
          [
            { text: `${settings.allowDocuments ? '✅' : '❌'} Dokumen`, callback_data: `toggle:${groupId}:allowDocuments` },
            { text: `${settings.allowAudios ? '✅' : '❌'} Audio`, callback_data: `toggle:${groupId}:allowAudios` }
          ],
          [
            { text: `${settings.allowStickers ? '✅' : '❌'} Stiker`, callback_data: `toggle:${groupId}:allowStickers` },
            { text: `${settings.allowGifs ? '✅' : '❌'} GIF`, callback_data: `toggle:${groupId}:allowGifs` }
          ],
          [
            { text: `${settings.allowVoiceMessages ? '✅' : '❌'} Pesan Suara`, callback_data: `toggle:${groupId}:allowVoiceMessages` },
            { text: `${settings.allowVideoMessages ? '✅' : '❌'} Pesan Video`, callback_data: `toggle:${groupId}:allowVideoMessages` }
          ],
          [
            { text: `${settings.allowPolls ? '✅' : '❌'} Polling`, callback_data: `toggle:${groupId}:allowPolls` },
            { text: `${settings.allowLocations ? '✅' : '❌'} Lokasi`, callback_data: `toggle:${groupId}:allowLocations` }
          ],
          [
            { text: `${settings.allowContacts ? '✅' : '❌'} Kontak`, callback_data: `toggle:${groupId}:allowContacts` },
            { text: `${settings.allowGames ? '✅' : '❌'} Game`, callback_data: `toggle:${groupId}:allowGames` }
          ],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pengaturan media:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler pengaturan proteksi
bot.action(/protection:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    const settings = group.settings;
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🛡️ *Pengaturan Proteksi Grup*\n_${group.groupName}_\n\nAktifkan/nonaktifkan fitur proteksi:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `${settings.antiSpam ? '✅' : '❌'} Anti-Spam`, callback_data: `toggle:${groupId}:antiSpam` }],
          [{ text: `${settings.antiBot ? '✅' : '❌'} Anti-Bot`, callback_data: `toggle:${groupId}:antiBot` }],
          [{ text: `${settings.antiFlood ? '✅' : '❌'} Anti-Flood`, callback_data: `toggle:${groupId}:antiFlood` }],
          [{ text: `${settings.antiLink ? '✅' : '❌'} Anti-Link`, callback_data: `toggle:${groupId}:antiLink` }],
          [{ text: `${settings.antiForward ? '✅' : '❌'} Anti-Forward`, callback_data: `toggle:${groupId}:antiForward` }],
          [{ text: `${settings.antiCommand ? '✅' : '❌'} Anti-Command`, callback_data: `toggle:${groupId}:antiCommand` }],
          [{ text: `${settings.captchaOnJoin ? '✅' : '❌'} Captcha Saat Bergabung`, callback_data: `toggle:${groupId}:captchaOnJoin` }],
          [{ text: '🔗 Whitelist Link', callback_data: `whitelist:${groupId}` }],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pengaturan proteksi:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler pengaturan penalti
bot.action(/penalties:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    const settings = group.settings;
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`⚠️ *Pengaturan Penalti Grup*\n_${group.groupName}_\n\nAtur tindakan untuk pelanggaran:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `🔢 Batas Peringatan: ${settings.maxWarnings}`, callback_data: `set_warnings:${groupId}` }],
          [{ text: `🔄 Tindakan Peringatan: ${formatAction(settings.warningAction)}`, callback_data: `set_warning_action:${groupId}` }],
          [{ text: `🕒 Kadaluarsa Peringatan: ${settings.warningExpiry} hari`, callback_data: `set_warning_expiry:${groupId}` }],
          [{ text: `🌊 Batas Flood: ${settings.floodThreshold} pesan/menit`, callback_data: `set_flood_threshold:${groupId}` }],
          [{ text: `🔄 Tindakan Flood: ${formatAction(settings.floodAction)}`, callback_data: `set_flood_action:${groupId}` }],
          [{ text: `⏱️ Durasi Bisu Flood: ${formatDuration(settings.floodMuteDuration)}`, callback_data: `set_flood_mute:${groupId}` }],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pengaturan penalti:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk mengelola anggota
bot.action(/members:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`👥 *Manajemen Anggota Grup*\n_${group.groupName}_\n\nPilih opsi:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '👮‍♂️ Daftar Admin', callback_data: `admin_list:${groupId}` }],
          [{ text: '⚠️ Pengguna Dengan Peringatan', callback_data: `warned_users:${groupId}` }],
          [{ text: '🔍 Cari Pengguna', callback_data: `search_user:${groupId}` }],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error manajemen anggota:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk mengelola daftar hitam
bot.action(/blacklist:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    // Buat tombol untuk setiap pengguna yang diblacklist
    const blacklistButtons = [];
    
    if (group.blacklist && group.blacklist.length > 0) {
      for (const userId of group.blacklist) {
        let userName = userId;
        try {
          const user = await User.findOne({ userId });
          if (user) {
            userName = user.firstName + (user.lastName ? ' ' + user.lastName : '');
          }
        } catch (error) {
          console.error('❌ Error mendapatkan info pengguna:', error);
        }
        
        blacklistButtons.push([
          { text: `🚫 ${userName} (${userId})`, callback_data: `blacklist_info:${groupId}:${userId}` }
        ]);
      }
    }
    
    // Jika tidak ada pengguna yang diblacklist
    if (blacklistButtons.length === 0) {
      blacklistButtons.push([{ text: '📝 Tidak ada pengguna dalam daftar hitam', callback_data: `no_action` }]);
    }
    
    // Tambahkan tombol tambah dan kembali
    blacklistButtons.push([{ text: '➕ Tambah ke Daftar Hitam', callback_data: `add_blacklist:${groupId}` }]);
    blacklistButtons.push([{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]);
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🚫 *Daftar Hitam Grup*\n_${group.groupName}_\n\nPengguna dalam daftar hitam tidak dapat mengirim pesan dalam grup. Pilih pengguna untuk melihat detail atau hapus dari daftar hitam:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: blacklistButtons
      }
    });
  } catch (error) {
    console.error('❌ Error mengelola daftar hitam:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk toggle pengaturan
bot.action(/toggle:(.+):(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const setting = ctx.match[2];
    
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    // Toggle pengaturan
    group.settings[setting] = !group.settings[setting];
    await group.save();
    
    // Tentukan ke mana harus kembali
    let returnAction = '';
    
    if (['notifyNewMembers', 'notifyLeftMembers', 'notifyTitleChange', 'notifyPhotoChange', 'notifyPhotoRemoved', 'notifyPinnedMessage', 'notifyVideoChat', 'notifyTimerEnabled', 'notifyTimerDisabled'].includes(setting)) {
      returnAction = `notifications:${groupId}`;
    } else if (['allowPhotos', 'allowVideos', 'allowDocuments', 'allowAudios', 'allowStickers', 'allowGifs', 'allowVoiceMessages', 'allowVideoMessages', 'allowPolls', 'allowLocations', 'allowContacts', 'allowGames', 'allowEmojis', 'allowInlineBots', 'allowUnsupported', 'allowInvoices', 'allowChannelMessages'].includes(setting)) {
      returnAction = `media:${groupId}`;
    } else if (['antiSpam', 'antiBot', 'antiFlood', 'antiLink', 'antiForward', 'antiCommand', 'captchaOnJoin', 'antiRaid', 'antiService'].includes(setting)) {
      returnAction = `protection:${groupId}`;
    } else if (['welcomeEnabled', 'welcomeButtons', 'welcomeDeletePrevious'].includes(setting)) {
      returnAction = `welcome:${groupId}`;
    } else {
      returnAction = `manage_group:${groupId}`;
    }
    
    await ctx.answerCbQuery(`Pengaturan berhasil diubah!`);
    
    // Re-trigger action untuk refresh tampilan
    ctx.match[1] = returnAction;
    return ctx.callbackQuery.data = returnAction;
  } catch (error) {
    console.error('❌ Error toggle pengaturan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk menambahkan pengguna ke blacklist
bot.action(/add_blacklist:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    
    await ctx.answerCbQuery();
    ctx.session.waitingForBlacklist = groupId;
    
    return ctx.editMessageText(`🚫 *Tambah Pengguna ke Daftar Hitam*\n\nSilakan kirim ID pengguna yang ingin ditambahkan ke daftar hitam.\n\nContoh: \`123456789\`\n\nUntuk mendapatkan ID pengguna, gunakan perintah /id dalam grup atau minta pengguna menggunakan perintah /id.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: `blacklist:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error tambah ke daftar hitam:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk menampilkan info dan menghapus pengguna dari blacklist
bot.action(/blacklist_info:(.+):(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const userId = ctx.match[2];
    
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    // Cek apakah pengguna ada di daftar hitam
    if (!group.blacklist.includes(userId)) {
      await ctx.answerCbQuery('Pengguna tidak ada dalam daftar hitam.');
      return ctx.callbackQuery.data = `blacklist:${groupId}`;
    }
    
    // Dapatkan info pengguna
    let userName = userId;
    let userInfo = '';
    
    try {
      const user = await User.findOne({ userId });
      if (user) {
        userName = user.firstName + (user.lastName ? ' ' + user.lastName : '');
        userInfo = `👤 *Nama:* ${userName}\n`;
        if (user.username) userInfo += `🔤 *Username:* @${user.username}\n`;
        userInfo += `🆔 *ID:* \`${userId}\`\n`;
        userInfo += `📅 *Terdaftar Pada:* ${moment(user.createdAt).format('DD MMM YYYY')}\n`;
      }
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    if (!userInfo) {
      userInfo = `🆔 *ID:* \`${userId}\`\n📝 *Catatan:* Pengguna tidak terdaftar dalam database.`;
    }
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🚫 *Informasi Pengguna Daftar Hitam*\n\n${userInfo}\n\nPengguna ini tidak dapat mengirim pesan dalam grup. Semua pesan akan otomatis dihapus.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Hapus dari Daftar Hitam', callback_data: `remove_blacklist:${groupId}:${userId}` }],
          [{ text: '« Kembali', callback_data: `blacklist:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error info daftar hitam:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk menghapus pengguna dari blacklist
bot.action(/remove_blacklist:(.+):(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const userId = ctx.match[2];
    
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    // Cek apakah pengguna ada di daftar hitam
    if (!group.blacklist.includes(userId)) {
      await ctx.answerCbQuery('Pengguna tidak ada dalam daftar hitam.');
      return ctx.callbackQuery.data = `blacklist:${groupId}`;
    }
    
    // Hapus dari daftar hitam
    group.blacklist = group.blacklist.filter(id => id !== userId);
    await group.save();
    
    await ctx.answerCbQuery('Pengguna berhasil dihapus dari daftar hitam!');
    return ctx.callbackQuery.data = `blacklist:${groupId}`;
  } catch (error) {
    console.error('❌ Error hapus dari daftar hitam:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk kembali ke menu utama
bot.action('back_to_main', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    return ctx.editMessageText(`🤖 *Selamat datang di Bot Manajemen Grup!*
    
Saya adalah bot yang akan membantu Anda mengelola dan melindungi grup Telegram Anda dari spam, raid, dan banyak lagi!

⚙️ *Fitur Utama:*
• Anti-spam & anti-flood 
• Blacklist pengguna
• Filter media & kata terlarang
• Perlindungan grup
• Sistem peringatan
• Manajemen anggota

Tambahkan saya ke grup Anda dan jadikan saya admin untuk menggunakan semua fitur!

Tekan tombol di bawah untuk mulai:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Tambah ke Grup', url: `https://t.me/${ctx.botInfo.username}?startgroup=true` },
            { text: '📚 Bantuan', callback_data: 'help' }
          ],
          [
            { text: '🔍 Grup Saya', callback_data: 'my_groups' },
            { text: '👤 Tentang Bot', callback_data: 'about' }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error kembali ke menu utama:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk bantuan
bot.action('help', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const helpMessage = `🛡️ *BANTUAN BOT MANAJEMEN GRUP* 🛡️

*Perintah Dasar:*
/start - Mulai bot
/help - Tampilkan pesan bantuan ini
/id - Dapatkan ID Anda dan ID grup
/settings - Pengaturan grup (admin saja)

*Moderasi:*
/warn [alasan] - Beri peringatan pengguna (balas ke pesan)
/mute [durasi] [alasan] - Bisukan pengguna (balas ke pesan)
/unmute - Batalkan bisukan pengguna (balas ke pesan)
/kick [alasan] - Keluarkan pengguna (balas ke pesan)
/ban [alasan] - Blokir pengguna (balas ke pesan)
/unban [user_id] - Batalkan blokir pengguna

*Blacklist:*
/bl [user_id] - Tambahkan pengguna ke daftar hitam
/unbl [user_id] - Hapus pengguna dari daftar hitam

*Kata Terlarang:*
/addword [kata] - Tambahkan kata terlarang
/rmword [kata] - Hapus kata terlarang
/wordlist - Lihat daftar kata terlarang

*Pengaturan Grup:*
Pengaturan grup dapat dikelola melalui chat pribadi dengan bot. Cukup gunakan perintah /settings atau tekan tombol "Grup Saya" di chat pribadi.

*Catatan:* Hanya admin yang dapat menggunakan perintah moderasi.`;
    
    return ctx.editMessageText(helpMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: 'back_to_main' }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error menampilkan bantuan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk tentang bot
bot.action('about', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    return ctx.editMessageText(`👤 *TENTANG BOT MANAJEMEN GRUP*

🤖 Bot ini adalah alat manajemen grup Telegram yang dapat membantu Anda melindungi dan mengelola grup Anda dengan mudah.

✨ *Fitur Utama:*
• Perlindungan penuh dari spam dan raid
• Filter otomatis untuk link dan kata terlarang
• Deteksi dan penanganan flood
• Manajemen anggota yang komprehensif
• Blacklist pengguna yang mudah
• Sistem peringatan otomatis
• Dan banyak lagi!

💡 *Cara Menggunakan:*
1. Tambahkan bot ke grup Anda
2. Jadikan bot sebagai admin grup
3. Gunakan /settings atau chat pribadi untuk mengelola grup

Bot ini ditujukan untuk membantu admin grup mengelola grup dengan lebih efektif dan menjaga grup tetap bersih dari konten yang tidak diinginkan.

📅 Versi: 1.0.0
🔄 Terakhir diperbarui: ${moment().format('DD MMM YYYY')}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: 'back_to_main' }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error menampilkan tentang bot:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Tambahkan ID pengguna ke daftar hitam
bot.on('text', async (ctx) => {
  // Skip jika tidak dalam mode menunggu blacklist
  if (!ctx.session.waitingForBlacklist) return;
  
  try {
    const groupId = ctx.session.waitingForBlacklist;
    const text = ctx.message.text.trim();
    
    // Reset mode menunggu
    ctx.session.waitingForBlacklist = null;
    
    // Validasi ID pengguna
    if (!/^\d+$/.test(text)) {
      return ctx.reply('❌ ID pengguna tidak valid. Harap masukkan ID numerik.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    const userId = text;
    
    // Temukan grup
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      return ctx.reply('❌ Grup tidak ditemukan.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    // Cek apakah pengguna sudah dalam daftar hitam
    if (group.blacklist.includes(userId)) {
      return ctx.reply(`❌ Pengguna dengan ID ${userId} sudah ada dalam daftar hitam.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Hitam', callback_data: `blacklist:${groupId}` }]
          ]
        },
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    // Tambahkan ke daftar hitam
    group.blacklist.push(userId);
    await group.save();
    
    return ctx.reply(`✅ Pengguna dengan ID ${userId} berhasil ditambahkan ke daftar hitam.\n\nPesan dari pengguna ini akan otomatis dihapus jika dikirim dalam grup.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali ke Daftar Hitam', callback_data: `blacklist:${groupId}` }]
        ]
      },
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error menambahkan ke daftar hitam:', error);
    return ctx.reply('❌ Terjadi kesalahan saat menambahkan pengguna ke daftar hitam. Silakan coba lagi nanti.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
});

// Lanjutan kode bot Telegram

// Perintah warn (peringatan)
bot.command('warn', async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat memberikan peringatan.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah ada reply ke pesan pengguna
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ Balas ke pesan pengguna yang ingin diberi peringatan.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const targetUserId = ctx.message.reply_to_message.from.id;
  
  // Cek apakah target adalah admin
  const targetIsAdmin = await isGroupAdmin(ctx, targetUserId);
  if (targetIsAdmin) {
    return ctx.reply('❌ Tidak dapat memberikan peringatan kepada admin grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Ambil alasan jika ada
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /warn
  const reason = args.length > 0 ? args.join(' ') : 'Tidak ada alasan';
  
  // Berikan peringatan
  await warnUser(ctx, targetUserId, reason);
});

// Perintah mute (bisukan)
bot.command(['mute', 'bisu'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat membisukan pengguna.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah ada reply ke pesan pengguna
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ Balas ke pesan pengguna yang ingin dibisukan.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const targetUserId = ctx.message.reply_to_message.from.id;
  
  // Cek apakah target adalah admin
  const targetIsAdmin = await isGroupAdmin(ctx, targetUserId);
  if (targetIsAdmin) {
    return ctx.reply('❌ Tidak dapat membisukan admin grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse durasi dan alasan
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /mute
  
  let duration = 60; // Default 60 menit
  let reason = 'Tidak ada alasan';
  
  if (args.length > 0) {
    // Coba parse durasi
    const durationArg = args[0].toLowerCase();
    
    if (/^\d+[mhdw]$/.test(durationArg)) {
      // Format seperti 10m, 2h, 1d, 1w
      const value = parseInt(durationArg);
      const unit = durationArg.slice(-1);
      
      switch (unit) {
        case 'm': // menit
          duration = value;
          break;
        case 'h': // jam
          duration = value * 60;
          break;
        case 'd': // hari
          duration = value * 60 * 24;
          break;
        case 'w': // minggu
          duration = value * 60 * 24 * 7;
          break;
      }
      
      args.shift(); // Buang argumen durasi
    } else if (/^\d+$/.test(durationArg)) {
      // Hanya angka, diasumsikan menit
      duration = parseInt(durationArg);
      args.shift(); // Buang argumen durasi
    }
    
    // Sisanya adalah alasan
    if (args.length > 0) {
      reason = args.join(' ');
    }
  }
  
  // Bisukan pengguna
  await muteUser(ctx, targetUserId, duration, reason);
});

// Perintah unmute (batalkan bisukan)
bot.command(['unmute', 'unbisu'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat membatalkan bisukan pengguna.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah ada reply ke pesan pengguna
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ Balas ke pesan pengguna yang ingin dibatalkan bisukannya.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const targetUserId = ctx.message.reply_to_message.from.id;
  
  try {
    // Batalkan bisukan pengguna
    await ctx.telegram.restrictChatMember(ctx.chat.id, targetUserId, {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true
    });
    
    // Ambil info pengguna
    let user;
    try {
      user = await ctx.telegram.getChatMember(ctx.chat.id, targetUserId);
    } catch (error) {
      console.error('❌ Error mendapatkan info pengguna:', error);
    }
    
    const userName = user?.user.first_name || 'Pengguna';
    
    // Kirim notifikasi
    await ctx.reply(`🔊 *${userName} telah dibatalkan bisukannya*\n` +
                   `✅ Pengguna ini sekarang dapat berbicara kembali dalam grup.`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
    
    // Log aktivitas
    await logActivity(ctx, 'user_unmuted', targetUserId);
    
    return true;
  } catch (error) {
    console.error('❌ Error membatalkan bisukan pengguna:', error);
    await ctx.reply(`❌ Gagal membatalkan bisukan pengguna: ${error.message}`, {
      reply_to_message_id: ctx.message.message_id
    });
    return false;
  }
});

// Perintah kick (keluarkan)
bot.command(['kick', 'tendang'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat mengeluarkan pengguna.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah ada reply ke pesan pengguna
  if (!ctx.message.reply_to_message) {
    return ctx.reply('❌ Balas ke pesan pengguna yang ingin dikeluarkan.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const targetUserId = ctx.message.reply_to_message.from.id;
  
  // Cek apakah target adalah admin
  const targetIsAdmin = await isGroupAdmin(ctx, targetUserId);
  if (targetIsAdmin) {
    return ctx.reply('❌ Tidak dapat mengeluarkan admin grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse alasan
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /kick
  const reason = args.length > 0 ? args.join(' ') : 'Tidak ada alasan';
  
  // Keluarkan pengguna
  await kickUser(ctx, targetUserId, reason);
});

// Perintah ban (blokir)
bot.command(['ban', 'blokir'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat memblokir pengguna.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse target dan alasan
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /ban
  
  let targetUserId;
  let reason = 'Tidak ada alasan';
  
  if (ctx.message.reply_to_message) {
    // Jika membalas pesan
    targetUserId = ctx.message.reply_to_message.from.id;
    if (args.length > 0) {
      reason = args.join(' ');
    }
  } else if (args.length > 0 && /^\d+$/.test(args[0])) {
    // Jika ID diberikan sebagai argumen
    targetUserId = args[0];
    args.shift();
    if (args.length > 0) {
      reason = args.join(' ');
    }
  } else {
    return ctx.reply('❌ Balas ke pesan pengguna atau sertakan ID pengguna yang ingin diblokir.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah target adalah admin
  const targetIsAdmin = await isGroupAdmin(ctx, targetUserId);
  if (targetIsAdmin) {
    return ctx.reply('❌ Tidak dapat memblokir admin grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Blokir pengguna
  await banUser(ctx, targetUserId, reason);
});

// Perintah unban (buka blokir)
bot.command(['unban', 'bukablokir'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat membuka blokir pengguna.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse ID target
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /unban
  
  if (args.length === 0 || !/^\d+$/.test(args[0])) {
    return ctx.reply('❌ Masukkan ID pengguna yang ingin dibuka blokirnya.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const targetUserId = args[0];
  
  // Buka blokir pengguna
  await unbanUser(ctx, targetUserId);
});

// Perintah blacklist (daftar hitam)
bot.command(['bl', 'blacklist'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat mengelola daftar hitam.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse target
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /bl
  
  let targetUserId;
  
  if (ctx.message.reply_to_message) {
    // Jika membalas pesan
    targetUserId = ctx.message.reply_to_message.from.id;
  } else if (args.length > 0 && /^\d+$/.test(args[0])) {
    // Jika ID diberikan sebagai argumen
    targetUserId = args[0];
  } else {
    return ctx.reply('❌ Balas ke pesan pengguna atau sertakan ID pengguna yang ingin ditambahkan ke daftar hitam.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah target adalah admin
  const targetIsAdmin = await isGroupAdmin(ctx, targetUserId);
  if (targetIsAdmin) {
    return ctx.reply('❌ Tidak dapat menambahkan admin grup ke daftar hitam.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Temukan grup
  const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
  if (!group) {
    await registerGroup(ctx);
  }
  
  // Update grup
  await Group.updateOne(
    { groupId: ctx.chat.id.toString() },
    { $addToSet: { blacklist: targetUserId.toString() } }
  );
  
  // Log aktivitas
  await logActivity(ctx, 'user_blacklisted', targetUserId);
  
  return ctx.reply(`✅ Pengguna dengan ID \`${targetUserId}\` telah ditambahkan ke daftar hitam.\n\nPesan dari pengguna ini akan otomatis dihapus.`, {
    parse_mode: 'Markdown',
    reply_to_message_id: ctx.message.message_id
  });
});

// Perintah unblacklist (hapus dari daftar hitam)
bot.command(['unbl', 'unblacklist'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat mengelola daftar hitam.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse target
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /unbl
  
  let targetUserId;
  
  if (ctx.message.reply_to_message) {
    // Jika membalas pesan
    targetUserId = ctx.message.reply_to_message.from.id;
  } else if (args.length > 0 && /^\d+$/.test(args[0])) {
    // Jika ID diberikan sebagai argumen
    targetUserId = args[0];
  } else {
    return ctx.reply('❌ Balas ke pesan pengguna atau sertakan ID pengguna yang ingin dihapus dari daftar hitam.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Temukan grup
  const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
  if (!group) {
    return ctx.reply('❌ Grup belum terdaftar dalam database.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna ada dalam daftar hitam
  if (!group.blacklist.includes(targetUserId.toString())) {
    return ctx.reply(`ℹ️ Pengguna dengan ID \`${targetUserId}\` tidak ada dalam daftar hitam.`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Update grup
  await Group.updateOne(
    { groupId: ctx.chat.id.toString() },
    { $pull: { blacklist: targetUserId.toString() } }
  );
  
  // Log aktivitas
  await logActivity(ctx, 'user_unblacklisted', targetUserId);
  
  return ctx.reply(`✅ Pengguna dengan ID \`${targetUserId}\` telah dihapus dari daftar hitam.`, {
    parse_mode: 'Markdown',
    reply_to_message_id: ctx.message.message_id
  });
});

// Perintah tambah kata terlarang
bot.command(['addword', 'tambahkata'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat mengelola kata terlarang.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse kata
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /addword
  
  if (args.length === 0) {
    return ctx.reply('❌ Masukkan kata yang ingin ditambahkan ke daftar kata terlarang.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const word = args.join(' ').toLowerCase();
  
  // Temukan grup
  const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
  if (!group) {
    await registerGroup(ctx);
  }
  
  // Update grup
  await Group.updateOne(
    { groupId: ctx.chat.id.toString() },
    { $addToSet: { blockedWords: word } }
  );
  
  return ctx.reply(`✅ Kata \`${word}\` telah ditambahkan ke daftar kata terlarang.`, {
    parse_mode: 'Markdown',
    reply_to_message_id: ctx.message.message_id
  });
});

// Perintah hapus kata terlarang
bot.command(['rmword', 'hapuskata'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat mengelola kata terlarang.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Parse kata
  const args = ctx.message.text.split(' ');
  args.shift(); // Buang perintah /rmword
  
  if (args.length === 0) {
    return ctx.reply('❌ Masukkan kata yang ingin dihapus dari daftar kata terlarang.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  const word = args.join(' ').toLowerCase();
  
  // Temukan grup
  const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
  if (!group) {
    return ctx.reply('❌ Grup belum terdaftar dalam database.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah kata ada dalam daftar
  if (!group.blockedWords || !group.blockedWords.includes(word)) {
    return ctx.reply(`ℹ️ Kata \`${word}\` tidak ada dalam daftar kata terlarang.`, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Update grup
  await Group.updateOne(
    { groupId: ctx.chat.id.toString() },
    { $pull: { blockedWords: word } }
  );
  
  return ctx.reply(`✅ Kata \`${word}\` telah dihapus dari daftar kata terlarang.`, {
    parse_mode: 'Markdown',
    reply_to_message_id: ctx.message.message_id
  });
});

// Perintah lihat daftar kata terlarang
bot.command(['wordlist', 'daftarkata'], async (ctx) => {
  // Hanya berfungsi di grup
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('❌ Perintah ini hanya dapat digunakan dalam grup.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Cek apakah pengguna adalah admin
  const isAdmin = await isGroupAdmin(ctx, ctx.from.id);
  if (!isAdmin) {
    return ctx.reply('❌ Hanya admin grup yang dapat melihat daftar kata terlarang.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Temukan grup
  const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
  if (!group) {
    return ctx.reply('❌ Grup belum terdaftar dalam database.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  // Buat daftar kata
  if (!group.blockedWords || group.blockedWords.length === 0) {
    return ctx.reply('ℹ️ Tidak ada kata terlarang yang terdaftar untuk grup ini.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
  
  let message = `📝 *Daftar Kata Terlarang*\n\n`;
  group.blockedWords.forEach((word, index) => {
    message += `${index + 1}. \`${word}\`\n`;
  });
  
  message += `\nTotal: ${group.blockedWords.length} kata terlarang`;
  
  return ctx.replyWithMarkdown(message, {
    reply_to_message_id: ctx.message.message_id
  });
});

// Handler pengaturan kata terlarang
bot.action(/blocked_words:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    // Buat daftar kata terlarang (batasi tampilan untuk tampilan awal)
    let wordList = 'Tidak ada kata terlarang yang terdaftar.';
    let totalWords = 0;
    
    if (group.blockedWords && group.blockedWords.length > 0) {
      totalWords = group.blockedWords.length;
      
      // Batasi jumlah kata yang ditampilkan
      const displayWords = group.blockedWords.slice(0, 10);
      wordList = displayWords.map((word, index) => `${index + 1}. \`${word}\``).join('\n');
      
      if (totalWords > 10) {
        wordList += `\n\n_...dan ${totalWords - 10} kata lainnya._`;
      }
    }
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🔤 *Kata Terlarang*\n_${group.groupName}_\n\n${wordList}\n\n*Total:* ${totalWords} kata terlarang`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Tambah Kata', callback_data: `add_word:${groupId}` },
            { text: '🗑️ Hapus Kata', callback_data: `remove_word:${groupId}` }
          ],
          [
            { text: '📋 Lihat Semua', callback_data: `view_all_words:${groupId}` }
          ],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error menampilkan kata terlarang:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk tambah kata terlarang
bot.action(/add_word:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    
    await ctx.answerCbQuery();
    ctx.session.waitingForAddWord = groupId;
    
    return ctx.editMessageText(`🔤 *Tambah Kata Terlarang*\n\nSilakan kirim kata atau frasa yang ingin ditambahkan ke daftar kata terlarang.\n\nContoh: \`kata kasar\`\n\nPesan yang mengandung kata terlarang akan otomatis dihapus.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: `blocked_words:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error tambah kata terlarang:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk hapus kata terlarang
bot.action(/remove_word:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    
    await ctx.answerCbQuery();
    ctx.session.waitingForRemoveWord = groupId;
    
    return ctx.editMessageText(`🔤 *Hapus Kata Terlarang*\n\nSilakan kirim kata atau frasa yang ingin dihapus dari daftar kata terlarang.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: `blocked_words:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error hapus kata terlarang:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk lihat semua kata terlarang
bot.action(/view_all_words:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    // Buat daftar kata terlarang lengkap
    let wordList = 'Tidak ada kata terlarang yang terdaftar.';
    let totalWords = 0;
    
    if (group.blockedWords && group.blockedWords.length > 0) {
      totalWords = group.blockedWords.length;
      wordList = group.blockedWords.map((word, index) => `${index + 1}. \`${word}\``).join('\n');
    }
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`📋 *Semua Kata Terlarang*\n_${group.groupName}_\n\n${wordList}\n\n*Total:* ${totalWords} kata terlarang`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: `blocked_words:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error menampilkan semua kata terlarang:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler pengaturan penyambutan
bot.action(/welcome:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    const settings = group.settings;
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`👋 *Pengaturan Penyambutan*\n_${group.groupName}_\n\nKostumisasi cara bot menyambut anggota baru:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: `${settings.welcomeEnabled ? '✅' : '❌'} Pesan Sambutan`, callback_data: `toggle:${groupId}:welcomeEnabled` }],
          [{ text: '✏️ Edit Pesan Sambutan', callback_data: `edit_welcome:${groupId}` }],
          [{ text: `${settings.welcomeButtons ? '✅' : '❌'} Tombol Sambutan`, callback_data: `toggle:${groupId}:welcomeButtons` }],
          [{ text: `${settings.welcomeDeletePrevious ? '✅' : '❌'} Hapus Sambutan Sebelumnya`, callback_data: `toggle:${groupId}:welcomeDeletePrevious` }],
          [{ text: '👁️ Pratinjau Pesan Sambutan', callback_data: `preview_welcome:${groupId}` }],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pengaturan penyambutan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk edit pesan sambutan
bot.action(/edit_welcome:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    await ctx.answerCbQuery();
    ctx.session.waitingForWelcome = groupId;
    
    return ctx.editMessageText(`✏️ *Edit Pesan Sambutan*\n\nSilakan kirim pesan sambutan baru. Anda dapat menggunakan placeholder berikut:\n\n\`{user}\` - Nama pengguna\n\`{group}\` - Nama grup\n\`{id}\` - ID pengguna\n\`{count}\` - Jumlah anggota grup\n\nPesan sambutan saat ini:\n\n\`${group.settings.welcomeMessage}\``, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: `welcome:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error edit pesan sambutan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk pratinjau pesan sambutan
bot.action(/preview_welcome:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    // Ganti placeholder dengan nilai contoh
    let message = group.settings.welcomeMessage
      .replace('{user}', ctx.from.first_name)
      .replace('{group}', group.groupName)
      .replace('{id}', ctx.from.id)
      .replace('{count}', '123');
    
    // Siapkan tombol jika fitur tombol diaktifkan
    let buttons = [];
    if (group.settings.welcomeButtons) {
      buttons = [
        [
          { text: '📚 Aturan Grup', callback_data: 'preview_rules' },
          { text: '👮‍♂️ Admin', callback_data: 'preview_admins' }
        ]
      ];
    }
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`*Pratinjau Pesan Sambutan*\n\n${message}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          ...(buttons.length > 0 ? buttons : []),
          [{ text: '« Kembali', callback_data: `welcome:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pratinjau pesan sambutan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk aksi preview
bot.action(['preview_rules', 'preview_admins'], async (ctx) => {
  await ctx.answerCbQuery('Ini hanya pratinjau tombol');
});

// Handler untuk menambahkan kata terlarang
bot.on('text', async (ctx, next) => {
  if (ctx.session.waitingForAddWord) {
    try {
      const groupId = ctx.session.waitingForAddWord;
      const word = ctx.message.text.trim().toLowerCase();
      
      // Reset session
      ctx.session.waitingForAddWord = null;
      
      // Temukan grup
      const group = await Group.findOne({ groupId });
      if (!group) {
        return ctx.reply('❌ Grup tidak ditemukan.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Cek apakah kata sudah ada dalam daftar
      if (group.blockedWords && group.blockedWords.includes(word)) {
        return ctx.reply(`ℹ️ Kata \`${word}\` sudah ada dalam daftar kata terlarang.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '« Kembali ke Daftar Kata', callback_data: `blocked_words:${groupId}` }]
            ]
          },
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Tambahkan kata ke daftar
      if (!group.blockedWords) {
        group.blockedWords = [];
      }
      
      group.blockedWords.push(word);
      await group.save();
      
      return ctx.reply(`✅ Kata \`${word}\` telah ditambahkan ke daftar kata terlarang.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Kata', callback_data: `blocked_words:${groupId}` }]
          ]
        },
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('❌ Error menambahkan kata terlarang:', error);
      return ctx.reply('❌ Terjadi kesalahan saat menambahkan kata terlarang. Silakan coba lagi nanti.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  } else if (ctx.session.waitingForRemoveWord) {
    try {
      const groupId = ctx.session.waitingForRemoveWord;
      const word = ctx.message.text.trim().toLowerCase();
      
      // Reset session
      ctx.session.waitingForRemoveWord = null;
      
      // Temukan grup
      const group = await Group.findOne({ groupId });
      if (!group) {
        return ctx.reply('❌ Grup tidak ditemukan.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Cek apakah kata ada dalam daftar
      if (!group.blockedWords || !group.blockedWords.includes(word)) {
        return ctx.reply(`ℹ️ Kata \`${word}\` tidak ditemukan dalam daftar kata terlarang.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '« Kembali ke Daftar Kata', callback_data: `blocked_words:${groupId}` }]
            ]
          },
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Hapus kata dari daftar
      group.blockedWords = group.blockedWords.filter(w => w !== word);
      await group.save();
      
      return ctx.reply(`✅ Kata \`${word}\` telah dihapus dari daftar kata terlarang.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali ke Daftar Kata', callback_data: `blocked_words:${groupId}` }]
          ]
        },
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('❌ Error menghapus kata terlarang:', error);
      return ctx.reply('❌ Terjadi kesalahan saat menghapus kata terlarang. Silakan coba lagi nanti.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  } else if (ctx.session.waitingForWelcome) {
    try {
      const groupId = ctx.session.waitingForWelcome;
      const welcomeMessage = ctx.message.text.trim();
      
      // Reset session
      ctx.session.waitingForWelcome = null;
      
      // Temukan grup
      const group = await Group.findOne({ groupId });
      if (!group) {
        return ctx.reply('❌ Grup tidak ditemukan.', {
          reply_to_message_id: ctx.message.message_id
        });
      }
      
      // Update pesan sambutan
      group.settings.welcomeMessage = welcomeMessage;
      await group.save();
      
      return ctx.reply('✅ Pesan sambutan telah diperbarui.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '👁️ Pratinjau', callback_data: `preview_welcome:${groupId}` }],
            [{ text: '« Kembali ke Pengaturan Penyambutan', callback_data: `welcome:${groupId}` }]
          ]
        },
        reply_to_message_id: ctx.message.message_id
      });
    } catch (error) {
      console.error('❌ Error memperbarui pesan sambutan:', error);
      return ctx.reply('❌ Terjadi kesalahan saat memperbarui pesan sambutan. Silakan coba lagi nanti.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
  } else {
    return next();
  }
});

// Handler ketika bot ditambahkan ke grup
bot.on('new_chat_members', async (ctx) => {
  try {
    // Cek apakah bot sendiri yang ditambahkan
    const botWasAdded = ctx.message.new_chat_members.some(member => member.id === ctx.botInfo.id);
    
    if (botWasAdded) {
      // Bot ditambahkan ke grup, daftarkan grup dan kirim pesan sambutan
      const group = await registerGroup(ctx);
      
      // Catat pemilik grup (pengguna yang menambahkan bot)
      if (group) {
        group.ownerId = ctx.from.id.toString();
        await group.save();
      }
      
      return ctx.replyWithMarkdown(`👋 *Hai! Saya adalah Bot Manajemen Grup.*

Saya telah ditambahkan ke grup ini. Untuk menggunakan semua fitur, tolong jadikan saya admin dengan izin:
• Hapus pesan
• Blokir pengguna
• Tambah anggota baru

*Catatan:* Hanya pengguna yang menambahkan saya (${ctx.from.first_name}) dan admin grup yang dapat mengatur bot melalui chat pribadi.

Gunakan /help untuk melihat perintah yang tersedia.`, {
        reply_to_message_id: ctx.message.message_id
      });
    } else {
      // Pengguna baru bergabung, tangani penyambutan
      const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
      
      if (!group || !group.settings.welcomeEnabled) return;
      
      // Deteksi bot jika pengaturan anti-bot diaktifkan
      for (const member of ctx.message.new_chat_members) {
        if (member.is_bot && group.settings.antiBot) {
          await detectNewBot(ctx, member);
          return; // Jika bot terdeteksi dan dikeluarkan, jangan lanjutkan penyambutan
        }
      }
      
      // Tangani captcha jika diaktifkan
      if (group.settings.captchaOnJoin) {
        // Implementasi captcha akan ditangani di fungsi terpisah
        // TODO: Implementasi captcha
      }
      
      // Siapkan pesan sambutan
      const memberCount = await ctx.telegram.getChatMembersCount(ctx.chat.id);
      
      for (const member of ctx.message.new_chat_members) {
        if (!member.is_bot) { // Jangan sambut bot
          let welcomeMessage = group.settings.welcomeMessage
            .replace('{user}', member.first_name)
            .replace('{group}', ctx.chat.title)
            .replace('{id}', member.id)
            .replace('{count}', memberCount.toString());
          
          // Tambahkan tombol jika diaktifkan
          let buttons = [];
          if (group.settings.welcomeButtons) {
            buttons = [
              [
                { text: '📚 Aturan Grup', callback_data: `rules:${ctx.chat.id}` },
                { text: '👮‍♂️ Admin', callback_data: `chat_admins:${ctx.chat.id}` }
              ]
            ];
          }
          
          await ctx.replyWithMarkdown(welcomeMessage, {
            reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined,
            reply_to_message_id: ctx.message.message_id
          });
        }
      }
    }
  } catch (error) {
    console.error('❌ Error menangani anggota baru:', error);
  }
});

// Handler para pengguna yang keluar grup
bot.on('left_chat_member', async (ctx) => {
  try {
    // Cek apakah bot sendiri yang dikeluarkan
    const botWasRemoved = ctx.message.left_chat_member.id === ctx.botInfo.id;
    
    if (botWasRemoved) {
      // Dapatkan info grup sebelum dihapus
      const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
      
      if (group && group.ownerId) {
        // Kirim notifikasi ke pengguna yang menambahkan bot
        try {
          await bot.telegram.sendMessage(group.ownerId, 
            `⚠️ *Pemberitahuan Penting*\n\nBot telah dikeluarkan dari grup *${ctx.chat.title}*. Grup ini telah dihapus dari daftar "Grup Saya".`, 
            { parse_mode: 'Markdown' });
        } catch (notifyError) {
          console.log(`Tidak dapat mengirim notifikasi ke pemilik grup: ${notifyError.message}`);
        }
      }
      
      // Hapus data grup dari database
      await Group.deleteOne({ groupId: ctx.chat.id.toString() });
      console.log(`✅ Bot dikeluarkan dari grup ${ctx.chat.title}, data grup dihapus.`);
      return;
    }
    
    // Anggota keluar grup, kirim notifikasi jika diaktifkan
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    
    if (!group || !group.settings.notifyLeftMembers) return;
    
    await ctx.replyWithMarkdown(`👋 *${ctx.message.left_chat_member.first_name}* telah meninggalkan grup.`, {
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error menangani anggota keluar:', error);
  }
});

// Handler untuk perubahan judul grup
bot.on('new_chat_title', async (ctx) => {
  try {
    // Update nama grup dalam database
    await Group.updateOne(
      { groupId: ctx.chat.id.toString() },
      { $set: { groupName: ctx.chat.title } }
    );
    
    // Kirim notifikasi jika diaktifkan
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    
    if (!group || !group.settings.notifyTitleChange) return;
    
    await ctx.replyWithMarkdown(`📝 Judul grup telah diubah menjadi:\n*${ctx.chat.title}*`, {
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error menangani perubahan judul:', error);
  }
});

// Handler untuk perubahan foto grup
bot.on('new_chat_photo', async (ctx) => {
  try {
    // Kirim notifikasi jika diaktifkan
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    
    if (!group || !group.settings.notifyPhotoChange) return;
    
    await ctx.replyWithMarkdown(`🖼 Foto grup telah diubah.`, {
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error menangani perubahan foto:', error);
  }
});

// Handler untuk penghapusan foto grup
bot.on('delete_chat_photo', async (ctx) => {
  try {
    // Kirim notifikasi jika diaktifkan
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    
    if (!group || !group.settings.notifyPhotoRemoved) return;
    
    await ctx.replyWithMarkdown(`🗑 Foto grup telah dihapus.`, {
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error menangani penghapusan foto:', error);
  }
});

// Handler untuk pesan yang disematkan
bot.on('pinned_message', async (ctx) => {
  try {
    // Kirim notifikasi jika diaktifkan
    const group = await Group.findOne({ groupId: ctx.chat.id.toString() });
    
    if (!group || !group.settings.notifyPinnedMessage) return;
    
    let pinnedContent = 'Tidak ada konten';
    
    if (ctx.message.pinned_message.text) {
      pinnedContent = ctx.message.pinned_message.text.substring(0, 50) + 
        (ctx.message.pinned_message.text.length > 50 ? '...' : '');
    } else if (ctx.message.pinned_message.photo) {
      pinnedContent = 'Foto';
    } else if (ctx.message.pinned_message.video) {
      pinnedContent = 'Video';
    } else if (ctx.message.pinned_message.document) {
      pinnedContent = 'Dokumen';
    } else if (ctx.message.pinned_message.audio) {
      pinnedContent = 'Audio';
    } else if (ctx.message.pinned_message.voice) {
      pinnedContent = 'Pesan Suara';
    } else if (ctx.message.pinned_message.sticker) {
      pinnedContent = 'Stiker';
    }
    
    await ctx.replyWithMarkdown(`📌 Pesan telah disematkan oleh *${ctx.from.first_name}*\n\n*Konten:* ${pinnedContent}`, {
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error menangani pesan disematkan:', error);
  }
});

// Handler aturan grup
bot.action(/rules:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    await ctx.answerCbQuery();
    
    return ctx.replyWithMarkdown(`📚 *ATURAN GRUP*\n\n${group.settings.rulesText || 'Belum ada aturan yang ditetapkan untuk grup ini.'}`);
  } catch (error) {
    console.error('❌ Error menampilkan aturan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler daftar admin grup
bot.action(/chat_admins:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    
    try {
      const adminMembers = await ctx.telegram.getChatAdministrators(groupId);
      
      let adminText = `👮‍♂️ *DAFTAR ADMIN GRUP*\n\n`;
      
      for (const admin of adminMembers) {
        const name = admin.user.first_name + (admin.user.last_name ? ' ' + admin.user.last_name : '');
        const username = admin.user.username ? '@' + admin.user.username : 'Tidak ada username';
        const status = admin.status === 'creator' ? '👑 Pemilik' : '👮‍♂️ Admin';
        
        adminText += `*${name}*\n`;
        adminText += `${status}\n`;
        adminText += `Username: ${username}\n\n`;
      }
      
      await ctx.answerCbQuery();
      
      return ctx.replyWithMarkdown(adminText);
    } catch (error) {
      console.error('❌ Error mendapatkan daftar admin:', error);
      await ctx.answerCbQuery('Tidak dapat mengambil daftar admin.');
    }
  } catch (error) {
    console.error('❌ Error menampilkan admin:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk pengaturan aturan
bot.action(/rules:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return ctx.editMessageText('❌ Grup tidak ditemukan.', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '« Kembali', callback_data: 'my_groups' }]
          ]
        }
      });
    }
    
    await ctx.answerCbQuery();
    return ctx.editMessageText(`📝 *Aturan Grup*\n_${group.groupName}_\n\n${group.settings.rulesText || 'Belum ada aturan yang ditetapkan untuk grup ini.'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Edit Aturan', callback_data: `edit_rules:${groupId}` }],
          [{ text: '« Kembali', callback_data: `manage_group:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error pengaturan aturan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk edit aturan
bot.action(/edit_rules:(.+)/, async (ctx) => {
  try {
    const groupId = ctx.match[1];
    const group = await Group.findOne({ groupId });
    
    if (!group) {
      await ctx.answerCbQuery('Grup tidak ditemukan.');
      return;
    }
    
    await ctx.answerCbQuery();
    ctx.session.waitingForRules = groupId;
    
    return ctx.editMessageText(`✏️ *Edit Aturan Grup*\n\nSilakan kirim aturan baru untuk grup ini. Anda dapat menggunakan format Markdown untuk mempercantik teks.\n\nAturan saat ini:\n\n${group.settings.rulesText || 'Belum ada aturan yang ditetapkan.'}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '« Kembali', callback_data: `rules:${groupId}` }]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error edit aturan:', error);
    await ctx.answerCbQuery('Terjadi kesalahan. Coba lagi nanti.');
  }
});

// Handler untuk memperbarui aturan
bot.on('text', async (ctx, next) => {
  if (!ctx.session.waitingForRules) return next();
  
  try {
    const groupId = ctx.session.waitingForRules;
    const rulesText = ctx.message.text.trim();
    
    // Reset session
    ctx.session.waitingForRules = null;
    
    // Temukan grup
    const group = await Group.findOne({ groupId });
    if (!group) {
      return ctx.reply('❌ Grup tidak ditemukan.', {
        reply_to_message_id: ctx.message.message_id
      });
    }
    
    // Update aturan
    group.settings.rulesText = rulesText;
    await group.save();
    
    return ctx.reply('✅ Aturan grup telah diperbarui.', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '👁️ Lihat Aturan', callback_data: `rules:${groupId}` }]
        ]
      },
      reply_to_message_id: ctx.message.message_id
    });
  } catch (error) {
    console.error('❌ Error memperbarui aturan:', error);
    return ctx.reply('❌ Terjadi kesalahan saat memperbarui aturan. Silakan coba lagi nanti.', {
      reply_to_message_id: ctx.message.message_id
    });
  }
});

// Start the bot
bot.launch()
  .then(() => {
    console.log(`✅ Bot berhasil dimulai! @${bot.botInfo.username}`);
  })
  .catch(err => {
    console.error('❌ Error memulai bot:', err);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
