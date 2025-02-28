const { App } = require('@slack/bolt')

const dotenv = require('dotenv')
dotenv.config({
    path: './local.env',
})

// Require the Node Slack SDK package (github.com/slackapi/node-slack-sdk)
const { WebClient, LogLevel } = require('@slack/web-api')

// WebClient instantiates a client that can call API methods
// When using Bolt, you can use either `app.client` or the `client` passed to listeners.
const client = new WebClient(`${process.env.SLACK_APP_TOKEN}`, {
    // LogLevel can be imported and used to make debugging simpler
    logLevel: LogLevel.DEBUG,
})

// Initializes your app with your bot token and signing secret
const app = new App({
    token: process.env.BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
    // Socket Mode doesn't listen on a port, but in case you want your app to respond to OAuth,
    // you still need to listen on some port!
})

// Listens to incoming messages that contain "hello"
app.message('hello', async ({ message, say }) => {
    app.logger.info('Received hello')

    // say() sends a message to the channel where the event was triggered
    await say(`Hey there <@${message.user}>!`)
})

app.command('Bob', async ({ message, say }) => {
    app.logger.info('Received Bob command')
    await say(`Hey there <@message!>!`)
})
;(async () => {
    await app.start()

    app.logger.info('⚡️ Bolt app is running!')
})()
