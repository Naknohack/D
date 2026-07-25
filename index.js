const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType,
  ActivityType,
  AuditLogEvent,
  
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let Tesseract = null;
try {
  Tesseract = require("tesseract.js");
} catch {}

// ===================== CONFIG =====================
const TOKEN = process.env.DISCORD_TOKEN || "thay token";
const CLIENT_ID = "1471438810121375865";

const OWNER_IDS = ["1020868400672686080"];
const allowedUsers = ["1020868400672686080"];

// ===================== MULTI-SERVER CONFIG DATABASE =====================
const GUILD_CONFIG_FILE = "guild_configs.json";
let guildConfigs = {};

// Tự động đọc file cấu hình server nếu có
if (fs.existsSync(GUILD_CONFIG_FILE)) {
  try {
    guildConfigs = JSON.parse(fs.readFileSync(GUILD_CONFIG_FILE, "utf8"));
  } catch {
    guildConfigs = {};
  }
}

// ===================== BANNED SERVERS DATABASE =====================
const BANNED_SERVERS_FILE = "banned_servers.json";
let bannedServers = {};

// Tự động đọc file và dọn dẹp các server bị ban quá 30 ngày
if (fs.existsSync(BANNED_SERVERS_FILE)) {
  try {
    bannedServers = JSON.parse(fs.readFileSync(BANNED_SERVERS_FILE, "utf8"));
    const now = Date.now();
    let changed = false;
    
    for (const guildId in bannedServers) {
      // 30 ngày = 30 * 24 * 60 * 60 * 1000 milliseconds
      if (now - bannedServers[guildId].timestamp > 30 * 24 * 60 * 60 * 1000) {
        delete bannedServers[guildId];
        changed = true;
      }
    }
    
    // Nếu có dọn dẹp thì lưu lại file cho nhẹ
    if (changed) {
      fs.writeFileSync(BANNED_SERVERS_FILE, JSON.stringify(bannedServers, null, 2));
    }
  } catch {
    bannedServers = {};
  }
}

// Hàm lưu trữ data ban
function saveBannedServers() {
  fs.writeFileSync(BANNED_SERVERS_FILE, JSON.stringify(bannedServers, null, 2));
}

// Hàm lưu file cấu hình server
function saveGuildConfigs() {
  fs.writeFileSync(GUILD_CONFIG_FILE, JSON.stringify(guildConfigs, null, 2));
}

// Hàm bổ trợ lấy cấu hình riêng biệt của từng server
function getGuildConfig(guildId) {
  if (!guildConfigs[guildId]) {
    guildConfigs[guildId] = {
      allowedKeyChannels: [], // Kênh được gõ key của server này
      logChannels: [],        // Kênh nhận nhật ký log của server này
      videoConfig: {
        enabled: true,                                   // Bật/tắt tự động tải video toàn server
        platforms: ["tiktok", "facebook", "instagram"],  // YouTube KHÔNG tải mặc định vì Discord tự embed xem được
        allowedChannels: []                              // Rỗng = áp dụng ở mọi kênh. Có ID = chỉ áp dụng ở các kênh này
      },
      // Cấu hình Automod chống spam, tách riêng theo từng loại (câu cố định / emoji / ảnh)
      // để mỗi loại có thể bật/tắt, chỉnh thời gian timeout và kênh thông báo riêng.
      automodConfig: {
        fixedMessage: { enabled: false, timeoutMinutes: 10, channelId: null },
        emojiSpam: { enabled: false, timeoutMinutes: 10, channelId: null },
        imageSpam: { enabled: false, timeoutMinutes: 10, channelId: null },
        mentionSpam: { enabled: false, timeoutMinutes: 10, channelId: null },
        exemptChannels: [] // Danh sách ID kênh KHÔNG bị Automod lọc (lệnh /thechannelwasnotcensored)
      },
      // Cấu hình giám sát server (lệnh /editing-log) - ghi lại toàn bộ hoạt động vào 1 kênh chỉ định.
      auditLogConfig: { enabled: false, channelId: null }
    };
  }
  // Vá cấu hình cũ (server đã tồn tại trước khi có tính năng video) để không bị lỗi undefined
  if (!guildConfigs[guildId].videoConfig) {
    guildConfigs[guildId].videoConfig = {
      enabled: true,
      platforms: ["tiktok", "facebook", "instagram"],
      allowedChannels: []
    };
  }
  // Vá cấu hình cũ (server đã tồn tại trước khi có tính năng automod) để không bị lỗi undefined
  if (!guildConfigs[guildId].automodConfig) {
    guildConfigs[guildId].automodConfig = {
      fixedMessage: { enabled: false, timeoutMinutes: 10, channelId: null },
      emojiSpam: { enabled: false, timeoutMinutes: 10, channelId: null },
      imageSpam: { enabled: false, timeoutMinutes: 10, channelId: null },
      mentionSpam: { enabled: false, timeoutMinutes: 10, channelId: null },
      exemptChannels: []
    };
  }
  // Vá riêng cho server đã có automodConfig từ TRƯỚC khi có tính năng Spam Tag (mentionSpam)
  // để tránh lỗi "Cannot set property 'enabled' of undefined" khi bật /automod hanh_dong: mention
  if (!guildConfigs[guildId].automodConfig.mentionSpam) {
    guildConfigs[guildId].automodConfig.mentionSpam = { enabled: false, timeoutMinutes: 10, channelId: null };
  }
  // Vá cấu hình cũ chưa có danh sách kênh được MIỄN Automod (tính năng /thechannelwasnotcensored)
  if (!guildConfigs[guildId].automodConfig.exemptChannels) {
    guildConfigs[guildId].automodConfig.exemptChannels = [];
  }
  // Vá cấu hình cũ (server đã tồn tại trước khi có tính năng giám sát) để không bị lỗi undefined
  if (!guildConfigs[guildId].auditLogConfig) {
    guildConfigs[guildId].auditLogConfig = { enabled: false, channelId: null };
  }
  return guildConfigs[guildId];
}

const TIMEOUT_MS = 5 * 24 * 60 * 60 * 1000;

// ===================== TEMPLATES CONFIG =====================
// Mẫu mặc định cũ (ID: 1020868400672686080)
const TEMPLATE_OLD = [
 {
    name: "Setup-bot",
    type: "category",
    children: [
      { name: "✧₊˚🤖-𝙎𝙚𝙩𝙪𝙥-𝙗𝙤𝙩-₊˚✧", type: "text" },
      { name: "✧₊˚✧₊˚𝘼𝙪𝙩𝙤-𝙈𝙊𝘿-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊👋𝙬𝙚𝙡𝙘𝙤𝙢𝙚₊˚✧",
    type: "category",
    children: [
      { name: "✧₊👋𝙬𝙚𝙡𝙘𝙤𝙢𝙚₊˚✧", type: "text" },
      { name: "✧₊𝙍𝙪𝙡𝙚₊˚✧", type: "text" },
      { name: "✧₊˚🚀𝘽𝙤𝙤𝙨𝙩-𝙨𝙚𝙫𝙚𝙧₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚📢𝘼𝙣𝙤𝙪𝙣𝙘𝙚₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚📢𝙉𝙤𝙩𝙞𝙛𝙞𝙘𝙖𝙩𝙞𝙤𝙣₊˚✧", type: "text" },
      { name: "✧₊˚🚨𝙍𝙚𝙥𝙤𝙧𝙩₊˚✧", type: "text" },
      { name: "✧₊˚🆙-𝙇𝙚𝙫𝙚𝙡-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚🌎𝘾𝙝𝙖𝙩-₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚🇻🇳𝘾𝙝𝙖𝙩𝙑𝙉₊˚✧", type: "text" },
      { name: "✧₊˚🇬🇧-𝘾𝙝𝙖𝙩-𝙀𝙣𝙜𝙡𝙞𝙨𝙝-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚🎉𝙂𝙞𝙫𝙚 𝙖𝙬𝙖𝙮₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚🎉𝙂𝙞𝙫𝙚 𝙖𝙬𝙖𝙮₊˚✧", type: "text" },
      { name: "✧₊˚🥳𝘿𝙤𝙣𝙚-𝙂𝙞𝙫𝙚-𝙖𝙬𝙖𝙮₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚🤖-𝘽𝙤𝙩-₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚📋-𝙆𝙝𝙤-𝙎𝙘𝙧𝙞𝙥𝙩₊˚✧", type: "text" },
      { name: "✧₊˚🤖-𝘾𝙝𝙖𝙩-𝘽𝙤𝙩-𝙎𝙘𝙧𝙞𝙥𝙩-₊˚✧", type: "text" },
      { name: "✧₊˚🤖-𝘽𝙮𝙥𝙖𝙨𝙨-𝙠𝙚𝙮-₊˚✧", type: "text" },
      { name: "share-script", type: "forum" }
    ]
  },
  {
    name: "✧₊˚📱𝘾𝙡𝙚𝙣𝙩 𝙖𝙣𝙙𝙧𝙤𝙞𝙙-₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚🇻🇳𝘿𝙚𝙡𝙩𝙖-𝙑𝙉𝙂-₊˚✧", type: "text" },
      { name: "✧₊˚🇻🇳𝘿𝙚𝙡𝙩𝙖-𝙑𝙉𝙂-𝙁𝙞𝙭𝙡𝙖𝙜-₊˚✧", type: "text" },
      { name: "✧₊˚🇻🇳𝘼𝙧𝙘𝙚𝙪𝙨-𝙑𝙉𝙂-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚🍎 𝘾𝙡𝙚𝙣𝙩 𝙄𝙊𝙎₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚🇻🇳𝘿𝙚𝙡𝙩𝙖-𝙑𝙉𝙂-₊˚✧", type: "text" },
    ]
  },
  {
    name: "🖥️ PC",
    type: "category",
    children: [
      { name: "✧₊˚💻-𝘾𝙡𝙚𝙣𝙩-𝙒𝙞𝙣𝙙𝙤𝙬₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚💻-𝙃𝙖𝙘𝙠 𝙇𝙌-₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚📱-𝙃𝙖𝙘𝙠-𝙇𝙌-𝘼𝙣𝙙𝙧𝙤𝙞𝙙-𝟲𝟰𝘽𝙞𝙩-₊˚✧", type: "text" },
      { name: "✧₊˚📱-𝙃𝙖𝙘𝙠-𝙇𝙌-𝘼𝙣𝙙𝙧𝙤𝙞𝙙-𝟯𝟮𝘽𝙞𝙩-₊˚✧", type: "text" },
      { name: "✧₊˚🍎-𝙃𝙖𝙘𝙠-𝙇𝙌-𝙄𝙊𝙎-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚🔥-𝙃𝙖𝙘𝙠 𝙁𝙁 𝙄𝙊𝙎 -₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚🔥-𝙃𝙖𝙘𝙠-𝙁𝙁-𝙄𝙊𝙎-𝙄𝙋𝘼-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊˚📽️𝙑𝙞𝙙𝙚𝙤𝙨₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚🎥-𝙏𝙞𝙠𝙩𝙤𝙠₊˚✧", type: "text" },
      { name: "✧₊˚🎥-𝙔𝙤𝙪𝙩𝙪𝙗𝙚₊˚✧", type: "text" }
    ]
  },
  {
    name: "BF Notify",
    type: "category",
    children: [
      { name: "✧₊˚🍌-𝙎𝙩𝙤𝙘𝙠-𝙁𝙧𝙪𝙞𝙩𝙨-₊˚✧", type: "text" }
    ]
  },
  {
    name: "✧₊📁𝙇𝙞𝙣𝙝 𝙏𝙞𝙣𝙝₊˚✧",
    type: "category",
    children: [
      { name: "✧₊˚📺-𝙔𝙤𝙪𝙏𝙪𝙗𝙚-𝙋𝙧𝙚𝙢𝙞𝙪𝙢-𝙈𝙤𝙙₊˚✧", type: "text" },
      { name: "✧₊˚🎞️-𝘾𝙖𝙥𝘾𝙪𝙩-𝙋𝙧𝙚𝙢𝙞𝙪𝙢-𝙈𝙤𝙙₊˚✧", type: "text" },
      { name: "✧₊˚🎬-𝙉𝙚𝙩𝙛𝙡𝙞𝙭-𝙋𝙧𝙚𝙢𝙞𝙪𝙢-𝙈𝙤𝙙₊˚✧", type: "text" },
      { name: "✧₊˚🤖-𝘾𝙝𝙖𝙩𝙂𝙋𝙏-𝙋𝙧𝙚𝙢𝙞𝙪𝙢-𝙈𝙤𝙙₊˚✧", type: "text" },
      { name: "✧₊˚⛏️-𝙈𝙞𝙣𝙚𝙘𝙧𝙖𝙛𝙩-𝙈𝙤𝙙₊˚✧", type: "text" }
    ]
  },
  {
    name: "Thoại",
    type: "category",
    children: [
      { name: "Chung", type: "voice" },
      { name: "Chung", type: "voice" }
    ]
  }
];

// Mẫu danh mục kênh mới (ID: 1427887770298486899)
const TEMPLATE_NEW = [
  {
    name: "✧₊˚👋 𝗛𝗲𝗹𝗹𝗼 ˚₊✧",
    type: "category",
    children: [
      { name: "🚪-𝗚𝗮𝘁𝗲", type: "text" },
      { name: "👋-𝗪𝗲𝗹𝗰𝗼𝗺𝗲", type: "text" }
    ]
  },
  {
    name: "✧₊˚📢 𝗧𝗵𝗼̂𝗻𝗴 𝗕𝗮́𝗼 ˚₊✧",
    type: "category",
    children: [
      { name: "📢-𝗡𝗼𝘁𝗶𝗳𝗶𝗰𝗮𝘁𝗶𝗼𝗻", type: "text" },
      { name: "🎥-𝗡𝗲𝘄-𝗩𝗶𝗱𝗲𝗼", type: "text" },
      { name: "💠-𝗚𝗲𝘁-𝗥𝗼𝗹𝗲", type: "text" },
      { name: "⏱️-𝗧𝘂𝘆𝗲̂̉𝗻-𝗡𝗵𝗮̂𝗻-𝗩𝗶𝗲̂𝗻", type: "text" },
      { name: "🚨-𝗟𝗼𝗴-𝗩𝗶-𝗣𝗵𝗮̣𝗺", type: "text" },
      { name: "💡-𝗟𝗲𝘃𝗲𝗹-𝗨𝗽", type: "text" },
      { name: "🎊-𝗧𝗵𝗼̂𝗻𝗴-𝗕𝗮́𝗼-𝗕𝗼𝗼𝘀𝘁𝗶𝗻𝗴", type: "text" },
      { name: "⚓-𝗟𝗲𝗮𝗱𝗲𝗿𝗯𝗼𝗮𝗿𝗱", type: "text" }
    ]
  },
  {
    name: "✧₊˚💬 𝗖𝗵𝗮𝘁 ˚₊✧",
    type: "category",
    children: [
      { name: "🌍-𝗖𝗵𝗮𝘁-𝗚𝗹𝗼𝗯𝗮𝗹", type: "text" },
      { name: "💬-𝗖𝗵𝗮𝘁-𝗩𝗶𝗲𝘁𝗻𝗮𝗺", type: "text" },
      { name: "💬-𝗖𝗵𝗮𝘁-𝗘𝗻𝗴𝗹𝗶𝘀𝗵", type: "text" }
    ]
  },
  {
    name: "✧₊˚🎉 𝗤𝘂𝗮̀ 𝗧𝗮̣̆𝗻𝗴 ˚₊✧",
    type: "category",
    children: [
      { name: "🎉-𝗚𝗶𝘃𝗲𝗮𝘄𝗮𝘆", type: "text" },
      { name: "💸-𝗗𝗼𝗻𝗲-𝗚𝗶𝘃𝗲𝗮𝘄𝗮𝘆", type: "text" }
    ]
  },
  {
    name: "✧₊˚🎫 𝗧𝗶𝗰𝗸𝗲𝘁 ˚₊✧",
    type: "category",
    children: [
      { name: "🎫-𝗧𝗮̣𝗼-𝗧𝗶𝗰𝗸𝗲𝘁-𝗖𝗮̀𝘆-𝗧𝗵𝘂𝗲̂", type: "text" }
    ]
  },
  {
    name: "✧₊˚🤖 𝗦𝗰𝗿𝗶𝗽𝘁-𝗛𝗮𝗰𝗸 ˚₊✧",
    type: "category",
    children: [
      { name: "🎮-𝗦𝗰𝗿𝗶𝗽𝘁", type: "text" },
      { name: "🧑‍💻-𝗦𝗰𝗿𝗶𝗽𝘁-𝗔𝗹𝗹-𝗚𝗮𝗺𝗲", type: "text" },
      { name: "🥶-𝗖𝗵𝗮𝘁-𝗦𝗰𝗿𝗶𝗽𝘁", type: "text" },
      { name: "🔑-𝗕𝘆𝗽𝗮𝘀𝘀-𝗞𝗲𝘆", type: "text" },
      { name: "🤖-𝗕𝗼𝘁-𝗖𝗠𝗗", type: "text" },
      { name: "✔️-𝗟𝗲̣̂𝗻𝗵-𝗖𝗵𝗮𝘁-𝗕𝗼𝘁", type: "text" }
    ]
  },
  {
    name: "✧₊˚💻 𝗖𝗹𝗶𝗲𝗻𝘁 𝗙𝗼𝗿 𝗥𝗕𝗟 ˚₊✧",
    type: "category",
    children: [
      { name: "🍎-𝗖𝗹𝗶𝗲𝗻𝘁-𝗜𝗢𝗦", type: "text" },
      { name: "📱-𝗖𝗹𝗶𝗲𝗻𝘁-𝗔𝗗𝗥", type: "text" },
      { name: "💻-𝗖𝗹𝗶𝗲𝗻𝘁-𝗣𝗖", type: "text" },
      { name: "☁️-𝗖𝗹𝗶𝗲𝗻𝘁-𝗖𝗹𝗼𝗻𝗲-𝗧𝗮𝗯", type: "text" }
    ]
  },
  {
    name: "✧₊˚🛡️ 𝗛𝗮𝗰𝗸 𝗡𝗧𝗙 ˚₊✧",
    type: "category",
    children: [
      { name: "📢-𝗦𝘁𝗮𝘁𝘂𝘀-𝗛𝗮𝗰𝗸", type: "text" },
      { name: "⬆️-𝗖𝗹𝗶𝗲𝗻𝘁-𝗨𝗽𝘁", type: "text" },
      { name: "🛠️-𝗥𝗼𝗯𝗹𝗼𝘅-𝗨𝗽𝗱𝗮𝘁𝗲-𝗩𝗲𝗿𝘀𝗶𝗼𝗻", type: "text" }
    ]
  },
  {
    name: "✧₊˚🔥 𝗛𝗮𝗰𝗸 𝗙𝗙 ˚₊✧",
    type: "category",
    children: [
      { name: "🍎-𝗛𝗮𝗰𝗸-𝗙𝗙-𝗜𝗢𝗦", type: "text" },
      { name: "📱-𝗛𝗮𝗰𝗸-𝗙𝗙-𝗔𝗗𝗥", type: "text" }
    ]
  },
  {
    name: "✧₊˚🎮 𝗠𝗶𝗻𝗲𝗰𝗿𝗮𝗳𝘁 𝗣𝗘 ˚₊✧",
    type: "category",
    children: [
      { name: "🍎-𝗠𝗶𝗻𝗲𝗰𝗿𝗮𝗳𝘁-𝗣𝗘-𝗜𝗢𝗦", type: "text" },
      { name: "📱-𝗠𝗶𝗻𝗲𝗰𝗿𝗮𝗳𝘁-𝗔𝗗𝗥", type: "text" }
    ]
  },
  {
    name: "✧₊˚🍎 𝗦𝘁𝗼𝗰𝗸 ˚₊✧",
    type: "category",
    children: [
      { name: "🍎-𝗦𝘁𝗼𝗰𝗸-𝗙𝗿𝘂𝗶𝘁", type: "text" }
    ]
  },
  {
    name: "✧₊˚🎮 𝗚𝗶𝗮̉𝗶 𝗧𝗿𝗶́ ˚₊✧",
    type: "category",
    children: [
      { name: "🏆-𝗡𝗼̂́𝗶-𝗧𝘂̛̀", type: "text" },
      { name: "🦀-𝗕𝗮̂̀𝘂-𝗖𝘂𝗮", type: "text" },
      { name: "🎰-𝗧𝗮̀𝗶-𝗫𝗶̉𝘂", type: "text" },
      { name: "🐟-𝗖𝗮̂𝘂-𝗖𝗮́", type: "text" },
      { name: "🌸-𝗧𝘂-𝗧𝗶𝗲̂𝗻", type: "text" }
    ]
  },
  {
    name: "Thoại",
    type: "category",
    children: [
      { name: "Chung", type: "voice" },
      { name: "Chung", type: "voice" }
    ]
  }
];

// ===================== ROLES CONFIGURATION =====================
// đổi toàn bộ mã màu Hex ngẫu nhiên đẹp mắt để tránh bị nói copy, phân quyền chuẩn bảo mật
const ROLES_DATA = [
  { name: "OWNER👑", color: "#FF3333", permissions: [PermissionsBitField.Flags.Administrator] },
  { name: "System Bot🤖", color: "#00E5FF", permissions: [PermissionsBitField.Flags.Administrator] },
  { name: "CO OWNER🕊️", color: "#FF5722", permissions: [PermissionsBitField.Flags.Administrator] },
  { name: "ADMIN🔥", color: "#FF1744", permissions: [PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.BanMembers, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers, PermissionsBitField.Flags.MoveMembers] },
  { name: "SUPPORTER👾", color: "#D500F9", permissions: [PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.ManageMessages] },
  { name: "MANAGER👤", color: "#2979FF", permissions: [PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.KickMembers, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.MoveMembers] },
  { name: "STAFF☀️", color: "#FFEA00", permissions: [PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.ManageMessages] },
  { name: "MUTED💢", color: "#757575", permissions: [] },
  { name: "UPDATE CLIENT🟢", color: "#00E676", permissions: [] },
  { name: "SHARE SCRIPT📱", color: "#37474F", permissions: [] },
  { name: "SELLER🤑", color: "#FFB300", permissions: [] },
  { name: "PREMIUM🧠", color: "#F50057", permissions: [] },
  { name: "FRIEND OWNER💠", color: "#00695C", permissions: [] },
  { name: "Share source⛩️", color: "#E65100", permissions: [] },
  { name: "BOOSTER🌸", color: "#F48FB1", permissions: [] },
  { name: "LGPT🌈", color: "#FF8A80", permissions: [] },
  { name: "Server Booster🚀", color: "#EA80FC", permissions: [] },
  { name: "HE", color: "#80D8FF", permissions: [] },
  { name: "SHE", color: "#FF80AB", permissions: [] },
  { name: "member", color: "#00efff", permissions: [], isMember: true }
];

// ===================== HELPER FUNCTIONS =====================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanOcrLine(line) {
  return (line || "").replace(/[\t\r]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeForGuess(text) {
  return cleanOcrLine(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}

function mapChannelType(type) {
  switch ((type || "text").toLowerCase()) {
    case "category": return ChannelType.GuildCategory;
    case "voice": return ChannelType.GuildVoice;
    case "forum": return ChannelType.GuildForum;
    case "announcement": return ChannelType.GuildAnnouncement;
    default: return ChannelType.GuildText;
  }
}

function cloneOverwrites(channel) {
  return channel?.permissionOverwrites?.cache
    ? channel.permissionOverwrites.cache.map(ow => ({
        id: ow.id,
        allow: ow.allow.bitfield.toString(),
        deny: ow.deny.bitfield.toString()
      }))
    : [];
}

async function deleteAllChannels(guild) {
  const channels = await guild.channels.fetch();
  const sorted = [...channels.values()]
    .filter(Boolean)
    .sort((a, b) => (b.rawPosition ?? b.position ?? 0) - (a.rawPosition ?? a.position ?? 0));
  await Promise.allSettled(
    sorted.map(ch => ch?.deletable ? ch.delete("Reset server setup") : Promise.resolve())
  );
}

async function createChannel(guild, spec, parentId = null) {
  const options = {
    name: spec.name,
    type: mapChannelType(spec.type),
    parent: parentId || null
  };

  if (spec.overwrites) options.permissionOverwrites = spec.overwrites;

  if (spec.type === "text" || spec.type === "announcement" || spec.type === "forum") {
    if (spec.topic) options.topic = spec.topic;
    if (typeof spec.nsfw === "boolean") options.nsfw = spec.nsfw;
    if (typeof spec.slowmode === "number") options.rateLimitPerUser = spec.slowmode;
    if (typeof spec.autoArchiveDuration === "number") options.defaultAutoArchiveDuration = spec.autoArchiveDuration;
  }

  if (spec.type === "voice") {
    if (typeof spec.bitrate === "number") options.bitrate = spec.bitrate;
    if (typeof spec.userLimit === "number") options.userLimit = spec.userLimit;
  }

  return guild.channels.create(options);
}

async function buildTemplate(guild, template) {
  await deleteAllChannels(guild);
  for (const group of template) {
    const category = await createChannel(guild, {
      name: group.name,
      type: "category",
      overwrites: group.overwrites || []
    });
    const children = Array.isArray(group.children) ? group.children : [];
    for (const child of children) {
      await createChannel(guild, child, category.id);
      await sleep(120);
    }
    await sleep(160);
  }
}

async function cloneFromGuildId(client, targetGuild, sourceGuildId) {
  const sourceGuild = await client.guilds.fetch(sourceGuildId).catch(() => null);
  if (!sourceGuild) throw new Error("Bot không có mặt trong server nguồn hoặc ID sai.");

  const sourceChannels = await sourceGuild.channels.fetch();
  const channels = [...sourceChannels.values()]
    .filter(Boolean)
    .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0));
  await deleteAllChannels(targetGuild);

  const categoryMap = new Map();

  for (const ch of channels.filter(c => c.type === ChannelType.GuildCategory)) {
    const created = await targetGuild.channels.create({
      name: ch.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: cloneOverwrites(ch)
    });
    categoryMap.set(ch.id, created.id);
    await sleep(100);
  }

  for (const ch of channels.filter(c => c.type !== ChannelType.GuildCategory)) {
    const parentId = ch.parentId ? (categoryMap.get(ch.parentId) || null) : null;

    const options = {
      name: ch.name,
      parent: parentId,
      permissionOverwrites: cloneOverwrites(ch),
      type: ch.type === ChannelType.GuildVoice ? ChannelType.GuildVoice :
            ch.type === ChannelType.GuildAnnouncement ? ChannelType.GuildAnnouncement :
            ch.type === ChannelType.GuildForum ? ChannelType.GuildForum : ChannelType.GuildText
    };
    if (options.type === ChannelType.GuildText || options.type === ChannelType.GuildAnnouncement || options.type === ChannelType.GuildForum) {
      if (ch.topic) options.topic = ch.topic;
      if (typeof ch.nsfw === "boolean") options.nsfw = ch.nsfw;
      if (typeof ch.rateLimitPerUser === "number") options.rateLimitPerUser = ch.rateLimitPerUser;
      if (typeof ch.defaultAutoArchiveDuration === "number") options.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration;
    }

    if (options.type === ChannelType.GuildVoice) {
      if (typeof ch.bitrate === "number") options.bitrate = ch.bitrate;
      if (typeof ch.userLimit === "number") options.userLimit = ch.userLimit;
    }

    await targetGuild.channels.create(options).catch(() => {});
    await sleep(90);
  }
}

async function ocrImageToText(imageUrl) {
  if (!Tesseract) return null;
  const res = await Tesseract.recognize(imageUrl, "eng+vie");
  return res?.data?.text || null;
}

function parseTemplateFromText(rawText) {
  const lines = String(rawText || "").split(/\r?\n/).map(cleanOcrLine).filter(Boolean);
  const template = [];
  let current = null;

  for (const line of lines) {
    const n = normalizeForGuess(line);
    const looksLikeCategory = line.length <= 40 && !n.startsWith("#") && !n.startsWith("🔊") && !n.startsWith("🎙") && !n.includes("http") && !n.match(/^\d+$/) && !n.includes("discord");
    if (looksLikeCategory && (current === null || current.children.length > 0 || template.length === 0)) {
      current = { name: line, type: "category", children: [] };
      template.push(current);
      continue;
    }

    if (!current) {
      current = { name: "Imported", type: "category", children: [] };
      template.push(current);
    }

    const isVoice = /voice|talk|room|call|chung|vocal|speaking/i.test(n);
    current.children.push({ name: line, type: isVoice ? "voice" : "text" });
  }

  return template.filter(group => group?.name && Array.isArray(group.children) && group.children.length);
}

async function buildFromImage(guild, attachmentUrl) {
  const text = await ocrImageToText(attachmentUrl).catch(() => null);
  const template = parseTemplateFromText(text || "");
  if (!template.length) {
    throw new Error("Không đọc được ảnh. Hãy dùng source_guild_id để clone chính xác.");
  }
  await buildTemplate(guild, template);
}

async function runSetup(interaction, { mode, sourceGuildId = null, image = null, templateId = null }) {
  if (!interaction.guild) {
    return interaction.reply({ content: "Lệnh này chỉ dùng trong server.", ephemeral: true });
  }

  await interaction.reply({
    content: "⏳ Đang tiến hành dọn dẹp và dựng cấu trúc các kênh theo yêu cầu. Vui lòng đợi...",
    ephemeral: true
  });

  try {
    if (mode === "owner") {
      if (templateId === "1427887770298486899") {
        await buildTemplate(interaction.guild, TEMPLATE_NEW);
      } else {
        await buildTemplate(interaction.guild, TEMPLATE_OLD);
      }
    } else if (mode === "guild") {
      await cloneFromGuildId(interaction.client, interaction.guild, sourceGuildId);
    } else if (mode === "image") {
      await buildFromImage(interaction.guild, image);
    } else {
      throw new Error("Thiếu thông tin cấu hình setup.");
    }

    return interaction.followUp({
      content: "<a:emoji_75:1524039622668189806>  Thiết lập cấu trúc hệ thống kênh thành công!",
      ephemeral: true
    });
  } catch (error) {
    console.error(error);
    return interaction.followUp({
      content: `<a:emoji_76:1524195723996823612> Gặp lỗi trong quá trình setup kênh: ${error.message}`,
      ephemeral: true
    });
  }
}

// ===================== VIDEO DOWNLOAD CONFIG =====================
const VIDEO_MAX_SIZE = 20 * 1024 * 1024;
// Chỉ còn đúng 1 mức 144p theo yêu cầu -> luôn tải chất lượng thấp nhất, nhanh nhất,
// không tốn thời gian thử 240p trước rồi mới rớt xuống 144p như trước.
const VIDEO_HEIGHTS = [144];

// Giới hạn số video được tải CÙNG LÚC trên toàn bộ bot để tránh ăn hết RAM/CPU của host
// khi nhiều user gửi link liên tiếp. Tăng lên 4 vì file 144p nhẹ hơn nhiều, ít tốn CPU/RAM hơn
// nên host có thể xử lý song song nhiều hơn mà vẫn ổn định. Chỉnh lại tùy cấu hình máy chủ.
const MAX_CONCURRENT_DOWNLOADS = 4;
let activeDownloads = 0;
const downloadQueue = [];

function acquireDownloadSlot() {
  return new Promise(resolve => {
    const tryStart = () => {
      if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
        activeDownloads++;
        resolve();
      } else {
        downloadQueue.push(tryStart);
      }
    };
    tryStart();
  });
}

function releaseDownloadSlot() {
  activeDownloads = Math.max(0, activeDownloads - 1);
  const next = downloadQueue.shift();
  if (next) next();
}

// Tự dò xem host có cài aria2c không (trình tải đa luồng, tải nhanh hơn hẳn so với
// bộ tải mặc định của yt-dlp khi mạng cho phép). Nếu không có thì tự bỏ qua, không lỗi.
const { spawnSync } = require("child_process");
let ARIA2C_AVAILABLE = false;
try {
  const check = spawnSync("aria2c", ["--version"], { stdio: "ignore" });
  ARIA2C_AVAILABLE = !check.error && check.status === 0;
} catch {
  ARIA2C_AVAILABLE = false;
}

// ===================== DATA STORAGE HANDLING =====================
let data = {};
let page = 1;

if (fs.existsSync("data.json")) {
  try {
    data = JSON.parse(fs.readFileSync("data.json", "utf8"));
  } catch {
    data = {};
  }
}

function save() {
  fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
}

function normalize(t) {
  return (t || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function stripVietnameseAccents(text) {
  return normalize(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, stdio: options.stdio || "pipe", ...options });
    let stderr = "";
    if (child.stderr) {
      child.stderr.on("data", d => { stderr += d.toString(); });
    }
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} exited with code ${code}${stderr ? `: ${stderr}` : ""}`));
    });
  });
}

function findDownloadedFile(dir, baseName) {
  const files = fs.readdirSync(dir);
  return files.filter(f => f.startsWith(baseName + ".") && !f.endsWith(".part")).map(f => path.join(dir, f))[0] || null;
}

function hasAudioStream(file) {
  try {
    const r = spawnSync("ffprobe", [
      "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file
    ], { encoding: "utf8" });
    return !!(r.stdout && r.stdout.trim().length > 0);
  } catch {
    return false;
  }
}

async function compressVideo(inputFile, outputFile) {
  // Hạ tiếp độ phân giải + tăng crf + giảm bitrate audio -> file nhẹ hơn, ffmpeg chạy nhanh hơn,
  // và Discord upload/gửi cũng nhanh hơn. Đổi lại hình sẽ mờ hơn bản trước - đúng yêu cầu ưu tiên tốc độ.
  // "-map" tường minh: luôn lấy video, và lấy audio NẾU có (dấu "?" = optional, không lỗi khi thiếu),
  // tránh việc ffmpeg tự chọn stream mặc định rồi vô tình bỏ audio ở vài video.
  await runCommand("ffmpeg", [
    "-y", "-i", inputFile,
    "-map", "0:v:0", "-map", "0:a:0?",
    // Scale xuống đúng 144p (giữ chiều cao 144, rộng theo tỉ lệ gốc) -> file nhẹ nhất,
    // ffmpeg chạy nhanh nhất, khớp với yêu cầu chất lượng thấp nhất/tốc độ cao nhất.
    "-vf", "scale=-2:144",
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "fastdecode",
    "-crf", "40", "-maxrate", "300k", "-bufsize", "600k",
    "-c:a", "aac", "-b:a", "32k", "-ac", "1",
    "-movflags", "+faststart",
    // Dùng hết số luồng CPU sẵn có (0 = auto-detect) thay vì cố định 2 luồng -> nén nhanh hơn trên host nhiều core.
    "-threads", "0",
    outputFile
  ], { stdio: "pipe" });
}

async function downloadVideoWithFallback(url, tmpDir, baseName) {
  // Chỉ còn 2 mức thấp nhất theo yêu cầu: 240p rồi tới 144p.
  for (const h of VIDEO_HEIGHTS) {
    const outTemplate = path.join(tmpDir, `${baseName}.%(ext)s`);
    const baseArgs = [
      "--no-playlist", "--no-warnings", "--no-mtime", "--no-part",
      // Timeout ngắn hơn + ít lần retry hơn -> bot fail nhanh và không bị treo lâu ở link lỗi,
      // đổi lại nếu mạng chập chờn thì dễ rớt hơn (đánh đổi lấy tốc độ theo đúng yêu cầu).
      "--retries", "2", "--fragment-retries", "2", "--socket-timeout", "8",
      "--concurrent-fragments", "8",
      // Giới hạn định dạng ngay từ bước tìm kiếm format, tránh yt-dlp mất thời gian
      // liệt kê/so sánh các format cao hơn không cần dùng tới.
      "-S", "+size,+br,res:" + h,
      // ĐÃ BỎ "--max-filesize": đây chính là nguyên nhân gây mất tiếng ở video nặng/dài -
      // khi ước tính video+audio gộp lại vượt mức giới hạn, yt-dlp âm thầm bỏ luồng audio
      // để video lọt qua giới hạn, tạo ra file mp4 không tiếng. Việc kiểm soát dung lượng
      // giờ để hoàn toàn cho bước nén (compressVideo) phía sau xử lý.
      "--merge-output-format", "mp4", "-o", outTemplate
    ];
    if (ARIA2C_AVAILABLE) {
      // Tăng số kết nối song song của aria2c (8 thay vì 4) để tải nhanh hơn khi mạng cho phép.
      baseArgs.push("--downloader", "aria2c", "--downloader-args", "aria2c:-x 8 -s 8 -k 1M --min-split-size=1M");
    }

    // Lần 1: ưu tiên format progressive (gộp sẵn, tải nhanh, khỏi cần ffmpeg merge)
    try {
      await runCommand("yt-dlp", [
        ...baseArgs,
        "-f", `b[height<=${h}][vcodec!=none][acodec!=none]/bv*[height<=${h}]+ba/b[height<=${h}]/best`,
        url
      ], { stdio: "pipe" });
      const file = findDownloadedFile(tmpDir, baseName);
      if (file && fs.existsSync(file)) {
        if (hasAudioStream(file)) return file;
        // Có file nhưng KHÔNG có tiếng -> thử lại 1 lần với format tường minh
        // buộc ghép riêng video+audio (bỏ qua nhánh progressive vừa lỗi ở nguồn này).
        fs.rmSync(file, { force: true });
      }
    } catch {}

    try {
      await runCommand("yt-dlp", [
        ...baseArgs,
        "-f", `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
        url
      ], { stdio: "pipe" });
      const file2 = findDownloadedFile(tmpDir, baseName);
      if (file2 && fs.existsSync(file2)) return file2; // trả về dù có/không có audio, còn hơn không có video
    } catch {}
  }
  return null;
}

async function handleVideo(msg, url) {
  const loading = await msg.reply("⏳ Đang tải video...");

  // Nếu host đang tải quá nhiều video cùng lúc, xếp hàng chờ thay vì chạy song song
  // gây ăn gam/CPU. User sẽ thấy trạng thái "đang chờ" thay vì bot bị đơ.
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    await loading.edit("⌛ Server đang tải video khác, video của bạn đã được xếp hàng chờ...").catch(() => {});
  }
  await acquireDownloadSlot();

  const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "video-"));
  const baseName = `video_${Date.now()}`;

  try {
    await loading.edit("<a:emoji_78:1526470876567044136>️ Đang lấy video...");
    const downloadedFile = await downloadVideoWithFallback(url, tmpDir, baseName);
    if (!downloadedFile) {
      await loading.edit("<a:emoji_76:1524195723996823612> Không tải được video này.");
      return;
    }

    let fileToSend = downloadedFile;
    let size = fs.statSync(downloadedFile).size;
    if (size > VIDEO_MAX_SIZE) {
      await loading.edit("📦 Video quá lớn, đang nén lại...");
      const compressedFile = path.join(tmpDir, `${baseName}_compressed.mp4`);
      await compressVideo(downloadedFile, compressedFile);
      if (fs.existsSync(compressedFile)) {
        fileToSend = compressedFile;
        size = fs.statSync(compressedFile).size;
      }
    }

    if (size > VIDEO_MAX_SIZE) {
      await loading.edit("<a:emoji_76:1524195723996823612> Video vẫn quá lớn để gửi trực tiếp lên Discord.");
      return;
    }

    await Promise.all([
      msg.channel.send({ files: [{ attachment: fileToSend, name: path.basename(fileToSend) }] }),
      loading.delete().catch(() => {})
    ]);
  } catch {
    await loading.edit("<a:emoji_76:1524195723996823612> Tải video thất bại.").catch(() => {});
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    releaseDownloadSlot();
  }
}

// ==========================================
// NAKNOHACK OBFUSCATOR CORE (LIGHTWEIGHT & FAST BASE64)
// ==========================================
const ObfConfig = {
    removeComments: true,
    minifyCode: true,
    watermark: "--// This file was created by Naknohack [https://discord.gg/uSWQ7rhpDp]"
};

class LuaLexer {
    static tokenize(code) {
        const tokens = [];
        let i = 0;
        while (i < code.length) {
            let char = code[i];
            if (char === '"' || char === "'") {
                let quote = char, str = quote;
                i++;
                while (i < code.length) {
                    str += code[i];
                    if (code[i] === '\\') { i++; str += code[i]; } 
                    else if (code[i] === quote) break;
                    i++;
                }
                tokens.push({ type: 'String', value: str });
                i++; continue;
            }
            if (char === '-' && code[i + 1] === '-') {
                let comment = "--"; i += 2;
                if (code[i] === '[' && code[i + 1] === '[') {
                    comment += "[["; i += 2;
                    while (i < code.length && !(code[i] === ']' && code[i + 1] === ']')) { comment += code[i]; i++; }
                    comment += "]]"; i += 2;
                } else {
                    while (i < code.length && code[i] !== '\n') { comment += code[i]; i++; }
                }
                tokens.push({ type: 'Comment', value: comment });
                continue;
            }
            if (/\s/.test(char)) {
                let space = char; i++;
                while (i < code.length && /\s/.test(code[i])) { space += code[i]; i++; }
                tokens.push({ type: 'Whitespace', value: space });
                continue;
            }
            tokens.push({ type: 'Other', value: char }); i++;
        }
        return tokens;
    }
}

class CodeTransformer {
    static process(sourceCode, config) {
        const tokens = LuaLexer.tokenize(sourceCode);
        let transformedCode = [];
        for (let token of tokens) {
            if (config.removeComments && token.type === 'Comment') continue;
            if (config.minifyCode && token.type === 'Whitespace') { transformedCode.push(" "); continue; }
            transformedCode.push(token.value);
        }
        return transformedCode.join("").trim();
    }
}

class VMCompiler {
    static randVar(len) {
        const chars = 'IlO0'; let res = '_';
        for(let i = 0; i < len; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
        return res;
    }

    static compile(sourceCode, config) {
        const xorKey = Math.floor(Math.random() * 250) + 1;
        let utf8str = unescape(encodeURIComponent(sourceCode));
        let xored = "";
        for (let i = 0; i < utf8str.length; i++) {
            xored += String.fromCharCode(utf8str.charCodeAt(i) ^ xorKey);
        }
        
        // Node.js dùng Buffer thay cho btoa trong một số môi trường, nhưng để giữ đúng logic 100%, 
        // ta dùng hàm btoa tích hợp của Node.js 18+ (hoặc Buffer b64)
        const b64Encoded = typeof btoa === "function" ? btoa(xored) : Buffer.from(xored, 'binary').toString('base64');

        const outBuilder = [];
        if (config.watermark) outBuilder.push(config.watermark);

        const keyV = this.randVar(6); const b64V = this.randVar(7); const bxorV = this.randVar(5);
        const decFunc = this.randVar(6); const tamperV = this.randVar(5); const decTbl = this.randVar(5);

        outBuilder.push(`local ${tamperV}=0`);
        outBuilder.push(`if iscclosure and not iscclosure(loadstring) then ${tamperV}=1 end`);
        outBuilder.push(`local ${keyV}=${xorKey}+(${tamperV}*256)`);
        outBuilder.push(`local ${b64V}="${b64Encoded}"`);
        outBuilder.push(`local ${bxorV}=bit32 and bit32.bxor or bit and bit.bxor or function(a,b) local p,c=1,0 while a>0 and b>0 do local ra,rb=a%2,b%2 if ra~=rb then c=c+p end a,b,p=(a-ra)/2,(b-rb)/2,p*2 end return c+a*p+b*p end`);
        outBuilder.push(`local function ${decFunc}(data, key)`);
        outBuilder.push(`  local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'`);
        outBuilder.push(`  local ${decTbl}={} for i=1,64 do ${decTbl}[string.byte(b,i)]=i-1 end`);
        outBuilder.push(`  data=string.gsub(data,'[^A-Za-z0-9+/=]','')`);
        outBuilder.push(`  local chars={} local j=1`);
        outBuilder.push(`  for i=1,#data,4 do`);
        outBuilder.push(`    local c1=${decTbl}[string.byte(data,i)] or 0`);
        outBuilder.push(`    local c2=${decTbl}[string.byte(data,i+1)] or 0`);
        outBuilder.push(`    local c3=${decTbl}[string.byte(data,i+2)] or 0`);
        outBuilder.push(`    local c4=${decTbl}[string.byte(data,i+3)] or 0`);
        outBuilder.push(`    local bit24=(c1*262144)+(c2*4096)+(c3*64)+c4`);
        outBuilder.push(`    local b1=math.floor(bit24/65536)`);
        outBuilder.push(`    local b2=math.floor(bit24/256)%256`);
        outBuilder.push(`    local b3=bit24%256`);
        outBuilder.push(`    chars[j]=string.char(${bxorV}(b1,key))`);
        outBuilder.push(`    if string.byte(data,i+2)==61 then break end`);
        outBuilder.push(`    chars[j+1]=string.char(${bxorV}(b2,key))`);
        outBuilder.push(`    if string.byte(data,i+3)==61 then break end`);
        outBuilder.push(`    chars[j+2]=string.char(${bxorV}(b3,key))`);
        outBuilder.push(`    j=j+3`);
        outBuilder.push(`  end`);
        outBuilder.push(`  return table.concat(chars)`);
        outBuilder.push(`end`);
        outBuilder.push(`local _f,_e=pcall(function() return loadstring(${decFunc}(${b64V},${keyV}))() end)`);
        outBuilder.push(`if not _f then return end`);
        
        return outBuilder.join("\n");
    }
}

// ===================== CLIENT CUSTOMIZATION =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // Bắt buộc bật để chạy Auto Add Role Member khi người dùng tham gia
    GatewayIntentBits.GuildMessageReactions // Bắt buộc bật để lệnh /editing-log ghi lại được ai thả emoji gì
  ]
});

// ===================== SLASH COMMAND BUILDER =====================
const commands = [
  new SlashCommandBuilder()
    .setName("them")
    .setDescription("Thêm key")
    .addStringOption(o => o.setName("key").setDescription("Tên key").setRequired(true))
    .addStringOption(o => o.setName("value").setDescription("Nội dung").setRequired(true)),

  new SlashCommandBuilder()
    .setName("sua")
    .setDescription("Sửa key")
    .addStringOption(o => o.setName("key").setDescription("Tên key").setRequired(true))
    .addStringOption(o => o.setName("value").setDescription("Nội dung").setRequired(true)),

  new SlashCommandBuilder()
    .setName("xoa")
    .setDescription("Xóa key")
    .addStringOption(o => o.setName("key").setDescription("Tên key").setRequired(true)),

  new SlashCommandBuilder()
    .setName("server-working")
    .setDescription("Chỉ dành cho Chủ Bot"),
  
  new SlashCommandBuilder()
    .setName("announcement")
    .setDescription("Gửi thông báo tới toàn bộ kênh ở các server (Chỉ Chủ Bot)")
    .addStringOption(o => o.setName("message").setDescription("Nội dung thông báo").setRequired(true))
    .addChannelOption(o => o.setName("log").setDescription("Chọn kênh tại Server Mẹ để nhận nhật ký log").setRequired(true)),
    
  new SlashCommandBuilder()
    .setName("list")
    .setDescription("Danh sách key"),

  new SlashCommandBuilder()
    .setName("obfuscator")
    .setDescription("Mã hóa mã nguồn Lua (Ai cũng dùng được)")
    .addStringOption(o => o.setName("method").setDescription("Chọn phương thức nhận mã").setRequired(true)
      .addChoices(
        { name: "File", value: "file" },
        { name: "Code", value: "code" },
        { name: "Link", value: "link" }
      ))
    .addAttachmentOption(o => o.setName("file").setDescription("File mã nguồn (NẾU CHỌN FILES)"))
    .addStringOption(o => o.setName("code").setDescription("Dán trực tiếp code vào đây (NẾU CHỌN CODE)"))
    .addStringOption(o => o.setName("link").setDescription("Đường link chứa code (NẾU CHỌN LINKS)")),
    
      new SlashCommandBuilder()
    .setName("qr")
    .setDescription("Tạo mã QR code")
    .addStringOption(o => 
      o.setName("link")
      .setDescription("Dán Link (URL) bạn muốn tạo QR vào đây")
      .setRequired(false)
    )
    .addStringOption(o => 
      o.setName("document")
      .setDescription("Nhập văn bản (Text) bạn muốn tạo QR vào đây")
      .setRequired(false)
    ),
    
   new SlashCommandBuilder()
  .setName("qrbank")
  .setDescription("Tạo mã QR chuyển khoản (Giao diện giống vietqr.io)")
  
  // 1. Ô chọn Ngân hàng (Dùng Autocomplete để gõ tìm kiếm)
  .addStringOption(option =>
    option.setName("bank")
      .setDescription("Nhập tên hoặc mã Ngân hàng (VD: MB, Vietcombank...)")
      .setAutocomplete(true) // Bắt buộc phải có dòng này để tìm kiếm
      .setRequired(true)
  )
  
  // 2. Ô nhập Số tài khoản (Người dùng tự gõ số)
  .addStringOption(option =>
    option.setName("account_number")
      .setDescription("Nhập số tài khoản ngân hàng của bạn")
      .setRequired(true)
  )
  
  // 3. Ô chọn Template (Menu thả xuống để chọn)
  .addStringOption(option =>
    option.setName("template")
      .setDescription("Chọn mẫu hiển thị QR")
      .setRequired(true)
      .addChoices(
        { name: "compact", value: "compact" },
        { name: "compact2", value: "compact2" },
        { name: "qr_only", value: "qr_only" },
        { name: "print", value: "print" },
        { name: "loax", value: "loax" }
      )
  ),
    
      new SlashCommandBuilder()
    .setName("bypass")
    .setDescription("Bypass link để lấy key tự động")
    .addStringOption(o => 
      o.setName("link")
      .setDescription("Dán link cần bypass vào đây")
      .setRequired(true)
    ),
    
      new SlashCommandBuilder()
    .setName("ban-server")
    .setDescription("Ban và auto rời khỏi server (Chỉ Chủ Bot)")
    .addStringOption(o => 
      o.setName("server_id")
      .setDescription("Gõ để tìm tên server bot đang tham gia")
      .setAutocomplete(true)
      .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unban-server")
    .setDescription("Gỡ ban server đã bị cấm (Chỉ Chủ Bot)")
    .addStringOption(o => 
      o.setName("server_id")
      .setDescription("Gõ để tìm tên server muốn gỡ ban")
      .setAutocomplete(true)
      .setRequired(true)
    ),
    
new SlashCommandBuilder()
  .setName("capquyenkenh")
  .setDescription("Cấu hình kênh sử dụng Key và kênh nhận Log nhật ký (Chỉ Admin hoặc Chủ Bot)")
  .addStringOption(o => o.setName("hanh_dong").setDescription("Chọn thao tác cài đặt").setRequired(true)
    .addChoices(
      { name: "Kênh được quyền chat script", value: "add_key" },
      { name: "xóa kênh được quyền chat script", value: "remove_key" },
      { name: "cấp quyền kênh log chat script sai kênh", value: "add_log" },
      { name: "xóa kênh log chat script sai kênh", value: "remove_log" },
      { name: "Xem cấu hình server hiện tại", value: "view" }
    ))
  .addChannelOption(o => o.setName("kenh").setDescription("Chọn kênh cần thiết lập").setRequired(false)),

  new SlashCommandBuilder()
    .setName("reset-server")
    .setDescription("Xóa toàn bộ cấu hình kênh gõ key và kênh log của bot tại server này (Chỉ Admin/Owner)"),
    
  new SlashCommandBuilder()
    .setName("setupclent")
    .setDescription("Xóa kênh cũ và dựng cấu trúc danh mục theo ID mẫu cung cấp")
    .addStringOption(o => 
      o.setName("id")
        .setDescription("Nhập ID mẫu (1020868400672686080: Mẫu cũ | 1427887770298486899: Mẫu mới)")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("setupserver")
    .setDescription("Xóa kênh cũ và clone server từ ID hoặc ảnh chụp")
    .addStringOption(o => o.setName("source_guild_id").setDescription("ID server nguồn nếu bot có mặt ở đó").setRequired(false))
    .addAttachmentOption(o => o.setName("image").setDescription("Ảnh chụp toàn bộ danh sách kênh").setRequired(false)),

  new SlashCommandBuilder()
    .setName("taovaitro")
    .setDescription("Tự động tạo toàn bộ danh sách vai trò (Roles) đã cấu hình phân quyền chống lạm quyền"),

  new SlashCommandBuilder()
    .setName("autovideo")
    .setDescription("Điều khiển tính năng tự động tải video (TikTok/Facebook/Instagram/YouTube)")
    .addSubcommand(sc => sc.setName("bat").setDescription("Bật tự động tải video cho server này"))
    .addSubcommand(sc => sc.setName("tat").setDescription("Tắt tự động tải video cho server này (hết bị dính link tự động tải)"))
    .addSubcommand(sc => sc
      .setName("nentang")
      .setDescription("Bật/tắt tải theo từng nền tảng cụ thể")
      .addStringOption(o => o.setName("nen_tang").setDescription("Chọn nền tảng").setRequired(true)
        .addChoices(
          { name: "TikTok", value: "tiktok" },
          { name: "Facebook", value: "facebook" },
          { name: "Instagram", value: "instagram" },
          { name: "YouTube (mặc định TẮT vì Discord tự embed)", value: "youtu" }
        ))
      .addStringOption(o => o.setName("trang_thai").setDescription("Bật hay tắt").setRequired(true)
        .addChoices({ name: "Bật", value: "on" }, { name: "Tắt", value: "off" })))
    .addSubcommand(sc => sc
      .setName("kenh")
      .setDescription("Giới hạn tự động tải video chỉ hoạt động ở(các) kênh nhất định")
      .addStringOption(o => o.setName("hanh_dong").setDescription("Thêm, xóa hay xem danh sách kênh").setRequired(true)
        .addChoices(
          { name: "Thêm kênh vào danh sách áp dụng", value: "add" },
          { name: "Xóa kênh khỏi danh sách áp dụng", value: "remove" },
          { name: "Xem toàn bộ danh sách kênh trong server + trạng thái áp dụng", value: "list" }
        ))
      .addChannelOption(o => o.setName("kenh_chon").setDescription("Chọn kênh (không cần khi dùng 'Xem danh sách')").setRequired(false)))
    .addSubcommand(sc => sc.setName("trangthai").setDescription("Xem toàn bộ cấu hình tự động tải video hiện tại")),

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Cấu hình Automod chống spam cho server (Chỉ Admin hoặc Chủ Bot)")
    .addStringOption(o => o.setName("hanh_dong").setDescription("Chọn loại spam cần cấu hình").setRequired(true)
      .addChoices(
        { name: "Spam câu cố định (nhắn lại 1 câu nhiều lần)", value: "fixed" },
        { name: "Spam Emoji", value: "emoji" },
        { name: "Spam ảnh (gửi nhiều ảnh liên tục)", value: "image" },
        { name: "Spam Tag (tag người chơi/role quá nhiều lần)", value: "mention" }
      ))
    .addStringOption(o => o.setName("trang_thai").setDescription("Bật hay tắt loại spam này").setRequired(true)
      .addChoices({ name: "Bật", value: "on" }, { name: "Tắt", value: "off" }))
    .addIntegerOption(o => o.setName("number_of_times").setDescription("Thời gian bị timeout khi vi phạm (đơn vị: phút, bắt buộc khi Bật)").setRequired(false).setMinValue(1).setMaxValue(40320))
    .addChannelOption(o => o.setName("notification_channel").setDescription("Chọn kênh bot gửi thông báo vi phạm (bắt buộc khi Bật)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("editing-log")
    .setDescription("Bật/tắt giám sát toàn bộ hoạt động của thành viên trong server (Chỉ Admin hoặc Chủ Bot)")
    .addStringOption(o => o.setName("hanh_dong").setDescription("Bật, tắt hay xem cấu hình giám sát hiện tại").setRequired(true)
      .addChoices(
        { name: "Bật giám sát", value: "on" },
        { name: "Tắt giám sát", value: "off" },
        { name: "Xem cấu hình hiện tại", value: "view" }
      ))
    .addChannelOption(o => o.setName("notification_channel").setDescription("Chọn kênh bot gửi toàn bộ log hoạt động (bắt buộc khi Bật)").setRequired(false)),

  new SlashCommandBuilder()
    .setName("thechannelwasnotcensored")
    .setDescription("Thêm/xóa/xem danh sách kênh KHÔNG bị Automod lọc (Chỉ Admin hoặc Chủ Bot)")
    .addStringOption(o => o.setName("hanh_dong").setDescription("Thêm, xóa hay xem danh sách kênh được miễn Automod").setRequired(true)
      .addChoices(
        { name: "Thêm kênh vào danh sách miễn", value: "them" },
        { name: "Xóa kênh khỏi danh sách miễn", value: "xoa" },
        { name: "Xem danh sách toàn bộ kênh", value: "list" }
      ))
    .addChannelOption(o => o.setName("kenh").setDescription("Chọn kênh (không cần khi dùng 'Xem danh sách')").setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("clientReady", async () => {
  try {
  // Thiết lập vòng lặp cập nhật trạng thái
    setInterval(() => {
        // Ép thời gian của máy chủ về đúng múi giờ Việt Nam để không bị lệch ngày
        const vnTimeStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
        const vnDate = new Date(vnTimeStr);
        
        // 1. Lấy "Thứ" chính xác theo giờ VN
        const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        const dayName = days[vnDate.getDay()];
        
        // 2. Lấy Ngày/Tháng/Năm (định dạng 00/00/0000)
        const day = String(vnDate.getDate()).padStart(2, '0');
        const month = String(vnDate.getMonth() + 1).padStart(2, '0');
        const year = vnDate.getFullYear();
        const fullDate = `${day}/${month}/${year}`;
        
        // 3. Lấy Giờ:Phút:Giây (định dạng 00:00:00)
        const hours = String(vnDate.getHours()).padStart(2, '0');
        const minutes = String(vnDate.getMinutes()).padStart(2, '0');
        const seconds = String(vnDate.getSeconds()).padStart(2, '0');
        const fullTime = `${hours}:${minutes}:${seconds}`;

        // 4. Lấy tổng số server bot đang tham gia
        const serverCount = client.guilds.cache.size;

        // 5. Ghép chuỗi chuẩn: Thứ | Ngày/Tháng/Năm | Giờ:Phút:Giây
        const statusText = `${dayName} | ${fullDate} | ${fullTime} 🇻🇳 ${serverCount} Server`;

        // 6. Cập nhật trạng thái thành "Đang xem" (Watching)
        client.user.setActivity(statusText, { type: ActivityType.Watching });
        
    }, 5000); // 8000 = 8giây
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("🔥 Bot trực tuyến và đã cập nhật Slash Commands mới!");
  } catch (err) {
    console.error("<a:emoji_76:1524195723996823612> Lỗi đăng ký slash commands:", err);
  }
});

// ===================== KEY LIST DISPLAY =====================
function makeListEmbed() {
  const keys = Object.keys(data);
  const per = 5;
  const max = Math.max(1, Math.ceil(keys.length / per));

  if (page > max) page = max;
  if (page < 1) page = 1;

  const start = (page - 1) * per;
  const list = keys.slice(start, start + per).map((k, i) => `🔑 ${start + i + 1}. ${k}`).join("\n");
  return new EmbedBuilder()
    .setColor("#5865F2")
    .setDescription(list || "<a:emoji_76:1524195723996823612> Không có dữ liệu data")
    .setFooter({ text: `Trang ${page}/${max}` });
}

function listButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("prev").setLabel("⬅️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("next").setLabel("➡️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("search").setLabel("🔎").setStyle(ButtonStyle.Success)
  );
}

// ===================== MUTING AND LOGGING SYSTEM =====================
async function logMute(msg, reason, type) {
  if (!msg.guild) return;
  const isKey = type === "KEY";
  const embed = new EmbedBuilder()
    .setColor(isKey ? "#f1c40f" : "#ff0000")
    .setTitle(isKey ? "🔑 Timeout do dùng script sai kênh" : "🚨 Timeout do spam / phá server")
    .addFields(
      { name: "Người bị xử lý", value: `${msg.member} (${msg.author.id})`, inline: false },
      { name: "Kênh", value: `${msg.channel}`, inline: false },
      { name: "Phân loại", value: isKey ? "Dùng script sai kênh" : "Spam", inline: true },
      { name: "Nguyên nhân", value: reason || "Không rõ", inline: true },
      { name: "Thời lượng", value: `${Math.floor(TIMEOUT_MS / 1000 / 60 / 60 / 24)} ngày`, inline: true },
      { name: "Nội dung tin nhắn", value: `\`\`\`\n${(msg.content || "").slice(0, 900) || "(Trống)"}\n\`\`\`\n`, inline: false }
    )
    .setTimestamp();

  const sCfg = getGuildConfig(msg.guild.id); // Lấy cấu hình của server hiện tại
  for (const channelId of sCfg.logChannels) {
    try {
      const logChannel = msg.guild.channels.cache.get(channelId) || (await msg.guild.channels.fetch(channelId).catch(() => null));
      if (!logChannel) continue;
      await logChannel.send({ embeds: [embed] }).catch(() => {});
    } catch {}
  }
}

async function applyTimeout(msg, reason, type) {
  if (!msg.member) return false;
  
  // Kiểm tra nếu là các vai trò quản trị an toàn thì bỏ qua hình phạt (Bypass)
  const safeRoles = ["OWNER", "ADMIN", "STAFF", "CO OWNER", "MANAGER", "SUPPORTER"];
  const isSafe = msg.member.roles.cache.some(r => safeRoles.some(s => r.name.toUpperCase().includes(s)));
  if (isSafe) return false;

  const me = msg.guild.members.me;
  if (!me) return false;

  const canTimeout = msg.member.moderatable && me.permissions.has(PermissionsBitField.Flags.ModerateMembers);
  if (!canTimeout) {
    await logMute(msg, reason, type).catch(() => {});
    return false;
  }

  await msg.member.timeout(TIMEOUT_MS, reason).catch(() => {});
  await logMute(msg, reason, type).catch(() => {});
  return true;
}

// ===================== AUTOMOD CHỐNG SPAM =====================
// Cửa sổ thời gian (mili giây) dùng để tính các loại spam bên dưới.
const SPAM_WINDOW_MS = 5000;
// Số tin nhắn giống hệt nhau liên tiếp trong cửa sổ -> coi là "Spam câu cố định".
const FIXED_MSG_THRESHOLD = 4;
// Số emoji trong CÙNG 1 tin nhắn -> coi là "Spam Emoji" ngay lập tức.
const EMOJI_COUNT_THRESHOLD = 10;
// Hoặc số tin nhắn có chứa emoji liên tiếp trong cửa sổ -> cũng coi là "Spam Emoji".
const EMOJI_MSG_THRESHOLD = 6;
// Tổng số ảnh (tính theo file đính kèm) gửi liên tiếp trong cửa sổ -> coi là "Spam ảnh".
const IMAGE_SPAM_THRESHOLD = 4;
// Số lượt tag (mention người chơi + role) trong CÙNG 1 tin nhắn -> coi là "Spam Tag" ngay lập tức.
const MENTION_COUNT_THRESHOLD = 3;
// Hoặc số tin nhắn có chứa tag liên tiếp trong cửa sổ -> cũng coi là "Spam Tag".
const MENTION_MSG_THRESHOLD = 4;

// Regex bắt cả emoji unicode lẫn emoji tùy chỉnh của Discord (custom emoji dạng <:ten:id> hoặc <a:ten:id>)
const EMOJI_REGEX = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;

function countEmojis(text) {
  return ((text || "").match(EMOJI_REGEX) || []).length;
}

// Đếm tổng số lượt tag (mention) người chơi + role trong 1 tin nhắn.
function countMentions(msg) {
  return (msg.mentions.users?.size || 0) + (msg.mentions.roles?.size || 0);
}

// Lưu lịch sử tin nhắn gần đây theo từng user (key: guildId_userId) để tính spam.
// Lưu trong RAM (mất khi bot restart) vì đây chỉ là dữ liệu tạm thời phục vụ phát hiện tức thời.
const userSpamHistory = new Map();

function getSpamHistory(guildId, userId) {
  const key = `${guildId}_${userId}`;
  let entry = userSpamHistory.get(key);
  if (!entry) {
    entry = [];
    userSpamHistory.set(key, entry);
  }
  return entry;
}

// Xóa hàng loạt các tin nhắn spam đã bắt được, cho sạch sẽ server. Xóa song song từng cái,
// bỏ qua lỗi (tin đã bị xóa trước đó / bot thiếu quyền Manage Messages ở kênh đó).
async function deleteSpamMessages(entries) {
  await Promise.allSettled(
    entries.map(e => (e.message && e.message.deletable) ? e.message.delete().catch(() => {}) : Promise.resolve())
  );
}

async function logAutomod(msg, reason, type, channelId, timedOut, errorReason) {
  if (!msg.guild || !channelId) return;
  const TYPE_LABELS = { fixed: "📋 Spam câu cố định", emoji: "😂 Spam Emoji", image: "🖼️ Spam ảnh", mention: "📛 Spam Tag" };
  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle(`🚨 Automod: ${TYPE_LABELS[type] || type}`)
    .addFields(
      { name: "Người bị xử lý", value: `${msg.member} (${msg.author.id})`, inline: false },
      { name: "Kênh", value: `${msg.channel}`, inline: false },
      { name: "Nguyên nhân", value: reason, inline: false },
      { name: "Trạng thái Timeout", value: timedOut ? "<a:emoji_75:1524039622668189806> Đã timeout thành công" : `️<a:emoji_76:1524195723996823612>  KHÔNG timeout được — ${errorReason || "Không rõ lý do"}`, inline: false },
      { name: "Nội dung tin nhắn gần nhất", value: `\`\`\`\n${(msg.content || "").slice(0, 900) || "(Trống / Chỉ có ảnh)"}\n\`\`\`` }
    )
    .setTimestamp();

  try {
    const logChannel = msg.guild.channels.cache.get(channelId) || (await msg.guild.channels.fetch(channelId).catch(() => null));
    if (!logChannel) return;
    await logChannel.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

// Áp timeout theo cấu hình automod (thời lượng riêng theo phút, kênh log riêng) - dùng chung
// logic kiểm tra vai trò an toàn / quyền hạn y hệt hàm applyTimeout() gốc phía trên.
// Khác với bản cũ: giờ sẽ trả về lý do CỤ THỂ nếu timeout thất bại (thay vì fail âm thầm),
// để admin biết ngay là do thiếu quyền hay do Role của Bot thấp hơn người vi phạm.
async function applyAutomodTimeout(msg, reason, type, timeoutMinutes, channelId) {
  if (!msg.member) {
    await logAutomod(msg, reason, type, channelId, false, "Không lấy được thông tin thành viên.").catch(() => {});
    return false;
  }

  // Đã bỏ bảo vệ theo TÊN role (trước đây hễ role tên chứa "ADMIN"/"OWNER"/... là auto miễn,
  // bất kể vị trí cao hay thấp hơn Bot). Giờ chỉ dựa vào vị trí Role thật trong server:
  // Role nào (kể cả Admin) đang THẤP HƠN Role cao nhất của Bot đều sẽ bị mute như bình thường.

  const me = msg.guild.members.me;
  if (!me) {
    await logAutomod(msg, reason, type, channelId, false, "Không lấy được thông tin Bot trong server.").catch(() => {});
    return false;
  }

  const durationMs = Math.max(1, timeoutMinutes || 10) * 60 * 1000;
  let timedOut = false;
  let errorReason = null;

  if (!me.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
    errorReason = "Bot đang THIẾU quyền **Timeout Members (Moderate Members)** trong server.";
  } else if (msg.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    // KHÔNG sửa được bằng code: Discord chặn cứng timeout với bất kỳ ai có quyền Administrator,
    // dù Role của Bot có được kéo cao hơn đến đâu. Muốn mute được người này thì phải gỡ quyền
    // Administrator khỏi role của họ, hoặc dùng hình thức khác (kick/ban/gỡ role) thay vì mute.
    errorReason = "Người này có quyền **Administrator** -> Discord KHÔNG cho phép Timeout/Mute bất kỳ ai có quyền này (giới hạn từ chính Discord, không phải lỗi Bot). Muốn xử lý được, cần gỡ quyền Administrator khỏi Role đó hoặc dùng hình thức khác (kick/ban/gỡ role).";
  } else if (!msg.member.moderatable) {
    errorReason = "Role của người này đang CAO HƠN hoặc BẰNG Role cao nhất của Bot -> cần vào Cài đặt Server, kéo Role của Bot lên cao hơn Role của người này.";
  } else {
    try {
      await msg.member.timeout(durationMs, reason);
      timedOut = true;
    } catch (err) {
      errorReason = `Lỗi khi gọi timeout: ${err.message}`;
    }
  }

  await logAutomod(msg, reason, type, channelId, timedOut, errorReason).catch(() => {});
  return timedOut;
}

// Kiểm tra 1 tin nhắn mới có vi phạm automod hay không. Trả về true nếu đã xử lý (đã timeout)
// để nơi gọi biết mà dừng xử lý tiếp (không coi tin nhắn spam là lệnh trả key/link video...).
async function checkAutomod(msg) {
  const amCfg = getGuildConfig(msg.guild.id).automodConfig;

  // Kênh (hoặc thread con của kênh) nằm trong danh sách miễn -> bỏ qua Automod hoàn toàn, không kiểm tra gì cả.
  const exempt = amCfg.exemptChannels || [];
  if (exempt.includes(msg.channel.id) || (msg.channel.parentId && exempt.includes(msg.channel.parentId))) return false;

  if (!amCfg.fixedMessage.enabled && !amCfg.emojiSpam.enabled && !amCfg.imageSpam.enabled && !amCfg.mentionSpam.enabled) return false;

  const now = Date.now();
  const history = getSpamHistory(msg.guild.id, msg.author.id);
  const content = (msg.content || "").trim();
  const imageCount = msg.attachments ? [...msg.attachments.values()].filter(a => (a.contentType || "").startsWith("image/")).length : 0;
  const emojiCount = countEmojis(content);
  const mentionCount = countMentions(msg);

  history.push({ content, time: now, imageCount, emojiCount, mentionCount, message: msg });
  // Dọn các bản ghi đã quá cửa sổ thời gian để danh sách không phình to vô hạn.
  while (history.length && now - history[0].time > SPAM_WINDOW_MS) history.shift();

  // 1) Spam câu cố định: cùng 1 nội dung (không rỗng) lặp lại đủ số lần trong cửa sổ.
  if (amCfg.fixedMessage.enabled && content) {
    const matched = history.filter(h => h.content === content);
    if (matched.length >= FIXED_MSG_THRESHOLD) {
      userSpamHistory.set(`${msg.guild.id}_${msg.author.id}`, []);
      await deleteSpamMessages(matched); // Xóa sạch toàn bộ tin nhắn spam cho gọn server
      await applyAutomodTimeout(msg, `Spam câu cố định (lặp lại ${matched.length} lần trong ${SPAM_WINDOW_MS / 1000}s)`, "fixed", amCfg.fixedMessage.timeoutMinutes, amCfg.fixedMessage.channelId);
      return true;
    }
  }

  // 2) Spam Emoji: 1 tin nhắn có quá nhiều emoji, HOẶC nhiều tin nhắn chứa emoji liên tiếp.
  if (amCfg.emojiSpam.enabled) {
    const emojiMsgs = history.filter(h => h.emojiCount > 0);
    if (emojiCount >= EMOJI_COUNT_THRESHOLD || emojiMsgs.length >= EMOJI_MSG_THRESHOLD) {
      userSpamHistory.set(`${msg.guild.id}_${msg.author.id}`, []);
      // Nếu bắt do 1 tin quá nhiều emoji thì chỉ xóa tin đó, còn bắt do spam nhiều tin thì xóa cả loạt.
      await deleteSpamMessages(emojiCount >= EMOJI_COUNT_THRESHOLD ? [{ message: msg }] : emojiMsgs);
      await applyAutomodTimeout(msg, `Spam Emoji (${emojiCount >= EMOJI_COUNT_THRESHOLD ? `${emojiCount} emoji trong 1 tin` : `${emojiMsgs.length} tin nhắn chứa emoji liên tiếp`})`, "emoji", amCfg.emojiSpam.timeoutMinutes, amCfg.emojiSpam.channelId);
      return true;
    }
  }

  // 3) Spam ảnh: tổng số ảnh gửi liên tiếp trong cửa sổ vượt ngưỡng.
  if (amCfg.imageSpam.enabled) {
    const imageMsgs = history.filter(h => h.imageCount > 0);
    const totalImages = imageMsgs.reduce((sum, h) => sum + h.imageCount, 0);
    if (totalImages >= IMAGE_SPAM_THRESHOLD) {
      userSpamHistory.set(`${msg.guild.id}_${msg.author.id}`, []);
      await deleteSpamMessages(imageMsgs); // Xóa sạch toàn bộ ảnh spam cho gọn server
      await applyAutomodTimeout(msg, `Spam ảnh (gửi ${totalImages} ảnh trong ${SPAM_WINDOW_MS / 1000}s)`, "image", amCfg.imageSpam.timeoutMinutes, amCfg.imageSpam.channelId);
      return true;
    }
  }

  // 4) Spam Tag: tag quá nhiều người chơi/role trong CÙNG 1 tin, HOẶC nhiều tin nhắn chứa tag liên tiếp.
  if (amCfg.mentionSpam.enabled) {
    const mentionMsgs = history.filter(h => h.mentionCount > 0);
    if (mentionCount >= MENTION_COUNT_THRESHOLD || mentionMsgs.length >= MENTION_MSG_THRESHOLD) {
      userSpamHistory.set(`${msg.guild.id}_${msg.author.id}`, []);
      // Nếu bắt do 1 tin tag quá nhiều người/role thì chỉ xóa tin đó, còn bắt do spam nhiều tin thì xóa cả loạt.
      await deleteSpamMessages(mentionCount >= MENTION_COUNT_THRESHOLD ? [{ message: msg }] : mentionMsgs);
      await applyAutomodTimeout(msg, `Spam Tag (${mentionCount >= MENTION_COUNT_THRESHOLD ? `tag ${mentionCount} người/role trong 1 tin` : `${mentionMsgs.length} tin nhắn chứa tag liên tiếp`})`, "mention", amCfg.mentionSpam.timeoutMinutes, amCfg.mentionSpam.channelId);
      return true;
    }
  }

  return false;
}

// ===================== GIÁM SÁT SERVER (lệnh /editing-log) =====================
// Gửi 1 embed bất kỳ vào kênh giám sát đã cấu hình cho server (nếu đã bật).
async function sendAuditLog(guild, embed) {
  try {
    const alCfg = getGuildConfig(guild.id).auditLogConfig;
    if (!alCfg.enabled || !alCfg.channelId) return;
    const ch = guild.channels.cache.get(alCfg.channelId) || (await guild.channels.fetch(alCfg.channelId).catch(() => null));
    if (!ch) return;
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

// Ghi log tin nhắn mới (nhắn tin / gửi ảnh). Theo đúng yêu cầu: KHÔNG ghi log nếu tin nhắn
// đó là 1 lệnh gọi key của hệ thống chatbot (trùng khớp data[]) hoặc là link bypass tự động.
async function logAuditMessage(msg) {
  try {
    if (!msg.guild || msg.author.bot) return;
    const alCfg = getGuildConfig(msg.guild.id).auditLogConfig;
    if (!alCfg.enabled || !alCfg.channelId) return;

    const normContent = normalize(msg.content);
    if (normContent && data[normContent]) return; // Là lệnh gọi key (chatbot) -> bỏ qua theo yêu cầu
    if (/https:\/\/auth\.platorelay\.com\/a\?d=[^\s]+/.test(msg.content || "")) return; // Là link bypass -> bỏ qua theo yêu cầu

    const attachments = [...msg.attachments.values()];
    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setTitle("💬 Tin nhắn mới")
      .addFields(
        { name: "Người gửi", value: `${msg.author} (${msg.author.id})`, inline: false },
        { name: "Kênh", value: `${msg.channel}`, inline: false },
        { name: "Nội dung", value: msg.content ? `\`\`\`\n${msg.content.slice(0, 900)}\n\`\`\`` : "(Không có văn bản)" }
      )
      .setTimestamp();

    if (attachments.length > 0) {
      embed.addFields({ name: `📎 Đính kèm (${attachments.length})`, value: attachments.map(a => a.url).join("\n").slice(0, 1000) });
      const firstImage = attachments.find(a => (a.contentType || "").startsWith("image/"));
      if (firstImage) embed.setImage(firstImage.url);
    }

    await sendAuditLog(msg.guild, embed);
  } catch (err) {
    console.error("Lỗi ghi audit log tin nhắn:", err);
  }
}

// Ghi log tin nhắn / ảnh bị xóa.
// LƯU Ý: nếu tin nhắn không nằm trong cache (bot mới khởi động lại, hoặc tin quá cũ),
// Discord sẽ không gửi lại nội dung gốc -> phần "Nội dung" sẽ hiện là không có dữ liệu.
client.on("messageDelete", async msg => {
  try {
    if (!msg.guild || msg.author?.bot) return;
    const alCfg = getGuildConfig(msg.guild.id).auditLogConfig;
    if (!alCfg.enabled || !alCfg.channelId) return;

    const attachments = msg.attachments ? [...msg.attachments.values()] : [];
    const embed = new EmbedBuilder()
      .setColor("#e74c3c")
      .setTitle("🗑️ Tin nhắn đã bị xóa")
      .addFields(
        { name: "Người gửi", value: msg.author ? `${msg.author} (${msg.author.id})` : "Không rõ (tin nhắn không có trong cache)", inline: false },
        { name: "Kênh", value: `${msg.channel}`, inline: false },
        { name: "Nội dung", value: msg.content ? `\`\`\`\n${msg.content.slice(0, 900)}\n\`\`\`` : "(Không có nội dung lưu trong cache)" }
      )
      .setTimestamp();

    if (attachments.length > 0) {
      embed.addFields({ name: `📎 Ảnh/File đã xóa (${attachments.length})`, value: attachments.map(a => a.url).join("\n").slice(0, 1000) });
    }

    await sendAuditLog(msg.guild, embed);
  } catch (err) {
    console.error("Lỗi ghi audit log xóa tin nhắn:", err);
  }
});

// Ghi log khi có người thả emoji/reaction vào 1 tin nhắn bất kỳ.
client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.partial) {
      try { await reaction.fetch(); } catch { return; }
    }
    const guild = reaction.message.guild;
    if (!guild) return;
    const alCfg = getGuildConfig(guild.id).auditLogConfig;
    if (!alCfg.enabled || !alCfg.channelId) return;

    const emojiDisplay = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const embed = new EmbedBuilder()
      .setColor("#f1c40f")
      .setTitle("😀 Thả Emoji / Reaction")
      .addFields(
        { name: "Người thả", value: `${user} (${user.id})`, inline: false },
        { name: "Kênh", value: `${reaction.message.channel}`, inline: false },
        { name: "Emoji", value: `${emojiDisplay}`, inline: true },
        { name: "Trên tin nhắn của", value: reaction.message.author ? `${reaction.message.author}` : "Không rõ", inline: true }
      )
      .setTimestamp();

    await sendAuditLog(guild, embed);
  } catch (err) {
    console.error("Lỗi ghi audit log reaction:", err);
  }
});

// Ghi log khi có role được cấp/gỡ cho 1 thành viên, kèm tra ai là người thực hiện qua Audit Log của Discord.
// Cần bot có quyền "Xem nhật ký kiểm duyệt" (View Audit Log) thì mới xác định được người thực hiện.
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const alCfg = getGuildConfig(newMember.guild.id).auditLogConfig;
    if (!alCfg.enabled || !alCfg.channelId) return;

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const addedRoles = newRoles.filter(r => !oldRoles.has(r.id));
    const removedRoles = oldRoles.filter(r => !newRoles.has(r.id));
    if (addedRoles.size === 0 && removedRoles.size === 0) return;

    let executor = "Không rõ (Bot thiếu quyền Xem nhật ký kiểm duyệt, hoặc do hệ thống tự động cấp)";
    try {
      const logs = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 });
      const entry = logs.entries.find(e => e.target?.id === newMember.id && (Date.now() - e.createdTimestamp) < 10000);
      if (entry && entry.executor) executor = `${entry.executor} (${entry.executor.id})`;
    } catch {}

    const embed = new EmbedBuilder()
      .setColor("#9b59b6")
      .setTitle("🎭 Thay đổi Vai trò (Role)")
      .addFields(
        { name: "Thành viên bị thay đổi", value: `${newMember} (${newMember.id})`, inline: false },
        { name: "Người thực hiện", value: executor, inline: false }
      )
      .setTimestamp();

    if (addedRoles.size > 0) embed.addFields({ name: "<a:emoji_75:1524039622668189806> Vai trò được cấp", value: addedRoles.map(r => `${r}`).join(", ") });
    if (removedRoles.size > 0) embed.addFields({ name: "<a:emoji_76:1524195723996823612>  Vai trò bị gỡ", value: removedRoles.map(r => `${r}`).join(", ") });

    await sendAuditLog(newMember.guild, embed);
  } catch (err) {
    console.error("Lỗi ghi audit log role:", err);
  }
});

// ===================== EVENT: AUTO ADD ROLE MEMBER =====================
client.on("guildMemberAdd", async (member) => {
  try {
    const roleSpec = ROLES_DATA.find(r => r.isMember);
    if (!roleSpec) return;

    const role = member.guild.roles.cache.find(r => r.name === roleSpec.name);
    if (role) {
      await member.roles.add(role, "Hệ thống tự động cấp vai trò cho thành viên mới tham gia").catch(console.error);
    }
  } catch (err) {
    console.error("Lỗi tự động thêm role thành viên:", err);
  }
});

// ===================== MESSAGES HANDLING =====================
client.on("messageCreate", async msg => {
 try {
   if (msg.author.bot || !msg.guild) return;

   // ===== GIÁM SÁT SERVER (/editing-log) - ghi log trước, không chặn luồng xử lý phía dưới =====
   logAuditMessage(msg);

   // ===== AUTOMOD CHỐNG SPAM (/automod) - nếu phát hiện & đã xử lý (timeout) thì dừng luôn,
   // không coi tin nhắn spam là lệnh trả key hay link video =====
   if (await checkAutomod(msg)) return;

      // ====================================================================
   // AUTO BYPASS (Cảm biến tự động kích hoạt khi có link)
   // ====================================================================
   const bypassMatch = msg.content.match(/https:\/\/auth\.platorelay\.com\/a\?d=[^\s]+/);
   if (bypassMatch) {
     const url = bypassMatch[0]; // Bắt chính xác nguyên đường link
     const startTime = Date.now(); 
     const apiKey = "6bp_948931f141bae7134d8d7763fe67395f"; 

     // 1. Gửi UI Loading ngay lập tức
     const loadingEmbed = new EmbedBuilder()
       .setColor("#2b2d31")
       .setTitle("<a:emoji_78:1526470876567044136>Bypassing...") 
       .setDescription("Đang tiến hành lấy key tự động, vui lòng chờ trong giây lát...");
       
     const responseMsg = await msg.reply({ 
       content: `<@${msg.author.id}>`, 
       embeds: [loadingEmbed] 
     });

     // 2. Gọi API để lấy Key
     try {
       const apiUrl = `https://6bypass.nyxoriavn.workers.dev/api/v1/bypass?url=${encodeURIComponent(url)}&api_key=${apiKey}`;
       const response = await fetch(apiUrl, { method: 'GET' });
       
       if (!response.ok) {
         throw new Error(`API trả về mã lỗi: ${response.status}`);
       }

       const rawData = await response.text();
       let resultText = rawData.trim();

       // Xử lý JSON nếu có
       try {
         const jsonObj = JSON.parse(rawData);
         resultText = (jsonObj.result || jsonObj.key || jsonObj.bypassed || rawData).trim(); 
       } catch (e) {}

       if (!resultText || resultText === "") {
          throw new Error("API không trả về kết quả nào.");
       }

       const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

       // 3. Edit UI thành kết quả (Giống hệt lệnh bypass thủ công)
       const resultEmbed = new EmbedBuilder()
         .setColor("#2b2d31")
         .setTitle("<a:emoji_75:1524039622668189806> Bypass Success")
         .setDescription("Your key has been retrieved. Copy it and input it into the application.")
         .addFields(
           { name: "Mobile Version", value: resultText }, 
           { name: "PC Version", value: `\`\`\`text\n${resultText}\n\`\`\`` }
         )
         .setFooter({ 
           text: `Auto-Bypassed for ${msg.author.username} • ⏱️ ${executionTime}s`, 
           iconURL: msg.author.displayAvatarURL() 
         });

       return await responseMsg.edit({ 
         content: `<@${msg.author.id}>`, 
         embeds: [resultEmbed] 
       });

     } catch (error) {
       console.error("Lỗi khi tự động Bypass:", error);
       
       const errorEmbed = new EmbedBuilder()
         .setColor("#FF0000")
         .setTitle("<a:emoji_76:1524195723996823612> Bypass Thất Bại")
         .setDescription(`Có lỗi xảy ra trong quá trình lấy key.\n**Chi tiết lỗi:** \`${error.message}\``);

       return await responseMsg.edit({ 
         content: `<@${msg.author.id}>`, 
         embeds: [errorEmbed] 
       });
     }
   }
   // ================= END AUTO BYPASS =================
   
   const text = normalize(msg.content);

   // ===== TRẢ KEY VÀ KIỂM TRA KÊNH CHUNG CHO CÁC SERVER =====
   if (text && data[text]) {
     const sCfg = getGuildConfig(msg.guild.id); // Lấy cấu hình riêng của server này
     
     // Nếu server đã thiết lập kênh gõ key cụ thể, thì bắt buộc phải gõ đúng kênh đó
     if (sCfg.allowedKeyChannels.length > 0 && !sCfg.allowedKeyChannels.includes(msg.channel.id)) {
       const muted = await applyTimeout(msg, "Dùng key ở kênh không cho phép", "KEY");
       if (muted) {
         await msg.reply("<a:emoji_76:1524195723996823612> Bạn đã bị khóa mõm (timeout) vì sử dụng key sai kênh quy định.").catch(() => {});
       } else {
         await msg.reply("<a:emoji_76:1524195723996823612> Không được sử dụng key ở kênh này! Vui lòng dùng đúng kênh.").catch(() => {});
       }
       return;
     }

      const raw = String(data[text]).replace(/```/g, "");

      return msg.reply({
        embeds: [
          new EmbedBuilder().setColor("#00ff99").setTitle(`🔑 ${text}`).setDescription(`\`\`\`\n${raw}\n\`\`\`\n`)
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`copy_pc_${text}`).setLabel("💻 Copy PC").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`copy_mobile_${text}`).setLabel("📱 Copy Mobile").setStyle(ButtonStyle.Success)
          )
        ]
      });
    }

    // ===== TỰ ĐỘNG BẮT LINK VIDEO =====
    const match = msg.content.match(/https?:\/\/[^\s]+/);
    if (!match) return;

    const url = match[0];

    const vCfg = getGuildConfig(msg.guild.id).videoConfig;

    // Tính năng đã bị tắt cho cả server -> bỏ qua hoàn toàn
    if (!vCfg.enabled) return;

    // Nếu server đã giới hạn kênh cụ thể, chỉ tự động tải ở đúng những kênh đó
    if (vCfg.allowedChannels.length > 0 && !vCfg.allowedChannels.includes(msg.channel.id)) return;

    // Chỉ tải các nền tảng được bật cho server này (mặc định KHÔNG gồm youtu vì
    // link YouTube Discord đã tự embed ra trình phát xem trực tiếp được, tải về vừa tốn
    // tài nguyên vừa dư thừa)
    const PLATFORM_KEYS = ["tiktok", "facebook", "instagram", "youtu"]; // "youtu" khớp cả youtube.com lẫn youtu.be
    const matchedKey = PLATFORM_KEYS.find(x => url.includes(x));
    if (!matchedKey) return;
    if (!vCfg.platforms.includes(matchedKey)) return;

    await handleVideo(msg, url);
  } catch (err) {
    console.error("Lỗi xử lý tin nhắn messageCreate:", err);
  }
});

const ALL_BANKS = [
  { name: "(970415) VietinBank", value: "970415" },
  { name: "(970436) Vietcombank", value: "970436" },
  { name: "(970418) BIDV", value: "970418" },
  { name: "(970405) Agribank", value: "970405" },
  { name: "(970448) OCB", value: "970448" },
  { name: "(970422) MBBank", value: "970422" },
  { name: "(970407) Techcombank", value: "970407" },
  { name: "(970416) ACB", value: "970416" },
  { name: "(970432) VPBank", value: "970432" },
  { name: "(970423) TPBank", value: "970423" },
  { name: "(970403) Sacombank", value: "970403" },
  { name: "(970437) HDBank", value: "970437" },
  { name: "(970454) VietCapitalBank", value: "970454" },
  { name: "(970429) SCB", value: "970429" },
  { name: "(970441) VIB", value: "970441" },
  { name: "(970443) SHB", value: "970443" },
  { name: "(970431) Eximbank", value: "970431" },
  { name: "(970426) MSB", value: "970426" },
  { name: "(546034) CAKE", value: "546034" },
  { name: "(546035) Ubank", value: "546035" },
  { name: "(971005) ViettelMoney", value: "971005" },
  { name: "(963388) Timo", value: "963388" },
  { name: "(971011) VNPTMoney", value: "971011" },
  { name: "(970400) SaigonBank", value: "970400" },
  { name: "(970409) BacABank", value: "970409" },
  { name: "(971025) MoMo", value: "971025" },
  { name: "(971133) PVcomBank Pay", value: "971133" },
  { name: "(970412) PVcomBank", value: "970412" },
  { name: "(970414) MBV", value: "970414" },
  { name: "(970419) NCB", value: "970419" },
  { name: "(970424) ShinhanBank", value: "970424" },
  { name: "(970425) ABBANK", value: "970425" },
  { name: "(970427) VietABank", value: "970427" },
  { name: "(970428) NamABank", value: "970428" },
  { name: "(970430) PGBank", value: "970430" },
  { name: "(970433) VietBank", value: "970433" },
  { name: "(970438) BaoVietBank", value: "970438" },
  { name: "(970440) SeABank", value: "970440" },
  { name: "(970446) COOPBANK", value: "970446" },
  { name: "(970449) LPBank", value: "970449" },
  { name: "(970452) KienLongBank", value: "970452" },
  { name: "(668888) KBank", value: "668888" },
  { name: "(977777) MAFC", value: "977777" },
  { name: "(970442) HongLeong", value: "970442" },
  { name: "(970467) KEBHANAHN", value: "970467" },
  { name: "(970466) KEBHanaHCM", value: "970466" },
  { name: "(533948) Citibank", value: "533948" },
  { name: "(970444) CBBank", value: "970444" },
  { name: "(422589) CIMB", value: "422589" },
  { name: "(796500) DBSBank", value: "796500" },
  { name: "(970406) Vikki", value: "970406" },
  { name: "(999888) VBSP", value: "999888" },
  { name: "(970408) GPBank", value: "970408" },
  { name: "(970463) KookminHCM", value: "970463" },
  { name: "(970462) KookminHN", value: "970462" },
  { name: "(970457) Woori", value: "970457" },
  { name: "(970421) VRB", value: "970421" },
  { name: "(458761) HSBC", value: "458761" },
  { name: "(970455) IBKHN", value: "970455" },
  { name: "(970456) IBKHCM", value: "970456" },
  { name: "(970434) IndovinaBank", value: "970434" },
  { name: "(970458) UnitedOverseas", value: "970458" },
  { name: "(801011) Nonghyup", value: "801011" },
  { name: "(970410) StandardChartered", value: "970410" },
  { name: "(970439) PublicBank", value: "970439" }
];

// ===================== INTERACTIONS EXECUTION =====================
client.on("interactionCreate", async i => {
  try {
     if (i.isAutocomplete()) {
      const focusedValue = i.options.getFocused().toLowerCase();
      
      // Gợi ý cho lệnh qrbank (đã có sẵn)
      if (i.commandName === "qrbank") {
        const filtered = ALL_BANKS.filter(bank => 
          bank.name.toLowerCase().includes(focusedValue) || 
          bank.value.includes(focusedValue)
        );
        await i.respond(filtered.slice(0, 25));
        return;
      }
      
      // Gợi ý danh sách Server mà bot ĐANG tham gia cho lệnh ban-server
      if (i.commandName === "ban-server") {
        const choices = i.client.guilds.cache.map(g => ({ name: `${g.name} (${g.id})`, value: g.id }));
        const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedValue)).slice(0, 25);
        await i.respond(filtered);
        return;
      }

      // Gợi ý danh sách Server ĐÃ BỊ BAN cho lệnh unban-server
      if (i.commandName === "unban-server") {
        const choices = Object.values(bannedServers).map(s => ({ name: `${s.name} (${s.id})`, value: s.id }));
        const filtered = choices.filter(c => c.name.toLowerCase().includes(focusedValue)).slice(0, 25);
        await i.respond(filtered);
        return;
      }
      
      return;
    }
    
    if (i.isChatInputCommand()) {
      // [CHÈN VÀO ĐÂY]: GIAO DIỆN TẠO QRBANK MỚI 
      if (i.commandName === "qrbank") {
        const bankBin = i.options.getString("bank"); 
        const accountNumber = i.options.getString("account_number"); 
        const template = i.options.getString("template"); 

        await i.deferReply(); 

        const bankInfo = ALL_BANKS.find(b => b.value === bankBin);
        if (!bankInfo) {
          return i.editReply({ content: "<a:emoji_76:1524195723996823612>  Ngân hàng không hợp lệ. Vui lòng chọn từ danh sách." });
        }

        try {
          const vietqrUrl = `https://img.vietqr.io/image/${bankBin}-${accountNumber}-${template}.png`;
          const embed = new EmbedBuilder()
            .setColor("#00B050")
            .setTitle("<a:emoji_75:1524039622668189806> Mã QR Thanh Toán")
            .setDescription(`🏦 **Ngân hàng:** \`${bankInfo.name}\`\n💳 **Số tài khoản:** \`${accountNumber}\`\n🎨 **Giao diện:** \`${template}\``)
            .setImage(vietqrUrl)
            .setFooter({ text: `Cung cấp bởi vietqr.io`, iconURL: i.user.displayAvatarURL() })
            .setTimestamp();

          return i.editReply({ embeds: [embed] });
        } catch (error) {
          console.error(error);
          return i.editReply({ content: "<a:emoji_76:1524195723996823612>  Có lỗi xảy ra trong quá trình tạo QR." });
        }
      }
          // ====================================================================
      // LỆNH TẠO MÃ QR BANK (VIETQR.IO API)
      // ====================================================================
      if (i.commandName === "qrbank") {
        const bankBin = i.options.getString("bank");
        const accountNumber = i.options.getString("account_number");
        const template = i.options.getString("template");

        await i.deferReply(); // Hoãn phản hồi chờ API xử lý

        try {
          // Tạo URL trực tiếp tới hệ thống API của VietQR dựa trên lựa chọn của người dùng
          // Cấu trúc chuẩn: https://img.vietqr.io/image/{bin}-{account}-{template}.png
          const vietqrUrl = `https://img.vietqr.io/image/${bankBin}-${accountNumber}-${template}.png`;

          const embed = new EmbedBuilder()
            .setColor("#00B050") // Đặt màu xanh lá chuẩn của VietQR
            .setTitle("<a:emoji_75:1524039622668189806> Khởi tạo mã QR Thanh Toán thành công!")
            .setDescription(`Dưới đây là mã QR chuyển khoản của bạn được tạo từ hệ thống **vietqr.io**.\n\n🏦 **Mã BIN Ngân hàng:** \`${bankBin}\`\n💳 **Số tài khoản:** \`${accountNumber}\`\n🎨 **Giao diện (Template):** \`${template}\``)
            .setImage(vietqrUrl)
            .setFooter({ 
              text: `Yêu cầu bởi ${i.user.username} | Powered by vietqr.io`, 
              iconURL: i.user.displayAvatarURL() 
            })
            .setTimestamp();

          return i.editReply({ embeds: [embed] });

        } catch (error) {
          console.error("Lỗi khi tạo QR Bank:", error);
          return i.editReply({ 
            content: `<a:emoji_76:1524195723996823612> Có lỗi xảy ra trong quá trình kết nối tới vietqr.io: ${error.message}` 
          });
        }
      }
      
          // ====================================================================
      // LỆNH TẠO MÃ QR CODE (LINK & DOCUMENT)
      // ====================================================================
      if (i.commandName === "qr") {
        const link = i.options.getString("link");
        const document = i.options.getString("document");

        // Kiểm tra xem người dùng có nhập ít nhất 1 trong 2 trường không
        if (!link && !document) {
          return i.reply({ 
            content: "<a:emoji_76:1524195723996823612> Lỗi: Bạn phải nhập dữ liệu vào ô `link` HOẶC ô `document` để tạo QR!", 
            ephemeral: true 
          });
        }

        // Ưu tiên lấy link nếu họ nhập cả 2, nếu không thì lấy document
        const inputData = link || document;
        const inputType = link ? "Link URL" : "Văn bản (Document)";

        await i.deferReply(); // Hoãn phản hồi để bot có thời gian tạo ảnh

        try {
          // Mã hóa dữ liệu để bỏ vào URL
          const encodedData = encodeURIComponent(inputData);
          
          // Sử dụng API qrserver để tạo QR cực nhanh và ổn định
          const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodedData}&margin=20`;

          const embed = new EmbedBuilder()
            .setColor("#00E5FF")
            .setTitle("<a:emoji_75:1524039622668189806> Khởi tạo mã QR thành công!")
            .addFields(
              { name: "Phân loại", value: `\`${inputType}\``, inline: true },
              { name: "Nội dung", value: `\`\`\`text\n${inputData.length > 1000 ? inputData.substring(0, 1000) + "..." : inputData}\n\`\`\``, inline: false }
            )
            .setImage(qrImageUrl)
            .setFooter({ 
              text: `Yêu cầu bởi ${i.user.username}`, 
              iconURL: i.user.displayAvatarURL() 
            })
            .setTimestamp();

          return i.editReply({ embeds: [embed] });

        } catch (error) {
          console.error("Lỗi khi tạo QR:", error);
          return i.editReply({ 
            content: `<a:emoji_76:1524195723996823612> Có lỗi xảy ra trong quá trình tạo mã QR: ${error.message}` 
          });
        }
      }
          // ====================================================================
    // XỬ LÝ THANH TÌM KIẾM NGÂN HÀNG (AUTOCOMPLETE)
    // ====================================================================
    if (i.isAutocomplete()) {
      if (i.commandName === "qrbank") {
        const focusedValue = i.options.getFocused().toLowerCase();
        
        // Lọc danh sách ngân hàng dựa trên chữ mà người dùng đang gõ
        const filtered = ALL_BANKS.filter(bank => 
          bank.name.toLowerCase().includes(focusedValue)
        );

        // Trả về tối đa 25 kết quả phù hợp nhất để tránh lỗi API của Discord
        await i.respond(filtered.slice(0, 25));
      }
      return; // Dừng lại ở đây, không chạy xuống dưới
    }
    
                // ====================================================================
      // LỆNH BYPASS (Fix lỗi copy dư dấu nháy trên Mobile, Trim khoảng trắng)
      // ====================================================================
      if (i.commandName === "bypass") {
        const startTime = Date.now(); 
        const link = i.options.getString("link");
        const apiKey = "6bp_948931f141bae7134d8d7763fe67395f"; 

        // --------------------------------------------------
        // GIAI ĐOẠN 1: Gửi UI chờ (Loading)
        // --------------------------------------------------
        const loadingEmbed = new EmbedBuilder()
          .setColor("#2b2d31")
          .setTitle("<a:emoji_78:1526470876567044136>Bypassing...") 
          .setDescription("Đang tiến hành lấy key, vui lòng chờ trong giây lát...");
          
        await i.reply({ 
          content: `<@${i.user.id}>`, 
          embeds: [loadingEmbed] 
        });

        // --------------------------------------------------
        // GIAI ĐOẠN 2: Gọi API và Đổi UI thành Kết quả
        // --------------------------------------------------
        try {
          const apiUrl = `https://6bypass.nyxoriavn.workers.dev/api/v1/bypass?url=${encodeURIComponent(link)}&api_key=${apiKey}`;
          const response = await fetch(apiUrl, { method: 'GET' });
          
          if (!response.ok) {
            throw new Error(`API trả về mã lỗi: ${response.status}`);
          }

          const rawData = await response.text();
          
          // Dùng .trim() để dọn dẹp sạch sẽ khoảng trắng/dấu xuống dòng dư từ API
          let resultText = rawData.trim();

          // Xử lý JSON nếu có
          try {
            const jsonObj = JSON.parse(rawData);
            resultText = (jsonObj.result || jsonObj.key || jsonObj.bypassed || rawData).trim(); 
          } catch (e) {}

          if (!resultText || resultText === "") {
             throw new Error("API không trả về kết quả nào.");
          }

          const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

          // Tạo UI Kết quả: Sửa Mobile Version thành text trơn để copy mượt nhất
          const resultEmbed = new EmbedBuilder()
            .setColor("#2b2d31")
            .setTitle("<a:emoji_75:1524039622668189806> Bypass Success")
            .setDescription("Your key has been retrieved. Copy it and input it into the application.")
            .addFields(
              { name: "Mobile Version", value: resultText }, // Đã xóa dấu ` ở đây
              { name: "PC Version", value: `\`\`\`text\n${resultText}\n\`\`\`` }
            )
            .setFooter({ 
              text: `Requested by ${i.user.username} • ⏱️ ${executionTime}s`, 
              iconURL: i.user.displayAvatarURL() 
            });

          // Thay thế khung Loading thành khung Kết quả
          return i.editReply({ 
            content: `<@${i.user.id}>`, 
            embeds: [resultEmbed] 
          });

        } catch (error) {
          console.error("Lỗi khi dùng lệnh Bypass:", error);
          
          const errorEmbed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("<a:emoji_76:1524195723996823612> Bypass Thất Bại")
            .setDescription(`Có lỗi xảy ra trong quá trình lấy key.\n**Chi tiết lỗi:** \`${error.message}\``);

          return i.editReply({ 
            content: `<@${i.user.id}>`, 
            embeds: [errorEmbed] 
          });
        }
      }
      
            // ====================================================================
      // LỆNH OBFUSCATOR CHO TẤT CẢ MỌI NGƯỜI
      // ====================================================================
      if (i.commandName === "obfuscator") {
        await i.deferReply({ ephemeral: false }); // Lệnh công khai
        
        const method = i.options.getString("method");
        let rawCode = "";
        let fileName = "obfuscated.lua";

        try {
          if (method === "file") {
            const file = i.options.getAttachment("file");
            if (!file || !file.name.endsWith('.lua') && !file.name.endsWith('.txt')) {
              return i.editReply("<a:emoji_76:1524195723996823612> Vui lòng đính kèm một file `.lua` hoặc `.txt` hợp lệ vào mục tùy chọn `file`.");
            }
            const res = await fetch(file.url);
            rawCode = await res.text();
            fileName = `Obf_${file.name}`;
          } 
          else if (method === "code") {
            rawCode = i.options.getString("code");
            if (!rawCode) {
              return i.editReply("<a:emoji_76:1524195723996823612> Bạn đã chọn phương thức Code nhưng lại để trống ô `code`.");
            }
            fileName = `Obf_${Date.now()}.lua`;
          } 
          else if (method === "link") {
            const link = i.options.getString("link");
            if (!link || !link.startsWith("http")) {
              return i.editReply("<a:emoji_76:1524195723996823612> Bạn đã chọn phương thức Links, vui lòng cung cấp một đường link hợp lệ tại ô `link`.");
            }
            const res = await fetch(link);
            rawCode = await res.text();
            fileName = `Obf_${Date.now()}.lua`;
          }

          if (!rawCode.trim()) {
            return i.editReply("<a:emoji_76:1524195723996823612> Nội dung mã nguồn bị trống, không thể obfuscate.");
          }

          // Chạy bộ máy Obfuscator
          const cleanCode = CodeTransformer.process(rawCode, ObfConfig);
          const finalCode = VMCompiler.compile(cleanCode, ObfConfig);

          // Chuyển string thành dạng RAM Buffer thay vì lưu xuống ổ cứng
          const buffer = Buffer.from(finalCode, "utf-8");

          // Trả kết quả (Sau khi hàm kết thúc, biến buffer sẽ tự động bị dọn dẹp khỏi RAM)
          await i.editReply({
            content: "<a:emoji_75:1524039622668189806>  **Mã hóa thành công!** Đây là file của bạn:",
            files: [{ attachment: buffer, name: fileName }]
          });

        } catch (error) {
          console.error("Lỗi Obfuscator:", error);
          await i.editReply("<a:emoji_76:1524195723996823612> Có lỗi hệ thống xảy ra khi thực hiện mã hóa: " + error.message);
        }
        
        return; // Dừng lại ở đây, không chạy các lệnh bên dưới
      }
      // 1. Lệnh thiết lập kênh tự động phân tách theo mẫu ID (Chỉ Chủ Bot)
      if (i.commandName === "setupclent") {
        if (!OWNER_IDS.includes(i.user.id)) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Lệnh này độc quyền dành cho chủ sở hữu bot.", ephemeral: true });
        }
        const targetId = i.options.getString("id");
        if (targetId !== "1020868400672686080" && targetId !== "1427887770298486899") {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> ID mẫu không hợp lệ! Chỉ chấp nhận `1020868400672686080` (Mẫu cũ) hoặc `1427887770298486899` (Mẫu mới).", ephemeral: true });
        }
        return runSetup(i, { mode: "owner", templateId: targetId });
      }

      // 2. Lệnh tự động tạo danh sách vai trò bảo mật (Chỉ Chủ Bot)
      if (i.commandName === "taovaitro") {
        if (!OWNER_IDS.includes(i.user.id)) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Lệnh này độc quyền dành cho chủ sở hữu bot.", ephemeral: true });
        }
        await i.reply({ content: "⏳ Đang dọn dẹp các vai trò cũ và thiết lập bộ Vai trò (Roles) mới bảo mật hoàn chỉnh. Xin chờ...", ephemeral: true });
        
        try {
          const currentRoles = await i.guild.roles.fetch();
          for (const role of currentRoles.values()) {
            if (role.name !== "@everyone" && !role.managed && role.editable) {
              await role.delete().catch(() => {});
            }
          }
          
          // Tạo tuần tự từ thấp lên cao để đảm bảo đúng thứ tự hiển thị
          const orderedRoles = [...ROLES_DATA].reverse();
          for (const spec of orderedRoles) {
            await i.guild.roles.create({
              name: spec.name,
              color: spec.color,
              permissions: spec.permissions,
              reason: "Chạy lệnh tự động hóa tạo vai trò an toàn chống lạm quyền"
            });
            await sleep(100);
          }
          
          return i.followUp({ content: "<a:emoji_75:1524039622668189806>  Đã tự động khởi tạo thành công toàn bộ hệ thống vai trò mới không sợ trùng lặp/copy và được phân quyền cực kỳ an toàn!", ephemeral: true });
        } catch (err) {
          console.error(err);
          return i.followUp({ content: `<a:emoji_76:1524195723996823612> Thất bại khi tạo vai trò: ${err.message}`, ephemeral: true });
        }
      }

      // ====================================================================
      // LỆNH THÔNG BÁO TOÀN DIỆN - KHÓA MỤC TIÊU TẠI SERVER MẸ
      // ====================================================================
      if (i.commandName === "announcement") {
        // 1. Kiểm tra quyền chủ bot
        if (!OWNER_IDS.includes(i.user.id)) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Lệnh này độc quyền dành cho chủ sở hữu bot.", ephemeral: true });
        }

        const motherGuildId = "1499212510375579668";

        // 2. Chốt chặn an toàn: Bắt buộc phải đứng ở Server Mẹ mới được bấm lệnh
        if (i.guildId !== motherGuildId) {
          return i.reply({ 
            content: `<a:emoji_76:1524195723996823612> Vui lòng quay về **Server Mẹ** để thực hiện lệnh!\n*(Điều này giúp danh sách chọn kênh hiển thị chính xác các kênh của Server Mẹ, tránh gửi lộn đi nơi khác).*`, 
            ephemeral: true 
          });
        }
        
        // Hoãn phản hồi để bot có thời gian quét data gửi tin nhắn
        await i.deferReply({ ephemeral: true });
        
        const messageContent = i.options.getString("message");
        const logChannelInput = i.options.getChannel("log"); // Kênh lấy từ tùy chọn người dùng gõ

        // 3. Chốt chặn thứ hai: Xác thực lại kênh được chọn có thuộc Server Mẹ hay không
        const motherGuild = i.client.guilds.cache.get(motherGuildId) || await i.client.guilds.fetch(motherGuildId).catch(() => null);
        if (!motherGuild) {
           return i.editReply({ content: "<a:emoji_76:1524195723996823612> Không tìm thấy dữ liệu của Server Mẹ trên hệ thống bot." });
        }

        const logChannel = motherGuild.channels.cache.get(logChannelInput.id);
        if (!logChannel) {
           return i.editReply({ content: "<a:emoji_76:1524195723996823612> Lỗi bảo mật: Kênh được chọn không nằm trong Server Mẹ!" });
        }

        let successCount = 0;
        let logDetails = [];

        // 4. Quét cơ sở dữ liệu guildConfigs (từ file guild_configs.json) để rải thông báo
        for (const [gId, config] of Object.entries(guildConfigs)) {
          if (config.allowedKeyChannels && config.allowedKeyChannels.length > 0) {
             const guild = i.client.guilds.cache.get(gId) || await i.client.guilds.fetch(gId).catch(() => null);
             if (!guild) continue; 
             
             for (const chId of config.allowedKeyChannels) {
               try {
                 const channel = guild.channels.cache.get(chId) || await guild.channels.fetch(chId).catch(() => null);
                 if (channel && channel.isTextBased()) {
                   await channel.send(messageContent);
                   successCount++;
                   logDetails.push(`- Kênh <#${chId}> (Server: **${guild.name}** | ID: \`${guild.id}\`)`);
                 }
               } catch (err) {
                 // Bỏ qua nếu bot bị chặn quyền nhắn tin ở một server khách cụ thể nào đó
               }
             }
          }
        }

        // 5. Tiến hành gửi sớ Log báo cáo chi tiết về kênh má đã chọn ở Server Mẹ
        try {
          await logChannel.send(`📢 **Nhật ký thông báo:** Đã gửi thông báo hàng loạt đến **${successCount}** kênh được cấp quyền gõ key.\n**Nội dung:** ${messageContent}`);
          
          if (logDetails.length > 0) {
            // Chia nhỏ danh sách phòng trường hợp vượt quá giới hạn 2000 ký tự của Discord
            const chunks = logDetails.join('\n').match(/[\s\S]{1,1900}/g) || [];
            for (const chunk of chunks) {
               await logChannel.send(`**Danh sách các kênh đã nhận tin nhắn:**\n${chunk}`);
            }
          }
        } catch (err) {
          console.error("Lỗi gửi log thông báo:", err);
          return i.editReply({ content: `⚠️ Đã rải thông báo thành công đến ${successCount} kênh. Tuy nhiên bot thiếu quyền viết tin nhắn (Send Messages) vào kênh log ${logChannel} má vừa chọn!` });
        }

        return i.editReply({ content: `<a:emoji_75:1524039622668189806>  Tiến trình hoàn tất! Đã gửi thông báo tới ${successCount} kênh và chốt an toàn dữ liệu log về kênh ${logChannel} tại Server Mẹ.` });
      }
      
      // 3. Lệnh setup server (Đã sửa: Chỉ dành riêng cho Chủ Bot theo yêu cầu)
      if (i.commandName === "setupserver") {
        if (!OWNER_IDS.includes(i.user.id)) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Lệnh setup server độc quyền dành cho Chủ sở hữu Bot.", ephemeral: true });
        }

        const sourceGuildId = i.options.getString("source_guild_id");
        const image = i.options.getAttachment("image");

        if (sourceGuildId) return runSetup(i, { mode: "guild", sourceGuildId });
        if (image?.url) return runSetup(i, { mode: "image", image: image.url });
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Vui lòng điền source_guild_id hoặc đính kèm tệp hình ảnh.", ephemeral: true });
      }

                  // BẢO MẬT RIÊNG CHO CÁC LỆNH DATA KEY & LỆNH CHỦ BOT
      const ownerOnlyCommands = ["them", "sua", "xoa", "server-working", "ban-server", "unban-server"];

      if (i.commandName === "ban-server") {
        const guildId = i.options.getString("server_id");
        const guildToLeave = i.client.guilds.cache.get(guildId);

        if (!guildToLeave) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Không tìm thấy server này (Có thể bot đã rời đi từ trước).", ephemeral: true });
        }

        // Lưu vào data
        bannedServers[guildId] = {
          id: guildId,
          name: guildToLeave.name,
          timestamp: Date.now()
        };
        saveBannedServers();

        await i.reply({ content: `<a:emoji_75:1524039622668189806> Đã thêm **${guildToLeave.name}** vào danh sách đen. Bot đang tiến hành rời khỏi server này...`, ephemeral: true });
        
        // Bot tự động rời
        await guildToLeave.leave().catch(() => {});
        return;
      }

      if (i.commandName === "unban-server") {
        const guildId = i.options.getString("server_id");
        
        if (bannedServers[guildId]) {
          delete bannedServers[guildId];
          saveBannedServers();
          return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã gỡ ban thành công cho server ID **${guildId}**. Bot hiện có thể tham gia lại.`, ephemeral: true });
        }
        
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Server này không nằm trong danh sách đen.", ephemeral: true });
      }
      
      if (ownerOnlyCommands.includes(i.commandName)) {
        if (!OWNER_IDS.includes(i.user.id)) {
          return i.reply({
            content: "<a:emoji_76:1524195723996823612> Lệnh quản trị hệ thống dữ liệu này độc quyền dành cho Chủ sở hữu Bot.",
            ephemeral: true
          });
        }
      }
      
    
      const key = i.options.getString("key") ? normalize(i.options.getString("key")) : "";
      const value = i.options.getString("value");

      if (i.commandName === "them") {
        data[key] = value;
        save();
        return i.reply({ content: "<a:emoji_75:1524039622668189806>  Thêm dữ liệu key thành công!", ephemeral: true });
      }

      if (i.commandName === "sua") {
        data[key] = value;
        save();
        return i.reply({ content: "✏️ Cập nhật dữ liệu sửa đổi thành công!", ephemeral: true });
      }

      if (i.commandName === "xoa") {
        delete data[key];
        save();
        return i.reply({ content: "🗑️ Xóa dữ liệu key thành công!", ephemeral: true });
      }

      if (i.commandName === "list") {
        page = 1;
        return i.reply({ embeds: [makeListEmbed()], components: [listButtons()], ephemeral: true });
      }
    }

    if (i.isButton()) {
      if (i.customId === "next") page++;
      if (i.customId === "prev") page--;

      if (i.customId === "next" || i.customId === "prev") {
        return i.update({ embeds: [makeListEmbed()], components: [listButtons()] });
      }

      if (i.customId === "search") {
        const modal = new ModalBuilder().setCustomId("searchModal").setTitle("🔎 Tìm kiếm dữ liệu key");
        const input = new TextInputBuilder().setCustomId("query").setLabel("Nhập tên key cần tìm").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return i.showModal(modal);
      }

      if (i.customId.startsWith("copy_pc_")) {
        const key = i.customId.replace("copy_pc_", "");
        return i.reply({ content: `\`\`\`\n${String(data[key] || "")}\n\`\`\`\n`, ephemeral: true });
      }

      if (i.customId.startsWith("copy_mobile_")) {
        const key = i.customId.replace("copy_mobile_", "");
        return i.reply({ content: String(data[key] || ""), ephemeral: true });
      }
    }

    if (i.isModalSubmit()) {
      if (i.customId === "searchModal") {
        const q = normalize(i.fields.getTextInputValue("query"));
        const results = Object.keys(data).filter(k => k.includes(q));
        return i.reply({ content: results.length ? results.join("\n") : "<a:emoji_76:1524195723996823612> Không tìm thấy kết quả nào trùng khớp.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Lỗi trong tiến trình interactionCreate:", err);
  }
  
        if (i.commandName === "server-working") {
        // Trả lời ẩn tạm thời để tránh bot bị hiện tượng "Interaction failed" do quét dữ liệu lâu
        await i.deferReply({ ephemeral: true });

        const targetGuildId = "1499212510375579668";
        let resultMessage = "📊 **DANH SÁCH SERVER BOT ĐANG HOẠT ĐỘNG:**\n\n";
        let count = 0;

        // Vòng lặp quét qua toàn bộ server bot đang tham gia
        for (const [guildId, guild] of i.client.guilds.cache) {
          // Kiểm tra xem bạn (Chủ Bot) có mặt trong server đó không
          const isOwnerInGuild = await guild.members.fetch(i.user.id).catch(() => null);
          if (isOwnerInGuild) continue; // Nếu có bạn ở đó rồi -> Bỏ qua đúng yêu cầu!

          let inviteLink = "Không có quyền tạo link mời (CreateInstantInvite)";
          try {
            // Tìm kênh chat đầu tiên bot có quyền tạo link mời công khai
            const channel = guild.channels.cache.find(c => 
              c.type === ChannelType.GuildText && 
              c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.CreateInstantInvite)
            );
            if (channel) {
              const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 });
              inviteLink = invite.url;
            }
          } catch (err) {}

          resultMessage += `🔹 **${guild.name}** (ID: ${guild.id}) - *${guild.memberCount} thành viên*\n🔗 Link: ${inviteLink}\n\n`;
          count++;
        }

        if (count === 0) {
          resultMessage += "Không có server nào hoạt động mà không có mặt chủ bot.";
        }

        // Tìm server đích theo ID bạn cấp để gửi vào
        const targetGuild = i.client.guilds.cache.get(targetGuildId);
        if (!targetGuild) {
          return i.editReply({ content: `<a:emoji_76:1524195723996823612> Bot hiện tại không có mặt trong server đích (ID: ${targetGuildId}) để gửi log.` });
        }

                // Thay ID kênh cụ thể (ví dụ kênh #log-server) thuộc server 1499212510375579668 vào đây
        const logChannelId = "1499987535982755950"; // Bạn nhớ copy ID của KÊNH rồi dán vào đây nhé!
        
        const targetChannel = targetGuild.channels.cache.get(logChannelId);

        if (!targetChannel) {
          return i.editReply({ content: `<a:emoji_76:1524195723996823612> Không tìm thấy KÊNH có ID ${logChannelId} trong server đích.` });
        }

        if (!targetChannel.permissionsFor(targetGuild.members.me).has(PermissionsBitField.Flags.SendMessages)) {
          return i.editReply({ content: `<a:emoji_76:1524195723996823612> Bot không có quyền gửi tin nhắn (Send Messages) vào kênh <#${logChannelId}>.` });
        }


        if (!targetChannel) {
          return i.editReply({ content: `<a:emoji_76:1524195723996823612> Tìm thấy server đích nhưng bot không có quyền gửi tin nhắn vào bất kỳ kênh text nào ở đó.` });
        }

        // Cắt nhỏ tin nhắn nếu danh sách dài quá 2000 ký tự (Giới hạn của Discord)
        const chunks = resultMessage.match(/[\s\S]{1,1900}/g) || [];
        for (const chunk of chunks) {
          await targetChannel.send(chunk);
        }

        return i.editReply({ content: `<a:emoji_75:1524039622668189806>  Đã quét xong! Đã gửi danh sách gồm ${count} server về kênh ${targetChannel} của server đích thành công.` });
      }
      
  
  if (i.commandName === "capquyenkenh") {
  // Đúng yêu cầu: Chủ Bot HOẶC Admin/Owner của server có quyền Administrator/ManageGuild đều dùng được
  const isBotOwner = OWNER_IDS.includes(i.user.id);
  const isAdmin = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator) || i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  
  if (!isBotOwner && !isAdmin) {
    return i.reply({ content: "<a:emoji_76:1524195723996823612> Bạn phải là Chủ sở hữu Bot hoặc có quyền Quản trị viên (Admin) của Server này để thực hiện.", ephemeral: true });
  }

  if (!i.guild) {
    return i.reply({ content: "<a:emoji_76:1524195723996823612> Lệnh này chỉ dùng được trong server, không dùng được ở tin nhắn riêng (DM).", ephemeral: true });
  }

  const action = i.options.getString("hanh_dong");
  const targetChannel = i.options.getChannel("kenh");
  const guildId = i.guild.id;
  const sCfg = getGuildConfig(guildId);

  // Thao tác xem cấu hình hiện tại
  if (action === "view") {
    const keyChs = sCfg.allowedKeyChannels.map(id => `<#${id}>`).join(", ") || "Chưa thiết lập (Có thể gõ ở bất kỳ kênh nào)";
    const logChs = sCfg.logChannels.map(id => `<#${id}>`).join(", ") || "Chưa thiết lập";
    
    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setTitle(`⚙️ Cấu hình Server: ${i.guild.name}`)
      .addFields(
        { name: "🔑 kênh được phép chat bot script", value: keyChs },
        { name: "🚨 kênh log chat script sai kênh", value: logChs }
      )
      .setTimestamp();
    return i.reply({ embeds: [embed], ephemeral: true });
  }

  // Đối với các hành động khác thì bắt buộc phải chọn kênh
  if (!targetChannel) {
    return i.reply({ content: "<a:emoji_76:1524195723996823612> Vui lòng chọn một kênh cụ thể để thực hiện hành động này.", ephemeral: true });
  }

  if (action === "add_key") {
    if (!sCfg.allowedKeyChannels.includes(targetChannel.id)) {
      sCfg.allowedKeyChannels.push(targetChannel.id);
      saveGuildConfigs();
    }
    return i.reply({ content: `<a:emoji_75:1524039622668189806>  Đã thêm kênh ${targetChannel} vào danh sách được gõ Key cho server này.`, ephemeral: true });
  }

  if (action === "remove_key") {
    sCfg.allowedKeyChannels = sCfg.allowedKeyChannels.filter(id => id !== targetChannel.id);
    saveGuildConfigs();
    return i.reply({ content: `<a:emoji_75:1524039622668189806>  Đã xóa kênh ${targetChannel} khỏi danh sách được gõ Key.`, ephemeral: true });
  }

  if (action === "add_log") {
    if (!sCfg.logChannels.includes(targetChannel.id)) {
      sCfg.logChannels.push(targetChannel.id);
      saveGuildConfigs();
    }
    return i.reply({ content: `<a:emoji_75:1524039622668189806>  Đã thiết lập kênh ${targetChannel} làm kênh nhận Log cho server này.`, ephemeral: true });
  }

  if (action === "remove_log") {
    sCfg.logChannels = sCfg.logChannels.filter(id => id !== targetChannel.id);
    saveGuildConfigs();
    return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã xóa kênh ${targetChannel} khỏi danh sách nhận Log.`, ephemeral: true });
  }
}

    if (i.commandName === "autovideo") {
      const isBotOwner = OWNER_IDS.includes(i.user.id);
      const isAdmin = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator) || i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
      if (!isBotOwner && !isAdmin) {
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Bạn phải là Chủ sở hữu Bot hoặc có quyền Quản trị viên (Admin) của Server này để dùng lệnh này.", ephemeral: true });
      }

      const sub = i.options.getSubcommand();
      const vCfg = getGuildConfig(i.guild.id).videoConfig;
      const PLATFORM_LABELS = { tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", youtu: "YouTube" };

      if (sub === "bat") {
        vCfg.enabled = true;
        saveGuildConfigs();
        return i.reply({ content: "<a:emoji_75:1524039622668189806> Đã **BẬT** tự động tải video cho server này.", ephemeral: true });
      }

      if (sub === "tat") {
        vCfg.enabled = false;
        saveGuildConfigs();
        return i.reply({ content: "<a:emoji_75:1524039622668189806> Đã **TẮT** tự động tải video cho server này. Bot sẽ không tự tải bất kỳ link nào nữa.", ephemeral: true });
      }

      if (sub === "nentang") {
        const platform = i.options.getString("nen_tang");
        const state = i.options.getString("trang_thai");
        if (state === "on") {
          if (!vCfg.platforms.includes(platform)) vCfg.platforms.push(platform);
        } else {
          vCfg.platforms = vCfg.platforms.filter(p => p !== platform);
        }
        saveGuildConfigs();
        return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã ${state === "on" ? "**BẬT**" : "**TẮT**"} tự động tải cho nền tảng **${PLATFORM_LABELS[platform]}**.`, ephemeral: true });
      }

      if (sub === "kenh") {
        const action = i.options.getString("hanh_dong");
        const targetChannel = i.options.getChannel("kenh_chon");

        if (action === "list") {
          const allChannels = i.guild.channels.cache
            .filter(c => c.type === ChannelType.GuildText)
            .map(c => `${vCfg.allowedChannels.length === 0 || vCfg.allowedChannels.includes(c.id) ? "<a:emoji_75:1524039622668189806>" : "⛔"} <#${c.id}>`)
            .join("\n") || "Server chưa có kênh text nào.";
          const note = vCfg.allowedChannels.length === 0
            ? "\n\n📌 Hiện chưa giới hạn kênh nào -> tự động tải hoạt động ở **TẤT CẢ** kênh."
            : "\n\n📌 Chỉ những kênh có <a:emoji_75:1524039622668189806> mới được tự động tải video.";
          const embed = new EmbedBuilder()
            .setColor("#3498db")
            .setTitle(`📋 Danh sách kênh - ${i.guild.name}`)
            .setDescription(allChannels + note)
            .setTimestamp();
          return i.reply({ embeds: [embed], ephemeral: true });
        }

        if (!targetChannel) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Vui lòng chọn một kênh cụ thể để thêm/xóa.", ephemeral: true });
        }

        if (action === "add") {
          if (!vCfg.allowedChannels.includes(targetChannel.id)) {
            vCfg.allowedChannels.push(targetChannel.id);
            saveGuildConfigs();
          }
          return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã thêm ${targetChannel} vào danh sách kênh được áp dụng tự động tải video.`, ephemeral: true });
        }

        if (action === "remove") {
          vCfg.allowedChannels = vCfg.allowedChannels.filter(id => id !== targetChannel.id);
          saveGuildConfigs();
          return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã xóa ${targetChannel} khỏi danh sách kênh được áp dụng.`, ephemeral: true });
        }
      }

      if (sub === "trangthai") {
        const platformsText = ["tiktok", "facebook", "instagram", "youtu"]
          .map(p => `${vCfg.platforms.includes(p) ? "<a:emoji_75:1524039622668189806>" : "⛔"} ${PLATFORM_LABELS[p]}`)
          .join("\n");
        const channelsText = vCfg.allowedChannels.length > 0
          ? vCfg.allowedChannels.map(id => `<#${id}>`).join(", ")
          : "Tất cả kênh (chưa giới hạn)";
        const embed = new EmbedBuilder()
          .setColor(vCfg.enabled ? "#2ecc71" : "#e74c3c")
          .setTitle(`⚙️ Cấu hình Auto Video - ${i.guild.name}`)
          .addFields(
            { name: "Trạng thái tổng", value: vCfg.enabled ? "🟢 Đang BẬT" : "🔴 Đang TẮT" },
            { name: "Nền tảng", value: platformsText },
            { name: "Kênh áp dụng", value: channelsText },
            { name: "Đang tải cùng lúc", value: `${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS} (${downloadQueue.length} đang chờ)` }
          )
          .setTimestamp();
        return i.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (i.commandName === "automod") {
      // Chỉ Chủ sở hữu THẬT của Server (guild.ownerId) hoặc Chủ Bot mới dùng được -> member được cấp quyền Admin/Manage Server KHÔNG dùng được.
      const isBotOwner = OWNER_IDS.includes(i.user.id);
      const isServerOwner = i.user.id === i.guild.ownerId;
      if (!isBotOwner && !isServerOwner) {
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Chỉ có Chủ sở hữu (Owner) của Server này mới được sử dụng lệnh này.", ephemeral: true });
      }

      const loai = i.options.getString("hanh_dong");
      const trangThai = i.options.getString("trang_thai");
      const soPhut = i.options.getInteger("number_of_times");
      const kenhTB = i.options.getChannel("notification_channel");

      const KEY_MAP = { fixed: "fixedMessage", emoji: "emojiSpam", image: "imageSpam", mention: "mentionSpam" };
      const LABEL_MAP = { fixed: "Spam câu cố định", emoji: "Spam Emoji", image: "Spam ảnh", mention: "Spam Tag" };
      const amCfg = getGuildConfig(i.guild.id).automodConfig;
      const target = amCfg[KEY_MAP[loai]];

      if (trangThai === "on") {
        if (!soPhut || !kenhTB) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Khi chọn **Bật**, bạn phải điền đủ **number_of_times** (thời gian timeout, phút) và **notification_channel** (kênh thông báo).", ephemeral: true });
        }
        target.enabled = true;
        target.timeoutMinutes = soPhut;
        target.channelId = kenhTB.id;
        saveGuildConfigs();
        return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã **BẬT** Automod - **${LABEL_MAP[loai]}**.\n⏱️ Timeout: **${soPhut} phút**\n📢 Kênh thông báo: ${kenhTB}`, ephemeral: true });
      } else {
        target.enabled = false;
        saveGuildConfigs();
        return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã **TẮT** Automod - **${LABEL_MAP[loai]}**.`, ephemeral: true });
      }
    }

    if (i.commandName === "thechannelwasnotcensored") {
      const isBotOwner = OWNER_IDS.includes(i.user.id);
      const isAdmin = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator) || i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
      if (!isBotOwner && !isAdmin) {
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Bạn phải là Chủ sở hữu Bot hoặc có quyền Quản trị viên (Admin) của Server này để dùng lệnh này.", ephemeral: true });
      }

      const amCfg = getGuildConfig(i.guild.id).automodConfig;
      const action = i.options.getString("hanh_dong");
      const targetChannel = i.options.getChannel("kenh");

      if (action === "list") {
        const allChannels = i.guild.channels.cache
          .filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
          .map(c => `${amCfg.exemptChannels.includes(c.id) ? "🔕" : "🔔"} <#${c.id}>`)
          .join("\n") || "Server chưa có kênh text nào.";
        const embed = new EmbedBuilder()
          .setColor("#3498db")
          .setTitle(`📋 Danh sách kênh - Automod - ${i.guild.name}`)
          .setDescription(allChannels + "\n\n📌 🔕 = Kênh đã MIỄN, Automod KHÔNG lọc ở đây.\n📌 🔔 = Kênh vẫn bị Automod lọc bình thường.")
          .setTimestamp();
        return i.reply({ embeds: [embed], ephemeral: true });
      }

      if (!targetChannel) {
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Vui lòng chọn một kênh cụ thể để thêm/xóa.", ephemeral: true });
      }

      if (action === "them") {
        if (!amCfg.exemptChannels.includes(targetChannel.id)) {
          amCfg.exemptChannels.push(targetChannel.id);
          saveGuildConfigs();
        }
        return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã thêm ${targetChannel} vào danh sách MIỄN Automod. Bot sẽ không lọc spam ở kênh này (và các thread thuộc kênh này) nữa.`, ephemeral: true });
      }

      if (action === "xoa") {
        amCfg.exemptChannels = amCfg.exemptChannels.filter(id => id !== targetChannel.id);
        saveGuildConfigs();
        return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã xóa ${targetChannel} khỏi danh sách miễn. Automod sẽ lọc spam ở kênh này trở lại bình thường.`, ephemeral: true });
      }
    }

    if (i.commandName === "editing-log") {
      const isBotOwner = OWNER_IDS.includes(i.user.id);
      const isAdmin = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator) || i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
      if (!isBotOwner && !isAdmin) {
        return i.reply({ content: "<a:emoji_76:1524195723996823612> Bạn phải là Chủ sở hữu Bot hoặc có quyền Quản trị viên (Admin) của Server này để dùng lệnh này.", ephemeral: true });
      }

      const action = i.options.getString("hanh_dong");
      const kenhTB = i.options.getChannel("notification_channel");
      const alCfg = getGuildConfig(i.guild.id).auditLogConfig;

      if (action === "view") {
        const embed = new EmbedBuilder()
          .setColor(alCfg.enabled ? "#2ecc71" : "#e74c3c")
          .setTitle(`🕵️ Cấu hình giám sát Server - ${i.guild.name}`)
          .addFields(
            { name: "Trạng thái", value: alCfg.enabled ? "🟢 Đang BẬT" : "🔴 Đang TẮT" },
            { name: "Kênh nhận log", value: alCfg.channelId ? `<#${alCfg.channelId}>` : "Chưa thiết lập" }
          )
          .setTimestamp();
        return i.reply({ embeds: [embed], ephemeral: true });
      }

      if (action === "on") {
        if (!kenhTB) {
          return i.reply({ content: "<a:emoji_76:1524195723996823612> Vui lòng chọn **notification_channel** để bật giám sát.", ephemeral: true });
        }
        alCfg.enabled = true;
        alCfg.channelId = kenhTB.id;
        saveGuildConfigs();
        return i.reply({ content: `<a:emoji_75:1524039622668189806> Đã **BẬT** giám sát server. Toàn bộ hoạt động (nhắn tin, xóa tin, gửi/xóa ảnh, thả emoji, cấp/gỡ role...) sẽ được gửi về ${kenhTB}.`, ephemeral: true });
      }

      if (action === "off") {
        alCfg.enabled = false;
        saveGuildConfigs();
        return i.reply({ content: "<a:emoji_75:1524039622668189806> Đã **TẮT** giám sát server.", ephemeral: true });
      }
    }

    if (i.commandName === "reset-server") {
      // 1. Kiểm tra quyền: Phải là Chủ server (Owner) hoặc có quyền Quản trị viên / Quản lý Server
      const isServerOwner = i.user.id === i.guild.ownerId;
      const isAdmin = i.memberPermissions?.has(PermissionsBitField.Flags.Administrator) || i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);

      if (!isServerOwner && !isAdmin) {
        return i.reply({ 
          content: "<a:emoji_76:1524195723996823612> Chỉ có Chủ phòng (Owner) hoặc Admin của Server này mới được sử dụng lệnh này.", 
          ephemeral: true 
        });
      }

      // 2. Thực hiện xóa cấu hình của server hiện tại
      if (guildConfigs[i.guildId]) {
        delete guildConfigs[i.guildId]; // Xóa dữ liệu của server này khỏi biến object
        saveGuildConfigs();             // Lưu lại vào file json
      }

      // 3. Thông báo thành công
      return i.reply({ 
        content: "🔄 **Đã Reset thành công!** Toàn bộ cấu hình kênh gõ Key và kênh nhận Log tại server này đã bị xóa.\nBot đã quay về trạng thái chờ cài đặt. Vui lòng dùng lệnh `/cauhinhkenh` để thiết lập lại từ đầu.", 
        ephemeral: true 
      });
    }
    
});

// ===================== EVENT: AUTO LEAVE BANNED SERVERS =====================
client.on("guildCreate", async guild => {
  try {
    // Nếu server nằm trong danh sách đen, tự động rời
    if (bannedServers[guild.id]) {
      console.log(`[BANNED] Đã chặn bot tham gia server bị cấm: ${guild.name} (${guild.id})`);
      await guild.leave().catch(console.error);
    }
  } catch (err) {
    console.error("Lỗi khi bot tham gia server mới:", err);
  }
});

// ===================== KHỞI CHẠY BOT =====================
if (!TOKEN || TOKEN === "Thay Token") {
  console.error("<a:emoji_76:1524195723996823612>Thiết lập cấu hình lỗi: Thiếu DISCORD_TOKEN hoặc chưa thay giá trị!");
  process.exit(1);
}
client.login(TOKEN);
