const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('chat_messages.db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the current directory
app.use(express.static(__dirname));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        senderId TEXT,
        receiverId TEXT,
        content TEXT,
        timestamp TEXT,
        audio TEXT DEFAULT NULL,
        type TEXT DEFAULT 'text'
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_receiverId ON messages(receiverId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_senderId ON messages(senderId)`);
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Map userId to socket
    socket.on('authenticate', (userId) => {
        socket.userId = userId;
        if (!io.userSockets) io.userSockets = {};
        io.userSockets[userId] = socket.id;
        socket.emit('authenticated', { userId });

        // Deliver all messages for this user (sent or received) as a single event
        db.all(
            'SELECT * FROM messages WHERE senderId = ? OR receiverId = ? ORDER BY timestamp',
            [userId, userId],
            (err, rows) => {
                if (!err && rows && rows.length > 0) {
                    socket.emit('all_messages', rows);
                }
            }
        );
    });

    // Handle sending messages (store in DB, relay if online)
    socket.on('send_message', (data) => {
        const message = {
            senderId: data.senderId,
            receiverId: data.receiverId,
            content: data.content,
            timestamp: new Date().toISOString(),
            clientId: data.clientId || null // Echo clientId if present
        };
        // Store in DB
        db.run(
            'INSERT INTO messages (senderId, receiverId, content, timestamp) VALUES (?, ?, ?, ?)',
            [message.senderId, message.receiverId, message.content, message.timestamp],
            function(err) {
                if (err) {
                    socket.emit('message_error', { error: 'DB error' });
                    return;
                }
                // Relay to receiver if online
                const receiverSocketId = io.userSockets && io.userSockets[data.receiverId];
                const fullMessage = { ...message, id: this.lastID };
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit('new_message', fullMessage);
                }
                // Echo to sender for confirmation (include clientId)
                socket.emit('message_sent', { success: true, clientId: message.clientId });
                console.log(`Message sent from ${data.senderId} to ${data.receiverId}:`, data.content);
            }
        );
    });

    // Handle sending voice messages
    socket.on('send_voice', (data) => {
        const message = {
            senderId: data.senderId,
            receiverId: data.receiverId,
            content: '[voice]',
            audio: data.audio,
            timestamp: new Date().toISOString(),
            clientId: data.clientId || null,
            type: 'voice'
        };
        db.run(
            'INSERT INTO messages (senderId, receiverId, content, timestamp, audio, type) VALUES (?, ?, ?, ?, ?, ?)',
            [message.senderId, message.receiverId, message.content, message.timestamp, message.audio, message.type],
            function(err) {
                if (err) {
                    socket.emit('message_error', { error: 'DB error' });
                    return;
                }
                const receiverSocketId = io.userSockets && io.userSockets[data.receiverId];
                const fullMessage = { ...message, id: this.lastID };
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit('new_message', fullMessage);
                }
                socket.emit('message_sent', { success: true, clientId: message.clientId });
                console.log(`Voice message sent from ${data.senderId} to ${data.receiverId}`);
            }
        );
    });

    // Typing indicator events (refactored to match chat.html)
    socket.on('typing', (receiverId) => {
        console.log(`[SERVER] Received typing for receiverId=${receiverId} from userId=${socket.userId}`);
        const receiverSocketId = io.userSockets && io.userSockets[receiverId];
        if (receiverSocketId) {
            console.log(`[SERVER] Relaying user_typing to socketId=${receiverSocketId} for userId=${socket.userId}`);
            io.to(receiverSocketId).emit('user_typing', socket.userId);
        } else {
            console.log(`[SERVER] No receiver socket for receiverId=${receiverId}`);
        }
    });
    socket.on('stop_typing', (receiverId) => {
        console.log(`[SERVER] Received stop_typing for receiverId=${receiverId} from userId=${socket.userId}`);
        const receiverSocketId = io.userSockets && io.userSockets[receiverId];
        if (receiverSocketId) {
            console.log(`[SERVER] Relaying user_stopped_typing to socketId=${receiverSocketId} for userId=${socket.userId}`);
            io.to(receiverSocketId).emit('user_stopped_typing', socket.userId);
        } else {
            console.log(`[SERVER] No receiver socket for receiverId=${receiverId}`);
        }
    });

    // Recording indicator events
    socket.on('recording', (receiverId) => {
        const receiverSocketId = io.userSockets && io.userSockets[receiverId];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_recording', socket.userId);
        }
    });
    socket.on('stop_recording', (receiverId) => {
        const receiverSocketId = io.userSockets && io.userSockets[receiverId];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user_stopped_recording', socket.userId);
        }
    });

    // Remove all join_chat, typing, stop_typing, chat_updated, and room logic

    socket.on('disconnect', () => {
        if (socket.userId && io.userSockets) {
            delete io.userSockets[socket.userId];
        }
        console.log('User disconnected:', socket.id);
    });
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Dashboard routes
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Views/Analytics routes
app.get('/views', (req, res) => {
    res.sendFile(path.join(__dirname, 'views.html'));
});

app.get('/views.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views.html'));
});

// Search routes
app.get('/search', (req, res) => {
    res.sendFile(path.join(__dirname, 'search.html'));
});

app.get('/search.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'search.html'));
});

// Shop routes
app.get('/shop', (req, res) => {
    res.sendFile(path.join(__dirname, 'shop.html'));
});

app.get('/shop.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'shop.html'));
});

// Chats route
app.get('/chats', (req, res) => {
    res.sendFile(path.join(__dirname, 'chats.html'));
});

app.get('/chats.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'chats.html'));
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Socket.IO is ready for real-time connections');
});
