const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const { initBackupService, restoreFromSupabase } = require('./backup-service');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the current directory
app.use(express.static(__dirname));

// Initialize SQLite database with updated schema
const db = new sqlite3.Database('chat_messages.db');

// Drop and recreate the messages table with all required columns
db.serialize(() => {
    // First drop existing indexes
    db.run(`DROP INDEX IF EXISTS idx_receiverId`);
    db.run(`DROP INDEX IF EXISTS idx_senderId`);
    db.run(`DROP INDEX IF EXISTS idx_timestamp`);
    
    // Drop existing table
    db.run(`DROP TABLE IF EXISTS messages`);
    
    // Create new table with all required columns
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        senderId TEXT NOT NULL,
        receiverId TEXT NOT NULL,
        content TEXT,
        timestamp TEXT NOT NULL,
        clientId TEXT,
        isCallRecord INTEGER DEFAULT 0,
        callType TEXT,
        callDuration INTEGER
    )`);
    
    // Recreate indexes
    db.run(`CREATE INDEX IF NOT EXISTS idx_receiverId ON messages(receiverId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_senderId ON messages(senderId)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp)`);
    
    console.log('Database schema updated successfully');
});

// Function to get all messages for a user
async function getUserMessages(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM messages WHERE senderId = ? OR receiverId = ? ORDER BY timestamp',
            [userId, userId],
            (err, rows) => {
                if (err) {
                    console.error('Error fetching messages:', err);
                    reject(err);
                    return;
                }
                resolve(rows || []);
            }
        );
    });
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Map userId to socket
    socket.on('authenticate', async (userId) => {
        try {
            socket.userId = userId;
            if (!io.userSockets) io.userSockets = {};
            io.userSockets[userId] = socket.id;
            console.log('[SERVER] User authenticated:', userId, 'socket:', socket.id);
            
            // First emit authentication confirmation
            socket.emit('authenticated', { userId });

            // Then fetch and send all messages
            const messages = await getUserMessages(userId);
            if (messages && messages.length > 0) {
                console.log(`[SERVER] Sending ${messages.length} messages to user ${userId}`);
                socket.emit('all_messages', messages);
            } else {
                console.log(`[SERVER] No messages found for user ${userId}`);
                socket.emit('all_messages', []);
            }
        } catch (error) {
            console.error('Error in authenticate handler:', error);
            socket.emit('error', { message: 'Error loading messages' });
        }
    });

    // Handle sending messages (store in DB, relay if online)
    socket.on('send_message', (data) => {
        const message = {
            senderId: data.senderId,
            receiverId: data.receiverId,
            content: data.content,
            timestamp: new Date().toISOString(),
            clientId: data.clientId || null,
            isCallRecord: data.isCallRecord || false,
            callType: data.callType || null,
            callDuration: data.callDuration || null
        };
        
        // Store in DB with expanded fields
        db.run(
            `INSERT INTO messages (
                senderId, receiverId, content, timestamp, 
                clientId, isCallRecord, callType, callDuration
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                message.senderId, 
                message.receiverId, 
                message.content, 
                message.timestamp,
                message.clientId,
                message.isCallRecord ? 1 : 0,
                message.callType,
                message.callDuration
            ],
            async function(err) {
                if (err) {
                    console.error('Database error:', err);
                    socket.emit('message_error', { error: 'DB error' });
                    return;
                }
                
                const fullMessage = { ...message, id: this.lastID };
                
                // Relay to receiver if online
                const receiverSocketId = io.userSockets && io.userSockets[data.receiverId];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit('new_message', fullMessage);
                    
                    // Also send updated message list to receiver
                    try {
                        const receiverMessages = await getUserMessages(data.receiverId);
                        io.to(receiverSocketId).emit('all_messages', receiverMessages);
                    } catch (error) {
                        console.error('Error sending updated messages to receiver:', error);
                    }
                }
                
                // Send updated message list to sender
                try {
                    const senderMessages = await getUserMessages(data.senderId);
                    socket.emit('all_messages', senderMessages);
                } catch (error) {
                    console.error('Error sending updated messages to sender:', error);
                }
                
                // Echo to sender for confirmation
                socket.emit('message_sent', { 
                    success: true, 
                    clientId: message.clientId,
                    messageId: this.lastID 
                });
                
                console.log(`Message sent from ${data.senderId} to ${data.receiverId}:`, data.content);
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

    // WebRTC signaling relays
    socket.on('webrtc-offer', (data) => {
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-offer', data);
        }
    });
    socket.on('webrtc-answer', (data) => {
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-answer', data);
        }
    });
    socket.on('webrtc-ice-candidate', (data) => {
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-ice-candidate', data);
        }
    });
    socket.on('webrtc-end-call', (data) => {
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-end-call', data);
        }
    });
    // Relay call rejection
    socket.on('webrtc-reject-call', (data) => {
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-reject-call', data);
        }
    });
    // Video call signaling relays (independent)
    socket.on('webrtc-video-offer', (data) => {
        console.log('[SERVER] Relaying webrtc-video-offer from', data.from, 'to', data.to, 'socket:', io.userSockets && io.userSockets[data.to]);
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-video-offer', data);
        }
    });
    socket.on('webrtc-video-answer', (data) => {
        console.log('[SERVER] Relaying webrtc-video-answer from', data.from, 'to', data.to, 'socket:', io.userSockets && io.userSockets[data.to]);
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-video-answer', data);
        }
    });
    socket.on('webrtc-video-ice-candidate', (data) => {
        console.log('[SERVER] Relaying webrtc-video-ice-candidate from', data.from, 'to', data.to, 'socket:', io.userSockets && io.userSockets[data.to]);
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-video-ice-candidate', data);
        }
    });
    socket.on('webrtc-video-end-call', (data) => {
        console.log('[SERVER] Relaying webrtc-video-end-call from', data.from, 'to', data.to, 'socket:', io.userSockets && io.userSockets[data.to]);
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-video-end-call', data);
        }
    });
    socket.on('webrtc-video-reject-call', (data) => {
        console.log('[SERVER] Relaying webrtc-video-reject-call from', data.from, 'to', data.to, 'socket:', io.userSockets && io.userSockets[data.to]);
        const receiverSocketId = io.userSockets && io.userSockets[data.to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('webrtc-video-reject-call', data);
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

// Start server with backup service
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Socket.IO is ready for real-time connections');
    
    try {
        // First restore any missing messages from Supabase
        console.log('Restoring messages from backup...');
        await restoreFromSupabase();
        
        // Then start the backup service
        console.log('Initializing backup service...');
        await initBackupService();
        
        console.log('Backup service initialized successfully');
    } catch (error) {
        console.error('Error initializing backup services:', error);
    }
});
