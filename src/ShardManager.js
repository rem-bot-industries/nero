/**
 * Created by Julian on 13.04.2017.
 */

class ShardManager {
    constructor() {
        this.shards = {};
    }

    addShard(shard) {
        this.shards[shard.id] = shard;
        return this.shards[shard.id];
    }

    getShard(id) {
        return this.shards[id];
    }

    getAllShards() {
        return this.shards;
    }

    removeShard(id) {
        if (typeof (this.shards[id]) !== 'undefined') {
            delete this.shards[id];
        } else {
            throw new Error(`The shard ${id} does not exist.`);
        }
    }

    updateShardState(id, state) {
        if (typeof (this.shards[id]) !== 'undefined') {
            this.shards[id].shardState = state;
            return this.shards[id];
        } else {
            throw new Error(`The shard ${id} does not exist.`);
        }
    }

    updateWsState(id, state) {
        if (typeof (this.shards[id]) !== 'undefined') {
            this.shards[id].wsState = state;
            return this.shards[id];
        } else {
            throw new Error(`The shard ${id} does not exist.`);
        }
    }

    updateShardStats(id, stats) {
        if (typeof (this.shards[id]) !== 'undefined') {
            this.shards[id] = Object.assign(this.shards[id], stats);
            console.log(this.shards[id]);
            return this.shards[id];
        } else {
            throw new Error(`The shard ${id} does not exist.`);
        }
    }


    getShardId() {
        for (let shard in this.shards) {
            if (this.shards.hasOwnProperty(shard)) {
                console.log(this.shards[shard].wsState);
                if (this.shards[shard].wsState === 'disconnected') {
                    console.log(`Using not connected shard ${this.shards[shard].id}!`);
                    if (this.shards[shard].removeTimeOut) {
                        clearTimeout(this.shards[shard].removeTimeOut);
                    }
                    return this.shards[shard].id;
                }
            }
        }
        console.log(`Using new shard ${Object.keys(this.shards).length}!`);
        return Object.keys(this.shards).length;
    }

    getShardCount() {
        return Object.keys(this.shards).length
    }

    reassignShardIds() {
        let id = 0;
        let tempShards = {};
        for (let shard in this.shards) {
            if (this.shards.hasOwnProperty(shard)) {
                tempShards[id] = this.shards[shard];
                tempShards[id].id = id;
                id++;
            }
        }
        this.shards = tempShards;
    }
}
module.exports = ShardManager;