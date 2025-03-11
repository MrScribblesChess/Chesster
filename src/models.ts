'use strict'

// -----------------------------------------------------------------------------
// Models for our locally stored data
// -----------------------------------------------------------------------------
import winston from 'winston'
import { Sequelize, Model, DataTypes } from 'sequelize'
import { ChessterConfig } from './config'

export class LichessRating extends Model {
    public id!: number
    public lichessUserName!: string
    public rating!: number
    public lastCheckedAt!: Date
}

export class Subscription extends Model {
    public id!: number
    public requester!: string
    public source!: string
    public event!: string
    public target!: string
    public league!: string
}

// -------------------------------------------------------------------------
function defineModels(sequelize: Sequelize) {
    LichessRating.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            lichessUserName: DataTypes.STRING, // Comes from lichess
            rating: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            lastCheckedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        },
        {
            sequelize,
            tableName: 'LichessRatings',
        }
    )
    Subscription.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            requester: {
                type: DataTypes.STRING,
                unique: 'eventUnique',
            },
            source: {
                type: DataTypes.STRING,
                unique: 'eventUnique',
            },
            event: {
                type: DataTypes.STRING,
                unique: 'eventUnique',
            },
            target: {
                type: DataTypes.STRING,
                unique: 'eventUnique',
            },
            league: {
                type: DataTypes.STRING,
                unique: 'eventUnique',
            },
        },
        {
            sequelize,
            tableName: 'Subscriptions',
        }
    )
}

// -------------------------------------------------------------------------
// Connection function that ensures we have a connection and the models
// are defined.
//
// Parameters: config - the config option that contains the database
//                      information.
// -------------------------------------------------------------------------
export async function connect(config: ChessterConfig) {
    if (config.database.dialect !== 'postgres') {
        throw new Error(
            "We don't support anything but postgresql because I'm lazy"
        )
    }

    /** How long to wait for db connection to succeed before moving on */
    const numMSTimeout = 10_000

    // Add connection timeout to prevent hanging
    const connectionOptions = {
        ...config.database,
        dialect: 'postgres' as const,
        // Add connection timeout
        dialectOptions: {
            // TODO Events API: delete this db connect timeout when I don't need it for testings
            connectTimeout: numMSTimeout,
        },
    }

    const sequelize = new Sequelize(
        config.database.name,
        config.database.username,
        config.database.password,
        connectionOptions
    )

    try {
        winston.info('[models.connect()] Attempting to connect to database...')
        await Promise.race([
            sequelize.authenticate(),
            new Promise((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error(
                                `Database connection timeout after ${numMSTimeout} seconds`
                            )
                        ),
                    numMSTimeout
                )
            ),
        ])
        winston.info('[models.connect()] Database connection successful')
        defineModels(sequelize)
    } catch (e) {
        winston.error(`[models.connect()] Error connecting to db: ${e}`)
        throw e
    }
}
