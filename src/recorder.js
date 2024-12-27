const fs = require('fs');
const path = require('path');
const wav = require('wav');

const recordings = new Map();
const MAX_SILENCE_MILLIS = 15 * 1000; // 15 secondes

function startRecording(connection, channelId) {

    console.log(`Enregistrement commencé pour le salon : ${channelId}`);

    setInterval(checkForSilence, 1000);

    connection.on('speaking', (user, speaking) => {
        const startSpeaking = speaking.bitfield === 1;
        if (startSpeaking && !recordings.has(user.id)) {
            const outputPath = path.join(__dirname, `${channelId.name}/${user.username}-${user.id}-${Date.now()}.pcm`);

            // Create parent directories if they don't exist
            fs.mkdirSync(path.dirname(outputPath), {recursive: true});

            const audio = connection.receiver.createStream(user.id, {
                mode: 'pcm',
                end: 'manual',
            });

            audio.pipe(fs.createWriteStream(outputPath));

            audio.on("close", () => {
                convertPcmToWav(outputPath, outputPath.replace('.pcm', '.wav')).then((message) => {
                    console.log(message);
                    fs.unlinkSync(outputPath); // Remove the PCM file
                }).catch((error) => {
                    console.error(error);
                });
            });

            recordings.set(user.id, {
                path: outputPath,
                audio,
                stopSpeaking: null,
            });
        } else if (!startSpeaking) {
            const recording = recordings.get(user.id);
            if (recording) {
                recording.stopSpeaking = Date.now();
            }
        }
    });
}

function stopRecording() {
    for (const recording of recordings.values()) {
        recording.audio.destroy(); // Stop the audio stream, which will also close the write stream and convert the PCM to WAV
    }
    recordings.clear();
    console.log('Enregistrement terminé');
    console.log('Tous les flux ont été fermés');
    console.log(recordings)
}

function checkForSilence() {
    const currentTime = Date.now();

    for (const [userId, recording] of recordings.entries()) {
        if (recording.stopSpeaking && currentTime - recording.stopSpeaking > MAX_SILENCE_MILLIS) {
            console.log(`Fermeture du flux pour inactivité : ${userId}`);
            recording.audio.destroy();
            recordings.delete(userId);
        }
    }
}

/**
 * Convert a PCM file to WAV format
 * @param {string} inputPath - Path to the PCM file
 * @param {string} outputPath - Path for the resulting WAV file
 * @returns {Promise<string>} - Resolves with a success message
 */
function convertPcmToWav(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            // Read PCM data
            const pcmData = fs.readFileSync(inputPath);
            // WAV writer configuration
            const writer = new wav.Writer({
                channels: 2, // Stereo
                sampleRate: 48000, // Match your recording sample rate
                bitDepth: 16, // Match your recording a bit depth
            });

            const outputStream = fs.createWriteStream(outputPath);
            writer.pipe(outputStream);
            writer.on('finish', () => {
                resolve(`Conversion terminée : ${outputPath}`);
            });
            writer.on('error', (error) => {
                reject(`Erreur lors de la conversion : ${error.message}`);
            });
            // Write PCM data to WAV writer
            writer.write(pcmData);
            writer.end();
        } catch (error) {
            reject(`Erreur lors de la lecture du fichier PCM : ${error.message}`);
        }
    });
}

module.exports = {
    startRecording,
    stopRecording,
};