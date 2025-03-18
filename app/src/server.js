const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;
const host = '0.0.0.0';

// Enable CORS for your Netlify frontend
app.use(cors({
    origin: ['https://your-site.netlify.app', 'http://localhost:3000', 'http://192.168.8.132:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-API-Key']
}));

app.use(express.json());

// Serve static files from 'public' directory
app.use(express.static('public'));

// In-memory storage for notifications (for demonstration purposes)
// In a production environment, you would use a database
let notifications = [];

// Simple API key authentication - should be BEFORE the routes
const API_KEY = 'safety-monitor-123'; // Make sure this matches the frontend

// Test endpoint (no authentication)
app.get('/test', (req, res) => {
    res.json({ message: 'Server is running!' });
});

// API authentication middleware
app.use('/api', (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// Protected API endpoints
app.get('/api/notifications', (req, res) => {
    res.json(notifications);
});

// POST endpoint to receive notification data
app.post('/api/notifications', (req, res) => {
    const notification = {
        id: Date.now(), // Simple ID generation
        timestamp: new Date().toISOString(),
        ...req.body
    };
    
    notifications.push(notification);
    console.log('Received notification:', notification);
    
    res.status(201).json({
        message: 'Notification received successfully',
        notification
    });
});

// Start the server
app.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
    console.log(`Local access: http://localhost:${port}`);
    console.log(`Network access: http://192.168.8.132:${port}`);
    console.log('\nAvailable endpoints:');
    console.log('  - GET  /         : HTML landing page');
    console.log('  - GET  /test     : Server test');
    console.log('  - GET  /api/notifications  : Retrieve notifications');
    console.log('  - POST /api/notifications  : Submit notification data');
}); 