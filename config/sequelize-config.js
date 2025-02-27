// README
// Sequelize expects migration files to be structured this way; the current testconfig.js file is structured differently. Hence this file which uses the correct structure.
// ChatGPT told me to do this.

const config = require('./testconfig.js')

module.exports = {
    development: {
        username: config.database.username,
        password: config.database.password,
        database: config.database.name,
        host: config.database.host,
        dialect: config.database.dialect,
        logging: config.database.logging,
    },
}
