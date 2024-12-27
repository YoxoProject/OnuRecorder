const {Client} = require('discord.js-selfbot-v13');
const {
    startRecording,
    stopRecording,
} = require('./recorder');

const BOT_TOKEN = '<token>';
const waitingList = [];// Liste des salons de conférence à enregistrer

const client = new Client({
    checkUpdate: false,
});

client.on('ready', async () => {
    console.log(`Selfbot connecté en tant que ${client.user.tag}`);
});

// Quand une conférence commence
client.on('stageInstanceCreate', async (stageInstance) => {
    if (stageInstance.guild.id.toString() !== "1273675047453855845") return; // TEMP: Si le serveur différent de Yoxo - NationsGlory, on return !

    const stageChannel = stageInstance.channel;

    if (!waitingList.length) {
        console.log(`Connexion au salon : ${stageChannel.name}`);
        await joinStageChannel(stageChannel);
    }
    if (waitingList.includes(stageChannel)) return;

    waitingList.push(stageChannel);
});

// Quand une conférence se termine
client.on('stageInstanceDelete', async (stageInstance) => {
    const stageChannel = stageInstance.channel;

    console.log(`Déconnexion du salon : ${stageChannel.name}`);
    await leaveStageChannel(stageChannel);

    const index = waitingList.indexOf(stageChannel.name);
    if (index > -1) waitingList.splice(index, 1);

    if (waitingList.length) {
        console.log(`Connexion au prochain salon : ${waitingList[0].name}`);
        await joinStageChannel(waitingList[0]);
    }
});

// Quand le bot se déconnecte ou se fait déconnecter d'un salon de conférence.
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.member.id !== client.user.id) return;

    const oldChannel = oldState.channel;
    const newChannel = newState.channel;

    if (oldChannel && oldChannel.type === 'GUILD_STAGE_VOICE' && oldChannel.name === waitingList[0].name) {
        console.log(`Déconnexion du salon : ${oldChannel.name}`);
        await stopRecording();
        // Delete the channel from the waiting list
        const index = waitingList.indexOf(oldChannel);
        if (index > -1) waitingList.splice(index, 1);
    }
});

/**
 * Se connecter à un salon de conférence
 */
async function joinStageChannel(stageChannel) {
    try {
        if (!stageChannel.joinable) {
            console.error(`Impossible de se connecter au salon : ${stageChannel.name}`);
            return;
        }

        const connection = await client.voice.joinChannel(stageChannel.id, {
            selfMute: true,
            selfDeaf: true,
            selfVideo: false,
        });
        startRecording(connection, stageChannel);
    } catch (error) {
        console.error(`Erreur lors de la connexion au salon : ${error}`);
    }
}

/**
 * Se déconnecter d'un salon de conférence
 */
async function leaveStageChannel(stageChannel) {
    try {
        if (stageChannel.guild.members.me.voice.channelId === stageChannel.id) {
            await stageChannel.guild.members.me.voice.disconnect();
            stopRecording();
        }
    } catch (error) {
        console.error(`Erreur lors de la déconnexion du salon : ${error.message}`);
    }
}

// Connexion du bot
client.login(BOT_TOKEN).then(r => console.log('Selfbot connecté avec succès.')).catch(console.error);
