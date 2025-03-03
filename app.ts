// -----------------------------------------------------------------------------
// This file's purpose is to help test our transition from Slack's old RTM API to the new Events API
// It opens a websocket connection to Slack's Events API and listens for messages in a channel
// I intend to move this logic to slack.ts. If you see this message, someone's been slacking.
// :sexy-glbert:

// To start this app, run `npx ts-node app.ts`

// Notes to self:
// payload.channel is the channel id

// command doesn't require chesster to figure out which league it's associated with, while league_command does.

// Message forwarding:https://github.com/Lichess4545/Chesster/blob/main/src/commands/messageForwarding.ts#L9-L102

// Note on type definitions: Most of these types were copied more or less directly from slack.ts and chesster.ts. I had trouble importing them so I copied them here, which probably isn't best practices but it's working for now.  When this logic is migrated in to slack.ts/chesster.ts, we can delete the duplicate type declarations if theyre unchanged, or update them if they've changed.

// OVERVIEW:

// This is the entry point for chesster. Chesster is built to interact with Slack's Events API through a websocket connection. Originally he was built on slack's RTM API but that was deprecated. This is built using Slack's Bolt framework.

// This file does the following:
// Start up chesster's server (that's what `app` is)
// Register chesster's listeners (each chesster.hears() calls tells chesster to listen for a different command)
// Processes incoming messages and sends appropriate responses by calling processChessterMessage

// Testing:
// Currently only the command processing functions in chessterUtils have automated tests; would like to test more

// -----------------------------------------------------------------------------

import { App, StringIndexed, SayFn } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
// ChatGPT imported this but I don't believe it's doing anything; TODO delete this
import _ from 'lodash'
// Processes incoming chesster commands and sends appropriate responses
import { processChessterMessage } from './utils/SlackEventsAPIUtils/chessterUtils'

// Load environment variables; don't delete this
import dotenv from 'dotenv'
dotenv.config({
    path: './local.env',
})

/**Types of events that chesster responds to */
export type HearsEventType =
    // Messages posted in channels where chesster is present, but the message doesn't tag @chesster directly
    | 'ambient'
    | 'direct_message'
    // Messages in a channel that tag @chesster directly
    | 'direct_mention'
    // Messages from other bots in slack
    | 'bot_message'

export interface SlackChannel {
    id: string
    name?: string
    is_im?: boolean
    is_group?: boolean
}

/** Message *to* chesster */
export interface ChessterMessage {
    type: 'message'
    user: string
    channel: SlackChannel
    text: string
    ts: string
    attachments?: any[]
    isPingModerator: boolean
}

export interface CommandMessage extends ChessterMessage {
    matches: RegExpMatchArray
}

// Middleware and callback types
export type MiddlewareFn = (message: CommandMessage) => CommandMessage

/**Function that is called when a chesster trigger happens */
export type CommandCallbackFn = (message: CommandMessage, say: SayFn) => void
export type LeagueCommandCallbackFn = (
    message: CommandMessage,
    // Call this function to send a message from chesster. For instance `say('Hello!')` will send 'Hello!'
    say: SayFn
) => void

export interface CommandEventOptions {
    type: 'command'
    patterns: RegExp[]
    messageTypes: HearsEventType[]
    middleware?: MiddlewareFn[]
    callback: CommandCallbackFn
}

export interface LeagueCommandEventOptions {
    type: 'league_command'
    patterns: RegExp[]
    messageTypes: HearsEventType[]
    middleware?: MiddlewareFn[]
    callback: LeagueCommandCallbackFn
}

export type SlackEventListenerOptions =
    | CommandEventOptions
    | LeagueCommandEventOptions

/**Determines whether a command can be triggered by another bot like slackbot */
function wantsBotMessage(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('bot_message')
}

/**Determines whether a command can be triggered by a direct message to chesster */
function wantsDirectMessage(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('direct_message')
}

/**Determines whether a command can be triggered by a direct mention of chesster in a channel */
function wantsDirectMention(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('direct_mention')
}

/**Determines whether a command can be triggered by a message in a channel where chesster is present, but not directly tagged */
function wantsAmbient(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('ambient')
}

/**The server thingy that chesster lives on */
const app = new App({
    token: process.env.BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
}) as App<StringIndexed>

const webClient = new WebClient(process.env.BOT_TOKEN)

/**List of chesster triggers. Each chesster.hears() call adds to this array */
const listeners: SlackEventListenerOptions[] = []

async function getChannel(
    channelId: string
): Promise<SlackChannel | undefined> {
    try {
        const result = await webClient.conversations.info({
            channel: channelId,
        })
        if (result.ok && result.channel) {
            return result.channel as SlackChannel
        }
    } catch (error) {
        app.logger.error(`Error getting channel: ${error}`)
    }
    return undefined
}

/**
 * Register a new listener for messages. Each `hears` call registers a new chesster prompt/command/trigger etc
 */
function hears(options: SlackEventListenerOptions): void {
    listeners.push(options)

    // Register the pattern with the Bolt app
    const regexPatterns = options.patterns.map((p) => p.source).join('|')
    const combinedRegex = new RegExp(regexPatterns, 'i')

    // This processes messages that do not tag chesster. I'm writing this early in the stages of migrating to Events API, but I believe this will be used for stuff like #team-scheduling where chesster isn't tagged directly, or scheduling DM responses that chesster uses to check responsiveness
    // Looking for messages that tag chesster directly? See the app.event block below
    app.message(combinedRegex, async ({ message, say, context }) => {
        try {
            const channelInfo = await getChannel(message.channel)
            if (!channelInfo) {
                app.logger.warn(
                    `Unable to get details for channel: ${message.channel}`
                )
                return
            }

            // @ts-expect-error this is a known bug; user definitely exists on message
            const user = message.user
            // @ts-expect-error this is a known bug; text definitely exists on message
            const text = message.text || ''

            // Sanitize received message, check if message matches a chesster command, and send appropriate chesster response
            await processChessterMessage({
                text,
                user,
                channel: channelInfo,
                ts: message.ts,
                app,
                say,
                botUserId: context.botUserId,
                isDirectMention: false,
                listeners,
            })
        } catch (error) {
            app.logger.error(`Error handling message: ${error}`)
            await say(
                "Error handling message. Its probably MrScribbles' fault. :sexy-glbert:"
            )
        }
    })

    // This processes all messages that tag chesster directly (e.g. `@chesster source`)
    // Looking for messages that don't tag chesster directly? See the app.message block above
    app.event('app_mention', async ({ event, say, context }) => {
        try {
            const channelInfo = await getChannel(event.channel)
            if (!channelInfo) return

            // Sanitize received message, check if message matches a chesster command, and send appropriate chesster response
            await processChessterMessage({
                text: event.text,
                // I can't imagine a scenario where event.user is undefined, but it's possible
                user: event.user!,
                channel: channelInfo,
                ts: event.ts,
                app,
                say,
                botUserId: context.botUserId,
                isDirectMention: true,
                listeners,
            })
        } catch (error) {
            app.logger.error(`Error handling app_mention: ${error}`)
            await say(
                "Error handling message. Its probably MrScribbles' fault. :sexy-glbert:"
            )
        }
    })
}

function initializeCommands() {
    // League source code
    hears({
        type: 'command',
        patterns: [/^source$/i],
        messageTypes: ['direct_mention', 'direct_message'],
        callback: async (message, say) => {
            const sourceUrl = 'https://github.com/Lichess4545/Chesster'

            const replyText = `The source code for Chesster can be found at: ${sourceUrl}`

            if (message.channel.is_im) {
                await say(replyText)
            } else {
                await say(replyText)
            }
        },
    })

    // List of chesster's commands
    hears({
        type: 'command',
        patterns: [/^commands$/i, /^command list$/i, /^help$/i],
        messageTypes: ['direct_mention', 'direct_message'],
        callback: async (message, say) => {
            const commandsText =
                'I will respond to the following commands:\n```' +
                '    [ starter guide ]              ! get the starter guide link\n' +
                '    [ rules | regulations ]        ! get the rules and regulations\n' +
                '    [ pairing | pairing <player> ] ! get your (or given <player>) latest pairings\n' +
                '    [ pairings ]                   ! get pairings link\n' +
                '    [ standings ]                  ! get standings link\n' +
                '    [ commands | command list ]    ! this list\n' +
                "    [ rating <player> ]            ! get the player's classical rating\n" +
                '    [ source ]                     ! github repo for Chesster\n' +
                '```'

            await say(commandsText)
        },
    })

    // Ping channel command for moderators
    hears({
        type: 'command',
        patterns: [/^ping channel$/i],
        messageTypes: ['direct_mention'],
        callback: async (message, say) => {
            // For now, anyone can ping the channel in our test
            // Or forever if I forget about this (TODO)
            await say('<!channel>')
        },
    })
}

// // Test/proof of concept
// app.message('hello', async ({ message, say }) => {
//     app.logger.info('Received hello')

//     app.logger.info('payload.channel', message.channel)

//     // say() sends a message to the channel where the event was triggered
//     // Weirdly, if I import App at the top of this file, it says user doesn't exist on message. But if I import it with require it works fine
//     // @ts-expect-error this is a known bug, user definitely exists on message
//     await say(`Hey there <@${message.user}>!`)
// })

// // Test/proof of concept

// app.event('app_mention', async ({ say, payload }) => {
//     app.logger.info('Received app_mention event')

//     app.logger.info('payload.channel', payload.channel)

//     await say(`Hey there <@${payload.user}>!`)
// })

// app.command('/bob', async ({ command, ack, say }) => {
//     await ack()
//     app.logger.info('Received Bob command')
//     await say(`Hey there <@${command.user_id}>!`)
// })

// Start up event listeners n'stuff
initializeCommands()
;(async () => {
    await app.start()
    app.logger.info('⚡️ Bolt app is running!')
})()
