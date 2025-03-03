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
// -----------------------------------------------------------------------------

import { App, StringIndexed, SayFn } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
// ChatGPT imported this but I don't believe it's doing anything; TODO delete this
import _ from 'lodash'

// Load environment variables; don't delete this
import dotenv from 'dotenv'
dotenv.config({
    path: './local.env',
})

/**Types of events that chesster responds to */
export type HearsEventType =
    | 'ambient'
    | 'direct_message'
    | 'direct_mention'
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

// Helper functions to check message types
function wantsBotMessage(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('bot_message')
}

function wantsDirectMessage(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('direct_message')
}

function wantsDirectMention(options: SlackEventListenerOptions) {
    return options.messageTypes.includes('direct_mention')
}

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
    app.message(combinedRegex, async ({ message, say, context }) => {
        console.log('received message inside app.message outside try')

        try {
            console.log('received message inside app.message inside try')

            const channelInfo = await getChannel(message.channel)
            if (!channelInfo) {
                app.logger.warn(
                    `Unable to get details for channel: ${message.channel}`
                )
                return
            }

            // @ts-expect-error this is a known bug, user definitely exists on message
            const user = message.user

            // Determine the message type
            const isBotMessage =
                message.subtype === 'bot_message' || 'bot_id' in message
            const isDirectMessage =
                channelInfo.is_im && !channelInfo.is_group && !isBotMessage
            // @ts-expect-error this is a known bug, text definitely exists on message
            const text = message.text || ''
            console.log('text:', text)
            const botUserId = context.botUserId
            const isDirectMention =
                text.includes(`<@${botUserId}>`) && !isBotMessage
            const isAmbient = !(
                isDirectMention ||
                isDirectMessage ||
                isBotMessage
            )

            app.logger.info('after isAmbient')

            // Find the matching pattern
            for (const pattern of options.patterns) {
                let matchText = text

                // Check if this listener wants this type of message
                let isWanted = false

                if (isDirectMessage && wantsDirectMessage(options)) {
                    isWanted = true
                } else if (isDirectMention && wantsDirectMention(options)) {
                    isWanted = true
                    matchText = matchText
                        .replace(`<@${botUserId}> `, '')
                        .replace(`<@${botUserId}>`, '')
                } else if (isAmbient && wantsAmbient(options)) {
                    isWanted = true
                } else if (isBotMessage && wantsBotMessage(options)) {
                    isWanted = true
                }

                console.log('user:', user)

                console.log('isWanted:', isWanted)

                // Here "continue" means "break out of this code block"
                if (!isWanted) continue

                const matches = matchText.match(pattern)
                if (matches) {
                    const chessterMessage: ChessterMessage = {
                        type: 'message',
                        user: user,
                        channel: channelInfo,
                        text: matchText.trim(),
                        ts: message.ts,
                        isPingModerator: false,
                    }

                    const commandMessage: CommandMessage = {
                        ...chessterMessage,
                        matches,
                    }

                    console.log('ABC')

                    // Apply middleware
                    let processedMessage = commandMessage
                    if (options.middleware) {
                        for (const middleware of options.middleware) {
                            processedMessage = middleware(processedMessage)
                        }
                    }

                    // Call the callback
                    options.callback(processedMessage, say)

                    // We found a match, so break the loop
                    break
                }
            }
        } catch (error) {
            app.logger.error(`Error handling message: ${error}`)
            await say(
                "Error handling message. Its probably MrScribbles' fault. :sexy-glbert:"
            )
        }
    })

    // This processes all messages that tag chesster directly (e.g. `@chesster source`)
    app.event('app_mention', async ({ event, say, context }) => {
        app.logger.info('Received app_mention event', event)

        // Get channel info
        const channelInfo = await getChannel(event.channel)
        if (!channelInfo) return

        // Get the text of the message minus the @chesster tag
        // So if the message is `@chesster source`, text will be `source`
        const messageText = event.text
            .replace(`<@${context.botUserId}> `, '')
            .replace(`<@${context.botUserId}>`, '')

        app.logger.info(`Processing mention with text: ${messageText}`)

        // Loop through listeners to find a match
        for (const options of listeners) {
            if (wantsDirectMention(options)) {
                for (const pattern of options.patterns) {
                    const matches = messageText.match(pattern)
                    if (matches) {
                        const chessterMessage: ChessterMessage = {
                            type: 'message',
                            user: event.user!,
                            channel: channelInfo,
                            text: messageText.trim(),
                            ts: event.ts,
                            isPingModerator: false,
                        }

                        const commandMessage: CommandMessage = {
                            ...chessterMessage,
                            matches,
                        }

                        // Apply middleware
                        let processedMessage = commandMessage
                        if (options.middleware) {
                            for (const middleware of options.middleware) {
                                processedMessage = middleware(processedMessage)
                            }
                        }

                        // Call the callback
                        options.callback(processedMessage, say)
                        break
                    }
                }
            }
        }
    })
}

// Simple reply function
async function reply(message: ChessterMessage, response: string, say: SayFn) {
    try {
        // If in a thread, reply in thread
        if (message.ts) {
            await say({
                text: response,
                thread_ts: message.ts,
            })
        } else {
            await say(response)
        }
    } catch (error) {
        app.logger.error(`Error replying to message: ${error}`)
    }
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
                await webClient.chat.postMessage({
                    channel: message.channel.id,
                    thread_ts: message.ts,
                    text: replyText,
                })
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
