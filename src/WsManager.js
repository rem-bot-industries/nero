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

    }

    addWs(ws) {
        let id = uuid();
        this.connections[id] = {ws, authenticated: false, heartbeat: 20000, heartbeatTimeout: null, id};
        this.connections[id].ws.send(JSON.stringify({op: OPCODE.IDENTIFY}));
        this.connections[id].ws.on('message', (msg, flags) => {
            this.onMessage(msg, flags, this.connections[id])
        });
        this.connections[id].ws.on('close', (code, number) => {
            this.onDisconnect(code, number, this.connections[id])
        });
        this.connections[id].authTimeout = setTimeout(() => {
            this.onAuthTimeout(this.connections[id]);
        }, 10 * 1000);
    }

    onMessage(msg, flags, connection) {
        // winston.info(msg);
        try {
            msg = JSON.parse(msg);
        } catch (e) {
            console.error(msg);
            return console.error(e);
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
                }, 10 * 1000);
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
                            heartbeat: 20000,
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

    onHeartbeat(msg, connection) {
        if (typeof (this.connections[connection.id]) !== 'undefined') {
            connection.ws.send(JSON.stringify({op: OPCODE.HEARTBEAT}));
            clearTimeout(this.connections[connection.id].heartbeatTimeout);
            this.connections[connection.id].heartbeatTimeout = this.setupTimeout(this.connections[connection.id])
        }
    }

    onDisconnect(code, number, connection) {
        console.error(code, number);
        this.logWebhook(`Shard ${connection.shardID} disconnected with code ${code}!`, 'error');
        try {
            shardingManager.updateWsState(connection.shardID, 'disconnected');
        } catch (e) {

        }
        delete this.connections[connection.id];
    }

    onAuthTimeout(connection) {
        return connection.ws.close(4000, 'Auth Timeout!');
    }

    heartbeatTimeout(id) {
        if (typeof (this.connections[id]) !== 'undefined') {
            this.connections[id].shardState = 'unknown';
            this.connections[id].ws.close(4000, 'Heartbeat timeout');
        }
    }

    setupTimeout(connection) {
        return setTimeout(() => {
            this.heartbeatTimeout(connection.id);
        }, connection.heartbeat);
    }

    runAction(msg, connection) {
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
            default: {
                return;
            }
        }
    }

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