/**
 * Created by julia on 31.01.2017.
 */
require('dotenv').config();
//uwu
let shards = {};
let StatTrack = require('./statistics/botStatTrack');
let WsHandler = require('./ws/wsHandler');
const winston = require('winston');
let _ = require("lodash");
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, {
    'timestamp': true,
    'colorize': true
});
let wsServer = new WsHandler();
const tracker = new StatTrack(60);
wsServer.on('shard_ready', (data) => {
    console.log('Shard Ready!');
    shards[data.sid] = {guilds: 0, users: 0};
    // shardCount += data.sc;
});
wsServer.on('shard_removed', (data) => {
    console.log('Shard Removed!');
    delete shards[data.sid];
    // shardCount += data.sc;
});
wsServer.on('_guild_update', (data) => {
    shards[data.sid].guilds = data.data;
});
wsServer.on('_cache_update', (data) => {
    wsServer.broadcast('_cache_update', data)
});
wsServer.on('_user_update', (data) => {
    shards[data.sid].users = data.data;
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
    console.log(`Total Guilds: ${guilds}, Total Users: ${users}`);
    tracker.update(guilds, users);
});
winston.info('Master started! OwO');
winston.info(`Listening on IP: ${process.env.ws_host} and PORT: ${process.env.ws_port}`);