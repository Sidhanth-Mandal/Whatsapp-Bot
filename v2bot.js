const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    jidNormalizedUser,
    isJidGroup,
    extractGroupMetadata
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Create logger
const logger = pino({ level: 'silent' });

class WhatsAppTagAllBot {
    constructor() {
        this.sock = null;
        this.authState = null;
        this.dataFile = path.join(__dirname, 'bot_data.json');
        this.loadData();
    }

    // Load saved data from JSON file
    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = fs.readFileSync(this.dataFile, 'utf8');
                this.savedTags = JSON.parse(data);
            } else {
                this.savedTags = {};
            }
        } catch (error) {
            console.error('Error loading data:', error);
            this.savedTags = {};
        }
    }

    // Save data to JSON file
    saveData() {
        try {
            fs.writeFileSync(this.dataFile, JSON.stringify(this.savedTags, null, 2));
        } catch (error) {
            console.error('Error saving data:', error);
        }
    }

    async initialize() {
        try {
            // Load authentication state
            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
            this.authState = { state, saveCreds };

            // Create WhatsApp socket connection
            this.sock = makeWASocket({
                auth: state,
                logger,
                browser: ['TagAll Bot', 'Chrome', '1.0.0']
            });

            // Handle connection updates
            this.sock.ev.on('connection.update', this.handleConnectionUpdate.bind(this));
            
            // Handle credential updates
            this.sock.ev.on('creds.update', this.authState.saveCreds);
            
            // Handle incoming messages
            this.sock.ev.on('messages.upsert', this.handleMessages.bind(this));

            console.log('WhatsApp TagAll Bot initialized successfully!');
        } catch (error) {
            console.error('Error initializing bot:', error);
        }
    }

    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;
        
        // Handle QR code display
        if (qr) {
            console.log('\n📱 SCAN THIS QR CODE WITH YOUR WHATSAPP 📱');
            console.log('==========================================');
            qrcode.generate(qr, { small: true });
            console.log('==========================================');
            console.log('Open WhatsApp → Settings → Linked Devices → Link a Device');
            console.log('Then scan the QR code above\n');
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;
                
            console.log('Connection closed due to:', lastDisconnect?.error);
            
            if (shouldReconnect) {
                console.log('Reconnecting...');
                this.initialize();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp connection opened successfully!');
            console.log('🤖 TagAll Bot is now active and ready!');
            console.log('📋 Usage: Send "tagall!" in any group where you are admin');
        }
    }

    async handleMessages(m) {
        try {
            const msg = m.messages[0];
            
            // Ignore if message is from status broadcast or if it's not a text message
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            
            // Get message text
            const messageText = this.getMessageText(msg);
            const chatId = msg.key.remoteJid;
            
            // Check if it's a group message
            if (isJidGroup(chatId) && messageText) {
                const trimmedText = messageText.trim();
                
                // Handle tagall command
                if (trimmedText.toLowerCase() === 'tagall!') {
                    await this.handleTagAllCommand(msg, chatId);
                }
                // Handle PUSH command (save phone numbers under tags)
                else if (trimmedText.toUpperCase().startsWith('PUSH ')) {
                    await this.handlePushCommand(msg, chatId, trimmedText);
                }
                // Handle custom tag commands (e.g., tag2year!)
                else if (trimmedText.toLowerCase().endsWith('!') && trimmedText.toLowerCase().startsWith('tag')) {
                    await this.handleCustomTagCommand(msg, chatId, trimmedText);
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    getMessageText(msg) {
        return msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text ||
               msg.message?.imageMessage?.caption ||
               msg.message?.videoMessage?.caption ||
               '';
    }

    async handleTagAllCommand(msg, groupId) {
        try {
            const senderId = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            
            // Check if sender is admin
            if (!(await this.isUserAdmin(senderId, groupId))) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Only group admins can use the tagall command!'
                });
                return;
            }

            // Get group metadata
            const groupMetadata = await this.sock.groupMetadata(groupId);
            
            // Get all group participants
            const participants = groupMetadata.participants;
            
            // Create mention array and text
            const mentions = participants.map(p => p.id);
            const mentionText = participants.map(p => `@${p.id.split('@')[0]}`).join(' ');
            
            // Create the tag all message
            const tagAllMessage = {
                text: `🔔 *TAG ALL MEMBERS* 🔔\n\n${mentionText}\n\n_Tagged by admin: @${senderId.split('@')[0]}_`,
                mentions: [...mentions, senderId]
            };

            // Send the tag all message
            await this.sock.sendMessage(groupId, tagAllMessage);
            
            console.log(`TagAll executed in group: ${groupMetadata.subject} by ${senderId}`);
            
        } catch (error) {
            console.error('Error in handleTagAllCommand:', error);
            
            // Send error message
            try {
                await this.sock.sendMessage(groupId, {
                    text: '❌ An error occurred while trying to tag all members. Please try again later.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    }
            
    async handleCustomTagCommand(msg, groupId, messageText) {
        try {
            const senderId = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            
            // Check if sender is admin
            if (!(await this.isUserAdmin(senderId, groupId))) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Only group admins can use tag commands!'
                });
                return;
            }

            // Extract tag name from command (e.g., "tag2year!" -> "2year")
            const tagMatch = messageText.toLowerCase().match(/^tag(.+)!$/);
            if (!tagMatch) return;
            
            const tagName = tagMatch[1].trim();
            
            // Check if tag exists in saved data
            if (!this.savedTags[tagName] || this.savedTags[tagName].length === 0) {
                await this.sock.sendMessage(groupId, {
                    text: `❌ No phone numbers found for tag "${tagName}". Use PUSH command to add numbers first.`
                });
                return;
            }

            // Create mentions array and text
            const phoneNumbers = this.savedTags[tagName];
            const mentions = phoneNumbers.map(num => `${num}@s.whatsapp.net`);
            const mentionText = phoneNumbers.map(num => `@${num}`).join(' ');
            
            // Create the tag message
            const tagMessage = {
                text: `🔔 *TAG: ${tagName.toUpperCase()}* 🔔\n\n${mentionText}\n\n_Tagged by admin: @${senderId.split('@')[0]}_\n_Total numbers: ${phoneNumbers.length}_`,
                mentions: [...mentions, senderId]
            };

            // Send the tag message
            await this.sock.sendMessage(groupId, tagMessage);
            
            console.log(`Custom tag "${tagName}" executed by ${senderId} with ${phoneNumbers.length} numbers`);
            
        } catch (error) {
            console.error('Error in handleCustomTagCommand:', error);
            
            try {
                await this.sock.sendMessage(groupId, {
                    text: '❌ An error occurred while trying to tag the saved numbers. Please try again later.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    }

    async handlePushCommand(msg, groupId, messageText) {
        try {
            const senderId = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            
            // Check if sender is admin
            if (!(await this.isUserAdmin(senderId, groupId))) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Only group admins can use the PUSH command!'
                });
                return;
            }

            // Parse PUSH command: PUSH @919876543210 #2nd years
            const pushRegex = /^PUSH\s+@(\d+)\s+#(.+)$/i;
            const match = messageText.match(pushRegex);
            
            if (!match) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Invalid PUSH format!\n\n✅ Correct format: `PUSH @919876543210 #tagname`\n\nExample: `PUSH @919876543210 #2nd years`'
                });
                return;
            }

            const phoneNumber = match[1];
            const tagName = match[2].trim().toLowerCase();

            // Validate phone number (basic validation)
            if (phoneNumber.length < 10 || phoneNumber.length > 15) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Invalid phone number format! Please use a valid phone number with country code.'
                });
                return;
            }

            // Initialize tag array if it doesn't exist
            if (!this.savedTags[tagName]) {
                this.savedTags[tagName] = [];
            }

            // Check if number already exists in this tag
            if (this.savedTags[tagName].includes(phoneNumber)) {
                await this.sock.sendMessage(groupId, {
                    text: `⚠️ Phone number @${phoneNumber} is already saved under tag "${tagName}"`
                });
                return;
            }

            // Add phone number to tag
            this.savedTags[tagName].push(phoneNumber);
            this.saveData();

            // Send confirmation message
            await this.sock.sendMessage(groupId, {
                text: `✅ Phone number @${phoneNumber} has been saved under tag "${tagName}"\n\n📊 Total numbers in "${tagName}": ${this.savedTags[tagName].length}\n\n💡 Use "tag${tagName}!" to tag all saved numbers in this category`,
                mentions: [`${phoneNumber}@s.whatsapp.net`]
            });

            console.log(`Phone number ${phoneNumber} added to tag "${tagName}" by ${senderId}`);
            
        } catch (error) {
            console.error('Error in handlePushCommand:', error);
            
            try {
                await this.sock.sendMessage(groupId, {
                    text: '❌ An error occurred while saving the phone number. Please try again later.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    }

    async isUserAdmin(userId, groupId) {
        try {
            const groupMetadata = await this.sock.groupMetadata(groupId);
            const userParticipant = groupMetadata.participants.find(p => 
                jidNormalizedUser(p.id) === userId
            );
            
            return userParticipant && (userParticipant.admin === 'admin' || userParticipant.admin === 'superadmin');
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    // Graceful shutdown
    async shutdown() {
        if (this.sock) {
            await this.sock.end();
            console.log('Bot shutdown gracefully');
        }
    }
}

// Initialize and start the bot
async function startBot() {
    const bot = new WhatsAppTagAllBot();
    await bot.initialize();
    
    // Handle process termination
    process.on('SIGINT', async () => {
        console.log('\nShutting down bot...');
        await bot.shutdown();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\nShutting down bot...');
        await bot.shutdown();
        process.exit(0);
    });
}

// Start the bot
startBot().catch(console.error);

module.exports = WhatsAppTagAllBot;