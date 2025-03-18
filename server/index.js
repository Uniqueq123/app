const express = require('express');
const mongoose = require('mongoose');
const app = express();
const port = 3000;

app.use(express.json());

// Notification schema
const notificationSchema = new mongoose.Schema({
    packageName: String,
    title: String,
    text: String,
    timestamp: Number,
    appName: String,
    deviceId: String
});

const Notification = mongoose.model('Notification', notificationSchema);

// API endpoint to receive notifications
app.post('/api/notifications', async (req, res) => {
    try {
        const notification = new Notification(req.body);
        await notification.save();
        res.status(200).send();
    } catch (error) {
        res.status(500).send(error);
    }
});

// Parent dashboard endpoint
app.get('/api/notifications', async (req, res) => {
    try {
        const notifications = await Notification.find()
            .sort({ timestamp: -1 })
            .limit(100);
        res.json(notifications);
    } catch (error) {
        res.status(500).send(error);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 