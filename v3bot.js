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
                else if (trimmedText.toUpperCase().startsWith('!PUSH ')) {
                    await this.handlePushCommand(msg, chatId, trimmedText);
                }
                // Handle POP command (remove phone numbers from tags)
                else if (trimmedText.toUpperCase().startsWith('!POP ')) {
                    await this.handlePopCommand(msg, chatId, trimmedText);
                }
                // Handle RENAME command (rename tags)
                else if (trimmedText.toUpperCase().startsWith('!RENAME ')) {
                    await this.handleRenameCommand(msg, chatId, trimmedText);
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

            // Parse PUSH command: PUSH @919876543210@919876543211@919876543212 #2nd years
            // Also support old format: PUSH @919876543210 #2nd years
            const pushRegex = /^!PUSH\s+@(.+?)\s+#(.+)$/i;
            const match = messageText.match(pushRegex);
            
            if (!match) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Invalid PUSH format!\n\n✅ Correct formats:\n• Single: `!PUSH @919876543210 #tagname`\n• Multiple: `PUSH @919876543210@919876543211@919876543212 #tagname`\n\nExample: `PUSH @919876543210@919876543211 #2nd years`'
                });
                return;
            }

            const numbersString = match[1];
            const tagName = match[2].trim().toLowerCase();

            // Split numbers by @ and filter out empty strings
            const phoneNumbers = numbersString.split('@').filter(num => num.trim().length > 0);

            if (phoneNumbers.length === 0) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ No valid phone numbers found! Please provide at least one phone number.'
                });
                return;
            }

            // Validate phone numbers
            const validNumbers = [];
            const invalidNumbers = [];

            for (const phoneNumber of phoneNumbers) {
                const cleanNumber = phoneNumber.trim();
                if (cleanNumber.length >= 10 && cleanNumber.length <= 15 && /^\d+$/.test(cleanNumber)) {
                    validNumbers.push(cleanNumber);
                } else {
                    invalidNumbers.push(cleanNumber);
                }
            }

            if (validNumbers.length === 0) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ No valid phone numbers found! Please use valid phone numbers with country code (10-15 digits).'
                });
                return;
            }

            // Initialize tag array if it doesn't exist
            if (!this.savedTags[tagName]) {
                this.savedTags[tagName] = [];
            }

            // Add numbers and track duplicates
            const addedNumbers = [];
            const duplicateNumbers = [];

            for (const phoneNumber of validNumbers) {
                if (this.savedTags[tagName].includes(phoneNumber)) {
                    duplicateNumbers.push(phoneNumber);
                } else {
                    this.savedTags[tagName].push(phoneNumber);
                    addedNumbers.push(phoneNumber);
                }
            }

            // Save data
            this.saveData();

            // Prepare response message
            let responseMessage = '';
            
            if (addedNumbers.length > 0) {
                const mentions = addedNumbers.map(num => `${num}@s.whatsapp.net`);
                const mentionText = addedNumbers.map(num => `@${num}`).join(' ');
                
                responseMessage += `✅ ${addedNumbers.length} phone number(s) added to tag "${tagName}":\n${mentionText}\n\n`;
                
                // Send message with mentions
                await this.sock.sendMessage(groupId, {
                    text: responseMessage + `📊 Total numbers in "${tagName}": ${this.savedTags[tagName].length}\n\n💡 Use "tag${tagName.replace(/\s+/g, '')}!" to tag all saved numbers`,
                    mentions: mentions
                });
            }

            // Send additional info about duplicates and invalid numbers
            let infoMessage = '';
            
            if (duplicateNumbers.length > 0) {
                infoMessage += `⚠️ ${duplicateNumbers.length} number(s) already existed: ${duplicateNumbers.join(', ')}\n`;
            }
            
            if (invalidNumbers.length > 0) {
                infoMessage += `❌ ${invalidNumbers.length} invalid number(s) skipped: ${invalidNumbers.join(', ')}\n`;
            }

            if (infoMessage && addedNumbers.length === 0) {
                await this.sock.sendMessage(groupId, {
                    text: infoMessage + `\n📊 Total numbers in "${tagName}": ${this.savedTags[tagName].length}`
                });
            } else if (infoMessage) {
                await this.sock.sendMessage(groupId, {
                    text: infoMessage
                });
            }

            console.log(`PUSH command executed by ${senderId}: ${addedNumbers.length} numbers added to "${tagName}"`);
            
        } catch (error) {
            console.error('Error in handlePushCommand:', error);
            
            try {
                await this.sock.sendMessage(groupId, {
                    text: '❌ An error occurred while saving the phone numbers. Please try again later.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    }

    async handlePopCommand(msg, groupId, messageText) {
        try {
            const senderId = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            
            // Check if sender is admin
            if (!(await this.isUserAdmin(senderId, groupId))) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Only group admins can use the POP command!'
                });
                return;
            }

            // Parse POP command: POP @919876543210@919876543211 #2nd years
            const popRegex = /^!POP\s+@(.+?)\s+#(.+)$/i;
            const match = messageText.match(popRegex);
            
            if (!match) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Invalid POP format!\n\n✅ Correct formats:\n• Single: `POP @919876543210 #tagname`\n• Multiple: `POP @919876543210@919876543211@919876543212 #tagname`\n\nExample: `POP @919876543210@919876543211 #2nd years`'
                });
                return;
            }

            const numbersString = match[1];
            const tagName = match[2].trim().toLowerCase();

            // Check if tag exists
            if (!this.savedTags[tagName] || this.savedTags[tagName].length === 0) {
                await this.sock.sendMessage(groupId, {
                    text: `❌ Tag "${tagName}" doesn't exist or is empty!`
                });
                return;
            }

            // Split numbers by @ and filter out empty strings
            const phoneNumbers = numbersString.split('@').filter(num => num.trim().length > 0);

            if (phoneNumbers.length === 0) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ No phone numbers found! Please provide at least one phone number to remove.'
                });
                return;
            }

            // Remove numbers and track what was removed/not found
            const removedNumbers = [];
            const notFoundNumbers = [];

            for (const phoneNumber of phoneNumbers) {
                const cleanNumber = phoneNumber.trim();
                const index = this.savedTags[tagName].indexOf(cleanNumber);
                
                if (index !== -1) {
                    this.savedTags[tagName].splice(index, 1);
                    removedNumbers.push(cleanNumber);
                } else {
                    notFoundNumbers.push(cleanNumber);
                }
            }

            // Clean up empty tags
            if (this.savedTags[tagName].length === 0) {
                delete this.savedTags[tagName];
            }

            // Save data
            this.saveData();

            // Prepare response message
            let responseMessage = '';
            
            if (removedNumbers.length > 0) {
                const mentions = removedNumbers.map(num => `${num}@s.whatsapp.net`);
                const mentionText = removedNumbers.map(num => `@${num}`).join(' ');
                
                responseMessage += `✅ ${removedNumbers.length} phone number(s) removed from tag "${tagName}":\n${mentionText}\n\n`;
                
                // Send message with mentions
                await this.sock.sendMessage(groupId, {
                    text: responseMessage + `📊 Remaining numbers in "${tagName}": ${this.savedTags[tagName] ? this.savedTags[tagName].length : 0}`,
                    mentions: mentions
                });
            }

            // Send info about numbers not found
            if (notFoundNumbers.length > 0) {
                const infoMessage = `⚠️ ${notFoundNumbers.length} number(s) not found in tag "${tagName}": ${notFoundNumbers.join(', ')}`;
                
                if (removedNumbers.length === 0) {
                    await this.sock.sendMessage(groupId, {
                        text: infoMessage + `\n\n📊 Total numbers in "${tagName}": ${this.savedTags[tagName] ? this.savedTags[tagName].length : 0}`
                    });
                } else {
                    await this.sock.sendMessage(groupId, {
                        text: infoMessage
                    });
                }
            }

            console.log(`POP command executed by ${senderId}: ${removedNumbers.length} numbers removed from "${tagName}"`);
            
        } catch (error) {
            console.error('Error in handlePopCommand:', error);
            
            try {
                await this.sock.sendMessage(groupId, {
                    text: '❌ An error occurred while removing the phone numbers. Please try again later.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    }

    async handleRenameCommand(msg, groupId, messageText) {
        try {
            const senderId = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
            
            // Check if sender is admin
            if (!(await this.isUserAdmin(senderId, groupId))) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Only group admins can use the RENAME command!'
                });
                return;
            }

            // Parse RENAME command: RENAME #oldtag #newtag
            const renameRegex = /^!RENAME\s+#(.+?)\s+#(.+)$/i;
            const match = messageText.match(renameRegex);
            
            if (!match) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Invalid RENAME format!\n\n✅ Correct format: `RENAME #oldtagname #newtagname`\n\nExample: `RENAME #2nd years #second years`'
                });
                return;
            }

            const oldTagName = match[1].trim().toLowerCase();
            const newTagName = match[2].trim().toLowerCase();

            // Check if old tag exists
            if (!this.savedTags[oldTagName]) {
                await this.sock.sendMessage(groupId, {
                    text: `❌ Tag "${oldTagName}" doesn't exist!`
                });
                return;
            }

            // Check if new tag name already exists
            if (this.savedTags[newTagName]) {
                await this.sock.sendMessage(groupId, {
                    text: `❌ Tag "${newTagName}" already exists! Please choose a different name.`
                });
                return;
            }

            // Check if old and new names are the same
            if (oldTagName === newTagName) {
                await this.sock.sendMessage(groupId, {
                    text: '❌ Old and new tag names are the same! Please choose a different name.'
                });
                return;
            }

            // Rename the tag
            this.savedTags[newTagName] = this.savedTags[oldTagName];
            delete this.savedTags[oldTagName];
            
            // Save data
            this.saveData();

            // Send confirmation message
            await this.sock.sendMessage(groupId, {
                text: `✅ Tag renamed successfully!\n\n🏷️ Old name: "${oldTagName}"\n🏷️ New name: "${newTagName}"\n\n📊 Numbers in renamed tag: ${this.savedTags[newTagName].length}\n\n💡 Use "tag${newTagName.replace(/\s+/g, '')}!" to tag all numbers in this category`
            });

            console.log(`RENAME command executed by ${senderId}: "${oldTagName}" → "${newTagName}"`);
            
        } catch (error) {
            console.error('Error in handleRenameCommand:', error);
            
            try {
                await this.sock.sendMessage(groupId, {
                    text: '❌ An error occurred while renaming the tag. Please try again later.'
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