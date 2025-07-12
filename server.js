const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for development
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Store connected users with their socket IDs
const connectedUsers = new Map(); // userId -> socketId
const socketToUser = new Map(); // socketId -> userId

// Middleware
app.use(cors());
app.use(express.json());

// Basic route
app.get('/', (req, res) => {
    res.send('UniqueQode Chat Server is running!');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    // Handle user authentication
    socket.on('authenticate', (userId) => {
        console.log(`👤 User ${userId} authenticated with socket ${socket.id}`);
        
        // Store user mapping
        connectedUsers.set(userId, socket.id);
        socketToUser.set(socket.id, userId);
        socket.userId = userId;
        
        // Join user to their personal room
        socket.join(`user_${userId}`);
        
        // Send authentication confirmation
        socket.emit('authenticated', { 
            userId, 
            socketId: socket.id,
            message: 'Successfully authenticated'
        });
        
        console.log(`📊 Current connected users: ${connectedUsers.size}`);
        console.log(`👥 Connected users:`, Array.from(connectedUsers.keys()));
    });

    // Handle sending messages
    socket.on('send_message', (messageData) => {
        console.log('📤 Message received:', messageData);
        
        const { senderId, receiverId, content, timestamp } = messageData;
        
        if (!senderId || !receiverId || !content) {
            console.error('❌ Invalid message data:', messageData);
            socket.emit('message_error', { error: 'Invalid message data' });
            return;
        }
        
        // Create message object
        const message = {
            id: Date.now() + Math.random(), // Ensure unique ID
            senderId,
            receiverId,
            content,
            timestamp: timestamp || new Date().toISOString(),
            senderName: 'User', // You can fetch this from database
            receiverName: 'User' // You can fetch this from database
        };

        console.log(`📨 Processing message from ${senderId} to ${receiverId}`);

        // Send acknowledgment to sender immediately
        socket.emit('message_sent', {
            messageId: message.id,
            timestamp: message.timestamp,
            success: true
        });

        // Send message to receiver if they're online
        const receiverSocketId = connectedUsers.get(receiverId);
        if (receiverSocketId) {
            console.log(`📨 Sending message to ${receiverId} (socket: ${receiverSocketId})`);
            
            // Send to receiver's specific socket only (prevents duplicates)
            io.to(receiverSocketId).emit('new_message', message);
        } else {
            console.log(`📨 User ${receiverId} is offline, message will be delivered when they come online`);
        }

        // Send to sender's other tabs/devices (personal room) - but not to the current socket
        socket.to(`user_${senderId}`).emit('new_message', message);
        
        console.log(`✅ Message processed successfully`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});