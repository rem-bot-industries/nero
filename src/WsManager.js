/**
 * Created by Julian on 16.04.2017.
 */
const ShardManager = require('./ShardManager');
const uuid = require('uuid/v4');
const StatisticsManager = require('./StatisticManager');
const StatsD = require('hot-shots');
const WebhookManager = require('./WebhookManager');
const winston = require('winston');
let shardingManager = new ShardManager();
class WsManager {
    constructor(options) {
        this.options = options.manager;
        this.webhook = options.webhook;
        this.statsd = options.statsd;
        this.stat = options.statistics.statName;
        this.connections = {};
        this.readyTimeout = null;
        this.statManager = new StatisticsManager(Object.assign(options.statistics, {statsd: options.statsd}));
        if (options.webhook.use) {
            this.webhookManager = new WebhookManager(options.webhook);
        }
        if (options.statistics.track) {
            this.statisticInterval = setInterval(() => {
                this.trackStatistics().then(() => {

                }).catch(e => {
                    console.error(e);
                    this.logWebhook('Posting stats failed!');
                });
            }, this.options.trackStatsInterval * 1000);
        }
        if (options.statsd.use) {
            this.dogstatsd = new StatsD({host: options.statsd.host});
        }
        this.waitingResponses = {};
    }

    addWs(ws) {
        if (this.statsd.use) {
            this.dogstatsd.increment(`${this.stat}.websocket_connect`);
        }
        let id = uuid();
        this.connections[id] = {ws, authenticated: false, heartbeat: 5000, heartbeatTimeout: null, id};
        this.connections[id].ws.send(JSON.stringify({op: OPCODE.IDENTIFY}));
        this.connections[id].ws.on('message', (msg, flags) => {
            this.onMessage(msg, flags, this.connections[id])
        });
        this.connections[id].ws.on('close', (code, reason) => {
            if (this.statsd.use) {
                this.dogstatsd.increment(`${this.stat}.websocket_disconnect`);
            }
            this.onDisconnect(code, reason, this.connections[id])
        });
        this.connections[id].authTimeout = setTimeout(() => {
            this.onAuthTimeout(this.connections[id]);
        }, 10 * 1000);
    }

    onMessage(msg, flags, connection) {
        try {
            msg = JSON.parse(msg);
        } catch (e) {
            console.error(msg);
            return console.error(e);
        }
        // console.log(JSON.stringify(msg));
        if (this.statsd.use) {
            this.dogstatsd.increment(`${this.stat}.websocket_message`);
        }
        switch (msg.op) {
            case OPCODE.IDENTIFY: {
                if (msg.d.token !== this.options.token) {
                    return connection.ws.close(4000, 'Bad Token!');
                }
                clearTimeout(this.connections[connection.id].authTimeout);
                let shardID;
                let shardState = 'unknown';
                if (msg.d.shardState) {
                    shardState = msg.d.shardState;
                }
                if (!msg.d.shardID) {
                    shardID = shardingManager.getShardId();
                }
                this.connections[connection.id].shardID = shardID;
                shardingManager.addShard({
                    id: shardID,
                    shardState: shardState,
                    wsState: 'authenticated',
                    guilds: 0,
                    users: 0,
                    channels: 0,
                    voice: 0,
                    voice_active: 0,
                    host: msg.d.host,
                    pid: msg.d.pid
                });
                this.logWebhook(`Shard ${shardID} identified with state ${shardState}`);
                clearTimeout(this.readyTimeout);
                this.readyTimeout = setTimeout(() => {
                    this.sendReady();
                }, 25 * 1000);
                return;
            }
            case OPCODE.HEARTBEAT: {
                this.onHeartbeat(msg, connection);
                return;
            }
            case OPCODE.MESSAGE: {
                if (msg.d.action) {
                    return this.runAction(msg, connection);
                }
                return;
            }
            case OPCODE.STATS_UPDATE: {
                shardingManager.updateShardStats(connection.shardID, msg.d);
                return;
            }
            case OPCODE.STATE_UPDATE: {
                shardingManager.updateShardState(connection.shardID, msg.d.state);
                this.logWebhook(`Shard ${connection.shardID} updated state to ${msg.d.state}`);
                return;
            }
            default:
                return console.error(`Unknown Message ${JSON.stringify(msg)}`);
        }
    }

    sendReady() {
        for (let key in this.connections) {
            if (this.connections.hasOwnProperty(key)) {
                let connection = this.connections[key];
                try {
                    connection.ws.send(JSON.stringify({
                        op: OPCODE.READY,
                        d: {
                            heartbeat: 5000,
                            sid: connection.shardID,
                            sc: shardingManager.getShardCount()
                        }
                    }));
                } catch (e) {
                    console.error(e);
                    return this.sendReady();
                }
                // winston.info(connection.heartbeat);

                this.connections[connection.id].heartbeatTimeout = this.setupTimeout(this.connections[connection.id])
            }
        }
    }

    /**
     * Reset the heartbeat timeout, send a heartbeat ack and restart the timeout
     * @param {Object} msg data
     * @param {Object} connection The connection object
     */
    onHeartbeat(msg, connection) {
        if (typeof (this.connections[connection.id]) !== 'undefined') {
            try {
                connection.ws.send(JSON.stringify({op: OPCODE.HEARTBEAT}));
            } catch (e) {
                console.error(e);
            }
            clearTimeout(this.connections[connection.id].heartbeatTimeout);
            this.connections[connection.id].heartbeatTimeout = this.setupTimeout(this.connections[connection.id])
        }
    }

    /**
     * Log the disconnect to the webhook and the console and update the
     * internal state then delete the client from the connections
     * @param {Number} code Errorcode (1006 -> regular disconnect,
     * 4000 -> client)
     * @param {String} reason Reason for the disconnect
     * @param {Object} connection The connection object
     */
    onDisconnect(code, reason, connection) {
        clearTimeout(this.connections[connection.id].heartbeatTimeout);
        console.error(code, reason);
        console.error(`Shard ${connection.shardID} disconnected with code ${code}! HOST:${shardingManager.getShard(connection.shardID).host}`);
        this.logWebhook(`Shard ${connection.shardID} disconnected with code ${code}! HOST:${shardingManager.getShard(connection.shardID).host}`, 'error');
        try {
            shardingManager.updateWsState(connection.shardID, 'disconnected');
        } catch (e) {

        }
        delete this.connections[connection.id];
    }

    /**
     * Close the connection because the client did not authenticate in time
     * @param {Object} connection The connection object
     */
    onAuthTimeout(connection) {
        return connection.ws.close(4000, 'Auth Timeout!');
    }

    /**
     * Close the connection and increment the websocket timeout tracker on datadog
     * @param {String} id Id of the connection
     */
    heartbeatTimeout(id) {
        if (typeof (this.connections[id]) !== 'undefined') {
            if (this.statsd.use) {
                this.dogstatsd.increment(`${this.stat}.websocket_timeout`);
            }
            this.connections[id].shardState = 'unknown';
            this.connections[id].ws.close(4000, 'Heartbeat timeout');
        }
    }

    /**
     * Create a timeout and disconnect the client if it isn't cleared within
     * heartbeat+4 seconds
     * @param {Object} connection The connection object
     * @return {Object}
     */
    setupTimeout(connection) {
        clearTimeout(this.connections[connection.id].heartbeatTimeout);
        return setTimeout(() => {
            this.heartbeatTimeout(connection.id);
        }, connection.heartbeat + 4000);
    }

    /**
     * Executes a action based on the message
     * @param {Object} msg Message from the websocket
     * @param {Object} connection The connection object
     * @return {Promise.<*>}
     */
    async runAction(msg, connection) {
        // winston.info(msg);
        switch (msg.d.action) {
            case 'bot_info': {
                let shards = shardingManager.getAllShards(connection.shardID);
                connection.ws.send(JSON.stringify({
                    op: OPCODE.MESSAGE,
                    d: {shards, action: 'bot_info_data', actionId: msg.d.actionId}
                }));
                return;
            }
            case 'shard_info': {
                if (msg.d.actionId) {
                    if (typeof (this.waitingResponses[msg.d.actionId]) !== 'undefined') {
                        return this.waitingResponses[msg.d.actionId].onMessage(msg);
                    }
                    this.broadcast({action: 'shard_info', actionId: msg.d.actionId, request: true});
                    try {
                        let res = await this.awaitReponseAll(msg.d.actionId);
                        connection.ws.send(JSON.stringify({
                            op: OPCODE.MESSAGE,
                            d: {shards: res.shards, action: 'shard_info', actionId: msg.d.actionId}
                        }));
                        delete this.waitingResponses[msg.d.actionId];
                    } catch (e) {
                        console.error(e);
                    }
                }
                return;
            }
            default: {
                return;
            }
        }
    }

    awaitResponseSingle() {

    }

    /**
     * Awaits a response from all shards
     * @param id Event id to await
     * @return {Promise}
     */
    awaitReponseAll(id) {
        return new Promise((res, rej) => {
            this.waitingResponses[id] = {
                onMessage: (msg) => {
                    // console.log('ON MESSAGE');
                    this.waitingResponses[id].shards[msg.d.shardID] = msg.d;
                    if (Object.keys(this.waitingResponses[id].shards).length === Object.keys(this.connections).length) {
                        clearTimeout(this.waitingResponses[id].responseTimeout);
                        res(this.waitingResponses[id]);
                    }
                },
                shards: {},
                responseTimeout: setTimeout(() => {
                    try {
                        rej(this.waitingResponses[id]);
                    } catch (e) {

                    }
                }, 5000)
            }
        });
    }

    /**
     * Sends a broadcast message to all connected and authenticated shards
     * @param {Object} msg data to send
     */
    broadcast(msg) {
        for (let key in this.connections) {
            if (this.connections.hasOwnProperty(key)) {
                let connection = this.connections[key];
                try {
                    connection.ws.send(JSON.stringify({
                        op: OPCODE.MESSAGE,
                        d: msg
                    }));
                } catch (e) {
                    console.error(e);
                }
            }
        }
    }

    /**
     * Posts the stats to Datadog and various bot sites
     * @return {Promise.<void>}
     */
    async trackStatistics() {
        let shards = shardingManager.getAllShards();
        let stats = {guilds: 0, users: 0, channels: 0, voiceConnections: 0, activeVoiceConnections: 0};
        for (let key in shards) {
            if (shards.hasOwnProperty(key)) {
                let shard = shards[key];
                if (shard.shardState === 'bot_ready') {
                    stats.guilds += shard.guilds;
                    stats.users += shard.users;
                    stats.channels += shard.channels;
                    stats.voiceConnections += shard.voice;
                    stats.activeVoiceConnections += shard.voice_active;
                }
            }
        }
        this.statManager.postStatsDataDog(stats);
        await this.statManager.postStats(stats.guilds);
    }

    /**
     * Logs a message to the webhook set in the config
     * @param {String} message
     * @param {String} level
     */
    logWebhook(message, level) {
        if (this.webhook.use) {
            this.webhookManager.log(message, level).then(() => {

            }).catch(e => {
                console.error(e)
            });
        }
    }
}
module.exports = WsManager;