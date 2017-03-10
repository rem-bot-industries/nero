/**
 * Created by julia on 31.01.2017.
 */
//nya :3
const winston = require('winston');
let _ = require("lodash");
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
    'timestamp': true,
    'colorize': true
});
let config;
try {
    if (process.env.secret_name) {
        config = require(`/run/secrets/${process.env.secret_name}`);
        winston.info(`Using docker secrets!`);
    } else {
        config = require('./config/main.json');
        winston.info(`Using local secrets!`);
    }

} catch (e) {
    winston.error(e);
    winston.error('Failed to require config!');
    process.exit(1);
}
global.remConfig = config;
if (!remConfig.tracking_enabled) {
    winston.warn(`Tracking is disabled!`);
} else {
    winston.info(`Using statsdhost: ${remConfig.dogstatsd_host}`);
}

let shards = {};
let StatTrack = require('./statistics/botStatTrack');
let WsHandler = require('./ws/wsHandler');
let wsServer = new WsHandler();
const tracker = new StatTrack(60);
wsServer.on('shard_ready', (data) => {
    winston.info(`Shard ${data.sid} Ready!`);
    shards[data.sid] = {guilds: 0, users: 0};
    // shardCount += data.sc;
});
wsServer.on('shard_removed', (data) => {
    winston(`Shard ${data.sid} Removed!`);
    delete shards[data.sid];
    // shardCount += data.sc;
});
wsServer.on('_guild_update', (data) => {
    if (typeof (data.sid) !== 'undefined') {
        try {
            shards[data.sid].guilds = data.data;
        } catch (e) {
            console.error(e);
            shards[data.sid] = shards[data.sid] ? shards[data.sid] : {guilds: 0, users: 0};
            shards[data.sid].guilds = data.data;
        }
    }
});
wsServer.on('_cache_update', (data) => {
    wsServer.broadcast('_cache_update', data)
});
wsServer.on('_user_update', (data) => {
    if (typeof (data.sid) !== 'undefined') {
        try {
            shards[data.sid].users = data.data;
        } catch (e) {
            console.error(e);
            shards[data.sid] = shards[data.sid] ? shards[data.sid] : {guilds: 0, users: 0};
            shards[data.sid].users = data.data;
        }
    }
});
wsServer.on('request_data', (event) => {
    /**
     * send a request_data_master event to all shards
     */
    // console.log(event);
    wsServer.broadcast('request_data_master', event);
    let shardData = {};
    let responses = 0;
    /**
     * set up a timeout
     */
    let time = setTimeout(() => {
        returnData({err: 'Timeout!'});
    }, 3000);
    /**
     * Called once a shard received the request and submitted data
     */
    wsServer.on(`resolve_data_master_${event.id}`, (data) => {
        if (shardData[data.sid]) return;
        shardData[data.sid] = data;
        responses++;
        if (responses === Object.keys(shards).length) {
            clearTimeout(time);
            wsServer.removeListener(`resolve_data_master_${event.id}`);
            returnData(shardData);
        }
    });
    /**
     * Resolves the data request
     * @param data
     */
    function returnData(data) {
        wsServer.broadcast(`resolved_data_${event.id}`, data);
    }
});
tracker.on('error', (err) => {
    console.error(err);
});
tracker.on('fetch', () => {
    let guilds = 0;
    let users = 0;
    _.forIn(shards, (value, key) => {
        guilds += value.guilds;
        users += value.users;

    });
    winston.info(`Total Guilds: ${guilds}, Total Users: ${users}`);
    tracker.update(guilds, users);
});
winston.info('Master started! OwO');
winston.info(`Listening on IP: ${remConfig.ws_host} and PORT: ${remConfig.ws_port}`);
