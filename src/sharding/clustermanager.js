const master = require("cluster");
const cluster = require("./cluster.js");
const numCPUs = require('os').cpus().length;
const logger = require("../utils/logger.js");
class ClusterManager {
    constructor(token, mainFile) {
        this.shardCount = 0;
        this.token = token;
        this.clusters = new Map();
        this.maxShards = 0;
        this.mainFile = mainFile;
        this.firstShardID = -1;
        this.shardSetupStart = 0;

        this.launch();
    }




    start(amount, numSpawned) {
        if (numSpawned === amount) {
            logger.info("Cluster Manager", "Clusters have been started!");
        } else {
            let worker = master.fork();
            this.clusters.set(worker.id, { worker: worker });

            numSpawned = numSpawned + 1;
            let self = this;
            setTimeout(function () {
                self.start(amount, numSpawned);
            }, 1000);
        }
    }

    async launch() {

        logger.info("General", "Cluster Manager has started!");
        const Discord = require("eris");
        let client = new Discord(this.token);
        client.getBotGateway().then(result => {
            this.shardCount = result.shards;
            this.maxShards = this.shardCount;
            logger.info("Cluster Manager", `Need ${this.shardCount} shard(s)!`);
        });

        if (master.isMaster) {

            master.setupMaster({
                silent: true
            });
            // Fork workers.
            await this.start(numCPUs, 0);
            let self = this;
            setTimeout(function () {
                self.roundRobinParser(master.workers);
            }, 5000);

        } else if (master.isWorker) {
            const Cluster = new cluster();
            Cluster.spawn();
        }



        master.on('message', (worker, message, handle) => {
            if (message.type && message.type === "log") {
                logger.log(`Cluster ${worker.id}`, `${message.msg}`)
            }

            if (message.type && message.type === "debug") {
                logger.debug(`Cluster ${worker.id}`, `${message.msg}`);
            }
            if (message.type && message.type === "info") {
                logger.info(`Cluster ${worker.id}`, `${message.msg}`);
            }
            if (message.type && message.type === "warn") {
                logger.warn(`Cluster ${worker.id}`, `${message.msg}`);
            }
            if (message.type && message.type === "error") {
                logger.error(`Cluster ${worker.id}`, `${message.msg}`);
            }
            if (message.type & message.type === "shardsStarted") {
                this.startupShards(this.shardSetupStart);
            }
        });

        master.on('exit', (worker, code, signal) => {
            logger.warn("Cluster Manager", `cluster ${worker.id} died. Restarting.`);
            let id = worker.id;
            let cluster = this.clusters.get(id);
            let shards = cluster.shardCount;
            let worker1 = master.fork();
            worker1.send({
                message: "shards",
                type: "reboot",
                shards: shards,
                firstShardID: cluster.firstShardID,
                lastShardID: cluster.lastShardID,
                maxShards: this.maxShards,
                token: this.token,
                file: this.mainFile
            });
            this.clusters.delete(worker1.id);
            this.clusters.set(worker1.id, worker1);
            let newCluster = this.clusters.get(worker1.id);
            newCluster.shardCount = shards;
            newCluster.firstShardID = cluster.firstShardID;
            newCluster.lastShardID = cluster.lastShardID;
        });
    }


    roundRobinParser(clusters) {
        let clusters1 = Object.entries(clusters);
        this.roundRobin(clusters1, 0);
    }

    roundRobin(clusters, start) {
        if (this.shardCount > 0) {
            let cluster = clusters[start];
            if (!cluster) {
                start = 0;
                let cluster = clusters[start];
                let c = cluster[1];
                //ic = internal cluster
                let ic = this.clusters.get(c.id);
                let shards = this.shardCount;
                c.send({
                    message: "shards",
                    type: "round-robin",
                    shards: 1
                });
                if (ic.shardCount) {
                    ic.shardCount = ic.shardCount + 1;
                } else {
                    ic.shardCount = 1;
                }
                this.shardCount = shards - 1;
                let self = this;
                setTimeout(function () {
                    self.roundRobin(clusters, start + 1);
                }, 250);

            } else {
                let c = cluster[1];
                let shards = this.shardCount;
                let ic = this.clusters.get(c.id);
                c.send({
                    message: "shards",
                    type: "round-robin",
                    shards: 1
                });
                if (ic.shardCount) {
                    ic.shardCount = ic.shardCount + 1;
                } else {
                    ic.shardCount = 1;
                }
                this.shardCount = shards - 1;
                let self = this;
                setTimeout(function () {
                    start = start + 1
                    self.roundRobin(clusters, this.shardSetupStart);
                }, 500);
            }
        } else {
            console.log("No shards left to round-robin. Starting to connect");
            this.startupShards(0);
        }
    }

    startupShards(start) {
        let cluster = this.clusters.get(start + 1);
        if (cluster) {
            let firstShardID = this.firstShardID + 1;
            cluster.worker.send({ message: "connect", firstShardID: firstShardID, lastShardID: firstShardID + cluster.shardCount - 1, maxShards: this.maxShards, token: this.token, file: this.mainFile });
            this.firstShardID = firstShardID + cluster.shardCount;
            this.shardSetupStart += 1;
            cluster.firstShardID = firstShardID;
            cluster.lastShardID = firstShardID + cluster.shardCount;
        }
    }
}

module.exports = ClusterManager;