const fs = require('fs');
const path = require('path');
const wav = require('wav');
const {uploadRecordToS3} = require("./aws_upload.js");
const {channelIdRemapped} = require("./aws_upload");

class RecordingSession {
    constructor(client, stageChannel) {
        this.client = client;
        this.stageChannel = stageChannel;
        this.recordings = new Map();
        this.MAX_SILENCE_MILLIS = 30 * 1000; // 30 secondes
        this.interval = null;
    }

    async start() {
        try {
            if (!this.stageChannel.joinable) {
                console.error(`Impossible de se connecter au salon : ${this.stageChannel.name}`);
                return;
            }

            await this.stageChannel.guild.members.me.voice.disconnect();

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
                }
            });
            return true;
        } catch (error) {
            console.error(`Erreur lors de la connexion au salon : ${error}`);
            return false;
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
        const formattedDate = new Date().toISOString().split("T")[0]; // Format YYYY-MM-DD

        const outputPath = path.join(
            __dirname,
            `recordings/${channelIdRemapped(this.stageChannel.id.toString())}/${formattedDate}/${user.username}-${user.id}-${Date.now()}.pcm`
        );

        fs.mkdirSync(path.dirname(outputPath), {recursive: true});

        const audio = connection.receiver.createStream(user.id, {
            mode: 'pcm',
            end: 'manual',
        });

        audio.pipe(fs.createWriteStream(outputPath));

        audio.on('close', async () => {
            const message = await this.convertPcmToWav(outputPath, outputPath.replace('.pcm', '.wav'));
            console.log(message);
            fs.unlinkSync(outputPath);

            await new Promise((resolve) => setTimeout(resolve, 1000)); // Attendre 1 seconde pour éviter les problèmes de lecture
            await uploadRecordToS3(outputPath.replace('.pcm', '.wav'), this.stageChannel);
            fs.unlinkSync(outputPath.replace('.pcm', '.wav'));
        });

        this.recordings.set(user.id, {
            path: outputPath,
            audio,
            stopSpeaking: null,
        });

        audio.on("data", () => {
            this.addBlank(user);
        });
    }

    addBlank(user) {
        const recording = this.recordings.get(user.id);
        if (recording.stopSpeaking) {
            const currentTime = Date.now();
            const silenceBuffer = Buffer.alloc(48000 * 2 * 30, 0); // 30 seconds of silence at 48kHz, 16-bit stereo

            const elapsed = currentTime - recording.stopSpeaking;
            const silenceBytes = elapsed * 48 * 2; // Calculate bytes for silence duration
            recording.audio.push(silenceBuffer.slice(0, silenceBytes));

            recording.stopSpeaking = null;
        }
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