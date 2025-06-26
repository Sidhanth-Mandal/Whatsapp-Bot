# WhatsApp TagAll Bot 🤖

A powerful WhatsApp bot that allows group administrators to tag all members or specific groups of members using custom tags. Built with Node.js and the Baileys WhatsApp Web API.

## ✨ Features

- **Tag All Members**: Instantly tag all members in a WhatsApp group
- **Custom Tags**: Create and manage custom tags for specific groups of phone numbers
- **Admin-Only Access**: Only group administrators can use bot commands
- **Persistent Storage**: All tag data is saved locally and persists between bot restarts
- **Multi-Number Support**: Add multiple phone numbers to tags in a single command
- **Tag Management**: Add, remove, and rename tags easily
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Auto-Reconnection**: Automatically reconnects if the connection is lost

## 🚀 Commands

### Basic Commands

| Command | Description | Usage | Example |
|---------|-------------|-------|---------|
| `tagall!` | Tag all members in the group | `tagall!` | `tagall!` |
| `tag{name}!` | Tag all numbers saved under a specific tag | `tag{tagname}!` | `tagsecondyears!` |

### Tag Management Commands

| Command | Description | Format | Example |
|---------|-------------|--------|---------|
| `!PUSH` | Add phone numbers to a tag | `!PUSH @number1@number2 #tagname` | `!PUSH @919876543210@919876543211 #second years` |
| `!POP` | Remove phone numbers from a tag | `!POP @number1@number2 #tagname` | `!POP @919876543210 #second years` |
| `!RENAME` | Rename an existing tag | `!RENAME #oldname #newname` | `!RENAME #2nd years #second years` |

## 📋 Prerequisites

Before running the bot, make sure you have:

- Node.js (v14 or higher)
- npm or yarn package manager
- A WhatsApp account
- Administrative access to the WhatsApp groups where you want to use the bot

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/whatsapp-tagall-bot.git
   cd whatsapp-tagall-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the bot**
   ```bash
   npm start
   ```
   or
   ```bash
   node index.js
   ```

4. **Scan QR Code**
   - When you first run the bot, it will generate a QR code in the terminal
   - Open WhatsApp on your phone
   - Go to Settings → Linked Devices → Link a Device
   - Scan the QR code displayed in the terminal
   - The bot will connect and be ready to use!

## 📦 Dependencies

The bot uses the following main dependencies:

```json
{
  "@whiskeysockets/baileys": "^6.0.0",
  "@hapi/boom": "^10.0.0",
  "pino": "^8.0.0",
  "qrcode-terminal": "^0.12.0"
}
```

## 📖 Usage Guide

### Setting Up Tags

1. **Add phone numbers to a tag**:
   ```
   !PUSH @919876543210@919876543211@919876543212 #students
   ```

2. **Tag all numbers in a category**:
   ```
   tagstudents!
   ```

3. **Remove specific numbers from a tag**:
   ```
   !POP @919876543210 #students
   ```

4. **Rename a tag**:
   ```
   !RENAME #students #graduates
   ```

### Important Notes

- **Admin Only**: All commands can only be used by group administrators
- **Phone Number Format**: Use full phone numbers with country code (e.g., 919876543210 for India)
- **Tag Names**: Tag names are case-insensitive and stored in lowercase
- **Spaces in Tag Names**: Spaces are allowed in tag names, but when using the tag command, remove spaces (e.g., `#second years` becomes `tagsecondyears!`)

## 🔧 Configuration

### File Structure

```
whatsapp-tagall-bot/
├── index.js              # Main bot file
├── bot_data.json         # Saved tags data (auto-generated)
├── auth_info_baileys/    # WhatsApp authentication data (auto-generated)
├── package.json          # Project dependencies
└── README.md            # This file
```

### Data Storage

- **Tags Data**: Stored in `bot_data.json` in the following format:
  ```json
  {
    "students": ["919876543210", "919876543211"],
    "teachers": ["919876543212", "919876543213"]
  }
  ```

- **Authentication**: WhatsApp session data is stored in the `auth_info_baileys/` directory

## 🛡️ Security Features

- **Admin Verification**: All commands verify that the sender is a group administrator
- **Input Validation**: Phone numbers are validated before being saved
- **Error Handling**: Graceful error handling prevents bot crashes
- **Session Management**: Secure session handling with auto-reconnection

## 🔍 Troubleshooting

### Common Issues

1. **QR Code Not Scanning**
   - Make sure your terminal supports QR code display
   - Try running the bot in a different terminal
   - Ensure your WhatsApp app is updated

2. **Bot Not Responding**
   - Check if the bot is connected (look for "WhatsApp connection opened successfully!" message)
   - Verify you're an admin in the group
   - Make sure the command format is correct

3. **Connection Lost**
   - The bot will automatically try to reconnect
   - If it doesn't reconnect, restart the bot

4. **Commands Not Working**
   - Ensure you're using the exact command format
   - Check that you have admin privileges in the group
   - Verify the phone numbers include country codes

### Debug Mode

To enable debug logging, modify the logger configuration in `index.js`:

```javascript
const logger = pino({ level: 'debug' }); // Change from 'silent' to 'debug'
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/new-feature`)
5. Create a Pull Request


## ⚠️ Disclaimer

- This bot is for educational and legitimate group management purposes only
- Respect WhatsApp's Terms of Service and use responsibly
- Avoid spamming or sending unsolicited messages
- The developers are not responsible for any misuse of this bot

## 🆘 Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/yourusername/whatsapp-tagall-bot/issues) section
2. Create a new issue with detailed information about your problem
3. Include error logs and steps to reproduce the issue

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API library
- [Hapi Boom](https://github.com/hapijs/boom) - HTTP-friendly error objects
- [Pino](https://github.com/pinojs/pino) - Fast JSON logger
- [QRCode Terminal](https://github.com/gtanner/qrcode-terminal) - QR code generation

## 📈 Changelog

### Version 1.0.0
- Initial release
- Basic tagall functionality
- Custom tag management (PUSH, POP, RENAME)
- Admin-only access control
- Persistent data storage
- Auto-reconnection feature

---

**Made with ❤️ for WhatsApp group management**
