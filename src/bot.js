const {Client} = require('discord.js-selfbot-v13');
const {RecordingSession} = require('./recorder');
const config = require('../config.json');
const {startLambdaToTranscriptONU} = require("./aws_upload");

const waitingList = []; // Liste des salons à enregistrer, partagée entre tous les bots
const activeBots = []; // Liste des bots actifs
let must_assign_next_bot = false;

const ONU_CHANNEL_IDS = [
    "1297495880479408158", // MOCHA
    "1142876034967027762", // BLUE
    "1142876353801228348", // ORANGE
    "1234150236293828678", // YELLOW
    "1142882475849306243", // WHITE
    "1142882371998326984", // PINK
    "1142882601388998656", // BLACK
    "1143617770538401902", // LIME
    "1142882421277204651", // CYAN
    "1142882303090114590", // CORAL
    "1142882746998460416", // PURPLE
    "1165297482725597305", // GREEN
    "1144980485685133342" // RED
]

// Initialiser les bots avec les tokens
function initializeBots() {
    for (const token of config.botTokens) {
        const client = new Client({checkUpdate: false});

        client.on('ready', () => {
            console.log(`Bot connecté : ${client.user.tag}`);
        });

        client.on('stageInstanceCreate', async (stageInstance) => {
            if (token !== config.botTokens[0]) return; // Evite d'avoir 2 détetction simultanée (seul le premier bot détecte)
            if (stageInstance.guild.id !== "1273675047453855845" && !ONU_CHANNEL_IDS.includes(stageInstance.channelId.toString())) return;

            const stageChannel = stageInstance.channel;
            if (!waitingList.includes(stageChannel)) {
                waitingList.push(stageChannel);

                must_assign_next_bot = true;
            }
        });

        client.on('stageInstanceDelete', async (stageInstance) => {
            const stageChannel = stageInstance.channel;

            const bot = activeBots.find((bot) => bot.client === client && bot.recordingSession && bot.recordingSession.stageChannel === stageChannel);
            if (bot) {
                if (bot.recordingSession) {
                    await bot.recordingSession.stop();
                }
                bot.isBusy = false;
                must_assign_next_bot = true;
            } else {
                const waitingListChannel = waitingList.find((channel) => channel.id === stageChannel.id);
                if (waitingListChannel) {
                    waitingList.splice(waitingList.indexOf(waitingListChannel), 1);
                }
            }
        });

        client.on('voiceStateUpdate', async (oldState,) => {
            if (oldState.member.id !== client.user.id) return;

            const oldChannel = oldState.channel;
            const bot = activeBots.find((bot) => bot.client === client);
            if (oldChannel && oldChannel.type === 'GUILD_STAGE_VOICE' && bot.recordingSession && oldChannel.name === bot.recordingSession.stageChannel.name) {
                console.log(`Déconnexion du salon : ${oldChannel.name}`);

                const bot = activeBots.find((bot) => bot.client === client);
                if (bot.recordingSession) {
                    await bot.recordingSession.stop();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await startLambdaToTranscriptONU(oldChannel.id);
                }
                bot.isBusy = false;

                must_assign_next_bot = true;
            }
        });

        client.login(token).catch(console.error);
        activeBots.push({client, isBusy: false, recordingSession: null});
    }
    setInterval(() => {
        if (must_assign_next_bot) {
            assignNextAvailableBot().then(_ => must_assign_next_bot = false);
        }
    }, 500);
}

// Assigner un bot disponible au prochain salon
async function assignNextAvailableBot() {
    console.log(`Salons en attente : ${waitingList.length}`);

    const nextChannel = waitingList[0];
    if (!nextChannel) return;

    const availableBot = activeBots.find((bot) => !bot.isBusy);
    if (availableBot) {
        availableBot.isBusy = true;
        waitingList.shift();
        const recordingSession = new RecordingSession(availableBot.client, nextChannel);
        availableBot.recordingSession = recordingSession;
        await recordingSession.start();
    }
    if (waitingList.length > 1 && activeBots.find((bot) => !bot.isBusy)) { // S'il reste des salons à enregistrer et qu'il reste des bots disponibles
        await assignNextAvailableBot();
    }
}

initializeBots();