const result = require('dotenv').config();
if (result.error) {
    console.error('No .env file found, Create one using .env.example');
    process.exit(1);
}

module.exports = {
    apps: [
        {
            name: "LiveScratch",
            script: "./index.js",
            killTimeout: 60000,
            env: {
                PORT: process.env.PORT,
                CHAT_WEBHOOK_URL: process.env.CHAT_WEBHOOK_URL,
                ADMIN_USER: process.env.ADMIN_USER,
                AUTH_PROJECTS: process.env.AUTH_PROJECTS,
                ADMIN: process.env.ADMIN,
            }
        }
    ]
};