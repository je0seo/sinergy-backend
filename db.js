const { Client } = require('pg');
const client = require('./config/db.js');

const connectToDB = async () => {
    try {
        await client.connect();
        console.log('Connected to the database!');
    } catch (err) {
        console.log('Failed to connect to the database:', err);
        throw err;
    }
};

module.exports = {
    connectToDB,
};
