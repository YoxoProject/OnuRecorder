const fs = require("fs");
const config = require("../config.json");
const path = require("path");
const {AbortController} = require("abort-controller");

let S3Client, PutObjectCommand;

// Importation dynamique du module ESM
(async () => {
    const sdk = await import("@aws-sdk/client-s3");
    S3Client = sdk.S3Client;
    PutObjectCommand = sdk.PutObjectCommand;

    initializeS3Client();
})();

let s3;

function initializeS3Client() {
    s3 = new S3Client({
        region: config.AWS_REGION,
        credentials: {
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
    });
}

async function uploadRecordToS3(record_file_path, stageChannel) {
    const date = new Date();
    const fileName = path.basename(record_file_path); // Récupère uniquement le nom du fichier
    const formattedDate = date.toISOString().split("T")[0]; // Format YYYY-MM-DD

    if (!fs.existsSync(record_file_path)) {
        console.error("Le fichier spécifié n'existe pas :", record_file_path);
        return;
    }

    const record = fs.readFileSync(record_file_path);

    const params = {
        Bucket: config.AWS_BUCKET_NAME,
        Key: `${channelIdRemapped(stageChannel.id.toString())}/${formattedDate}/${fileName}`,
        Body: record,
        ContentType: "audio/wav",
    };

    try {
        const data = await s3.send(new PutObjectCommand(params));
        console.log(`Enregistrement envoyé sur S3 : HTTP ${data.$metadata.httpStatusCode}`);
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'enregistrement sur S3 :", error);
    }
}

function channelIdRemapped(channelId) {
    switch (channelId) {
        case "1297495880479408158":
            return "MOCHA";
        case "1142876034967027762":
            return "BLUE";
        case "1142876353801228348":
            return "ORANGE";
        case "1234150236293828678":
            return "YELLOW";
        case "1142882475849306243":
            return "WHITE";
        case "1142882371998326984":
            return "PINK";
        case "1142882601388998656":
            return "BLACK";
        case "1143617770538401902":
            return "LIME";
        case "1142882421277204651":
            return "CYAN";
        case "1142882303090114590":
            return "CORAL";
        case "1142882746998460416":
            return "PURPLE";
        case "1165297482725597305":
            return "GREEN";
        case "1144980485685133342":
            return "RED";
        default:
            return channelId;
    }
}

async function startLambdaToTranscriptONU(channelId) {
    const server = channelIdRemapped(channelId);
    if (server === channelId) {
        console.error("Le salon spécifié n'est pas un salon ONU.");
        return;
    }
    const date = new Date().toISOString().split("T")[0]; // Format YYYY-MM-DD

    const url = `${config.AWS_TRANSCRIBE_URL}/${server}/${date}`;
    const controller = new AbortController();
    const {signal} = controller;

    try {
        const fetchPromise = fetch(url, {signal});

        // Annule la requête après 1s
        setTimeout(() => {
            controller.abort();
            console.log("Requête annulée.");
        }, 1000);
        await fetchPromise;
    } catch (error) {
        console.log("La requête a bien été envoyée.");
    }

}

module.exports = {uploadRecordToS3, channelIdRemapped, startLambdaToTranscriptONU};
