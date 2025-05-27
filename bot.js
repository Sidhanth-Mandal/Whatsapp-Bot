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

// Create logger
const logger = pino({ level: 'silent' });

class WhatsAppTagAllBot {
    constructor() {
        this.sock = null;
        this.authState = null;
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
            
            // Check if it's a group message and contains the trigger
            if (isJidGroup(chatId) && messageText && messageText.toLowerCase().trim() === 'tagall!') {
                await this.handleTagAllCommand(msg, chatId);
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
            
            // Get group metadata
            const groupMetadata = await this.sock.groupMetadata(groupId);
            
            // Check if sender is admin or super admin
            const senderParticipant = groupMetadata.participants.find(p => 
                jidNormalizedUser(p.id) === senderId
            );
            
            if (!senderParticipant || (senderParticipant.admin !== 'admin' && senderParticipant.admin !== 'superadmin')) {
                // Send message that only admins can use this command
                await this.sock.sendMessage(groupId, {
                    text: '❌ Only group admins can use the tagall command!'
                });
                return;
            }

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