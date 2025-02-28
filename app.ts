// -----------------------------------------------------------------------------
// This file's purpose is to help test our transition from Slack's old RTM API to the new Events API
// It opens a websocket connection to Slack's Events API and listens for messages in a channel
// I intend to move this logic to slack.ts. If you see this message, someone's been slacking.
// :sexy-glbert:
// -----------------------------------------------------------------------------

// For some reason, when I just require App its type is `any`
// And I can't import App from '@slack/bolt' because it's not a module. Updating it to allow an import statement would require changing other project config
const { App } = require('@slack/bolt')

const dotenv = require('dotenv')

dotenv.config({
    path: './local.env',
})

// Require the Node Slack SDK package (github.com/slackapi/node-slack-sdk)
// Docs told me to do this, not sure it's actually necessary
const { WebClient, LogLevel } = require('@slack/web-api')

// WebClient instantiates a client that can call API methods
// When using Bolt, you can use either `app.client` or the `client` passed to listeners.
// Docs told me to do this, not sure it's actually necessary
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
})

// Listens to incoming messages that contain "hello"
app.message('hello', async ({ message, say }) => {
    app.logger.info('Received hello')

    // say() sends a message to the channel where the event was triggered
    // Weirdly, if I import App at the top of this file, it says user doesn't exist on message. But if I import it with require it works fine
    // @ts-expect-error this is a known bug, user definitely exists on message
    await say(`Hey there <@${message.user}>!`)
})

app.command('Bob', async ({ say }) => {
    app.logger.info('Received Bob command')
    await say(`Hey there <@message!>!`)
})
;(async () => {
    await app.start()

    app.logger.info('⚡️ Bolt app is running!')
})()
