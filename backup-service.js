const { createClient } = require('@supabase/supabase-js');
const sqlite3 = require('sqlite3').verbose();

// Supabase configuration
const supabaseUrl = 'https://zgdgdnkabcfpqiusicxk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnZGdkbmthYmNmcHFpdXNpY3hrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzA3MzEzNzAsImV4cCI6MjA0NjMwNzM3MH0.XpJzk36EInl8rJTZhbKeg5VMEEbdzRkvZJsBUAB-VgU';
const supabase = createClient(supabaseUrl, supabaseKey);

// SQLite configuration - make sure to use the correct database file name
const db = new sqlite3.Database('./chat_messages.db');

// Track last backup timestamp
let lastBackupTime = 0;

// Function to get messages from SQLite that haven't been backed up
async function getNewMessages() {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT * FROM messages 
            WHERE timestamp > ?
            ORDER BY timestamp ASC
        `;
        
        db.all(query, [lastBackupTime], (err, rows) => {
            if (err) {
                console.error('Error fetching messages from SQLite:', err);
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}

// Function to backup messages to Supabase
async function backupToSupabase(messages) {
    if (!messages || messages.length === 0) {
        console.log('No new messages to backup');
        return;
    }

    try {
        // Transform messages to match Supabase schema
        const formattedMessages = messages.map(msg => ({
            message_id: msg.id.toString(), // Convert to string to ensure consistency
            sender_id: msg.senderId,
            receiver_id: msg.receiverId,
            content: msg.content,
            timestamp: msg.timestamp,
            client_id: msg.clientId || null,
            is_call_record: msg.isCallRecord || false,
            call_type: msg.callType || null,
            call_duration: msg.callDuration || null,
            sqlite_id: msg.id.toString() // Keep track of SQLite ID for reference
        }));

        // Insert messages into Supabase
        const { data, error } = await supabase
            .from('chat_messages_backup')
            .upsert(formattedMessages, {
                onConflict: 'message_id',
                ignoreDuplicates: true
            });

        if (error) {
            console.error('Error backing up to Supabase:', error);
            return;
        }

        // Update last backup time to the latest message timestamp
        const timestamps = messages.map(m => new Date(m.timestamp).getTime());
        lastBackupTime = Math.max(...timestamps);
        console.log(`Successfully backed up ${messages.length} messages to Supabase`);

    } catch (error) {
        console.error('Error in backup process:', error);
    }
}

// Function to restore messages from Supabase to SQLite
async function restoreFromSupabase() {
    try {
        // Get all messages from Supabase
        const { data: backupMessages, error } = await supabase
            .from('chat_messages_backup')
            .select('*')
            .order('timestamp', { ascending: true });

        if (error) {
            console.error('Error fetching backup from Supabase:', error);
            return;
        }

        if (!backupMessages || backupMessages.length === 0) {
            console.log('No messages to restore from backup');
            return;
        }

        // Insert messages into SQLite
        const insertPromises = backupMessages.map(msg => {
            return new Promise((resolve, reject) => {
                const query = `
                    INSERT OR IGNORE INTO messages (
                        id, senderId, receiverId, content, timestamp, 
                        clientId, isCallRecord, callType, callDuration
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                db.run(query, [
                    parseInt(msg.message_id), // Convert back to integer for SQLite
                    msg.sender_id,
                    msg.receiver_id,
                    msg.content,
                    msg.timestamp,
                    msg.client_id,
                    msg.is_call_record ? 1 : 0,
                    msg.call_type,
                    msg.call_duration
                ], (err) => {
                    if (err) {
                        console.error('Error restoring message:', err);
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });

        await Promise.all(insertPromises);
        console.log(`Restored ${backupMessages.length} messages from Supabase`);

    } catch (error) {
        console.error('Error in restore process:', error);
    }
}

// Function to initialize backup service
async function initBackupService() {
    try {
        // Start backup interval (every 4 minutes)
        setInterval(async () => {
            console.log('Starting scheduled backup...');
            const newMessages = await getNewMessages();
            await backupToSupabase(newMessages);
        }, 4 * 60 * 1000); // 4 minutes in milliseconds

        // Initial backup
        console.log('Performing initial backup...');
        const initialMessages = await getNewMessages();
        await backupToSupabase(initialMessages);

        console.log('Backup service initialized successfully');
    } catch (error) {
        console.error('Error initializing backup service:', error);
    }
}

// Export functions for use in server.js
module.exports = {
    initBackupService,
    restoreFromSupabase
}; 