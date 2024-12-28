const fs = require('fs');
const path = require('path');
const wav = require('wav');

class RecordingSession {
    constructor(client, stageChannel) {
        this.client = client;
        this.stageChannel = stageChannel;
        this.recordings = new Map();
        this.MAX_SILENCE_MILLIS = 15 * 1000; // 15 secondes
        this.interval = null;
    }

    async start() {
        try {
            if (!this.stageChannel.joinable) {
                console.error(`Impossible de se connecter au salon : ${this.stageChannel.name}`);
                return;
            }

            const connection = await this.client.voice.joinChannel(this.stageChannel.id, {
                selfMute: true,
                selfDeaf: true,
                selfVideo: false,
            });

            console.log(`Enregistrement commencé pour le salon : ${this.stageChannel.name}`);

            this.interval = setInterval(() => this.checkForSilence(), 1000);

            connection.on('speaking', (user, speaking) => {
                const startSpeaking = speaking.bitfield === 1;
                if (startSpeaking && !this.recordings.has(user.id)) {
                    this.startRecording(user, connection);
                } else if (!startSpeaking) {
                    const recording = this.recordings.get(user.id);
                    if (recording) {
                        recording.stopSpeaking = Date.now();
                    }
                } else {
                    const recording = this.recordings.get(user.id);
                    if (recording) {
                        recording.stopSpeaking = null;
                    }
                }
            });
        } catch (error) {
            console.error(`Erreur lors de la connexion au salon : ${error}`);
        }
    }

    async stop() {
        clearInterval(this.interval);

        for (const recording of this.recordings.values()) {
            recording.audio.destroy();
        }

        this.recordings.clear();
        console.log(`Enregistrement terminé pour le salon : ${this.stageChannel.name}`);

        try {
            if (this.stageChannel.guild.members.me.voice.channelId === this.stageChannel.id) {
                await this.stageChannel.guild.members.me.voice.disconnect();
            }
        } catch (error) {
            console.error(`Erreur lors de la déconnexion : ${error.message}`);
        }
    }

    startRecording(user, connection) {
        const outputPath = path.join(
            __dirname,
            `recordings/${this.stageChannel.name}/${user.username}-${user.id}-${Date.now()}.pcm`
        );

        fs.mkdirSync(path.dirname(outputPath), {recursive: true});

        const audio = connection.receiver.createStream(user.id, {
            mode: 'pcm',
            end: 'manual',
        });

        audio.pipe(fs.createWriteStream(outputPath));

        audio.on('close', () => {
            this.convertPcmToWav(outputPath, outputPath.replace('.pcm', '.wav'))
                .then((message) => {
                    console.log(message);
                    fs.unlinkSync(outputPath);
                })
                .catch((error) => {
                    console.error(error);
                });
        });

        this.recordings.set(user.id, {
            path: outputPath,
            audio,
            stopSpeaking: null,
        });
    }

    checkForSilence() {
        const currentTime = Date.now();

        for (const [userId, recording] of this.recordings.entries()) {
            if (recording.stopSpeaking && currentTime - recording.stopSpeaking > this.MAX_SILENCE_MILLIS) {
                console.log(`Fermeture du flux pour inactivité : ${userId}`);
                recording.audio.destroy();
                this.recordings.delete(userId);
            }
        }
    }

    convertPcmToWav(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            try {
                const pcmData = fs.readFileSync(inputPath);
                const writer = new wav.Writer({
                    channels: 2,
                    sampleRate: 48000,
                    bitDepth: 16,
                });

                const outputStream = fs.createWriteStream(outputPath);
                writer.pipe(outputStream);
                writer.on('finish', () => {
                    resolve(`Conversion terminée : ${outputPath}`);
                });
                writer.on('error', (error) => {
                    reject(`Erreur lors de la conversion : ${error.message}`);
                });

                writer.write(pcmData);
                writer.end();
            } catch (error) {
                reject(`Erreur lors de la lecture du fichier PCM : ${error.message}`);
            }
        });
    }
}

module.exports = {RecordingSession};