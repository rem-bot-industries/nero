/**
 * Created by Julian on 21.04.2017.
 */
const StatsD = require('hot-shots');
const axios = require('axios');
const winston = require('winston');
/**
 * The Statisticsmanager class, it provides methods to post statistics to various pages
 */
class StatisticManager {
    /**
     * Creates a new Statisticsmanager
     * @param {Object} options - the options
     * @param {Object} options.statsd - options for the statsd
     * @param {String} options.statsd.host - host adress of the statsd
     */
    constructor(options) {
        this.options = {
            abalBots: {track: false, token: ''},
            carbon: {track: false, token: ''},
            dbotsOrg: {track: false, token: ''},
            bot_id: '',
            statName: 'nero'
        };
        Object.assign(this.options, options);
        if (this.options.statsd.use) {
            this.dogstatsd = new StatsD({host: this.options.statsd.host});
        }
    }

    async postStats(guilds) {
        if (this.options.carbon.track) {
            let res = await this.postStatsCarbon(guilds);
            winston.info(res.data);
        }
        if (this.options.abalBots.track) {
            let res = await this.postStatsAbalBots(guilds);
            winston.info(res.data);
        }
        if (this.options.dbotsOrg.track) {
            let res = await this.postStatsDbotsOrg(guilds);
            winston.info(res.data);
        }
        return Promise.resolve();
    }

    async postStatsCarbon(guilds) {
        return axios({
            url: 'https://www.carbonitex.net/discord/data/botdata.php', method: 'post', data: {
                server_count: guilds,
                key: this.options.carbon.token
            }
        });
    }

    async postStatsAbalBots(guilds, bot_id) {
        return axios({
            url: `https://bots.discord.pw/api/bots/${this.options.bot_id}/stats`, method: 'post', data: {
                server_count: guilds
            },
            headers: {
                Authorization: this.options.abalBots.token
            }
        });
    }

    async postStatsDbotsOrg(guilds) {
        return axios({
            url: `https://discordbots.org/api/bots/${this.options.bot_id}/stats`, method: 'post', data: {
                server_count: guilds
            },
            headers: {
                Authorization: this.options.dbotsOrg.token
            }
        });
    }

    postStatsDataDog({guilds, users, channels, voiceConnections, activeVoiceConnections}) {
        if (this.options.statsd.use) {
            this.dogstatsd.gauge(`${this.options.statName}.guilds`, guilds);
            this.dogstatsd.gauge(`${this.options.statName}.users`, users);
            this.dogstatsd.gauge(`${this.options.statName}.channels`, channels);
            this.dogstatsd.gauge(`${this.options.statName}.voice_connections`, voiceConnections);
            this.dogstatsd.gauge(`${this.options.statName}.active_voice_connections`, activeVoiceConnections);
        }
    }
}
module.exports = StatisticManager;